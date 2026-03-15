import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PipelineStage, PipelineState, SSEEvent } from '@/types/pipeline'
import { usePipelineStore } from '@/stores/pipeline'
import { useToastStore } from '@/stores/toast'
import { pipelineApi } from '@/lib/api'

export function usePipeline(projectId: number) {
  const [activeStage, setActiveStage] = useState<PipelineStage | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const { updatePipeline, updateStageStatus, appendStreamContent, clearStreamContent, pipelines } =
    usePipelineStore()
  const showToast = useToastStore((s) => s.show)
  const queryClient = useQueryClient()
  const pipeline = pipelines[projectId]

  const handleSSEEvent = useCallback(
    (event: SSEEvent) => {
      const stage = event.stage as PipelineStage
      switch (event.type) {
        case 'progress':
          updatePipeline(projectId, {
            current_stage: stage,
            current_progress: event.progress ?? 0,
            current_message: event.message ?? '',
          })
          break
        case 'state_change':
          if (event.status) {
            updateStageStatus(projectId, stage, event.status)
            if (event.status === 'cancelled' || event.status === 'done') {
              updatePipeline(projectId, { current_stage: null })
              setActiveStage(null)
            }
          }
          break
        case 'content':
          if (event.data && typeof event.data === 'object' && 'chunk' in event.data) {
            appendStreamContent(projectId, stage, event.data.chunk as string)
          }
          break
        case 'pause':
          updateStageStatus(projectId, stage, 'paused')
          updatePipeline(projectId, { current_message: event.message ?? '' })
          setActiveStage(null)
          break
        case 'done':
          updatePipeline(projectId, { current_stage: null, current_message: event.message ?? '' })
          setActiveStage(null)
          queryClient.invalidateQueries({ queryKey: ['project', projectId] })
          break
        case 'error':
          updateStageStatus(projectId, stage, 'failed')
          updatePipeline(projectId, { error: event.message ?? '未知错误' })
          setActiveStage(null)
          break
        case 'fallback_warning': {
          const data = (event.data ?? {}) as {
            key?: string
            from?: string
            to?: string
            reset_content?: boolean
          }
          if (data.reset_content) {
            clearStreamContent(projectId, stage)
          }
          const fallbackMsg =
            event.message ||
            `${data.key ?? stage}: ${data.from ?? '当前模型'} 不可用，已自动切换至 ${data.to ?? '备用模型'}`
          showToast(fallbackMsg, 'info', 5000)
          break
        }
      }
    },
    [projectId, updatePipeline, updateStageStatus, appendStreamContent, clearStreamContent, queryClient, showToast]
  )

  const streamStage = useCallback(
    async (stage: PipelineStage, body?: Record<string, unknown>) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const token = localStorage.getItem('token')
      const response = await fetch(pipelineApi.getRunUrl(projectId, stage), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
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
            const event = JSON.parse(dataLines.join('\n')) as SSEEvent
            if (eventName === 'fallback_warning' && !event.type) {
              event.type = 'fallback_warning'
            }
            handleSSEEvent(event)
          } catch {
            // ignore malformed chunks
          }
        }
      }
    },
    [handleSSEEvent, projectId]
  )

  const runStage = useCallback(
    (stage: PipelineStage, body?: Record<string, unknown>) => {
      clearStreamContent(projectId, stage)
      updateStageStatus(projectId, stage, 'running')
      updatePipeline(projectId, { current_stage: stage, current_progress: 0, current_message: '正在启动...' })
      setActiveStage(stage)
      void streamStage(stage, body).catch((error: unknown) => {
        if ((error as { name?: string }).name === 'AbortError') {
          return
        }
        updateStageStatus(projectId, stage, 'failed')
        updatePipeline(projectId, {
          current_stage: null,
          error: error instanceof Error ? error.message : '未知错误',
        })
        setActiveStage(null)
        showToast(error instanceof Error ? error.message : '阶段执行失败', 'error')
      })
    },
    [projectId, clearStreamContent, showToast, streamStage, updatePipeline, updateStageStatus]
  )

  const confirmStage = useCallback(
    async (stage: PipelineStage) => {
      await pipelineApi.confirm(projectId, stage)
      updateStageStatus(projectId, stage, 'done')
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
    [projectId, updateStageStatus, queryClient]
  )

  const cancelStage = useCallback(
    async (stage: PipelineStage) => {
      abortRef.current?.abort()
      abortRef.current = null
      await pipelineApi.cancel(projectId, stage)
      updateStageStatus(projectId, stage, 'cancelled')
      updatePipeline(projectId, {
        current_stage: null,
        current_progress: 0,
        current_message: '任务已取消',
        error: null,
      })
      setActiveStage(null)
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
    [projectId, queryClient, updatePipeline, updateStageStatus]
  )

  const resetStage = useCallback(
    async (stage: PipelineStage) => {
      await pipelineApi.reset(projectId, stage)
      const stages: PipelineStage[] = ['novel', 'outline', 'script', 'storyboard', 'images', 'video']
      const idx = stages.indexOf(stage)
      const resetUpdates: Partial<PipelineState> = { current_stage: null, error: null }
      for (const s of stages.slice(idx)) {
        resetUpdates[s] = 'pending'
      }
      updatePipeline(projectId, resetUpdates)
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
    [projectId, updatePipeline, queryClient]
  )

  const clearStage = useCallback(
    async (stage: PipelineStage) => {
      await pipelineApi.clear(projectId, stage)
      const stages: PipelineStage[] = ['novel', 'outline', 'script', 'storyboard', 'images', 'video']
      const idx = stages.indexOf(stage)
      const resetUpdates: Partial<PipelineState> = {
        current_stage: null,
        current_progress: 0,
        current_message: '',
        error: null,
      }
      for (const s of stages.slice(idx)) {
        resetUpdates[s] = 'pending'
        clearStreamContent(projectId, s)
      }
      updatePipeline(projectId, resetUpdates)
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
    [projectId, queryClient, clearStreamContent, updatePipeline]
  )

  return {
    pipeline,
    activeStage,
    handleSSEEvent,
    runStage,
    cancelStage,
    confirmStage,
    resetStage,
    clearStage,
    isRunning: activeStage !== null,
  }
}
