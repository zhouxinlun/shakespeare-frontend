import axios from 'axios'
import type { Project } from '@/types/pipeline'
import type {
  Outline,
  Script,
  Novel,
  NovelEvaluation,
  BookEvaluation,
  BookEvaluationHistory,
  NovelLiveEvaluation,
  NovelLatestEvaluation,
  NovelStats,
  NovelChatHistory,
  AIConfig,
  AIModelMap,
  ProviderBaseURLMap,
  PromptConfig,
} from '@/types/api'

const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// 请求拦截：自动携带 Token
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 响应拦截：401 跳转登录
http.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ===== Auth =====
export const authApi = {
  login: (username: string, password: string) =>
    http.post<{ code: number; data: { token: string; user: { id: number; name: string } } }>('/auth/login', { username, password }),
  me: () => http.get('/auth/me'),
}

// ===== Projects =====
export const projectApi = {
  list: () => http.get<Project[]>('/projects'),
  create: (data: { name: string; intro?: string; type?: string; content_type?: 'short_drama' | 'web_novel' | 'mystery' | 'general'; art_style?: string; video_ratio?: string }) =>
    http.post<Project>('/projects', data),
  get: (id: number) => http.get<Project>(`/projects/${id}`),
  update: (id: number, data: Partial<Project>) => http.put<Project>(`/projects/${id}`, data),
  delete: (id: number) => http.delete(`/projects/${id}`),
}

// ===== Novels =====
export const novelApi = {
  list: (projectId: number) => http.get<Novel[]>(`/projects/${projectId}/novels`),
  stats: (projectId: number) => http.get<NovelStats>(`/projects/${projectId}/novels/stats`),
  batchCreate: (
    projectId: number,
    chapters: { chapter_index: number; volume?: string; chapter_title?: string; content: string }[]
  ) =>
    http.post(`/projects/${projectId}/novels`, { chapters }),
  update: (
    projectId: number,
    novelId: number,
    data: Partial<{ chapter_index: number; volume?: string; chapter_title?: string; content: string }>
  ) => http.put<Novel>(`/projects/${projectId}/novels/${novelId}`, data),
  reorder: (projectId: number, orders: { novel_id: number; chapter_index: number }[]) =>
    http.put(`/projects/${projectId}/novels/reorder`, { orders }),
  delete: (projectId: number, novelId: number) =>
    http.delete(`/projects/${projectId}/novels/${novelId}`),
  deleteAll: (projectId: number) => http.delete(`/projects/${projectId}/novels`),
  listEvaluations: (projectId: number, novelId: number) =>
    http.get<NovelEvaluation[]>(`/projects/${projectId}/novels/${novelId}/evaluations`),
  latestEvaluations: (projectId: number) =>
    http.get<NovelLatestEvaluation[]>(`/projects/${projectId}/evaluations/latest`),
  parseUrl: (projectId: number) => `/api/projects/${projectId}/novels/parse`,
  chatUrl: (projectId: number) => `/api/projects/${projectId}/novels/chat`,
  chatHistory: (projectId: number, limit = 120, offset = 0) =>
    http.get<NovelChatHistory>(`/projects/${projectId}/novels/chat/history`, {
      params: { limit, offset },
    }),
  clearChatHistory: (projectId: number) => http.delete(`/projects/${projectId}/novels/chat/history`),
  evaluateUrl: (projectId: number, novelId: number) => `/api/projects/${projectId}/novels/${novelId}/evaluate`,
  evaluateBook: (
    projectId: number,
    data?: Partial<{
      novel_ids: number[]
      chapters_to_evaluate: number[]
      focus_areas: string[]
      include_benchmarking: boolean
      force_re_evaluate: boolean
    }>
  ) => http.post<BookEvaluation>(`/projects/${projectId}/novels/evaluate-book`, data ?? {}),
  bookHistory: (projectId: number, limit = 10, offset = 0) =>
    http.get<BookEvaluationHistory>(`/projects/${projectId}/novels/book/history`, {
      params: { limit, offset },
    }),
  evaluateLive: (projectId: number, novelId: number, temporaryContent: string, chapterTitle?: string) =>
    http.post<NovelLiveEvaluation>(`/projects/${projectId}/novels/${novelId}/evaluate-live`, {
      temporary_content: temporaryContent,
      chapter_title: chapterTitle,
    }),
}

// ===== Outlines =====
export const outlineApi = {
  list: (projectId: number) => http.get<Outline[]>(`/projects/${projectId}/outlines`),
  get: (projectId: number, outlineId: number) =>
    http.get<Outline>(`/projects/${projectId}/outlines/${outlineId}`),
  update: (projectId: number, outlineId: number, data: { data?: Record<string, unknown>; status?: string }) =>
    http.put<Outline>(`/projects/${projectId}/outlines/${outlineId}`, data),
  getStoryline: (projectId: number) => http.get(`/projects/${projectId}/storyline`),
}

// ===== Scripts =====
export const scriptApi = {
  list: (projectId: number) => http.get<Script[]>(`/projects/${projectId}/scripts`),
  get: (projectId: number, scriptId: number) =>
    http.get<Script>(`/projects/${projectId}/scripts/${scriptId}`),
}

// ===== Pipeline =====
export const pipelineApi = {
  getRunUrl: (projectId: number, stage: string) => `/api/pipeline/${projectId}/run/${stage}`,
  getChatUrl: (projectId: number, stage: string) => `/api/pipeline/${projectId}/chat/${stage}`,

  confirm: (projectId: number, stage: string) =>
    http.post(`/pipeline/${projectId}/confirm/${stage}`),
  reset: (projectId: number, stage: string) =>
    http.post(`/pipeline/${projectId}/reset/${stage}`),
  cancel: (projectId: number, stage: string) =>
    http.post(`/pipeline/${projectId}/cancel/${stage}`),
  clear: (projectId: number, stage: string) =>
    http.post(`/pipeline/${projectId}/clear/${stage}`),
}

// ===== Settings =====
export const settingApi = {
  getAIConfigs: () => http.get<AIConfig[]>('/settings/ai-configs'),
  createAIConfig: (data: { type?: string; manufacturer?: string; model: string; api_key: string; base_url?: string | null }) =>
    http.post<AIConfig>('/settings/ai-configs', data),
  updateAIConfig: (id: number, data: Partial<{ type: string; manufacturer: string; model: string; api_key: string; base_url?: string | null }>) =>
    http.put<AIConfig>(`/settings/ai-configs/${id}`, data),
  deleteAIConfig: (id: number) => http.delete(`/settings/ai-configs/${id}`),
  testDraftAIConfig: (data: { type?: string; manufacturer?: string; model: string; api_key: string; base_url?: string | null; prompt?: string }) =>
    http.post<{ code: number; data: {
      reply: string
      detected_type?: string | null
      supports_tools?: boolean | null
      supports_thinking?: boolean | null
      supports_vision?: boolean | null
      supports_image_generation?: boolean | null
      image_min_size?: string | null
      supports_video_generation?: boolean | null
    } }>('/settings/ai-configs/test', data),
  testSavedAIConfig: (id: number) =>
    http.post<{ code: number; data: {
      reply: string
      detected_type?: string | null
      supports_tools?: boolean | null
      supports_thinking?: boolean | null
      supports_vision?: boolean | null
      supports_image_generation?: boolean | null
      image_min_size?: string | null
      supports_video_generation?: boolean | null
    } }>(`/settings/ai-configs/${id}/test`),
  getModelMaps: () => http.get<AIModelMap[]>('/settings/ai-model-maps'),
  updateModelMap: (key: string, data: { config_id?: number | null; fallback_config_ids?: number[] }) =>
    http.put(`/settings/ai-model-maps/${key}`, data),
  getProviderBaseURLMaps: () => http.get<ProviderBaseURLMap[]>('/settings/provider-base-url-maps'),
  createProviderBaseURLMap: (data: { manufacturer: string; base_url_prefix: string }) =>
    http.post<ProviderBaseURLMap>('/settings/provider-base-url-maps', data),
  updateProviderBaseURLMap: (id: number, data: Partial<{ manufacturer: string; base_url_prefix: string }>) =>
    http.put<ProviderBaseURLMap>(`/settings/provider-base-url-maps/${id}`, data),
  deleteProviderBaseURLMap: (id: number) => http.delete(`/settings/provider-base-url-maps/${id}`),
  getPrompts: () => http.get<PromptConfig[]>('/settings/prompts'),
  updatePrompt: (code: string, custom_value: string | null) =>
    http.put(`/settings/prompts/${code}`, { custom_value }),
}

export default http
