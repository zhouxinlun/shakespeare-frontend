import { create } from 'zustand'
import type { PipelineState, PipelineStage, StageStatus } from '@/types/pipeline'

interface PipelineStore {
  // projectId -> PipelineState
  pipelines: Record<number, PipelineState>
  // `${projectId}-${stage}` -> streaming text content
  streamContent: Record<string, string>

  setPipeline: (projectId: number, state: PipelineState) => void
  updatePipeline: (projectId: number, updates: Partial<PipelineState>) => void
  updateStageStatus: (projectId: number, stage: PipelineStage, status: StageStatus) => void
  appendStreamContent: (projectId: number, stage: PipelineStage, chunk: string) => void
  clearStreamContent: (projectId: number, stage: PipelineStage) => void
  getStreamContent: (projectId: number, stage: PipelineStage) => string
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  pipelines: {},
  streamContent: {},

  setPipeline: (projectId, state) =>
    set((s) => ({ pipelines: { ...s.pipelines, [projectId]: state } })),

  updatePipeline: (projectId, updates) =>
    set((s) => ({
      pipelines: {
        ...s.pipelines,
        [projectId]: { ...(s.pipelines[projectId] ?? {}), ...updates } as PipelineState,
      },
    })),

  updateStageStatus: (projectId, stage, status) =>
    set((s) => ({
      pipelines: {
        ...s.pipelines,
        [projectId]: { ...(s.pipelines[projectId] ?? {}), [stage]: status } as PipelineState,
      },
    })),

  appendStreamContent: (projectId, stage, chunk) => {
    const key = `${projectId}-${stage}`
    set((s) => ({ streamContent: { ...s.streamContent, [key]: (s.streamContent[key] ?? '') + chunk } }))
  },

  clearStreamContent: (projectId, stage) => {
    const key = `${projectId}-${stage}`
    set((s) => ({ streamContent: { ...s.streamContent, [key]: '' } }))
  },

  getStreamContent: (projectId, stage) => {
    return get().streamContent[`${projectId}-${stage}`] ?? ''
  },
}))
