export type StageStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled' | 'skipped'

export type PipelineStage = 'novel' | 'outline' | 'script' | 'storyboard' | 'images' | 'video'

export interface PipelineState {
  novel: StageStatus
  outline: StageStatus
  script: StageStatus
  storyboard: StageStatus
  images: StageStatus
  video: StageStatus
  current_stage: PipelineStage | null
  current_progress: number
  current_message: string
  error: string | null
}

export interface SSEEvent {
  type: 'progress' | 'state_change' | 'content' | 'error' | 'pause' | 'done' | 'fallback_warning'
  stage: PipelineStage
  progress?: number
  message?: string
  status?: StageStatus
  data?: unknown
}

export interface Project {
  id: number
  name: string
  intro?: string
  type?: string
  content_type: 'short_drama' | 'web_novel' | 'mystery' | 'general'
  art_style?: string
  video_ratio?: string
  pipeline_state: PipelineState
  user_id: number
  created_at: string
  updated_at: string
}

export const STAGE_LABELS: Record<PipelineStage, string> = {
  novel: '小说解析',
  outline: '大纲生成',
  script: '剧本生成',
  storyboard: '分镜创建',
  images: '图片生成',
  video: '视频合成',
}

export const STAGE_ORDER: PipelineStage[] = ['novel', 'outline', 'script', 'storyboard', 'images', 'video']

// 支持 Chat 优化的阶段
export const CHAT_STAGES: PipelineStage[] = ['outline', 'script', 'storyboard']

// 每个阶段的前置依赖
export const STAGE_DEPS: Partial<Record<PipelineStage, PipelineStage>> = {
  outline: 'novel',
  script: 'outline',
  storyboard: 'script',
  images: 'storyboard',
  video: 'images',
}
