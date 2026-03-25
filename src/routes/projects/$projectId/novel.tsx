import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Plus,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
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
  NovelChatSession,
  NovelChatSessionList,
  NovelEvaluation,
  NovelLatestEvaluation,
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
type ParseInputMode = 'text' | 'file'

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
  artifactType?: string
  artifactStatus?: string
  requiresConfirmation?: boolean
  artifactPayload?: Record<string, unknown>
  novelIds?: number[]
  createdAt?: string
  isStreaming?: boolean
}

interface RewriteChange {
  chapterIndex?: number
  chapterTitle?: string
  reason?: string
  originalSnippet?: string
  replacementSnippet?: string
  content: string
}

interface RewritePlan {
  scopeLabel?: string
  reason?: string
  changes: RewriteChange[]
}

interface TopologyNode {
  label: string
  tone: 'core' | 'support' | 'risk' | 'action'
}

interface TopologyViewData {
  centerLabel: string
  nodes: TopologyNode[]
}

interface StorylineStageData {
  title: string
  summary: string
  chapters?: number[]
  tension?: string
}

const CHAT_SKILLS: Array<{ value: ChatSkill; label: string; hint: string }> = [
  { value: 'auto', label: '自动推荐', hint: '根据问题自动匹配最合适的技能' },
  { value: 'chapter_eval', label: '章节评估', hint: '给出问题定位与优先级建议' },
  { value: 'chapter_rewrite', label: '章节改写', hint: '输出可替换正文与改写意图' },
  { value: 'story_overview', label: '全书梳理', hint: '总结结构与节奏风险' },
  { value: 'character_insight', label: '任务分析', hint: '分析人物关系、动机与成长线并输出关系拓扑' },
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
  const AUTO_SCROLL_EDGE_PX = 120
  const AUTO_SCROLL_MAX_SPEED = 14

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
  const [parseInputMode, setParseInputMode] = useState<ParseInputMode>('text')
  const [parseText, setParseText] = useState('')
  const [parseFileName, setParseFileName] = useState('')
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
  const [activeChatSessionId, setActiveChatSessionId] = useState<number | null>(null)
  const [chatOptionsCollapsed, setChatOptionsCollapsed] = useState(false)
  const [chatEvalByMessageId, setChatEvalByMessageId] = useState<Record<string, NovelEvaluation>>({})
  const [chatEvalLoadingByMessageId, setChatEvalLoadingByMessageId] = useState<Record<string, boolean>>({})
  const [chatEvalErrorByMessageId, setChatEvalErrorByMessageId] = useState<Record<string, string>>({})
  const [chatHistoryBootstrapped, setChatHistoryBootstrapped] = useState(false)
  const [isClearingChatHistory, setIsClearingChatHistory] = useState(false)
  const [deletingChatSessionId, setDeletingChatSessionId] = useState<number | null>(null)
  const [isApplyingRewrite, setIsApplyingRewrite] = useState(false)
  const [applyingRewriteMessageId, setApplyingRewriteMessageId] = useState<string | null>(null)
  const [activeTopologyView, setActiveTopologyView] = useState<{ title: string; data: TopologyViewData } | null>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const parseFileInputRef = useRef<HTMLInputElement>(null)
  const dragPointerYRef = useRef<number | null>(null)
  const autoScrollFrameRef = useRef<number | null>(null)

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

  const { data: chatSessionList, isLoading: isChatSessionsLoading } = useQuery<NovelChatSessionList>({
    queryKey: ['novels-chat-sessions', id],
    queryFn: () => novelApi.chatSessions(id, 40, 0).then((r) => r.data),
  })

  const { data: chatHistory, isLoading: isChatHistoryLoading } = useQuery<NovelChatHistory>({
    queryKey: ['novels-chat-history', id, activeChatSessionId],
    queryFn: () => novelApi.chatHistory(id, activeChatSessionId, 120, 0).then((r) => r.data),
    enabled: activeChatSessionId != null,
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

  const chatSessions = useMemo<NovelChatSession[]>(
    () => chatSessionList?.sessions ?? [],
    [chatSessionList]
  )

  const activeChatSession = useMemo<NovelChatSession | null>(
    () => chatSessions.find((item) => item.id === activeChatSessionId) ?? null,
    [activeChatSessionId, chatSessions]
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
  }, [selectedNovel])

  useEffect(() => {
    const validIds = new Set(sortedNovels.map((item) => item.id))
    setChatSelectedIds((prev) => {
      const next = prev.filter((item) => validIds.has(item))
      return next.length === prev.length && next.every((item, index) => item === prev[index]) ? prev : next
    })
  }, [sortedNovels])

  useEffect(() => {
    setActiveChatSessionId(null)
    setChatMessages([])
    setChatHistoryBootstrapped(true)
    setChatEvalByMessageId({})
    setChatEvalLoadingByMessageId({})
    setChatEvalErrorByMessageId({})
  }, [id])

  useEffect(() => {
    if (activeChatSessionId == null || chatHistoryBootstrapped || !chatHistory) return
    setChatMessages(
      chatHistory.messages.map((item) => ({
        id: `history-${item.id}`,
        role: item.role,
        content: item.message,
        skill: item.skill || undefined,
        artifactType: item.artifact_type || undefined,
        artifactStatus: item.artifact_status || undefined,
        requiresConfirmation: Boolean(item.requires_confirmation),
        artifactPayload: (item.artifact_payload as Record<string, unknown> | null | undefined) ?? undefined,
        novelIds: item.novel_ids,
        createdAt: item.created_at,
      }))
    )
    setChatHistoryBootstrapped(true)
  }, [activeChatSessionId, chatHistory, chatHistoryBootstrapped])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    if (draggingNovelId == null) {
      dragPointerYRef.current = null
      if (autoScrollFrameRef.current != null) {
        cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
      return
    }

    const tick = () => {
      const pointerY = dragPointerYRef.current
      if (pointerY != null) {
        const viewportHeight = window.innerHeight
        let delta = 0

        if (pointerY > viewportHeight - AUTO_SCROLL_EDGE_PX) {
          const ratio = Math.min(1, (pointerY - (viewportHeight - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX)
          delta = Math.ceil(ratio * AUTO_SCROLL_MAX_SPEED)
        } else if (pointerY < AUTO_SCROLL_EDGE_PX) {
          const ratio = Math.min(1, (AUTO_SCROLL_EDGE_PX - pointerY) / AUTO_SCROLL_EDGE_PX)
          delta = -Math.ceil(ratio * AUTO_SCROLL_MAX_SPEED)
        }

        if (delta !== 0) {
          window.scrollBy({ top: delta, behavior: 'auto' })
        }
      }

      autoScrollFrameRef.current = requestAnimationFrame(tick)
    }

    autoScrollFrameRef.current = requestAnimationFrame(tick)

    return () => {
      if (autoScrollFrameRef.current != null) {
        cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
    }
  }, [draggingNovelId])

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['novels', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-stats', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-latest-evaluations', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-book-history', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-chat-sessions', id] }),
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
    setParseInputMode('text')
    setParseFileName('')
    setParseProgress(0)
    setParseMessage('等待开始解析')
    setParseMeta({})
    setParseAnalysis(null)
    setParsedChapters([])
    if (project?.content_type) {
      setContentGenre(contentTypeName(project.content_type))
    }
  }

  const openParseFilePicker = () => {
    parseFileInputRef.current?.click()
  }

  const handleParseFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const lowerName = file.name.toLowerCase()
    const isTxt = lowerName.endsWith('.txt') || file.type === 'text/plain'
    if (!isTxt) {
      showToast('当前仅支持上传 .txt 文本文件', 'error')
      return
    }

    try {
      const content = await file.text()
      if (!content.trim()) {
        showToast('文件内容为空，请检查后重试', 'error')
        return
      }
      setParseInputMode('file')
      setParseFileName(file.name)
      setParseText(content)
      setParseProgress(0)
      setParseMessage('文件已载入，等待开始解析')
      setParseMeta({})
      setParseAnalysis(null)
      setParsedChapters([])
      showToast(`已加载文件：${file.name}`, 'success')
    } catch {
      showToast('读取 txt 文件失败，请重试', 'error')
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

  const resetChatVisualState = () => {
    setChatEvalByMessageId({})
    setChatEvalLoadingByMessageId({})
    setChatEvalErrorByMessageId({})
  }

  const activateDraftChat = () => {
    setActiveChatSessionId(null)
    setChatMessages([])
    setChatHistoryBootstrapped(true)
    resetChatVisualState()
  }

  const openChatSession = (sessionId: number) => {
    if (chatLoading || sessionId === activeChatSessionId) return
    setActiveChatSessionId(sessionId)
    setChatMessages([])
    setChatHistoryBootstrapped(false)
    resetChatVisualState()
  }

  const deleteChatSession = async (session: NovelChatSession) => {
    if (chatLoading || deletingChatSessionId != null) return
    const shouldDelete = window.confirm(`确认删除会话「${session.title || '未命名会话'}」吗？`)
    if (!shouldDelete) return

    setDeletingChatSessionId(session.id)
    try {
      await novelApi.deleteChatSession(id, session.id)
      if (activeChatSessionId === session.id) {
        activateDraftChat()
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['novels-chat-sessions', id] }),
        queryClient.invalidateQueries({ queryKey: ['novels-chat-history', id, session.id] }),
      ])
      showToast('会话已删除', 'success')
    } catch (error) {
      showToast(extractErrorMessage(error), 'error')
    } finally {
      setDeletingChatSessionId(null)
    }
  }

  const sendChat = async () => {
    const message = chatInput.trim()
    if (!message || chatLoading) return

    let sessionId = activeChatSessionId
    if (!sessionId) {
      try {
        const created = await novelApi.createChatSession(id)
        sessionId = created.data.id
        setChatHistoryBootstrapped(true)
        setActiveChatSessionId(sessionId)
        await queryClient.invalidateQueries({ queryKey: ['novels-chat-sessions', id] })
      } catch (error) {
        showToast(extractErrorMessage(error), 'error')
        return
      }
    }

    const selectedSkill = chatSkill === 'auto' ? undefined : chatSkill
    const userMsg: ChatMessage = {
      id: `${Date.now()}-u`,
      role: 'user',
      content: message,
      skill: selectedSkill,
      novelIds: chatSelectedIds,
      createdAt: new Date().toISOString(),
    }
    const assistantId = `${Date.now()}-a`
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      skill: selectedSkill,
      novelIds: chatSelectedIds,
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
          session_id: sessionId,
          novel_ids: chatSelectedIds.length ? chatSelectedIds : undefined,
        },
        onEvent: (event, eventName) => {
          if (eventName === 'fallback_warning') {
            showToast(event.message || 'Chat 模型已切换到备用配置', 'info')
            return
          }

          const type = event.type
          if (type === 'session_created') {
            const payload = event.session as Partial<NovelChatSession> | undefined
            if (typeof payload?.id === 'number') {
              setActiveChatSessionId(payload.id)
              void queryClient.invalidateQueries({ queryKey: ['novels-chat-sessions', id] })
            }
            return
          }
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

          if (type === 'scope_resolved') {
            const ids = Array.isArray(event.novel_ids)
              ? event.novel_ids.filter((item): item is number => typeof item === 'number')
              : []
            const scopeLabel = typeof event.scope_label === 'string' ? event.scope_label : ''
            setChatMessages((prev) =>
              prev.map((item) =>
                item.id === assistantId
                  ? { ...item, novelIds: ids }
                  : item.id === userMsg.id
                    ? { ...item, novelIds: ids }
                    : item
              )
            )
            if (scopeLabel && ids.length > 0 && type === 'scope_resolved' && !chatSelectedIds.length) {
              showToast(`${scopeLabel}：第${ids.map((novelId) => sortedNovels.find((item) => item.id === novelId)?.chapter_index).filter(Boolean).join('、')}章`, 'info')
            }
            return
          }

          if (type === 'artifact_ready') {
            const payload = (event.data && typeof event.data === 'object' ? event.data : event) as {
              artifact_type?: unknown
              artifact_status?: unknown
              requires_confirmation?: unknown
              artifact_payload?: unknown
            }
            setChatMessages((prev) =>
              prev.map((item) =>
                item.id === assistantId
                  ? {
                    ...item,
                    artifactType: typeof payload.artifact_type === 'string' ? payload.artifact_type : item.artifactType,
                    artifactStatus: typeof payload.artifact_status === 'string' ? payload.artifact_status : item.artifactStatus,
                    requiresConfirmation: typeof payload.requires_confirmation === 'boolean' ? payload.requires_confirmation : item.requiresConfirmation,
                    artifactPayload: payload.artifact_payload && typeof payload.artifact_payload === 'object'
                      ? payload.artifact_payload as Record<string, unknown>
                      : item.artifactPayload,
                  }
                  : item
              )
            )
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['novels-chat-sessions', id] }),
        queryClient.invalidateQueries({ queryKey: ['novels-chat-history', id, sessionId] }),
      ])
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
    const isDraft = activeChatSessionId == null
    const shouldClear = window.confirm(isDraft ? '确认清空当前未保存会话内容吗？' : '确认删除当前聊天会话吗？')
    if (!shouldClear) return

    setIsClearingChatHistory(true)
    try {
      if (isDraft) {
        activateDraftChat()
      } else if (activeChatSessionId != null) {
        await novelApi.deleteChatSession(id, activeChatSessionId)
        activateDraftChat()
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['novels-chat-sessions', id] }),
          queryClient.invalidateQueries({ queryKey: ['novels-chat-history', id, activeChatSessionId] }),
        ])
      }
      showToast(isDraft ? '当前会话内容已清空' : '当前会话已删除', 'success')
    } catch (error) {
      showToast(extractErrorMessage(error), 'error')
    } finally {
      setIsClearingChatHistory(false)
    }
  }

  const confirmRewriteFromChat = async (message: ChatMessage, plan: RewritePlan) => {
    if (isApplyingRewrite) return

    const prepared = plan.changes.map((change, index) => {
      const targetNovel = resolveRewriteTargetNovel(change, message, sortedNovels, index)
      return { change, targetNovel }
    })

    const invalidItem = prepared.find((item) => !item.targetNovel)
    if (invalidItem) {
      showToast('仍有待修改章节无法定位，请先在 Chat 中明确章节范围', 'error')
      return
    }

    if (!prepared.length) {
      showToast('当前没有可确认的改写目标章节', 'error')
      return
    }

    setIsApplyingRewrite(true)
    setApplyingRewriteMessageId(message.id)
    try {
      const results: Novel[] = []
      for (const item of prepared) {
        const targetNovel = item.targetNovel as Novel
        const response = await novelApi.rewriteFromChat(id, targetNovel.id, {
          instruction: message.content,
          scope_label: plan.scopeLabel,
          reason: item.change.reason || plan.reason,
          chapter_index: item.change.chapterIndex ?? targetNovel.chapter_index,
          chapter_title: item.change.chapterTitle?.trim() || targetNovel.chapter_title || undefined,
          original_snippet: item.change.originalSnippet,
          replacement_snippet: item.change.replacementSnippet,
          full_content: item.change.content.trim(),
        })
        results.push(response.data)
      }
      await refreshAll()
      const first = results[0]
      if (first) {
        setSelectedId(first.id)
        setEditingTitle(first.chapter_title || '')
        setEditingContent(first.content)
        setEditorOpen(true)
      }
      showToast(`已完成 ${results.length} 个章节的确认改写`, 'success')
    } catch (error) {
      showToast(extractErrorMessage(error), 'error')
    } finally {
      setIsApplyingRewrite(false)
      setApplyingRewriteMessageId(null)
    }
  }

  const handleCardDrop = async (targetId: number) => {
    if (draggingNovelId == null) return
    try {
      await reorderByDrag(draggingNovelId, targetId)
    } finally {
      dragPointerYRef.current = null
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
    dragPointerYRef.current = null
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
          <div className="flex items-center gap-2">
            <button
              onClick={addManualChapter}
              disabled={batchCreateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {batchCreateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 确认添加
            </button>
            <button
              onClick={() => setShowManualForm(false)}
              disabled={batchCreateMutation.isPending}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,860px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,980px)]">
        <div
          className="space-y-4"
          onDragOver={(event) => {
            if (draggingNovelId == null) return
            dragPointerYRef.current = event.clientY
          }}
        >
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
                        dragPointerYRef.current = event.clientY
                        setDraggingNovelId(novel.id)
                        setDropTargetId(novel.id)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        dragPointerYRef.current = event.clientY
                        if (draggingNovelId != null) setDropTargetId(novel.id)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        void handleCardDrop(novel.id)
                      }}
                      onDragEnd={() => {
                        dragPointerYRef.current = null
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
            onClick={() => {
              if (draggingNovelId == null) setShowManualForm(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              dragPointerYRef.current = event.clientY
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
                ? 'cursor-pointer border-border text-muted-foreground hover:bg-accent/40'
                : trashOver
                  ? 'border-red-500/60 bg-red-500/10 text-red-300'
                  : 'border-red-500/40 text-red-300'
            )}
          >
            <div className="flex items-center justify-center gap-1.5">
              {draggingNovelId == null ? <Plus className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
              <span>{draggingNovelId == null ? '添加章节内容' : '拖拽章节到这里可删除'}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <aside className="flex h-[72vh] min-h-0 flex-col rounded-xl border border-border bg-card">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">小说协作 Chat</h3>
              <p className="mt-1 text-xs text-muted-foreground">按技能与章节范围和 AI 对话，支持评估、改写和策略建议。</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                当前会话：{activeChatSession?.title || '新会话（未保存）'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => activateDraftChat()}
                disabled={chatLoading}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                新会话
              </button>
              <button
                onClick={() => setChatOptionsCollapsed((value) => !value)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
              >
                {chatOptionsCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                {chatOptionsCollapsed ? '展开配置' : '收起配置'}
              </button>
              <button
                onClick={() => void clearChatHistory()}
                disabled={chatLoading || isClearingChatHistory || !chatMessages.length}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                {isClearingChatHistory ? '处理中...' : activeChatSessionId == null ? '清空草稿' : '删除会话'}
              </button>
            </div>
          </div>

          {!chatOptionsCollapsed && (
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
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 overflow-auto px-4 py-3">
              {activeChatSessionId != null && isChatHistoryLoading && !chatHistoryBootstrapped && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在加载会话历史...
                </p>
              )}
              {chatMessages.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  <p>{activeChatSessionId == null ? '当前是一个新的会话草稿。' : '当前会话暂无消息。'}</p>
                  <p className="mt-2">可直接提问示例：</p>
                  <p className="mt-1">1. 评估第2章到第4章的转折与挂念问题。</p>
                  <p className="mt-1">2. 把第3章改写成更强悬念的结尾。</p>
                  <p className="mt-1">3. 分析当前小说人物关系和可发布平台建议。</p>
                </div>
              )}
                {chatMessages.map((message) => {
                  const rewritePlan =
                    message.role === 'assistant' && message.skill === 'chapter_rewrite'
                      ? normalizeRewritePlan(message.artifactPayload) ?? parseRewritePlan(message.content)
                      : null
                  const targetNovel = resolveMessageTargetNovel(message, sortedNovels, rewritePlan?.changes?.[0]?.chapterIndex)
                  const artifactEvaluation = normalizeEvalArtifact(message.artifactPayload)
                  const isEvalMessage =
                    message.role === 'assistant'
                    && (
                      message.skill === 'chapter_eval'
                      || message.artifactType === 'chapter_eval_report'
                      || artifactEvaluation != null
                    )
                  const artifactTargetNovel = artifactEvaluation
                    ? sortedNovels.find((item) => item.id === artifactEvaluation.novel_id)
                    : undefined
                  const effectiveEvalTargetNovel = targetNovel ?? artifactTargetNovel
                const radarEvaluation =
                  isEvalMessage
                    ? (
                      artifactEvaluation
                      ?? chatEvalByMessageId[message.id]
                      ?? (effectiveEvalTargetNovel ? evaluationMap.get(effectiveEvalTargetNovel.id) : null)
                    )
                    : null
                const radarLoading = Boolean(chatEvalLoadingByMessageId[message.id])
                const radarError = chatEvalErrorByMessageId[message.id]
                const storylineData = normalizeStoryTimeline(message.artifactPayload)
                const topologyData =
                  message.role === 'assistant' && message.skill && (
                    message.skill === 'character_insight'
                    || message.skill === 'platform_advice'
                    || (message.skill === 'story_overview' && !storylineData)
                  )
                    ? normalizeTopologyArtifact(message.artifactPayload, message.skill) ?? parseTopologyView(message.content, message.skill)
                    : null

                return (
                  <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className="max-w-[95%] space-y-2">
                      <div
                        className={cn(
                          'rounded-lg px-3 py-2 text-xs leading-relaxed',
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
                        <div className="break-words">
                          <MarkdownContent content={message.content} />
                        </div>
                        {message.isStreaming && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current" />}
                      </div>

                      {message.role === 'assistant' && rewritePlan && rewritePlan.changes.length > 0 && (
                        <div className="rounded-xl border border-border bg-card/80 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-foreground">章节改写确认</p>
                            <button
                              onClick={() => void confirmRewriteFromChat(message, rewritePlan)}
                              disabled={isApplyingRewrite}
                              className={cn(
                                'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-xs font-medium transition-colors',
                                isApplyingRewrite
                                  ? 'cursor-not-allowed bg-primary/40 text-primary-foreground/70'
                                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
                              )}
                            >
                              {isApplyingRewrite && applyingRewriteMessageId === message.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Wand2 className="h-3.5 w-3.5" />}
                              {isApplyingRewrite && applyingRewriteMessageId === message.id ? '正在应用' : '确认并应用'}
                            </button>
                          </div>
                        </div>
                      )}

                      {isEvalMessage && (
                        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-medium text-foreground">多维度评估图表</p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {effectiveEvalTargetNovel
                                  ? `章节：第${effectiveEvalTargetNovel.chapter_index}章 ${effectiveEvalTargetNovel.chapter_title || '未命名章节'}`
                                  : '正在解析评估章节范围...'}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3">
                            {radarEvaluation ? (
                              <RadarChart
                                metrics={buildRadarMetrics(radarEvaluation.dimension_scores)}
                                overallScore={radarEvaluation.overall_score}
                              />
                            ) : !effectiveEvalTargetNovel ? (
                              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                正在识别章节范围...
                              </p>
                            ) : radarLoading ? (
                              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                正在生成章节评估图表...
                              </p>
                            ) : radarError ? (
                              <p className="text-[11px] text-red-300">图表生成失败：{radarError}</p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">正在等待章节评估结果...</p>
                            )}
                          </div>
                          {artifactEvaluation?.summary && (
                            <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3 text-[11px] text-muted-foreground">
                              <p className="font-medium text-foreground">评估报告</p>
                              <p className="mt-1 whitespace-pre-wrap">{artifactEvaluation.summary}</p>
                              {Array.isArray(artifactEvaluation.suggestions) && artifactEvaluation.suggestions.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {artifactEvaluation.suggestions.slice(0, 4).map((item, idx) => (
                                    <div key={`eval-suggestion-${message.id}-${idx}`} className="rounded-md border border-border/50 px-2 py-1">
                                      <span className="text-foreground">{String(item.dimension || '建议')}</span>：{String(item.suggestion || '')}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {message.role === 'assistant' && message.skill === 'story_overview' && storylineData && (
                        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-medium text-foreground">故事线时序图</p>
                              <p className="mt-1 text-[11px] text-muted-foreground">粗粒度展示当前故事推进阶段与章节分布。</p>
                            </div>
                          </div>
                          <div className="mt-3">
                            <StoryTimelineCard stages={storylineData} />
                          </div>
                        </div>
                      )}

                      {message.role === 'assistant' && topologyData && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-medium text-foreground">
                                {message.skill === 'character_insight' ? '人物关系拓扑图' : '结构/关系拓扑视图'}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                将本轮分析提炼为可视化节点，便于快速查看主线、风险与动作建议。
                              </p>
                            </div>
                            <button
                              onClick={() => setActiveTopologyView({ title: `${chatSkillLabel(message.skill)} · 拓扑图`, data: topologyData })}
                              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 px-3 py-1.5 text-[11px] text-amber-300 hover:bg-amber-500/10"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                              查看拓扑图
                            </button>
                          </div>
                          <div className="mt-3">
                            <TopologyGraph data={topologyData} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
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
          </div>
        </aside>

        <aside className="flex h-[72vh] min-h-0 flex-col rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">消息会话历史</p>
                <p className="mt-1 text-[11px] text-muted-foreground">刷新后默认进入新会话，历史会话可继续聊。</p>
              </div>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                {chatSessions.length} 条
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-3">
            <button
              onClick={() => activateDraftChat()}
              disabled={chatLoading}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50',
                activeChatSessionId == null
                  ? 'border-indigo-500/50 bg-indigo-500/10'
                  : 'border-border hover:bg-accent/50'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">新会话</span>
                <span className="text-[10px] text-muted-foreground">未保存</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">开始新的聊天上下文，不自动继承旧会话消息。</p>
            </button>

            {isChatSessionsLoading && (
              <p className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在加载历史会话...
              </p>
            )}

            {!isChatSessionsLoading && chatSessions.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-[11px] text-muted-foreground">
                暂无历史会话，发送第一条消息后会自动保存到右侧列表。
              </div>
            )}

            {chatSessions.map((session) => (
              <div
                key={session.id}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  activeChatSessionId === session.id
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-border hover:bg-accent/40'
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => openChatSession(session.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-foreground">
                        {session.title || '未命名会话'}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatTime(session.last_message_at)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {session.preview || '点击继续这个会话'}
                    </p>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {session.message_count} 条消息
                    </p>
                  </button>
                  <button
                    onClick={() => void deleteChatSession(session)}
                    disabled={chatLoading || deletingChatSessionId === session.id}
                    className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                    title="删除会话"
                  >
                    {deletingChatSessionId === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
        </div>
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

            <div className="flex flex-1 overflow-hidden p-4">
              <div className="w-full space-y-3 overflow-auto">
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
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTopologyView && (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 md:p-8">
          <div className="mx-auto flex h-full max-w-4xl flex-col rounded-xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{activeTopologyView.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">将本轮 AI 分析提炼为中心节点 + 辐射节点的蜘蛛网式拓扑视图。</p>
              </div>
              <button
                onClick={() => setActiveTopologyView(null)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                关闭
              </button>
            </div>
            <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-xl border border-border bg-card p-4">
                <TopologyGraph data={activeTopologyView.data} />
              </div>
              <div className="overflow-auto rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-medium text-foreground">节点说明</p>
                <div className="mt-3 space-y-2">
                  {activeTopologyView.data.nodes.map((node, index) => (
                    <div key={`${node.label}-${index}`} className="rounded-lg border border-border bg-background/60 p-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('inline-flex h-2.5 w-2.5 rounded-full', topologyToneClass(node.tone))} />
                        <p className="text-xs font-medium text-foreground">{node.label}</p>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{topologyToneLabel(node.tone)}</p>
                    </div>
                  ))}
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
              <div>
                <h3 className="text-sm font-semibold text-foreground">智能解析小说文本</h3>
                <p className="mt-1 text-xs text-muted-foreground">支持直接粘贴正文，或上传 txt 文件提取文本后解析。</p>
              </div>
              <button
                onClick={() => setParseOpen(false)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                关闭
              </button>
            </div>

            <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
              <div className="space-y-3 overflow-auto">
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">导入方式</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <button
                        onClick={() => setParseInputMode('text')}
                        className={cn(
                          'rounded-xl border p-3 text-left transition-colors',
                          parseInputMode === 'text'
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-border hover:bg-accent/40'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-emerald-300" />
                          <p className="text-sm font-semibold text-foreground">文本输入</p>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          适合直接粘贴原文、章节汇总或临时整理后的文本。
                        </p>
                      </button>
                      <button
                        onClick={() => {
                          setParseInputMode('file')
                          openParseFilePicker()
                        }}
                        className={cn(
                          'rounded-xl border p-3 text-left transition-colors',
                          parseInputMode === 'file'
                            ? 'border-sky-500/50 bg-sky-500/10'
                            : 'border-border hover:bg-accent/40'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Upload className="h-4 w-4 text-sky-300" />
                          <p className="text-sm font-semibold text-foreground">上传 txt</p>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          当前仅支持 .txt，后续可以继续扩展 docx / epub 等格式。
                        </p>
                      </button>
                    </div>
                    <input
                      ref={parseFileInputRef}
                      type="file"
                      accept=".txt,text/plain"
                      onChange={handleParseFileChange}
                      className="hidden"
                    />
                  </div>

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
                          优先保留原文标题、分隔符和现有章节结构。
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
                          按剧情节奏、转折与挂念感自动拆成更适合短剧的分集。
                        </p>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">原文内容</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {parseInputMode === 'text'
                          ? '直接粘贴完整小说文本后开始解析。'
                          : '先上传 txt 文件，载入后仍可继续微调文本。'}
                      </p>
                    </div>
                    {parseInputMode === 'file' && (
                      <button
                        onClick={openParseFilePicker}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        重新上传
                      </button>
                    )}
                  </div>

                  {parseInputMode === 'file' && (
                    <div className="mt-3 rounded-lg border border-dashed border-border bg-background/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-foreground">
                            {parseFileName ? `已载入文件：${parseFileName}` : '尚未选择 txt 文件'}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            仅支持 txt；文件内容会读取到下方文本框，便于继续修改。
                          </p>
                        </div>
                        <button
                          onClick={openParseFilePicker}
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          选择 txt 文件
                        </button>
                      </div>
                    </div>
                  )}

                  <textarea
                    value={parseText}
                    onChange={(event) => setParseText(event.target.value)}
                    rows={14}
                    placeholder={parseInputMode === 'text' ? '在这里粘贴完整小说文本...' : '上传 txt 后，文件内容会显示在这里...'}
                    className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>

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
                    {parseInputMode === 'text' ? '文本输入' : `文件导入${parseFileName ? ` · ${parseFileName}` : ''}`} · {parsePathLabel(parsePath)} · {parseEngineLabel(effectiveParseMode)} · 字数：{parseText.length}
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

function resolveMessageTargetNovel(message: ChatMessage, novels: Novel[], preferredChapterIndex?: number): Novel | undefined {
  if (message.novelIds?.length === 1) {
    const byId = novels.find((item) => item.id === message.novelIds?.[0])
    if (byId) return byId
  }
  if (preferredChapterIndex != null) {
    const byIndex = novels.find((item) => item.chapter_index === preferredChapterIndex)
    if (byIndex) return byIndex
  }
  const inferredIndex = parseChapterIndex(message.content)
  if (inferredIndex != null) {
    return novels.find((item) => item.chapter_index === inferredIndex)
  }
  return undefined
}

function MarkdownContent({ content }: { content: string }) {
  return <div className="space-y-2 text-xs leading-relaxed">{renderMarkdownBlocks(content)}</div>
}

function renderMarkdownBlocks(content: string): ReactNode[] {
  const normalized = (content || '').replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const nodes: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = []
      const lang = line.slice(3).trim()
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length && lines[index].startsWith('```')) index += 1
      nodes.push(
        <div key={`code-${nodes.length}`} className="overflow-auto rounded-md border border-border/70 bg-black/20">
          {lang && <div className="border-b border-border/60 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{lang}</div>}
          <pre className="p-3 text-[11px] leading-5 text-foreground">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
      )
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      nodes.push(
        <p
          key={`heading-${nodes.length}`}
          className={cn(
            'font-semibold text-foreground',
            level <= 2 ? 'text-sm' : level <= 4 ? 'text-[13px]' : 'text-xs'
          )}
        >
          {renderInlineMarkdown(heading[2], `heading-inline-${nodes.length}`)}
        </p>
      )
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      nodes.push(
        <blockquote
          key={`quote-${nodes.length}`}
          className="border-l-2 border-indigo-400/50 pl-3 text-muted-foreground"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`quote-line-${quoteIndex}`}>{renderInlineMarkdown(quoteLine, `quote-inline-${nodes.length}-${quoteIndex}`)}</p>
          ))}
        </blockquote>
      )
      continue
    }

    if (/^(\s*[-*+]\s+|\s*\d+\.\s+)/.test(line)) {
      const items: Array<{ ordered: boolean; text: string }> = []
      while (index < lines.length && /^(\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[index])) {
        const current = lines[index]
        const ordered = /^\s*\d+\.\s+/.test(current)
        items.push({
          ordered,
          text: current.replace(/^(\s*[-*+]\s+|\s*\d+\.\s+)/, ''),
        })
        index += 1
      }
      const ordered = items.every((item) => item.ordered)
      const ListTag = ordered ? 'ol' : 'ul'
      nodes.push(
        <ListTag
          key={`list-${nodes.length}`}
          className={cn('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}
        >
          {items.map((item, itemIndex) => (
            <li key={`list-item-${itemIndex}`}>{renderInlineMarkdown(item.text, `list-inline-${nodes.length}-${itemIndex}`)}</li>
          ))}
        </ListTag>
      )
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length
      && lines[index].trim()
      && !lines[index].startsWith('```')
      && !/^(#{1,6})\s+/.test(lines[index])
      && !/^>\s?/.test(lines[index])
      && !/^(\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[index])
    ) {
      paragraphLines.push(lines[index])
      index += 1
    }
    nodes.push(
      <p key={`paragraph-${nodes.length}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(paragraphLines.join('\n'), `paragraph-inline-${nodes.length}`)}
      </p>
    )
  }

  return nodes.length ? nodes : [<p key="empty">{content}</p>]
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={`${keyPrefix}-${match.index}`} className="rounded bg-black/20 px-1 py-0.5 font-mono text-[11px]">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-${match.index}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={`${keyPrefix}-${match.index}`} className="italic">
          {token.slice(1, -1)}
        </em>
      )
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        nodes.push(
          <a
            key={`${keyPrefix}-${match.index}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-300 underline underline-offset-2"
          >
            {linkMatch[1]}
          </a>
        )
      } else {
        nodes.push(token)
      }
    } else {
      nodes.push(token)
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length ? nodes : [text]
}

function extractTaggedSection(content: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = content.match(new RegExp(`【${escaped}】\\s*([\\s\\S]*?)(?=\\n【[^\\n]+】|$)`, 'i'))
    const value = match?.[1]?.trim()
    if (value) return value
  }
  return null
}

function parseChapterIndex(content: string): number | undefined {
  const matched = content.match(/第\s*(\d+)\s*[章节回集]/)
  if (!matched) return undefined
  const parsed = Number(matched[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseRewritePlan(content: string): RewritePlan | null {
  const normalized = (content || '').trim()
  if (!normalized) return null

  const scopeLabel = extractTaggedSection(normalized, ['修改范围', '可替换章节', '目标章节']) ?? undefined
  const reason = extractTaggedSection(normalized, ['改写意图', '修改意图', '改写目标']) ?? undefined
  const numberedChanges: RewriteChange[] = []

  for (let index = 1; index <= 8; index += 1) {
    const chapterSection = extractIndexedTaggedSection(normalized, index, ['章节', '目标章节'])
    const fullContent = extractIndexedTaggedSection(normalized, index, ['整章替换正文', '可替换正文', '替换正文', '改写正文'])
    if (!chapterSection && !fullContent) continue

    if (!fullContent) continue
    numberedChanges.push({
      chapterIndex: parseChapterIndex(chapterSection || ''),
      chapterTitle: extractIndexedTaggedSection(normalized, index, ['标题', '可替换标题']) ?? undefined,
      reason: extractIndexedTaggedSection(normalized, index, ['修改原因', '改写原因', '说明']) ?? undefined,
      originalSnippet: extractIndexedTaggedSection(normalized, index, ['原文定位', '原文片段', '修改前片段']) ?? undefined,
      replacementSnippet: extractIndexedTaggedSection(normalized, index, ['建议替换片段', '修改后片段', '替换后片段']) ?? undefined,
      content: fullContent,
    })
  }

  if (numberedChanges.length) {
    return { scopeLabel, reason, changes: numberedChanges }
  }

  const body = extractTaggedSection(normalized, ['整章替换正文', '可替换正文', '替换正文', '改写正文'])
  if (!body) {
    return parseLooseRewritePlan(normalized)
  }
  const chapterSection = extractTaggedSection(normalized, ['可替换章节', '目标章节'])
  const title = extractTaggedSection(normalized, ['可替换标题', '替换标题']) ?? undefined
  return {
    scopeLabel,
    reason,
    changes: [
      {
        chapterIndex: parseChapterIndex(chapterSection || normalized),
        chapterTitle: title,
        reason,
        content: body,
      },
    ],
  }
}

function parseLooseRewritePlan(content: string): RewritePlan | null {
  const normalized = (content || '').trim()
  if (!normalized) return null

  const looseMatch = normalized.match(/(?:完整)?第\s*(\d+)\s*章正文[：:\s-]*([\s\S]+)/i)
  if (!looseMatch) return null

  const chapterIndex = Number(looseMatch[1])
  const body = looseMatch[2]?.replace(/^[-—–\s]+/, '').trim()
  if (!body) return null

  return {
    reason: extractTaggedSection(normalized, ['改写意图', '修改意图', '改写目标']) ?? '根据上一轮建议生成的待确认修改方案',
    changes: [
      {
        chapterIndex: Number.isFinite(chapterIndex) ? chapterIndex : undefined,
        content: body,
      },
    ],
  }
}

function normalizeRewritePlan(payload: Record<string, unknown> | undefined): RewritePlan | null {
  if (!payload) return null
  const rawChanges = Array.isArray(payload.changes) ? payload.changes : []
  const changes: RewriteChange[] = rawChanges
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const content = typeof record.full_content === 'string' ? record.full_content : typeof record.content === 'string' ? record.content : ''
      if (!content.trim()) return null
      return {
        chapterIndex: typeof record.chapter_index === 'number' ? record.chapter_index : undefined,
        chapterTitle: typeof record.chapter_title === 'string' ? record.chapter_title : undefined,
        reason: typeof record.reason === 'string' ? record.reason : undefined,
        originalSnippet: typeof record.original_snippet === 'string' ? record.original_snippet : undefined,
        replacementSnippet: typeof record.replacement_snippet === 'string' ? record.replacement_snippet : undefined,
        content,
      } satisfies RewriteChange
    })
    .filter(Boolean) as RewriteChange[]
  if (!changes.length) return null
  return {
    scopeLabel: typeof payload.scope_label === 'string' ? payload.scope_label : typeof payload.scopeLabel === 'string' ? payload.scopeLabel : undefined,
    reason: typeof payload.reason === 'string' ? payload.reason : undefined,
    changes,
  }
}

function normalizeEvalArtifact(payload: Record<string, unknown> | undefined): NovelEvaluation | null {
  if (!payload) return null
  const evaluation = payload.evaluation
  if (evaluation && typeof evaluation === 'object') {
    return evaluation as NovelEvaluation
  }
  if (typeof payload.novel_id !== 'number' || typeof payload.overall_score !== 'number' || !payload.dimension_scores || typeof payload.dimension_scores !== 'object') {
    return null
  }
  return {
    id: 0,
    novel_id: payload.novel_id,
    content_type: 'short_drama',
    evaluation_type: 'chapter_only',
    overall_score: payload.overall_score,
    dimension_scores: payload.dimension_scores as Record<string, number>,
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    suggestions: Array.isArray(payload.suggestions) ? payload.suggestions as NovelEvaluation['suggestions'] : [],
    novel_revision: 1,
    parent_evaluation_id: null,
    model_used: 'novel_evaluator',
    prompt_version: 'chat-artifact',
    project_id: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function normalizeStoryTimeline(payload: Record<string, unknown> | undefined): StorylineStageData[] | null {
  if (!payload || !Array.isArray(payload.stages)) return null
  const stages = payload.stages
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      if (typeof record.title !== 'string' || typeof record.summary !== 'string') return null
      return {
        title: record.title,
        summary: record.summary,
        chapters: Array.isArray(record.chapters) ? record.chapters.filter((v): v is number => typeof v === 'number') : [],
        tension: typeof record.tension === 'string' ? record.tension : undefined,
      } satisfies StorylineStageData
    })
    .filter(Boolean) as StorylineStageData[]
  return stages.length ? stages : null
}

function normalizeTopologyArtifact(
  payload: Record<string, unknown> | undefined,
  skill: Exclude<ChatSkill, 'auto'>
): TopologyViewData | null {
  if (!payload || !Array.isArray(payload.nodes)) return null
  const nodesRaw = payload.nodes
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name : typeof record.label === 'string' ? record.label : ''
      const note = typeof record.note === 'string' ? record.note : typeof record.role === 'string' ? record.role : ''
      if (!name) return null
      return {
        label: note ? `${name}：${truncateText(note, 18)}` : name,
        tone: skill === 'character_insight' ? 'core' : 'support',
      } satisfies TopologyNode
    })
    .filter(Boolean) as TopologyNode[]
  if (!nodesRaw.length) return null
  return {
    centerLabel: skill === 'character_insight' ? '人物关系' : skill === 'story_overview' ? '全书梳理' : '平台建议',
    nodes: nodesRaw.slice(0, 8),
  }
}

function extractIndexedTaggedSection(content: string, index: number, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = content.match(new RegExp(`【修改项\\s*${index}\\s*[-：:]\\s*${escaped}】\\s*([\\s\\S]*?)(?=\\n【修改项\\s*\\d+\\s*[-：:]\\s*[^\\n]+】|\\n【[^\\n]+】|$)`, 'i'))
    const value = match?.[1]?.trim()
    if (value) return value
  }
  return null
}

function resolveRewriteTargetNovel(
  change: RewriteChange,
  message: ChatMessage,
  novels: Novel[],
  index = 0
): Novel | undefined {
  if (change.chapterIndex != null) {
    const byIndex = novels.find((item) => item.chapter_index === change.chapterIndex)
    if (byIndex) return byIndex
  }
  if (message.novelIds?.length) {
    const scopedNovel = message.novelIds[index] != null
      ? novels.find((item) => item.id === message.novelIds?.[index])
      : undefined
    if (scopedNovel) return scopedNovel
  }
  return resolveMessageTargetNovel(message, novels, change.chapterIndex)
}

function buildRadarMetrics(dimensionScores: Record<string, number>): Array<{ label: string; score: number }> {
  return Object.entries(dimensionScores)
    .slice(0, 6)
    .map(([key, value]) => ({
      label: dimensionLabel(key),
      score: Number(value),
    }))
}

function parseTopologyView(content: string, skill: Exclude<ChatSkill, 'auto'>): TopologyViewData | null {
  const sectionDefs: Record<Exclude<ChatSkill, 'auto'>, Array<{ labels: string[]; tone: TopologyNode['tone'] }>> = {
    chapter_eval: [
      { labels: ['问题', '核心问题'], tone: 'risk' },
      { labels: ['原因', '原因分析'], tone: 'core' },
      { labels: ['建议', '修改动作'], tone: 'action' },
    ],
    chapter_rewrite: [
      { labels: ['改写意图'], tone: 'core' },
      { labels: ['修改说明'], tone: 'action' },
      { labels: ['可替换章节'], tone: 'support' },
    ],
    story_overview: [
      { labels: ['主线摘要', '主线'], tone: 'core' },
      { labels: ['分集节奏', '关键节点'], tone: 'support' },
      { labels: ['结构风险', '风险'], tone: 'risk' },
      { labels: ['下一步优化路线', '下一步'], tone: 'action' },
    ],
    character_insight: [
      { labels: ['核心人物', '角色目标/阻碍/转变'], tone: 'core' },
      { labels: ['关系张力', '人物关系'], tone: 'support' },
      { labels: ['可做冲突与反转点', '冲突点'], tone: 'risk' },
      { labels: ['建议动作', '成长线'], tone: 'action' },
    ],
    platform_advice: [
      { labels: ['目标平台画像', '目标平台'], tone: 'core' },
      { labels: ['标题包装'], tone: 'support' },
      { labels: ['开篇节奏优化'], tone: 'risk' },
      { labels: ['分集长度/挂念建议', '发布动作'], tone: 'action' },
    ],
  }

  const nodes = (sectionDefs[skill] || [])
    .map((item) => {
      const value = extractTaggedSection(content, item.labels)
      if (!value) return null
      return {
        label: `${item.labels[0]}：${truncateText(value.replace(/\n+/g, ' '), 26)}`,
        tone: item.tone,
      } satisfies TopologyNode
    })
    .filter(Boolean) as TopologyNode[]

  if (!nodes.length) {
    const fallbackLines = content
      .split('\n')
      .map((line) => line.replace(/^[-*•\d.\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 5)
      .map((line, index) => ({
        label: truncateText(line, 28),
        tone: (['core', 'support', 'risk', 'action', 'support'] as TopologyNode['tone'][])[index] ?? 'support',
      }))
    if (!fallbackLines.length) return null
    return {
      centerLabel: skill === 'story_overview' ? '全书梳理' : skill === 'character_insight' ? '人物分析' : '平台建议',
      nodes: fallbackLines,
    }
  }

  return {
    centerLabel: skill === 'story_overview' ? '全书梳理' : skill === 'character_insight' ? '人物分析' : '平台建议',
    nodes,
  }
}

function truncateText(value: string, maxLen: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxLen) return normalized
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`
}

function topologyToneClass(tone: TopologyNode['tone']): string {
  if (tone === 'core') return 'bg-indigo-400'
  if (tone === 'risk') return 'bg-red-400'
  if (tone === 'action') return 'bg-emerald-400'
  return 'bg-amber-300'
}

function topologyToneFill(tone: TopologyNode['tone']): string {
  if (tone === 'core') return 'rgb(129 140 248)'
  if (tone === 'risk') return 'rgb(248 113 113)'
  if (tone === 'action') return 'rgb(74 222 128)'
  return 'rgb(252 211 77)'
}

function topologyToneLabel(tone: TopologyNode['tone']): string {
  if (tone === 'core') return '核心主题 / 主线'
  if (tone === 'risk') return '风险 / 冲突 / 待修复点'
  if (tone === 'action') return '建议动作 / 下一步'
  return '支撑信息 / 辅助节点'
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

function RadarChart({
  metrics,
  overallScore,
}: {
  metrics: Array<{ label: string; score: number }>
  overallScore: number
}) {
  if (!metrics.length) {
    return <p className="text-[11px] text-muted-foreground">暂无可视化维度数据。</p>
  }
  const size = 220
  const center = size / 2
  const maxRadius = 72
  const levels = 5
  const points = metrics.map((metric, index) => {
    const angle = (-Math.PI / 2) + (index / metrics.length) * Math.PI * 2
    const radius = (Math.max(0, Math.min(10, metric.score)) / 10) * maxRadius
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
      lx: center + Math.cos(angle) * (maxRadius + 24),
      ly: center + Math.sin(angle) * (maxRadius + 24),
      angle,
      ...metric,
    }
  })
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ')

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {Array.from({ length: levels }, (_, idx) => {
          const radius = ((idx + 1) / levels) * maxRadius
          const ring = points
            .map((point) => `${center + Math.cos(point.angle) * radius},${center + Math.sin(point.angle) * radius}`)
            .join(' ')
          return <polygon key={`ring-${idx}`} points={ring} fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="1" />
        })}
        {points.map((point, idx) => (
          <line key={`axis-${idx}`} x1={center} y1={center} x2={point.lx} y2={point.ly} stroke="rgba(148,163,184,0.2)" strokeWidth="1" />
        ))}
        <polygon points={polygon} fill="rgba(99,102,241,0.2)" stroke="rgba(129,140,248,0.9)" strokeWidth="2" />
        {points.map((point, idx) => (
          <g key={`label-${idx}`}>
            <circle cx={point.x} cy={point.y} r="3" fill="rgb(129 140 248)" />
            <text
              x={point.lx}
              y={point.ly}
              textAnchor={point.lx >= center ? 'start' : 'end'}
              dominantBaseline="middle"
              fontSize="10"
              fill="currentColor"
            >
              {truncateText(point.label, 8)}
            </text>
          </g>
        ))}
      </svg>
      <p className="text-[11px] text-muted-foreground">总分：{overallScore.toFixed(2)} / 10</p>
    </div>
  )
}

function StoryTimelineCard({ stages }: { stages: StorylineStageData[] }) {
  return (
    <div className="space-y-3">
      {stages.map((stage, index) => (
        <div key={`timeline-${index}`} className="relative rounded-lg border border-border/60 bg-background/30 p-3">
          {index < stages.length - 1 && (
            <div className="absolute left-[17px] top-10 h-[calc(100%-18px)] w-px bg-border/60" />
          )}
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-[10px] font-semibold text-sky-300">
              {index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-foreground">{stage.title}</p>
                {stage.chapters && stage.chapters.length > 0 && (
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300">
                    第{stage.chapters.join('、')}章
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{stage.summary}</p>
              {stage.tension && <p className="mt-1 text-[11px] text-amber-300">叙事张力：{stage.tension}</p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function TopologyGraph({ data }: { data: TopologyViewData }) {
  const size = 520
  const center = size / 2
  const radius = 160
  const nodes = data.nodes.map((node, index) => {
    const angle = (-Math.PI / 2) + (index / Math.max(1, data.nodes.length)) * Math.PI * 2
    return {
      ...node,
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    }
  })

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} className="min-h-[420px]">
      {Array.from({ length: 3 }, (_, idx) => (
        <circle
          key={`bg-${idx}`}
          cx={center}
          cy={center}
          r={60 + idx * 48}
          fill="none"
          stroke="rgba(148,163,184,0.14)"
          strokeDasharray="4 6"
        />
      ))}
      {nodes.map((node, index) => (
        <g key={`${node.label}-${index}`}>
          <line x1={center} y1={center} x2={node.x} y2={node.y} stroke="rgba(148,163,184,0.35)" strokeWidth="1.5" />
          <circle cx={node.x} cy={node.y} r="26" fill="rgba(15,23,42,0.9)" stroke="rgba(148,163,184,0.4)" />
          <circle cx={node.x} cy={node.y} r="6" fill={topologyToneFill(node.tone)} />
          <text x={node.x} y={node.y + 42} textAnchor="middle" fontSize="12" fill="currentColor">
            {truncateText(node.label, 12)}
          </text>
        </g>
      ))}
      <circle cx={center} cy={center} r="40" fill="rgba(99,102,241,0.18)" stroke="rgba(129,140,248,0.95)" strokeWidth="2" />
      <text x={center} y={center} textAnchor="middle" dominantBaseline="middle" fontSize="14" fill="currentColor">
        {truncateText(data.centerLabel, 10)}
      </text>
    </svg>
  )
}

function chatSkillLabel(skill?: Exclude<ChatSkill, 'auto'>): string {
  if (skill === 'chapter_eval') return '章节评估'
  if (skill === 'chapter_rewrite') return '章节改写'
  if (skill === 'story_overview') return '全书梳理'
  if (skill === 'character_insight') return '任务分析'
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
