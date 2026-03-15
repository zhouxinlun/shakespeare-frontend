import { useEffect, useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  Brain,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'

import { novelApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'
import type {
  BookEvaluation,
  BookEvaluationHistory,
  Novel,
  NovelEvaluation,
  NovelEvaluationComparison,
  NovelLiveEvaluation,
  NovelLatestEvaluation,
  NovelStats,
} from '@/types/api'

type ParseMode = 'auto' | 'rule_only' | 'ai_only'
type ParsePath = 'guided_rule' | 'intelligent'
type RuleType = 'title' | 'separator' | 'rhythm'
type TwistStrategy = 'aggressive' | 'balanced' | 'conservative'
type CliffhangerStyle = 'suspense' | 'reversal' | 'climax' | 'dialogue'
type DashboardTab = 'overview' | 'consistency' | 'suggestions' | 'trend'

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
        // ignore malformed chunks
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
  const [parseMode, setParseMode] = useState<ParseMode>('auto')
  const [ruleType, setRuleType] = useState<RuleType>('title')
  const [separatorPattern, setSeparatorPattern] = useState('---')
  const [twistStrategy, setTwistStrategy] = useState<TwistStrategy>('balanced')
  const [cliffhangerStyle, setCliffhangerStyle] = useState<CliffhangerStyle>('suspense')
  const [targetPlatform, setTargetPlatform] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
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
  const [isEvaluatingAll, setIsEvaluatingAll] = useState(false)
  const [isEvaluatingBatch, setIsEvaluatingBatch] = useState(false)
  const [batchMessage, setBatchMessage] = useState('')
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([])
  const [liveEvaluation, setLiveEvaluation] = useState<NovelLiveEvaluation | null>(null)
  const [isLiveEvaluating, setIsLiveEvaluating] = useState(false)
  const [liveEvaluationError, setLiveEvaluationError] = useState('')
  const [evaluationHistory, setEvaluationHistory] = useState<NovelEvaluation[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [compareVersion1, setCompareVersion1] = useState<number | null>(null)
  const [compareVersion2, setCompareVersion2] = useState<number | null>(null)
  const [compareResult, setCompareResult] = useState<NovelEvaluationComparison | null>(null)
  const [isComparing, setIsComparing] = useState(false)
  const [compareError, setCompareError] = useState('')
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview')
  const [isEvaluatingBook, setIsEvaluatingBook] = useState(false)
  const [bookEvaluationMessage, setBookEvaluationMessage] = useState('')

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
    return sortedNovels.find((n) => n.id === selectedId) ?? sortedNovels[0]
  }, [sortedNovels, selectedId])

  const selectedEvaluation = useMemo(() => {
    if (!selectedNovel) return null
    if (currentEvaluation && currentEvaluation.novel_id === selectedNovel.id) {
      return currentEvaluation
    }
    return evaluationMap.get(selectedNovel.id) ?? null
  }, [currentEvaluation, evaluationMap, selectedNovel])

  const effectiveParseMode = useMemo<ParseMode>(() => {
    if (parsePath === 'intelligent') {
      return parseMode === 'rule_only' ? 'ai_only' : parseMode
    }
    if (ruleType === 'separator' && parseMode === 'auto') {
      return 'rule_only'
    }
    return parseMode
  }, [parseMode, parsePath, ruleType])

  const parseUnitLabel = parsePath === 'intelligent' || ruleType === 'rhythm' ? '段' : '章'

  useEffect(() => {
    if (!selectedNovel) return
    setEditingVolume(selectedNovel.volume || '')
    setEditingTitle(selectedNovel.chapter_title || '')
    setEditingContent(selectedNovel.content || '')
    setLiveEvaluation(null)
    setLiveEvaluationError('')
  }, [selectedNovel])

  useEffect(() => {
    if (!selectedNovel) return
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
        setLiveEvaluationError(String(error))
      } finally {
        if (!cancelled) {
          setIsLiveEvaluating(false)
        }
      }
    }, 700)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [id, selectedNovel, editingContent, editingTitle, evaluatingId])

  useEffect(() => {
    const validIds = new Set(sortedNovels.map((item) => item.id))
    setSelectedBatchIds((prev) => prev.filter((item) => validIds.has(item)))
  }, [sortedNovels])

  useEffect(() => {
    if (!selectedNovel) {
      setEvaluationHistory([])
      setCompareVersion1(null)
      setCompareVersion2(null)
      setCompareResult(null)
      setHistoryError('')
      return
    }

    let cancelled = false
    setIsHistoryLoading(true)
    setHistoryError('')
    setCompareError('')
    setCompareResult(null)

    novelApi
      .listEvaluations(id, selectedNovel.id)
      .then((response) => {
        if (cancelled) return
        const list = response.data
        setEvaluationHistory(list)
        setCompareVersion2(list[0]?.id ?? null)
        setCompareVersion1(list[1]?.id ?? null)
      })
      .catch((error) => {
        if (cancelled) return
        setEvaluationHistory([])
        setCompareVersion1(null)
        setCompareVersion2(null)
        setHistoryError(String(error))
      })
      .finally(() => {
        if (!cancelled) setIsHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, selectedNovel, latestEvaluations])

  const isAllBatchSelected = sortedNovels.length > 0 && selectedBatchIds.length === sortedNovels.length

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['novels', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-stats', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-latest-evaluations', id] }),
      queryClient.invalidateQueries({ queryKey: ['novels-book-history', id] }),
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
      showToast(String(error), 'error')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (novelId: number) => novelApi.delete(id, novelId),
    onSuccess: async () => {
      await refreshAll()
      showToast('章节已删除', 'success')
      setCurrentEvaluation(null)
    },
  })

  const clearMutation = useMutation({
    mutationFn: () => novelApi.deleteAll(id),
    onSuccess: async () => {
      await refreshAll()
      showToast('已清空全部章节', 'success')
      setCurrentEvaluation(null)
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (orders: { novel_id: number; chapter_index: number }[]) => novelApi.reorder(id, orders),
    onSuccess: async () => {
      await refreshAll()
    },
  })

  const selectNovel = (novel: Novel) => {
    setSelectedId(novel.id)
    setEditingVolume(novel.volume || '')
    setEditingTitle(novel.chapter_title || '')
    setEditingContent(novel.content || '')
    setCurrentEvaluation(evaluationMap.get(novel.id) ?? null)
  }

  const addManualChapter = async () => {
    const content = manualContent.trim()
    if (!content) {
      showToast('章节正文不能为空', 'error')
      return
    }

    const nextIndex = sortedNovels.length
      ? Math.max(...sortedNovels.map((n) => n.chapter_index)) + 1
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
      showToast(String(error), 'error')
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
    const idx = sortedNovels.findIndex((n) => n.id === novel.id)
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

  const toggleBatchSelection = (novelId: number) => {
    setSelectedBatchIds((prev) =>
      prev.includes(novelId) ? prev.filter((item) => item !== novelId) : [...prev, novelId]
    )
  }

  const toggleSelectAllBatch = () => {
    if (isAllBatchSelected) {
      setSelectedBatchIds([])
      return
    }
    setSelectedBatchIds(sortedNovels.map((item) => item.id))
  }

  const openParseModal = () => {
    setParseOpen(true)
    setParseProgress(0)
    setParseMessage('等待开始解析')
    setParseMeta({})
    setParseAnalysis(null)
    setParsedChapters([])
  }

  const startParse = async () => {
    const text = parseText.trim()
    if (!text) {
      showToast('请先粘贴小说文本', 'error')
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
          mode: effectiveParseMode,
          rule_type: ruleType,
          separator_pattern: ruleType === 'separator' ? separatorPattern.trim() || undefined : undefined,
          twist_strategy: parsePath === 'intelligent' || ruleType === 'rhythm' ? twistStrategy : undefined,
          cliffhanger_style: parsePath === 'intelligent' || ruleType === 'rhythm' ? cliffhangerStyle : undefined,
          target_platform: parsePath === 'intelligent' ? targetPlatform.trim() || undefined : undefined,
          target_audience: parsePath === 'intelligent' ? targetAudience.trim() || undefined : undefined,
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
            if (payload) {
              setParseAnalysis(payload)
            }
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
      showToast(String(error), 'error')
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
      showToast(String(error), 'error')
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
                    content_type: 'short_drama',
                    evaluation_type: 'chapter_only',
                    overall_score: 0,
                    dimension_scores: {},
                    summary: '',
                    suggestions: [],
                    novel_revision: 1,
                    parent_evaluation_id: null,
                    model_used: 'novel_evaluator',
                    prompt_version: 'short_drama.v1',
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
            if (evaluation) {
              setCurrentEvaluation(evaluation)
            }
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
      showToast(String(error), 'error')
    } finally {
      setEvaluatingId(null)
    }
  }

  const evaluateAll = async () => {
    setIsEvaluatingAll(true)
    setEvaluationMessage('开始重评全书...')

    try {
      await streamSSE(novelApi.evaluateAllUrl(id), {
        body: {},
        onEvent: (event, eventName) => {
          if (eventName === 'fallback_warning') {
            showToast(event.message || '评估模型已切换到备用配置', 'info')
          }

          const type = event.type
          if (type === 'chapter_start') {
            setEvaluationMessage(`正在评估：${String(event.chapter_title || '')}`)
          } else if (type === 'chapter_done') {
            if (event.error) {
              showToast(`章节评估失败：${String(event.chapter_title || '')}`, 'error')
            }
          } else if (type === 'done') {
            const avg = event.avg_score
            setEvaluationMessage(`全书评估完成，平均分 ${avg ?? '-'} `)
          } else if (type === 'error') {
            throw new Error(event.message || '全书评估失败')
          }
        },
      })
      await refreshAll()
      showToast('全书评估完成', 'success')
    } catch (error) {
      setEvaluationMessage('全书评估失败')
      showToast(String(error), 'error')
    } finally {
      setIsEvaluatingAll(false)
    }
  }

  const evaluateBook = async () => {
    if (!sortedNovels.length) {
      showToast('当前项目没有章节，无法执行全书评估', 'error')
      return
    }

    setIsEvaluatingBook(true)
    setBookEvaluationMessage('正在进行全书质量体检...')
    try {
      await novelApi.evaluateBook(id)
      await refreshAll()
      setBookEvaluationMessage('全书质量体检已完成')
      showToast('全书质量体检完成', 'success')
    } catch (error) {
      setBookEvaluationMessage('全书质量体检失败')
      showToast(String(error), 'error')
    } finally {
      setIsEvaluatingBook(false)
    }
  }

  const evaluateBatch = async () => {
    if (!selectedBatchIds.length) {
      showToast('请先勾选要评估的章节', 'error')
      return
    }

    setIsEvaluatingBatch(true)
    setBatchMessage('开始批量评估...')
    setBatchProgress({ current: 0, total: selectedBatchIds.length })
    setCurrentEvaluation(null)

    try {
      await streamSSE(novelApi.evaluateBatchUrl(id), {
        body: { novel_ids: selectedBatchIds },
        onEvent: (event, eventName) => {
          if (eventName === 'fallback_warning') {
            showToast(event.message || '评估模型已切换到备用配置', 'info')
          }

          const type = event.type
          if (type === 'progress') {
            const current = Number(event.current || 0)
            const total = Number(event.total || selectedBatchIds.length)
            const chapter = String(event.chapter || '')
            setBatchProgress({ current, total })
            setBatchMessage(chapter ? `批量评估中 ${current}/${total}：${chapter}` : `批量评估中 ${current}/${total}`)
          } else if (type === 'complete') {
            const results = Array.isArray(event.results) ? event.results : []
            const failedCount = results.filter((item) => item && typeof item === 'object' && 'error' in item).length
            const successCount = results.length - failedCount
            setBatchProgress({ current: Number(event.total || results.length), total: Number(event.total || results.length) })
            setBatchMessage(`批量评估完成：成功 ${successCount}，失败 ${failedCount}`)
          } else if (type === 'error') {
            throw new Error(event.message || '批量评估失败')
          }
        },
      })
      await refreshAll()
      showToast('批量评估完成', 'success')
    } catch (error) {
      setBatchMessage('批量评估失败')
      showToast(String(error), 'error')
    } finally {
      setIsEvaluatingBatch(false)
    }
  }

  const runCompare = async () => {
    if (!selectedNovel || compareVersion1 == null || compareVersion2 == null) {
      showToast('请选择两个评估版本', 'error')
      return
    }
    if (compareVersion1 === compareVersion2) {
      showToast('请选择两个不同的版本', 'error')
      return
    }

    setIsComparing(true)
    setCompareError('')
    setCompareResult(null)
    try {
      const response = await novelApi.compareEvaluations(id, selectedNovel.id, compareVersion1, compareVersion2)
      setCompareResult(response.data)
    } catch (error) {
      setCompareError(String(error))
    } finally {
      setIsComparing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        加载章节中...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="h-5 w-5" /> 小说管理
          </h2>
          <p className="text-xs text-muted-foreground mt-1">支持手动维护、智能解析和 AI 文本评估</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openParseModal}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 px-3 py-1.5 text-sm text-indigo-300 hover:bg-indigo-500/10"
          >
            <Sparkles className="h-4 w-4" /> 粘贴文本解析
          </button>
          <button
            onClick={() => setShowManualForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <Plus className="h-4 w-4" /> 手动添加
          </button>
          <button
            onClick={evaluateAll}
            disabled={isEvaluatingAll || isEvaluatingBatch || isEvaluatingBook || !novels.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
          >
            {isEvaluatingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />} 全书重评估
          </button>
          <button
            onClick={evaluateBook}
            disabled={isEvaluatingBook || isEvaluatingAll || isEvaluatingBatch || !novels.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 px-3 py-1.5 text-sm text-violet-300 hover:bg-violet-500/10 disabled:opacity-50"
          >
            {isEvaluatingBook ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />} 全书质量体检
          </button>
          <button
            onClick={evaluateBatch}
            disabled={isEvaluatingBatch || isEvaluatingAll || isEvaluatingBook || !selectedBatchIds.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 px-3 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
          >
            {isEvaluatingBatch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            批量评估（{selectedBatchIds.length}）
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

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <button
          onClick={toggleSelectAllBatch}
          disabled={!sortedNovels.length}
          className="rounded border border-border px-2 py-1 text-foreground hover:bg-accent disabled:opacity-50"
        >
          {isAllBatchSelected ? '取消全选' : '全选章节'}
        </button>
        <span>已选 {selectedBatchIds.length} / {sortedNovels.length} 章</span>
        {batchProgress && (
          <span>
            · 进度 {batchProgress.current}/{batchProgress.total}
          </span>
        )}
        {batchMessage && <span>· {batchMessage}</span>}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatsCard label="总章节" value={String(stats?.total_chapters ?? 0)} />
        <StatsCard label="总卷数" value={String(stats?.total_volumes ?? 0)} />
        <StatsCard label="总字数" value={String(stats?.total_words ?? 0)} />
        <StatsCard label="平均评分" value={stats?.average_score != null ? stats.average_score.toFixed(2) : '-'} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">全书质量仪表板</h3>
            <p className="mt-1 text-xs text-muted-foreground">基于章节评估结果做全书聚合、问题识别与优化建议。</p>
          </div>
          {latestBookEvaluation && (
            <p className="text-[11px] text-muted-foreground">
              最近体检：{formatDateTime(latestBookEvaluation.created_at)} · {contentTypeName(latestBookEvaluation.content_type)}
            </p>
          )}
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
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载全书评估中...
          </p>
        ) : !latestBookEvaluation ? (
          <p className="text-xs text-muted-foreground">暂无全书评估结果，点击“全书质量体检”生成仪表板数据。</p>
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
                    <p className="text-xs font-medium text-foreground mb-2">维度均分</p>
                    <div className="space-y-2">
                      {Object.entries(latestBookEvaluation.aggregated_stats?.dimension_averages || {}).map(([key, value]) => (
                        <ScoreRow key={`book-avg-${key}`} label={dimensionLabel(key)} score={Number(value)} />
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
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
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">手动添加章节</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={manualVolume}
              onChange={(e) => setManualVolume(e.target.value)}
              placeholder="卷名（可选）"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              placeholder="章节标题（可选）"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <textarea
            value={manualContent}
            onChange={(e) => setManualContent(e.target.value)}
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {!groupedNovels.length && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              还没有章节，先使用“粘贴文本解析”或“手动添加”。
            </div>
          )}

          {groupedNovels.map(([volume, chapters]) => (
            <div key={volume} className="rounded-xl border border-border bg-card p-3">
              <h3 className="text-sm font-semibold text-foreground mb-2">{volume}</h3>
              <div className="space-y-2">
                {chapters.map((novel) => {
                  const score = evaluationMap.get(novel.id)?.overall_score
                  return (
                    <div
                      key={novel.id}
                      className={cn(
                        'rounded-lg border p-3 transition-colors',
                        selectedNovel?.id === novel.id
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : 'border-border hover:bg-accent/40'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <label className="mt-0.5 flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedBatchIds.includes(novel.id)}
                            onChange={() => toggleBatchSelection(novel.id)}
                            className="h-4 w-4 rounded border-border bg-background"
                            title="加入批量评估"
                          />
                        </label>
                        <button
                          onClick={() => selectNovel(novel)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-sm font-medium text-foreground truncate">
                            第 {novel.chapter_index} 章 {novel.chapter_title || '未命名章节'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {novel.content.slice(0, 110)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            字数：{novel.word_count}
                            {score != null ? ` · 评分：${score.toFixed(1)}` : ''}
                          </p>
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => moveChapter(novel, 'up')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="上移"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => moveChapter(novel, 'down')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="下移"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => selectNovel(novel)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="编辑"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => evaluateOne(novel)}
                            disabled={evaluatingId === novel.id || isEvaluatingAll || isEvaluatingBatch || isEvaluatingBook}
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
        </div>

        <aside className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">章节编辑</h3>
            <p className="text-xs text-muted-foreground mt-1">选择左侧章节后可编辑并保存</p>
          </div>

          {!selectedNovel && (
            <div className="text-sm text-muted-foreground">暂无可编辑章节</div>
          )}

          {selectedNovel && (
            <>
              <input
                value={editingVolume}
                onChange={(e) => setEditingVolume(e.target.value)}
                placeholder="卷名"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                placeholder="章节标题"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <textarea
                value={editingContent}
                onChange={(e) => setEditingContent(e.target.value)}
                rows={12}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
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
              <button
                onClick={saveSelectedChapter}
                disabled={updateMutation.isPending}
                className="w-full rounded-md bg-primary py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {updateMutation.isPending ? '保存中...' : '保存章节修改'}
              </button>
            </>
          )}

          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">AI 内容评估</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  按当前项目内容类型自动选择评估维度。
                </p>
              </div>
              {selectedNovel && (
                <button
                  onClick={() => evaluateOne(selectedNovel)}
                  disabled={evaluatingId != null || isEvaluatingAll || isEvaluatingBatch || isEvaluatingBook}
                  className="rounded-md border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                >
                  {evaluatingId === selectedNovel.id ? '评估中...' : '重新评估'}
                </button>
              )}
            </div>

            {evaluationMessage && <p className="text-xs text-muted-foreground mt-2">{evaluationMessage}</p>}

            {selectedEvaluation ? (
              <div className="space-y-2 mt-3">
                <p className="text-sm font-medium text-foreground">总分：{selectedEvaluation.overall_score.toFixed(2)}</p>
                <p className="text-[11px] text-muted-foreground">
                  内容类型：{contentTypeName(selectedEvaluation.content_type)} · 评估版本：v{selectedEvaluation.novel_revision}
                </p>
                {Object.entries(selectedEvaluation.dimension_scores).map(([key, value]) => (
                  <ScoreRow key={key} label={dimensionLabel(key)} score={Number(value)} />
                ))}
                {selectedEvaluation.summary && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{selectedEvaluation.summary}</p>
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
              <p className="text-xs text-muted-foreground mt-2">暂无评估结果</p>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">版本对比</h4>
                <p className="mt-1 text-xs text-muted-foreground">选择两个历史评估版本，比较维度变化与问题收敛。</p>
              </div>
              <button
                onClick={runCompare}
                disabled={isComparing || !selectedNovel || compareVersion1 == null || compareVersion2 == null}
                className="rounded-md border border-indigo-500/40 px-2 py-1 text-xs text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-50"
              >
                {isComparing ? '对比中...' : '开始对比'}
              </button>
            </div>

            {isHistoryLoading && (
              <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载评估历史...
              </p>
            )}
            {historyError && <p className="mt-2 text-xs text-red-300">历史加载失败：{historyError}</p>}

            {!isHistoryLoading && !historyError && evaluationHistory.length >= 2 && (
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">版本 1（基线）</span>
                    <select
                      value={compareVersion1 ?? ''}
                      onChange={(e) => setCompareVersion1(Number(e.target.value) || null)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    >
                      <option value="">请选择</option>
                      {evaluationHistory.map((item) => (
                        <option key={`v1-${item.id}`} value={item.id}>
                          {evaluationOptionLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">版本 2（目标）</span>
                    <select
                      value={compareVersion2 ?? ''}
                      onChange={(e) => setCompareVersion2(Number(e.target.value) || null)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                    >
                      <option value="">请选择</option>
                      {evaluationHistory.map((item) => (
                        <option key={`v2-${item.id}`} value={item.id}>
                          {evaluationOptionLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {compareError && <p className="text-xs text-red-300">对比失败：{compareError}</p>}

                {compareResult && (
                  <div className="space-y-2 rounded-lg border border-border bg-background/60 p-3">
                    <p className="text-[11px] text-muted-foreground">
                      v{compareResult.version1.novel_revision} ({formatDateTime(compareResult.version1.created_at)}) →
                      v{compareResult.version2.novel_revision} ({formatDateTime(compareResult.version2.created_at)})
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded border border-emerald-500/30 px-2 py-0.5 text-emerald-300">
                        已解决问题 {compareResult.suggestions_resolved}
                      </span>
                      <span className="rounded border border-amber-500/30 px-2 py-0.5 text-amber-300">
                        新问题 {compareResult.new_issues}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {Object.entries(compareResult.comparison).map(([key, value]) => {
                        const before = Number(value.before || 0)
                        const after = Number(value.after || 0)
                        const delta = Number(value.delta || 0)
                        return (
                          <div key={`cmp-${key}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                            <span className="text-foreground">{dimensionLabel(key)}</span>
                            <span className="text-muted-foreground">{before.toFixed(1)} → {after.toFixed(1)}</span>
                            <span className={cn(delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-red-300' : 'text-muted-foreground')}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isHistoryLoading && !historyError && evaluationHistory.length < 2 && (
              <p className="mt-2 text-xs text-muted-foreground">至少需要两个评估版本才能进行对比。</p>
            )}
          </div>
        </aside>
      </div>

      {parseOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 p-4 md:p-8">
          <div className="mx-auto h-full max-w-6xl rounded-xl border border-border bg-background shadow-2xl flex flex-col">
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
                        setParseMode('auto')
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
                        适合已经有章标题、分隔符，或者你希望保留原文结构再做少量优化。
                      </p>
                    </button>
                    <button
                      onClick={() => {
                        setParsePath('intelligent')
                        setRuleType('rhythm')
                        setParseMode('ai_only')
                      }}
                      className={cn(
                        'rounded-xl border p-3 text-left transition-colors',
                        parsePath === 'intelligent'
                          ? 'border-indigo-500/50 bg-indigo-500/10'
                          : 'border-border hover:bg-accent/40'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">AI 智能分集</p>
                        <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                          推荐
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        更适合短剧改编，按转折、节奏和挂念点组织分段，不机械按原文章节点切。
                      </p>
                    </button>
                  </div>
                </div>

                <textarea
                  value={parseText}
                  onChange={(e) => setParseText(e.target.value)}
                  rows={14}
                  placeholder="在这里粘贴完整小说文本..."
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                />

                <div className="rounded-xl border border-border bg-card p-3">
                  {parsePath === 'guided_rule' ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">结构参考方式</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          规则不是硬约束，系统会优先参考这些结构，再决定是否补 AI 优化。
                        </p>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        {([
                          ['title', '标题型', '第X章 / Chapter N 等'],
                          ['separator', '分隔型', '--- / *** / === 等'],
                          ['rhythm', '节奏型', '按转折点和短剧节奏切分'],
                        ] as const).map(([value, label, desc]) => (
                          <button
                            key={value}
                            onClick={() => {
                              setRuleType(value)
                              if (value === 'separator') setParseMode('rule_only')
                              if (value === 'rhythm') setParseMode('auto')
                            }}
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
                          onChange={(e) => setSeparatorPattern(e.target.value)}
                          placeholder="分隔符，例如 --- 或 ***"
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                      )}
                      {ruleType === 'rhythm' && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <SelectField
                            label="转折策略"
                            value={twistStrategy}
                            onChange={(value) => setTwistStrategy(value as TwistStrategy)}
                            options={[
                              ['aggressive', '激进：每个转折都值得分段'],
                              ['balanced', '平衡：兼顾连贯和刺激'],
                              ['conservative', '保守：只保留大转折'],
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
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">AI 分集偏好</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          让故事节奏决定分段数量，适合短剧改编、结构混乱文本和需要强挂念感的内容。
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <SelectField
                          label="转折策略"
                          value={twistStrategy}
                          onChange={(value) => setTwistStrategy(value as TwistStrategy)}
                          options={[
                            ['aggressive', '激进：转折密度更高'],
                            ['balanced', '平衡：默认推荐'],
                            ['conservative', '保守：保证叙事完整'],
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
                        <input
                          value={targetPlatform}
                          onChange={(e) => setTargetPlatform(e.target.value)}
                          placeholder="目标平台，例如 抖音 / 小红书"
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <input
                          value={targetAudience}
                          onChange={(e) => setTargetAudience(e.target.value)}
                          placeholder="目标观众，例如 都市白领 / 学生"
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                      </div>
                      <input
                        value={contentGenre}
                        onChange={(e) => setContentGenre(e.target.value)}
                        placeholder="内容类型，例如 悬疑 / 爱情 / 伦理"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="rounded-xl border border-border bg-card p-3">
                    <p className="text-sm font-medium text-foreground">执行引擎（高级）</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      `自动` 会先看规则质量再决定是否调用 AI；`仅规则` 不调用 AI；`仅 AI` 直接全量交给模型。
                    </p>
                  </div>
                  <div className="space-y-2">
                    <select
                      value={parseMode}
                      onChange={(e) => setParseMode(e.target.value as ParseMode)}
                      className="w-full rounded-md border border-border bg-card px-2 py-2 text-sm"
                    >
                      <option value="auto">自动（推荐）</option>
                      <option value="rule_only">仅规则</option>
                      <option value="ai_only">仅 AI</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      当前实际执行：{parseEngineLabel(effectiveParseMode)} · 字数：{parseText.length}
                    </p>
                  </div>
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
                    onClick={startParse}
                    disabled={isParsing}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isParsing ? '解析中...' : '开始解析'}
                  </button>
                  <button
                    onClick={saveParsedResult}
                    disabled={isSavingParsed || !parsedChapters.length}
                    className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    {isSavingParsed ? '保存中...' : '确认保存'}
                  </button>
                </div>
              </div>

              <div className="overflow-auto rounded-md border border-border bg-card p-3">
                <h4 className="text-sm font-medium text-foreground mb-2">解析预览（{parsedChapters.length} {parseUnitLabel}）</h4>
                <div className="space-y-3">
                  {parsedChapters.map((chapter, idx) => (
                    <div key={`${idx}-${chapter.chapter_index}`} className="rounded-md border border-border p-2">
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          value={chapter.volume || ''}
                          onChange={(e) => {
                            const value = e.target.value
                            setParsedChapters((prev) =>
                              prev.map((item, index) => (index === idx ? { ...item, volume: value } : item))
                            )
                          }}
                          placeholder="卷名"
                          className="rounded border border-border bg-background px-2 py-1 text-xs"
                        />
                        <input
                          value={chapter.chapter_title || ''}
                          onChange={(e) => {
                            const value = e.target.value
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
                        onChange={(e) => {
                          const value = e.target.value
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

function StatsCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground mt-1">{value}</p>
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
        onChange={(e) => onChange(e.target.value)}
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
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>{label}</span>
        <span>{score.toFixed(1)}</span>
      </div>
      <div className="h-1.5 rounded bg-muted overflow-hidden">
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
    rhythm_ai: '节奏优先 AI 解析',
  }
  if (!method) return '-'
  return map[method] || method
}

function parseEngineLabel(mode: ParseMode): string {
  const map: Record<ParseMode, string> = {
    auto: '自动',
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
    rhythm: '节奏型',
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

function evaluationOptionLabel(evaluation: NovelEvaluation): string {
  return `v${evaluation.novel_revision} · ${formatDateTime(evaluation.created_at)} · ${evaluation.overall_score.toFixed(1)}分`
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
