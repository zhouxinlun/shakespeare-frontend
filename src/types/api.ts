export interface ApiResp<T = unknown> {
  code: number
  msg: string
  data?: T
}

export interface Outline {
  id: number
  episode_index: number
  title?: string
  data: Record<string, unknown>
  status: string
  project_id: number
  created_at: string
  updated_at: string
}

export interface Script {
  id: number
  episode_index: number
  title?: string
  content: string
  outline_id: number
  project_id: number
  status: string
  created_at: string
  updated_at: string
}

export interface Novel {
  id: number
  chapter_index: number
  volume?: string
  chapter_title?: string
  content: string
  word_count: number
  project_id: number
  created_at: string
  updated_at: string
}

export interface NovelStats {
  total_chapters: number
  total_words: number
  total_volumes: number
  average_score?: number | null
}

export interface NovelEvaluation {
  id: number
  novel_id: number
  content_type: string
  evaluation_type: string
  overall_score: number
  dimension_scores: Record<string, number>
  summary?: string | null
  suggestions: Array<{
    dimension: string
    issue: string
    suggestion: string
    priority: 'high' | 'medium' | 'low'
    text_ref?: string
  }>
  novel_revision: number
  parent_evaluation_id?: number | null
  model_used: string
  prompt_version: string
  project_id: number
  created_at: string
  updated_at?: string | null
}

export interface NovelLatestEvaluation {
  novel_id: number
  evaluation: NovelEvaluation
}

export interface NovelLiveEvaluation {
  novel_id: number
  overall_score: number
  dimension_scores: Record<string, number>
  content_type: string
  prompt_version: string
  model_used: string
  generated_at: string
}

export type NovelChatSkill =
  | 'chapter_eval'
  | 'chapter_rewrite'
  | 'story_overview'
  | 'character_insight'
  | 'platform_advice'

export interface NovelChatMessageRecord {
  id: number
  session_id: number
  role: 'user' | 'assistant'
  message: string
  skill?: NovelChatSkill | null
  artifact_type?: string | null
  artifact_status?: string | null
  requires_confirmation?: boolean
  artifact_payload?: Record<string, unknown> | null
  novel_ids: number[]
  created_at: string
}

export interface NovelChatHistory {
  total: number
  messages: NovelChatMessageRecord[]
}

export interface NovelChatSession {
  id: number
  title?: string | null
  preview?: string | null
  message_count: number
  created_at: string
  updated_at: string
  last_message_at: string
}

export interface NovelChatSessionList {
  total: number
  sessions: NovelChatSession[]
}

export interface NovelEvaluationComparisonItem {
  before: number
  after: number
  delta: number
}

export interface NovelEvaluationComparison {
  version1: NovelEvaluation
  version2: NovelEvaluation
  comparison: Record<string, NovelEvaluationComparisonItem>
  suggestions_resolved: number
  new_issues: number
}

export interface BookEvaluation {
  id: number
  project_id: number
  content_type: string
  evaluated_novel_ids: number[]
  aggregated_stats: {
    total_chapters: number
    total_words: number
    total_volumes: number
    average_score: number
    dimension_averages: Record<string, number>
    score_distribution: Record<string, number>
    low_score_chapters?: Array<{
      novel_id: number
      chapter_index: number
      chapter_title?: string
      overall_score: number
    }>
    benchmark?: {
      grade: string
      level: string
    }
  }
  consistency_issues: Array<{
    type: string
    severity: 'high' | 'medium' | 'low' | string
    title: string
    description: string
    affected_chapters: number[]
    suggestion: string
  }>
  overall_assessment: {
    overall_score: number
    completeness_score: number
    coherence_score: number
    audience_fit_score: number
    summary: string
    improvement_priorities: Array<{
      dimension: string
      label: string
      average_score: number
      priority: 'high' | 'medium' | 'low' | string
      recommendation: string
    }>
  }
  model_used: string
  prompt_version: string
  created_at: string
  updated_at?: string | null
}

export interface BookEvaluationHistory {
  total: number
  evaluations: BookEvaluation[]
}

export interface AIConfig {
  id: number
  type: string
  manufacturer: string
  model: string
  api_key: string
  base_url?: string | null
  last_test_status?: string | null
  last_test_summary?: string | null
  last_tested_at?: string | null
  supports_tools?: boolean | null
  supports_thinking?: boolean | null
  supports_vision?: boolean | null
  supports_image_generation?: boolean | null
  image_min_size?: string | null
  supports_video_generation?: boolean | null
  created_at: string
}

export interface AIModelMap {
  id: number
  key: string
  name: string
  config_id?: number | null
  fallback_config_ids: number[]
  config?: AIConfig | null
  fallback_configs: AIConfig[]
}

export interface ProviderBaseURLMap {
  id: number
  manufacturer: string
  base_url_prefix: string
  created_at: string
}

export interface PromptConfig {
  id: number
  code: string
  name: string
  type: string
  parent_code?: string
  default_value: string
  custom_value?: string
}
