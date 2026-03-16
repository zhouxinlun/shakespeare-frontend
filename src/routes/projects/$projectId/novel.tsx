import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Brain,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

import { novelApi, projectApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'
import type {
  BookEvaluation,
  BookEvaluationHistory,
  Novel,
  NovelChatHistory,
  NovelEvaluation,
  NovelLatestEvaluation,
  NovelLiveEvaluation,
  NovelStats,
} from '@/types/api'
import type { Project } from '@/types/pipeline'

type ParseMode = 'auto' | 'rule_only' | 'ai_only'
type ParsePath = 'guided_rule' | 'intelligent'
type RuleType = 'title' | 'separator' | 'custom'
type TwistStrategy = 'aggressive' | 'balanced' | 'conservative'
type CliffhangerStyle = 'suspense' | 'reversal' | 'climax' | 'dialogue'
type DashboardTab = 'overview' | 'consistency' | 'suggestions' | 'trend'
type ChatSkill = 'auto' | 'chapter_eval' | 'chapter_rewrite' | 'story_overview' | 'character_insight' | 'platform_advice'

interface ParsedChapter {
  volume?: string
  chapter_index: number
  chapter_title?: string
  content: string
}

interface ParseAnalysis {
  total_chars: number
  paragraphs: number
  chapter_heading_hits: number
  separator_hits: number
  twist_marker_count: number
  suggested_path?: ParsePath
  suggested_rule_type?: RuleType
}

interface StreamEvent {
  type?: string
  message?: string
  progress?: number
  data?: unknown
  [key: string]: unknown
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  skill?: Exclude<ChatSkill, 'auto'>
  createdAt?: string
  isStreaming?: boolean
}

const CHAT_SKILLS: Array<{ value: ChatSkill; label: string; hint: string }> = [
  { value: 'auto', label: '自动推荐', hint: '根据问题自动匹配最合适的技能' },
  { value: 'chapter_eval', label: '章节评估', hint: '给出问题定位与优先级建议' },
  { value: 'chapter_rewrite', label: '章节改写', hint: '输出可替换正文与改写意图' },
  { value: 'story_overview', label: '全书梳理', hint: '总结结构与节奏风险' },
  { value: 'character_insight', label: '人物分析', hint: '分析关系、动机与成长线' },
  { value: 'platform_advice', label: '平台建议', hint: '给出发布与包装建议' },
]

const CHAT_QUICK_PROMPTS: Record<ChatSkill, string[]> = {
  auto: [
    '请先判断我最需要用哪个技能，再给出3条可执行建议。',
    '请按当前章节问题给出优先级最高的改进动作。',
    '我下一步先改哪几章最划算？',
  ],
  chapter_eval: [
    '评估我选中章节的转折与挂念，按 high/medium/low 给建议。',
    '指出最影响留存的3个问题，并给出可执行修改动作。',
    '如果我只能改一处，最应该改哪里，为什么？',
  ],
  chapter_rewrite: [
    '把当前最后一段改成“悬念型结尾”，保留人设和设定。',
    '把这一章开头改得更抓人，要求30秒内建立冲突。',
    '给我一个更短、更有冲击力的版本，控制在300字内。',
  ],
  story_overview: [
    '梳理全书主线和分集节奏，指出结构断层。',
    '按章节给我“保留/重写/删除”建议列表。',
    '基于当前内容，给一个更稳的分集路线图。',
  ],
  character_insight: [
    '分析主角、反派、配角的动机冲突与成长线。',
    '指出人物关系里最有潜力的反转点。',
    '找出人物行为不一致的章节并给修复建议。',
  ],
  platform_advice: [
    '按短剧平台习惯，给我标题、卖点和首集优化建议。',
    '我这个题材更适合哪个平台，为什么？',
    '结合当前内容给3条提高完播率的动作建议。',
  ],
}

async function streamSSE(
  url: string,
  options: {
    method?: 'POST' | 'PUT' | 'GET'
    body?: Record<string, unknown>
    onEvent: (event: StreamEvent, eventName: string) => void
  }
): Promise<void> {
  const token = localStorage.getItem('token')
  const response = await fetch(url, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `请求失败: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('SSE 响应为空')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const lines = frame.split('\n')
      let eventName = 'message'
      const dataLines: string[] = []

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventName = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6))
        }
      }

      if (!dataLines.length) continue

      try {
        const parsed = JSON.parse(dataLines.join('\n')) as StreamEvent
        options.onEvent(parsed, eventName)
      } catch {
        // ignore malformed frames
      }
    }
  }
}

export function NovelPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string }
  const id = parseInt(projectId)
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const [showManualForm, setShowManualForm] = useState(false)
  const [manualVolume, setManualVolume] = useState('')
  const [manualTitle, setManualTitle] = useState('')
  const [manualContent, setManualContent] = useState('')

  const [editingVolume, setEditingVolume] = useState('')
  const [editingTitle, setEditingTitle] = useState('')
  const [editingContent, setEditingContent] = useState('')

  const [parseOpen, setParseOpen] = useState(false)
  const [parseText, setParseText] = useState('')
  const [parsePath, setParsePath] = useState<ParsePath>('guided_rule')
  const [ruleType, setRuleType] = useState<RuleType>('title')
  const [separatorPattern, setSeparatorPattern] = useState('---')
  const [customSplitRule, setCustomSplitRule] = useState('')
  const [twistStrategy, setTwistStrategy] = useState<TwistStrategy>('balanced')
  const [cliffhangerStyle, setCliffhangerStyle] = useState<CliffhangerStyle>('suspense')
  const [contentGenre, setContentGenre] = useState('')
  const [parseProgress, setParseProgress] = useState(0)
  const [parseMessage, setParseMessage] = useState('等待开始解析')
  const [parseMeta, setParseMeta] = useState<{ method?: string; confidence?: number }>({})
  const [parseAnalysis, setParseAnalysis] = useState<ParseAnalysis | null>(null)
  const [parsedChapters, setParsedChapters] = useState<ParsedChapter[]>([])
  const [isParsing, setIsParsing] = useState(false)
  const [isSavingParsed, setIsSavingParsed] = useState(false)

  const [evaluatingId, setEvaluatingId] = useState<number | null>(null)
  const [evaluationMessage, setEvaluationMessage] = useState('')
  const [currentEvaluation, setCurrentEvaluation] = useState<NovelEvaluation | null>(null)
  const [liveEvaluation, setLiveEvaluation] = useState<NovelLiveEvaluation | null>(null)
  const [isLiveEvaluating, setIsLiveEvaluating] = useState(false)
  const [liveEvaluationError, setLiveEvaluationError] = useState('')

  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview')
  const [isEvaluatingBook, setIsEvaluatingBook] = useState(false)
  const [bookEvaluationMessage, setBookEvaluationMessage] = useState('')

  const [draggingNovelId, setDraggingNovelId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [trashOver, setTrashOver] = useState(false)

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSkill, setChatSkill] = useState<ChatSkill>('auto')
  const [chatSelectedIds, setChatSelectedIds] = useState<number[]>([])
  const [chatHistoryBootstrapped, setChatHistoryBootstrapped] = useState(false)
  const [isClearingChatHistory, setIsClearingChatHistory] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const { data: project } = useQuery<Project>({
    queryKey: ['project', id],
    queryFn: () => projectApi.get(id).then((r) => r.data),
  })

  const { data: novels = [], isLoading } = useQuery({
    queryKey: ['novels', id],
    queryFn: () => novelApi.list(id).then((r) => r.data),
  })

  const { data: stats } = useQuery<NovelStats>({
    queryKey: ['novels-stats', id],
    queryFn: () => novelApi.stats(id).then((r) => r.data),
  })

  const { data: latestEvaluations = [] } = useQuery<NovelLatestEvaluation[]>({
    queryKey: ['novels-latest-evaluations', id],
    queryFn: () => novelApi.latestEvaluations(id).then((r) => r.data),
  })

  const {
    data: bookEvaluationHistory,
    isLoading: isBookHistoryLoading,
  } = useQuery<BookEvaluationHistory>({
    queryKey: ['novels-book-history', id],
    queryFn: () => novelApi.bookHistory(id, 10, 0).then((r) => r.data),
  })

  const { data: chatHistory, isLoading: isChatHistoryLoading } = useQuery<NovelChatHistory>({
    queryKey: ['novels-chat-history', id],
    queryFn: () => novelApi.chatHistory(id, 120, 0).then((r) => r.data),
  })

  const evaluationMap = useMemo(() => {
    const map = new Map<number, NovelEvaluation>()
    for (const item of latestEvaluations) {
      map.set(item.novel_id, item.evaluation)
    }
    return map
  }, [latestEvaluations])

  const latestBookEvaluation = useMemo<BookEvaluation | null>(
    () => bookEvaluationHistory?.evaluations?.[0] ?? null,
    [bookEvaluationHistory]
  )

  const sortedNovels = useMemo(
    () => [...novels].sort((a, b) => a.chapter_index - b.chapter_index),
    [novels]
  )

  const groupedNovels = useMemo(() => {
    const groups = new Map<string, Novel[]>()
    for (const novel of sortedNovels) {
      const key = (novel.volume || '').trim() || '正文'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(novel)
    }
    return [...groups.entries()]
  }, [sortedNovels])

  const selectedNovel = useMemo(() => {
    if (!sortedNovels.length) return null
    if (!selectedId) return sortedNovels[0]
    return sortedNovels.find((item) => item.id === selectedId) ?? sortedNovels[0]
  }, [selectedId, sortedNovels])

  const selectedEvaluation = useMemo(() => {
    if (!selectedNovel) return null
    if (currentEvaluation && currentEvaluation.novel_id === selectedNovel.id) {
      return currentEvaluation
    }
    return evaluationMap.get(selectedNovel.id) ?? null
  }, [currentEvaluation, evaluationMap, selectedNovel])

  const effectiveParseMode = useMemo<ParseMode>(() => {
    if (parsePath === 'intelligent') return 'ai_only'
    if (ruleType === 'title') return 'auto'
    return 'rule_only'
  }, [parsePath, ruleType])

  const parseUnitLabel = parsePath === 'intelligent' ? '集' : '章'

  useEffect(() => {
    if (!project || contentGenre.trim()) return
    setContentGenre(contentTypeName(project.content_type))
  }, [project, contentGenre])

  useEffect(() => {
    if (!selectedNovel) {
      setEditorOpen(false)
      return
    }
    setEditingVolume(selectedNovel.volume || '')
    setEditingTitle(selectedNovel.chapter_title || '')
    setEditingContent(selectedNovel.content || '')
    setLiveEvaluation(null)
    setLiveEvaluationError('')
  }, [selectedNovel])

  useEffect(() => {
    if (!selectedNovel || !editorOpen) return
    if (evaluatingId === selectedNovel.id) return

    const draft = editingContent.trim()
    const saved = (selectedNovel.content || '').trim()
    if (!draft || draft === saved || draft.length < 30) {
      setLiveEvaluation(null)
      setLiveEvaluationError('')
      setIsLiveEvaluating(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setIsLiveEvaluating(true)
      setLiveEvaluationError('')
      try {
        const response = await novelApi.evaluateLive(id, selectedNovel.id, draft, editingTitle.trim() || undefined)
        if (cancelled) return
        setLiveEvaluation(response.data)
      } catch (error) {
        if (cancelled) return
        setLiveEvaluation(null)
        setLiveEvaluationError(extractErrorMessage(error))
      } finally {
        if (!cancelled) setIsLiveEvaluating(false)
      }
    }, 700)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [id, selectedNovel, editorOpen, editingContent, editingTitle, evaluatingId])

  useEffect(() => {
    const validIds = new Set(sortedNovels.map((item) => item.id))
    setChatSelectedIds((prev) => prev.filter((item) => validIds.has(item)))
  }, [sortedNovels])

  useEffect(() => {
    setChatMessages([])
    setChatHistoryBootstrapped(false)
  }, [id])

  useEffect(() => {
    if (chatHistoryBootstrapped || !chatHistory) return
    setChatMessages(
      chatHistory.messages.map((item) => ({
        id: `history-${item.id}`,
        role: item.role,
        content: item.message,
        skill: item.skill || undefined,
        createdAt: item.created_at,
      }))
    )
    setChatHistoryBootstrapped(true)
  }, [chatHistory, chatHistoryBootstrapped])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['novels', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-stats', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-latest-evaluations', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-book-history', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-chat-history', id] }),
    ])
  }

  const batchCreateMutation = useMutation({
    mutationFn: (chapters: { chapter_index: number; volume?: string; chapter_title?: string; content: string }[]) =>
      novelApi.batchCreate(id, chapters),
    onSuccess: async () => {
      await refreshAll()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (payload: { novelId: number; data: Partial<{ chapter_index: number; volume?: string; chapter_title?: string; content: string }> }) =>
      novelApi.update(id, payload.novelId, payload.data),
    onSuccess: async () => {
      await refreshAll()
      showToast('章节已更新', 'success')
    },
    onError: (error: unknown) => {
      showToast(extractErrorMessage(error), 'error')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (novelId: number) => novelApi.delete(id, novelId),
    onSuccess: async () => {
      await refreshAll()
      showToast('章节已删除', 'success')
      setCurrentEvaluation(null)
    },
    onError: (error: unknown) => {
      showToast(extractErrorMessage(error), 'error')
    },
  })

  const clearMutation = useMutation({
    mutationFn: () => novelApi.deleteAll(id),
    onSuccess: async () => {
      await refreshAll()
      showToast('已清空全部章节', 'success')
      setCurrentEvaluation(null)
    },
    onError: (error: unknown) => {
      showToast(extractErrorMessage(error), 'error')
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (orders: { novel_id: number; chapter_index: number }[]) => novelApi.reorder(id, orders),
    onSuccess: async () => {
      await refreshAll()
    },
    onError: (error: unknown) => {
      showToast(extractErrorMessage(error), 'error')
    },
  })

  const selectNovel = (novel: Novel, openEditor = false) => {
    setSelectedId(novel.id)
    setEditingVolume(novel.volume || '')
    setEditingTitle(novel.chapter_title || '')
    setEditingContent(novel.content || '')
    setCurrentEvaluation(evaluationMap.get(novel.id) ?? null)
    if (openEditor) setEditorOpen(true)
  }

  const addManualChapter = async () => {
    const content = manualContent.trim()
    if (!content) {
      showToast('章节正文不能为空', 'error')
      return
    }

    const nextIndex = sortedNovels.length
      ? Math.max(...sortedNovels.map((item) => item.chapter_index)) + 1
      : 1

    try {
      await batchCreateMutation.mutateAsync([
        {
          chapter_index: nextIndex,
          volume: manualVolume.trim() || undefined,
          chapter_title: manualTitle.trim() || undefined,
          content,
        },
      ])
      setManualVolume('')
      setManualTitle('')
      setManualContent('')
      showToast('章节已添加', 'success')
    } catch (error) {
      showToast(extractErrorMessage(error), 'error')
    }
  }

  const saveSelectedChapter = async () => {
    if (!selectedNovel) return

    const content = editingContent.trim()
    if (!content) {
      showToast('章节正文不能为空', 'error')
      return
    }

    await updateMutation.mutateAsync({
      novelId: selectedNovel.id,
      data: {
        volume: editingVolume.trim() || undefined,
        chapter_title: editingTitle.trim() || undefined,
        content,
      },
    })
  }

  const moveChapter = async (novel: Novel, direction: 'up' | 'down') => {
    const idx = sortedNovels.findIndex((item) => item.id === novel.id)
    if (idx < 0) return

    const target = direction === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= sortedNovels.length) return

    const reordered = [...sortedNovels]
    const temp = reordered[idx]
    reordered[idx] = reordered[target]
    reordered[target] = temp

    await reorderMutation.mutateAsync(
      reordered.map((item, index) => ({
        novel_id: item.id,
        chapter_index: index + 1,
      }))
    )
  }

  const reorderByDrag = async (sourceId: number, targetId: number) => {
    if (sourceId === targetId) return

    const sourceIndex = sortedNovels.findIndex((item) => item.id === sourceId)
    const targetIndex = sortedNovels.findIndex((item) => item.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const reordered = [...sortedNovels]
    const [moved] = reordered.splice(sourceIndex, 1)
    reordered.splice(targetIndex, 0, moved)

    await reorderMutation.mutateAsync(
      reordered.map((item, index) => ({
        novel_id: item.id,
        chapter_index: index + 1,
      }))
    )
  }

  const openParseModal = () => {
    setParseOpen(true)
    setParseProgress(0)
    setParseMessage('等待开始解析')
    setParseMeta({})
    setParseAnalysis(null)
    setParsedChapters([])
    if (project?.content_type) {
      setContentGenre(contentTypeName(project.content_type))
    }
  }

  const startParse = async () => {
    const text = parseText.trim()
    if (!text) {
      showToast('请先粘贴小说文本', 'error')
      return
    }

    if (parsePath === 'guided_rule' && ruleType === 'custom' && !customSplitRule.trim()) {
      showToast('请先输入自定义分割规则', 'error')
      return
    }

    setIsParsing(true)
    setParseProgress(0)
    setParseMessage('开始解析...')
    setParseMeta({})
    setParseAnalysis(null)
    setParsedChapters([])

    try {
      await streamSSE(novelApi.parseUrl(id), {
        body: {
          raw_text: text,
          parse_path: parsePath,
          mode: effectiveParseMode,
          rule_type: parsePath === 'guided_rule' ? ruleType : 'title',
          separator_pattern: parsePath === 'guided_rule' && ruleType === 'separator' ? separatorPattern.trim() || undefined : undefined,
          custom_split_rule: parsePath === 'guided_rule' && ruleType === 'custom' ? customSplitRule.trim() || undefined : undefined,
          twist_strategy: parsePath === 'intelligent' ? twistStrategy : undefined,
          cliffhanger_style: parsePath === 'intelligent' ? cliffhangerStyle : undefined,
          content_genre: parsePath === 'intelligent' ? contentGenre.trim() || undefined : undefined,
        },
        onEvent: (event, eventName) => {
          if (eventName === 'fallback_warning') {
            showToast(event.message || '模型已切换到备用配置', 'info')
          }

          const type = event.type
          if (type === 'progress') {
            setParseProgress(typeof event.progress === 'number' ? event.progress : 0)
            setParseMessage(event.message || '解析中...')
          } else if (type === 'analysis') {
            const payload = event.data as ParseAnalysis | undefined
            if (payload) setParseAnalysis(payload)
          } else if (type === 'chunk') {
            const payload = event.data as ParsedChapter
            if (payload && payload.content) {
              setParsedChapters((prev) => [
                ...prev,
                {
                  volume: payload.volume || '正文',
                  chapter_index: payload.chapter_index,
                  chapter_title: payload.chapter_title,
                  content: payload.content,
                },
              ])
            }
          } else if (type === 'done') {
            setParseProgress(100)
            setParseMeta({
              method: typeof event.parsing_method === 'string' ? event.parsing_method : undefined,
              confidence: typeof event.confidence === 'number' ? event.confidence : undefined,
            })
            setParseMessage('解析完成')
          } else if (type === 'error') {
            throw new Error(event.message || '解析失败')
          }
        },
      })
    } catch (error) {
      setParseMessage('解析失败')
      showToast(extractErrorMessage(error), 'error')
    } finally {
      setIsParsing(false)
    }
  }

  const saveParsedResult = async () => {
    if (!parsedChapters.length) {
      showToast('没有可保存的解析结果', 'error')
      return
    }

    const shouldReplace = window.confirm('将覆盖当前项目已存在章节，是否继续？')
    if (!shouldReplace) return

    setIsSavingParsed(true)
    try {
      await novelApi.deleteAll(id)
      const chapters = parsedChapters
        .map((item, idx) => ({
          chapter_index: idx + 1,
          volume: (item.volume || '').trim() || undefined,
          chapter_title: (item.chapter_title || '').trim() || undefined,
          content: item.content.trim(),
        }))
        .filter((item) => item.content)

      await novelApi.batchCreate(id, chapters)
      await refreshAll()
      setParseOpen(false)
      setParseText('')
      setParsedChapters([])
      showToast('解析结果已保存', 'success')
    } catch (error) {
      showToast(extractErrorMessage(error), 'error')
    } finally {
      setIsSavingParsed(false)
    }
  }

  const evaluateOne = async (novel: Novel) => {
    setEvaluatingId(novel.id)
    setEvaluationMessage('正在评估章节...')

    try {
      await streamSSE(novelApi.evaluateUrl(id, novel.id), {
        body: {},
        onEvent: (event, eventName) => {
          if (eventName === 'fallback_warning') {
            showToast(event.message || '评估模型已切换到备用配置', 'info')
          }

          const type = event.type
          if (type === 'progress') {
            setEvaluationMessage(event.message || '评估中...')
          } else if (type === 'dimension') {
            const name = String(event.name || '')
            const score = Number(event.score || 0)
            setCurrentEvaluation((prev) => {
              const base: NovelEvaluation = prev && prev.novel_id === novel.id
                ? prev
                : {
                  id: 0,
                  novel_id: novel.id,
                  content_type: project?.content_type || 'short_drama',
                  evaluation_type: 'chapter_only',
                  overall_score: 0,
                  dimension_scores: {},
                  summary: '',
                  suggestions: [],
                  novel_revision: 1,
                  parent_evaluation_id: null,
                  model_used: 'novel_evaluator',
                  prompt_version: `${project?.content_type || 'short_drama'}.v1`,
                  project_id: id,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              return {
                ...base,
                dimension_scores: {
                  ...base.dimension_scores,
                  [name]: score,
                },
              }
            })
          } else if (type === 'done') {
            const evaluation = event.evaluation as NovelEvaluation | undefined
            if (evaluation) setCurrentEvaluation(evaluation)
            setEvaluationMessage('评估完成')
          } else if (type === 'error') {
            throw new Error(event.message || '评估失败')
          }
        },
      })

      await refreshAll()
      const latest = await novelApi.listEvaluations(id, novel.id)
      setCurrentEvaluation(latest.data[0] ?? null)
      showToast('章节评估完成', 'success')
    } catch (error) {
      setEvaluationMessage('评估失败')
      showToast(extractErrorMessage(error), 'error')
    } finally {
      setEvaluatingId(null)
    }
  }

  const evaluateBook = async () => {
    if (!sortedNovels.length) {
      showToast('当前项目没有章节，无法生成仪表盘', 'error')
      return
    }

    setIsEvaluatingBook(true)
    setBookEvaluationMessage('正在生成全书质量仪表盘...')
    try {
      await novelApi.evaluateBook(id)
      await refreshAll()
      setBookEvaluationMessage('全书质量仪表盘已更新')
      showToast('全书质量仪表盘已生成', 'success')
    } catch (error) {
      setBookEvaluationMessage('仪表盘生成失败')
      showToast(extractErrorMessage(error), 'error')
    } finally {
      setIsEvaluatingBook(false)
    }
  }

  const sendChat = async () => {
    const message = chatInput.trim()
    if (!message || chatLoading) return

    const selectedSkill = chatSkill === 'auto' ? undefined : chatSkill
    const userMsg: ChatMessage = {
      id: `${Date.now()}-u`,
      role: 'user',
      content: message,
      skill: selectedSkill,
      createdAt: new Date().toISOString(),
    }
    const assistantId = `${Date.now()}-a`
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      skill: selectedSkill,
      createdAt: new Date().toISOString(),
      isStreaming: true,
    }

    setChatMessages((prev) => [...prev, userMsg, assistantMsg])
    setChatInput('')
    setChatLoading(true)

    try {
      await streamSSE(novelApi.chatUrl(id), {
        body: {
          message,
          skill: selectedSkill,
          novel_ids: chatSelectedIds.length ? chatSelectedIds : undefined,
        },
        onEvent: (event, eventName) => {
          if (eventName === 'fallback_warning') {
            showToast(event.message || 'Chat 模型已切换到备用配置', 'info')
            return
          }

          const type = event.type
          if (type === 'skill_recommendation') {
            const recommended = typeof event.recommended_skill === 'string' ? event.recommended_skill : ''
            const reason = typeof event.reason === 'string' ? event.reason : ''
            const skill = isChatSkill(recommended) ? recommended : undefined
            if (skill) {
              setChatMessages((prev) =>
                prev.map((item) =>
                  item.id === assistantId
                    ? { ...item, skill }
                    : item
                )
              )
            }
            if (reason) {
              showToast(reason, 'info')
            }
            return
          }

          if (type === 'content') {
            const payload = event.data as { chunk?: unknown } | undefined
            const chunk = typeof payload?.chunk === 'string' ? payload.chunk : ''
            if (!chunk) return
            setChatMessages((prev) =>
              prev.map((item) =>
                item.id === assistantId ? { ...item, content: item.content + chunk } : item
              )
            )
          } else if (type === 'error') {
            throw new Error(event.message || 'Chat 失败')
          }
        },
      })
    } catch (error) {
      setChatMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { ...item, content: extractErrorMessage(error), isStreaming: false }
            : item
        )
      )
    } finally {
      setChatLoading(false)
      setChatMessages((prev) =>
        prev.map((item) => (item.id === assistantId ? { ...item, isStreaming: false } : item))
      )
      await queryClient.invalidateQueries({ queryKey: ['novels-chat-history', id] })
    }
  }

  const toggleChatChapterSelection = (novelId: number) => {
    setChatSelectedIds((prev) =>
      prev.includes(novelId) ? prev.filter((item) => item !== novelId) : [...prev, novelId]
    )
  }

  const applyQuickPrompt = (prompt: string) => {
    setChatInput(prompt)
  }

  const clearChatHistory = async () => {
    if (chatLoading || isClearingChatHistory || !chatMessages.length) return
    const shouldClear = window.confirm('确认清空当前项目的小说 Chat 历史吗？')
    if (!shouldClear) return

    setIsClearingChatHistory(true)
    try {
      await novelApi.clearChatHistory(id)
      setChatMessages([])
      await queryClient.invalidateQueries({ queryKey: ['novels-chat-history', id] })
      showToast('聊天历史已清空', 'success')
    } catch (error) {
      showToast(extractErrorMessage(error), 'error')
    } finally {
      setIsClearingChatHistory(false)
    }
  }

  const handleCardDrop = async (targetId: number) => {
    if (draggingNovelId == null) return
    try {
      await reorderByDrag(draggingNovelId, targetId)
    } finally {
      setDraggingNovelId(null)
      setDropTargetId(null)
    }
  }

  const handleTrashDrop = async () => {
    if (draggingNovelId == null) {
      setTrashOver(false)
      return
    }
    const novel = sortedNovels.find((item) => item.id === draggingNovelId)
    setTrashOver(false)
    setDraggingNovelId(null)
    setDropTargetId(null)
    if (!novel) return

    const shouldDelete = window.confirm(`确认删除 第${novel.chapter_index}章 吗？`)
    if (!shouldDelete) return
    deleteMutation.mutate(novel.id)
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载章节中...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <BookOpen className="h-5 w-5" /> 小说管理
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">支持手动维护、智能解析、章节评估与小说协作 Chat</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openParseModal}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 px-3 py-1.5 text-sm text-indigo-300 hover:bg-indigo-500/10"
          >
            <Sparkles className="h-4 w-4" /> 粘贴文本解析
          </button>
          <button
            onClick={() => setShowManualForm((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <Plus className="h-4 w-4" /> 手动添加
          </button>
          <button
            onClick={() => {
              if (window.confirm('确认清空所有章节？')) clearMutation.mutate()
            }}
            disabled={!novels.length || clearMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> 清空全部
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatsCard label="总章节" value={String(stats?.total_chapters ?? 0)} />
        <StatsCard label="总卷数" value={String(stats?.total_volumes ?? 0)} />
        <StatsCard label="总字数" value={String(stats?.total_words ?? 0)} />
        <StatsCard label="平均评分" value={stats?.average_score != null ? stats.average_score.toFixed(2) : '-'} />
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">全书质量仪表板</h3>
            <p className="mt-1 text-xs text-muted-foreground">基于已评估章节聚合全书质量、分集合理性和优化建议。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={evaluateBook}
              disabled={isEvaluatingBook || !novels.length}
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/10 disabled:opacity-50"
            >
              {isEvaluatingBook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />} 生成仪表盘
            </button>
            {latestBookEvaluation && (
              <p className="text-[11px] text-muted-foreground">
                最近生成：{formatDateTime(latestBookEvaluation.created_at)}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([
            ['overview', '概览'],
            ['consistency', '一致性'],
            ['suggestions', '建议'],
            ['trend', '趋势'],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setDashboardTab(tab)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                dashboardTab === tab
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                  : 'border-border text-muted-foreground hover:bg-accent'
              )}
            >
              {label}
            </button>
          ))}
          {bookEvaluationMessage && <span className="text-xs text-muted-foreground">· {bookEvaluationMessage}</span>}
        </div>

        {isBookHistoryLoading ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载仪表盘中...
          </p>
        ) : !latestBookEvaluation ? (
          <p className="text-xs text-muted-foreground">暂无仪表盘数据，请先点击“生成仪表盘”。</p>
        ) : (
          <div className="space-y-3">
            {dashboardTab === 'overview' && (
              <>
                <div className="grid gap-2 md:grid-cols-4">
                  <MetaPill label="总体评分" value={Number(latestBookEvaluation.overall_assessment?.overall_score ?? 0).toFixed(2)} />
                  <MetaPill label="完整度" value={Number(latestBookEvaluation.overall_assessment?.completeness_score ?? 0).toFixed(2)} />
                  <MetaPill label="连贯性" value={Number(latestBookEvaluation.overall_assessment?.coherence_score ?? 0).toFixed(2)} />
                  <MetaPill label="受众匹配" value={Number(latestBookEvaluation.overall_assessment?.audience_fit_score ?? 0).toFixed(2)} />
                </div>
                {latestBookEvaluation.overall_assessment?.summary && (
                  <p className="text-xs text-muted-foreground">{latestBookEvaluation.overall_assessment.summary}</p>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border bg-background/60 p-3">
                    <p className="mb-2 text-xs font-medium text-foreground">维度均分</p>
                    <div className="space-y-2">
                      {Object.entries(latestBookEvaluation.aggregated_stats?.dimension_averages || {}).map(([key, value]) => (
                        <ScoreRow key={`book-avg-${key}`} label={dimensionLabel(key)} score={Number(value)} />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-border bg-background/60 p-3">
                    <p className="text-xs font-medium text-foreground">分布与低分章节</p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(latestBookEvaluation.aggregated_stats?.score_distribution || {}).map(([key, value]) => (
                        <MetaPill key={`dist-${key}`} label={scoreBandLabel(key)} value={String(value)} />
                      ))}
                    </div>
                    <div className="space-y-1">
                      {(latestBookEvaluation.aggregated_stats?.low_score_chapters || []).slice(0, 5).map((item) => (
                        <p key={`low-${item.novel_id}`} className="text-xs text-muted-foreground">
                          第{item.chapter_index}章 {item.chapter_title || ''} · {Number(item.overall_score).toFixed(1)}分
                        </p>
                      ))}
                      {!latestBookEvaluation.aggregated_stats?.low_score_chapters?.length && (
                        <p className="text-xs text-muted-foreground">暂无低分章节</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {dashboardTab === 'consistency' && (
              <div className="space-y-2">
                {(latestBookEvaluation.consistency_issues || []).map((issue, idx) => (
                  <div key={`issue-${idx}`} className="rounded-lg border border-border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">{issue.title}</p>
                      <span className={cn('rounded border px-2 py-0.5 text-[11px]', issueSeverityClass(issue.severity))}>
                        {issue.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{issue.description}</p>
                    <p className="mt-1 text-xs text-foreground/90">建议：{issue.suggestion}</p>
                  </div>
                ))}
                {!latestBookEvaluation.consistency_issues?.length && (
                  <p className="text-xs text-muted-foreground">未识别到明显跨章节一致性问题。</p>
                )}
              </div>
            )}

            {dashboardTab === 'suggestions' && (
              <div className="space-y-2">
                {(latestBookEvaluation.overall_assessment?.improvement_priorities || []).map((item, idx) => (
                  <div key={`prio-${idx}`} className="rounded-lg border border-border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">{item.label || dimensionLabel(item.dimension)}</p>
                      <span className={cn('rounded border px-2 py-0.5 text-[11px]', item.priority === 'high' ? 'border-red-500/40 text-red-300' : 'border-amber-500/40 text-amber-300')}>
                        {item.priority}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">当前均分：{Number(item.average_score).toFixed(2)}</p>
                    <p className="mt-1 text-xs text-foreground/90">{item.recommendation}</p>
                  </div>
                ))}
                {!latestBookEvaluation.overall_assessment?.improvement_priorities?.length && (
                  <p className="text-xs text-muted-foreground">暂无改进优先项。</p>
                )}
              </div>
            )}

            {dashboardTab === 'trend' && (
              <div className="space-y-2">
                {(bookEvaluationHistory?.evaluations || []).map((item) => (
                  <div key={`trend-${item.id}`} className="rounded-lg border border-border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">{formatDateTime(item.created_at)}</p>
                      <p className="text-xs text-emerald-300">{Number(item.overall_assessment?.overall_score ?? 0).toFixed(2)} 分</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      章节：{item.aggregated_stats?.total_chapters ?? 0} · 问题：{item.consistency_issues?.length ?? 0}
                      {item.aggregated_stats?.benchmark?.level ? ` · 评级：${item.aggregated_stats.benchmark.level}` : ''}
                    </p>
                  </div>
                ))}
                {!bookEvaluationHistory?.evaluations?.length && (
                  <p className="text-xs text-muted-foreground">暂无历史趋势数据。</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showManualForm && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground">手动添加章节</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={manualVolume}
              onChange={(event) => setManualVolume(event.target.value)}
              placeholder="卷名（可选）"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              placeholder="章节标题（可选）"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <textarea
            value={manualContent}
            onChange={(event) => setManualContent(event.target.value)}
            rows={5}
            placeholder="请输入章节正文..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={addManualChapter}
            disabled={batchCreateMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {batchCreateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 添加章节
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {!groupedNovels.length && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              还没有章节，先使用“粘贴文本解析”或“手动添加”。
            </div>
          )}

          {groupedNovels.map(([volume, chapters]) => (
            <div key={volume} className="rounded-xl border border-border bg-card p-3">
              <h3 className="mb-2 text-sm font-semibold text-foreground">{volume}</h3>
              <div className="space-y-2">
                {chapters.map((novel) => {
                  const score = evaluationMap.get(novel.id)?.overall_score
                  const isDropTarget = dropTargetId === novel.id && draggingNovelId !== novel.id
                  return (
                    <div
                      key={novel.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        setDraggingNovelId(novel.id)
                        setDropTargetId(novel.id)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        if (draggingNovelId != null) setDropTargetId(novel.id)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        void handleCardDrop(novel.id)
                      }}
                      onDragEnd={() => {
                        setDraggingNovelId(null)
                        setDropTargetId(null)
                        setTrashOver(false)
                      }}
                      className={cn(
                        'group relative rounded-lg border p-3 transition-colors',
                        selectedNovel?.id === novel.id
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : 'border-border hover:bg-accent/40',
                        isDropTarget && 'border-emerald-500/50 bg-emerald-500/10'
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none absolute -left-2 top-1/2 -translate-y-1/2 rounded-full border border-border bg-background p-0.5 text-muted-foreground transition-opacity',
                          draggingNovelId === novel.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        )}
                        title="拖拽排序"
                      >
                        <Plus className="h-3 w-3" />
                      </span>

                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => selectNovel(novel, true)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-medium text-foreground">
                            第 {novel.chapter_index} 章 {novel.chapter_title || '未命名章节'}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{novel.content.slice(0, 110)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            字数：{novel.word_count}
                            {score != null ? ` · 评分：${score.toFixed(1)}` : ''}
                          </p>
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => void moveChapter(novel, 'up')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="上移"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => void moveChapter(novel, 'down')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="下移"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => void evaluateOne(novel)}
                            disabled={evaluatingId != null}
                            className="rounded p-1 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                            title="评估"
                          >
                            {evaluatingId === novel.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm('确认删除该章节？')) deleteMutation.mutate(novel.id)
                            }}
                            className="rounded p-1 text-red-300 hover:bg-red-500/10"
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <div
            onDragOver={(event) => {
              event.preventDefault()
              if (draggingNovelId != null) setTrashOver(true)
            }}
            onDragLeave={() => setTrashOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              void handleTrashDrop()
            }}
            className={cn(
              'rounded-xl border border-dashed p-4 text-center text-xs transition-colors',
              draggingNovelId == null
                ? 'border-border text-muted-foreground'
                : trashOver
                  ? 'border-red-500/60 bg-red-500/10 text-red-300'
                  : 'border-red-500/40 text-red-300'
            )}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              <span>{draggingNovelId == null ? '拖拽章节到这里可删除' : '松开鼠标删除章节'}</span>
            </div>
          </div>
        </div>

        <aside className="flex h-[70vh] flex-col rounded-xl border border-border bg-card">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">小说协作 Chat</h3>
              <p className="mt-1 text-xs text-muted-foreground">按技能与章节范围和 AI 对话，支持评估、改写和策略建议。</p>
            </div>
            <button
              onClick={() => void clearChatHistory()}
              disabled={chatLoading || isClearingChatHistory || !chatMessages.length}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              {isClearingChatHistory ? '清空中...' : '清空会话'}
            </button>
          </div>

          <div className="space-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {CHAT_SKILLS.map((item) => (
                <button
                  key={item.value}
                  onClick={() => setChatSkill(item.value)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    chatSkill === item.value
                      ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                  title={item.hint}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">章节范围（可多选，不选即全书）</p>
              <div className="max-h-20 overflow-auto">
                <div className="flex flex-wrap gap-1.5">
                  {sortedNovels.map((novel) => (
                    <button
                      key={`chat-scope-${novel.id}`}
                      onClick={() => toggleChatChapterSelection(novel.id)}
                      className={cn(
                        'rounded border px-2 py-0.5 text-[11px] transition-colors',
                        chatSelectedIds.includes(novel.id)
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      )}
                    >
                      第{novel.chapter_index}章
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">快捷提问（点击填入输入框）</p>
              <div className="flex flex-wrap gap-1.5">
                {CHAT_QUICK_PROMPTS[chatSkill].map((prompt, idx) => (
                  <button
                    key={`quick-${chatSkill}-${idx}`}
                    onClick={() => applyQuickPrompt(prompt)}
                    className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-auto px-4 py-3">
            {isChatHistoryLoading && !chatHistoryBootstrapped && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在加载会话历史...
              </p>
            )}
            {!isChatHistoryLoading && chatMessages.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                <p>可直接提问示例：</p>
                <p className="mt-1">1. 评估第2章到第4章的转折与挂念问题。</p>
                <p className="mt-1">2. 把第3章改写成更强悬念的结尾。</p>
                <p className="mt-1">3. 分析当前小说人物关系和可发布平台建议。</p>
              </div>
            )}
            {chatMessages.map((message) => (
              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[92%] rounded-lg px-3 py-2 text-xs leading-relaxed',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-foreground'
                  )}
                >
                  {(message.skill || message.createdAt) && (
                    <p className="mb-1 text-[10px] opacity-70">
                      {message.skill ? `Skill: ${chatSkillLabel(message.skill)}` : ''}
                      {message.createdAt ? `${message.skill ? ' · ' : ''}${formatTime(message.createdAt)}` : ''}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  {message.isStreaming && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current" />}
                </div>
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>

          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void sendChat()
                  }
                }}
                placeholder="输入你的问题或指令... (Enter 发送，Shift+Enter 换行)"
                rows={3}
                className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={() => void sendChat()}
                disabled={chatLoading || !chatInput.trim()}
                className={cn(
                  'self-end rounded-md p-2 transition-colors',
                  chatLoading || !chatInput.trim()
                    ? 'cursor-not-allowed bg-muted text-muted-foreground'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {editorOpen && selectedNovel && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 md:p-8">
          <div className="mx-auto flex h-full max-w-6xl flex-col rounded-xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">章节编辑</h3>
                <p className="mt-1 text-xs text-muted-foreground">第 {selectedNovel.chapter_index} 章 · {selectedNovel.chapter_title || '未命名章节'}</p>
              </div>
              <button
                onClick={() => setEditorOpen(false)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-3 overflow-auto">
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    value={editingVolume}
                    onChange={(event) => setEditingVolume(event.target.value)}
                    placeholder="卷名"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                  />
                  <input
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    placeholder="章节标题"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                  />
                </div>

                <textarea
                  value={editingContent}
                  onChange={(event) => setEditingContent(event.target.value)}
                  rows={22}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                />

                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => void saveSelectedChapter()}
                    disabled={updateMutation.isPending}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {updateMutation.isPending ? '保存中...' : '保存章节修改'}
                  </button>
                  <button
                    onClick={() => void evaluateOne(selectedNovel)}
                    disabled={evaluatingId != null}
                    className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    {evaluatingId === selectedNovel.id ? '评估中...' : '评估本章'}
                  </button>
                </div>
                {evaluationMessage && <p className="text-xs text-muted-foreground">{evaluationMessage}</p>}
              </div>

              <div className="space-y-3 overflow-auto rounded-xl border border-border bg-card p-3">
                <div className="rounded-lg border border-border bg-background/60 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">实时评分（未保存）</p>
                    {isLiveEvaluating && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">停止输入后自动刷新，不会写入数据库。</p>
                  {liveEvaluation ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-foreground">
                        总分：{liveEvaluation.overall_score.toFixed(2)} · 类型：{contentTypeName(liveEvaluation.content_type)}
                      </p>
                      {Object.entries(liveEvaluation.dimension_scores).map(([key, value]) => (
                        <ScoreRow key={`live-${key}`} label={dimensionLabel(key)} score={Number(value)} />
                      ))}
                    </div>
                  ) : liveEvaluationError ? (
                    <p className="mt-2 text-xs text-red-300">实时评分失败：{liveEvaluationError}</p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">编辑正文后将自动显示实时评分。</p>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-background/60 p-3">
                  <h4 className="text-sm font-semibold text-foreground">AI 内容评估</h4>
                  <p className="mt-1 text-xs text-muted-foreground">按项目内容类型评估这一章。</p>

                  {selectedEvaluation ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm font-medium text-foreground">总分：{selectedEvaluation.overall_score.toFixed(2)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        内容类型：{contentTypeName(selectedEvaluation.content_type)} · 版本：v{selectedEvaluation.novel_revision}
                      </p>
                      {Object.entries(selectedEvaluation.dimension_scores).map(([key, value]) => (
                        <ScoreRow key={key} label={dimensionLabel(key)} score={Number(value)} />
                      ))}
                      {selectedEvaluation.summary && (
                        <p className="text-xs leading-relaxed text-muted-foreground">{selectedEvaluation.summary}</p>
                      )}
                      {!!selectedEvaluation.suggestions?.length && (
                        <div className="space-y-1">
                          {selectedEvaluation.suggestions.slice(0, 3).map((item, idx) => (
                            <p key={`${item.dimension}-${idx}`} className="text-xs text-foreground/90">
                              [{item.priority}] {item.dimension}: {item.suggestion}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">暂无评估结果</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {parseOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 p-4 md:p-8">
          <div className="mx-auto flex h-full max-w-6xl flex-col rounded-xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">智能解析小说文本</h3>
              <button
                onClick={() => setParseOpen(false)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                关闭
              </button>
            </div>

            <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
              <div className="space-y-3 overflow-auto">
                <div className="rounded-xl border border-border bg-card p-3">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">解析路径</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <button
                      onClick={() => {
                        setParsePath('guided_rule')
                        setRuleType('title')
                      }}
                      className={cn(
                        'rounded-xl border p-3 text-left transition-colors',
                        parsePath === 'guided_rule'
                          ? 'border-amber-500/50 bg-amber-500/10'
                          : 'border-border hover:bg-accent/40'
                      )}
                    >
                      <p className="text-sm font-semibold text-foreground">参考原文结构</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        只保留标题型/分隔型，也支持手动指定动态分割规则。
                      </p>
                    </button>
                    <button
                      onClick={() => setParsePath('intelligent')}
                      className={cn(
                        'rounded-xl border p-3 text-left transition-colors',
                        parsePath === 'intelligent'
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : 'border-border hover:bg-accent/40'
                      )}
                    >
                      <p className="text-sm font-semibold text-foreground">AI 智能分集</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        保留转折策略、挂念风格和内容类型，按剧情起伏生成分集。
                      </p>
                    </button>
                  </div>
                </div>

                <textarea
                  value={parseText}
                  onChange={(event) => setParseText(event.target.value)}
                  rows={14}
                  placeholder="在这里粘贴完整小说文本..."
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                />

                <div className="rounded-xl border border-border bg-card p-3">
                  {parsePath === 'guided_rule' ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">结构参考方式</p>
                        <p className="mt-1 text-xs text-muted-foreground">支持标题型、分隔型，或手动输入动态分割规则。</p>
                      </div>

                      <div className="grid gap-2 md:grid-cols-3">
                        {([
                          ['title', '标题型', '第X章 / Chapter N 等'],
                          ['separator', '分隔型', '--- / *** / === 等'],
                          ['custom', '手动规则', '字面量或 re:正则分割'],
                        ] as const).map(([value, label, desc]) => (
                          <button
                            key={value}
                            onClick={() => setRuleType(value)}
                            className={cn(
                              'rounded-lg border p-3 text-left transition-colors',
                              ruleType === value
                                ? 'border-amber-500/50 bg-amber-500/10'
                                : 'border-border hover:bg-accent/40'
                            )}
                          >
                            <p className="text-sm font-medium text-foreground">{label}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
                          </button>
                        ))}
                      </div>

                      {ruleType === 'separator' && (
                        <input
                          value={separatorPattern}
                          onChange={(event) => setSeparatorPattern(event.target.value)}
                          placeholder="分隔符，例如 --- 或 ***"
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                      )}

                      {ruleType === 'custom' && (
                        <input
                          value={customSplitRule}
                          onChange={(event) => setCustomSplitRule(event.target.value)}
                          placeholder="自定义规则：字面量行分割，或 re:正则表达式"
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">AI 分集偏好</p>
                        <p className="mt-1 text-xs text-muted-foreground">按剧情起伏和挂念感拆分短剧分集。</p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <SelectField
                          label="转折策略"
                          value={twistStrategy}
                          onChange={(value) => setTwistStrategy(value as TwistStrategy)}
                          options={[
                            ['aggressive', '激进：转折密度更高'],
                            ['balanced', '平衡：默认推荐'],
                            ['conservative', '保守：保证连贯'],
                          ]}
                        />
                        <SelectField
                          label="挂念风格"
                          value={cliffhangerStyle}
                          onChange={(value) => setCliffhangerStyle(value as CliffhangerStyle)}
                          options={[
                            ['suspense', '悬念型'],
                            ['reversal', '反转型'],
                            ['climax', '高潮型'],
                            ['dialogue', '对话中断型'],
                          ]}
                        />
                      </div>

                      <input
                        value={contentGenre}
                        onChange={(event) => setContentGenre(event.target.value)}
                        placeholder="内容类型，例如 悬疑 / 爱情 / 伦理"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                  <p className="text-sm font-medium text-foreground">当前执行策略</p>
                  <p className="text-xs text-muted-foreground">
                    {parsePathLabel(parsePath)} · {parseEngineLabel(effectiveParseMode)} · 字数：{parseText.length}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="h-2 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full bg-indigo-400 transition-all" style={{ width: `${parseProgress}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{parseMessage}</p>
                  {parseAnalysis && (
                    <div className="grid gap-2 md:grid-cols-2">
                      <MetaPill label="文本字数" value={String(parseAnalysis.total_chars)} />
                      <MetaPill label="段落数" value={String(parseAnalysis.paragraphs)} />
                      <MetaPill label="标题命中" value={String(parseAnalysis.chapter_heading_hits)} />
                      <MetaPill label="分隔符命中" value={String(parseAnalysis.separator_hits)} />
                      <MetaPill label="转折提示词" value={String(parseAnalysis.twist_marker_count)} />
                      <MetaPill
                        label="系统建议"
                        value={`${parsePathLabel(parseAnalysis.suggested_path)} / ${ruleTypeLabel(parseAnalysis.suggested_rule_type)}`}
                      />
                    </div>
                  )}
                  {(parseMeta.method || parseMeta.confidence != null) && (
                    <p className="text-xs text-muted-foreground">
                      解析方式：{parseMethodLabel(parseMeta.method)}
                      {parseMeta.confidence != null ? ` · 置信度：${Math.round(parseMeta.confidence * 100)}%` : ''}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => void startParse()}
                    disabled={isParsing}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isParsing ? '解析中...' : '开始解析'}
                  </button>
                  <button
                    onClick={() => void saveParsedResult()}
                    disabled={isSavingParsed || !parsedChapters.length}
                    className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    {isSavingParsed ? '保存中...' : '确认保存'}
                  </button>
                </div>
              </div>

              <div className="overflow-auto rounded-md border border-border bg-card p-3">
                <h4 className="mb-2 text-sm font-medium text-foreground">解析预览（{parsedChapters.length} {parseUnitLabel}）</h4>
                <div className="space-y-3">
                  {parsedChapters.map((chapter, idx) => (
                    <div key={`${idx}-${chapter.chapter_index}`} className="rounded-md border border-border p-2">
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          value={chapter.volume || ''}
                          onChange={(event) => {
                            const value = event.target.value
                            setParsedChapters((prev) =>
                              prev.map((item, index) => (index === idx ? { ...item, volume: value } : item))
                            )
                          }}
                          placeholder="卷名"
                          className="rounded border border-border bg-background px-2 py-1 text-xs"
                        />
                        <input
                          value={chapter.chapter_title || ''}
                          onChange={(event) => {
                            const value = event.target.value
                            setParsedChapters((prev) =>
                              prev.map((item, index) => (index === idx ? { ...item, chapter_title: value } : item))
                            )
                          }}
                          placeholder="章节标题"
                          className="rounded border border-border bg-background px-2 py-1 text-xs"
                        />
                      </div>
                      <textarea
                        value={chapter.content}
                        onChange={(event) => {
                          const value = event.target.value
                          setParsedChapters((prev) =>
                            prev.map((item, index) => (index === idx ? { ...item, content: value } : item))
                          )
                        }}
                        rows={3}
                        className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                      />
                    </div>
                  ))}
                  {!parsedChapters.length && (
                    <p className="text-xs text-muted-foreground">解析结果将在这里实时显示</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function isChatSkill(value: string): value is Exclude<ChatSkill, 'auto'> {
  return (
    value === 'chapter_eval'
    || value === 'chapter_rewrite'
    || value === 'story_overview'
    || value === 'character_insight'
    || value === 'platform_advice'
  )
}

function chatSkillLabel(skill?: Exclude<ChatSkill, 'auto'>): string {
  if (skill === 'chapter_eval') return '章节评估'
  if (skill === 'chapter_rewrite') return '章节改写'
  if (skill === 'story_overview') return '全书梳理'
  if (skill === 'character_insight') return '人物分析'
  if (skill === 'platform_advice') return '平台建议'
  return '未指定'
}

function StatsCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/70 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function ScoreRow({ label, score }: { label: string; score: number }) {
  const pct = Math.max(0, Math.min(100, (score / 10) * 100))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{score.toFixed(1)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-muted">
        <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function dimensionLabel(key: string): string {
  const map: Record<string, string> = {
    opening_hook: '开场 Hook',
    conflict_density: '冲突密度',
    twist_effectiveness: '转折力度',
    cliffhanger_strength: '挂念强度',
    visual_adaptability: '画面可拍性',
    serialized_drive: '追更驱动力',
    plot_momentum: '情节推进',
    character_appeal: '人物吸引力',
    readability: '可读性',
    immersion: '沉浸感',
    chapter_payoff: '章节爽点',
    retention_drive: '追读驱动',
    suspense_setup: '悬念搭建',
    clue_fairness: '线索公平性',
    logic_consistency: '逻辑闭环',
    reveal_impact: '揭晓冲击',
    atmosphere_control: '氛围控制',
    payoff_strength: '回收力度',
    plot: '情节推进',
    character: '人物塑造',
    dialogue: '对话质量',
    description: '场景描写',
    pacing: '节奏把控',
    drama_potential: '改编潜力',
  }
  return map[key] || key
}

function parseMethodLabel(method?: string): string {
  const map: Record<string, string> = {
    rule_only: '规则解析',
    ai_full: 'AI 全量解析',
    ai_enhance: 'AI 增强修订',
    rule_fallback: '规则兜底',
    separator_rule: '分隔符规则解析',
    custom_rule: '自定义规则解析',
    rhythm_ai: '剧情起伏 AI 分集',
    rhythm_rule: '剧情起伏规则分集',
  }
  if (!method) return '-'
  return map[method] || method
}

function parseEngineLabel(mode: ParseMode): string {
  const map: Record<ParseMode, string> = {
    auto: '自动（规则优先）',
    rule_only: '仅规则',
    ai_only: '仅 AI',
  }
  return map[mode]
}

function parsePathLabel(path?: ParsePath): string {
  if (path === 'guided_rule') return '参考原文结构'
  if (path === 'intelligent') return 'AI 智能分集'
  return '-'
}

function ruleTypeLabel(ruleType?: RuleType): string {
  const map: Record<RuleType, string> = {
    title: '标题型',
    separator: '分隔型',
    custom: '手动规则',
  }
  if (!ruleType) return '-'
  return map[ruleType]
}

function contentTypeName(value?: string): string {
  const map: Record<string, string> = {
    short_drama: '短剧',
    web_novel: '网文',
    mystery: '悬疑',
    general: '通用',
  }
  if (!value) return '-'
  return map[value] || value
}

function formatDateTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString()
}

function issueSeverityClass(severity?: string): string {
  if (severity === 'high') return 'border-red-500/40 text-red-300'
  if (severity === 'medium') return 'border-amber-500/40 text-amber-300'
  if (severity === 'low') return 'border-sky-500/40 text-sky-300'
  return 'border-border text-muted-foreground'
}

function scoreBandLabel(key: string): string {
  const map: Record<string, string> = {
    excellent: '优秀',
    good: '良好',
    average: '中等',
    poor: '待提升',
  }
  return map[key] || key
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error && error.message) return error.message

  const maybeError = error as {
    message?: string
    response?: {
      data?: {
        detail?: string
      }
    }
  }

  if (typeof maybeError?.response?.data?.detail === 'string' && maybeError.response.data.detail.trim()) {
    return maybeError.response.data.detail
  }

  if (typeof maybeError?.message === 'string' && maybeError.message.trim()) {
    return maybeError.message
  }

  return '请求失败，请稍后重试'
}
