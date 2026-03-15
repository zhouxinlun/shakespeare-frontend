import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Film, ChevronRight, Loader2, Clapperboard } from 'lucide-react'
import { projectApi } from '@/lib/api'
import { formatDate, toErrMsg } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'
import type { Project } from '@/types/pipeline'
import { STAGE_ORDER, STAGE_LABELS } from '@/types/pipeline'

type CreateStep = 1 | 2

type ArtStyleValue = '写实真人' | '漫画风格' | '古风水墨' | '赛博朋克' | 'custom'
type ContentTypeValue = 'short_drama' | 'web_novel' | 'mystery' | 'general'

const PROJECT_TYPES = ['都市爱情', '玄幻', '甜宠', '悬疑', '古装', '校园', '其他'] as const
const CONTENT_TYPE_OPTIONS: Array<{ value: ContentTypeValue; label: string; description: string }> = [
  { value: 'short_drama', label: '短剧', description: '默认按短剧节奏、转折和留存导向评估。' },
  { value: 'web_novel', label: '网文', description: '更强调连载感、章节粘性和阅读流畅度。' },
  { value: 'mystery', label: '悬疑', description: '更强调伏笔、公平性、揭晓冲击和逻辑闭环。' },
  { value: 'general', label: '通用', description: '适合暂未明确内容类型的普通文本项目。' },
] as const
const VIDEO_RATIOS = [
  { value: '9:16', label: '9:16 竖屏（推荐）' },
  { value: '16:9', label: '16:9 横屏' },
] as const
const ART_STYLE_OPTIONS = ['写实真人', '漫画风格', '古风水墨', '赛博朋克', 'custom'] as const

export function ProjectListPage() {
  const [showCreate, setShowCreate] = useState(false)
  const [step, setStep] = useState<CreateStep>(1)
  const [name, setName] = useState('')
  const [intro, setIntro] = useState('')
  const [projectType, setProjectType] = useState<string>(PROJECT_TYPES[0])
  const [contentType, setContentType] = useState<ContentTypeValue>('short_drama')
  const [videoRatio, setVideoRatio] = useState('9:16')
  const [artStyle, setArtStyle] = useState<ArtStyleValue>('漫画风格')
  const [customArtStyle, setCustomArtStyle] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.show)

  const resetCreateForm = () => {
    setStep(1)
    setName('')
    setIntro('')
    setProjectType(PROJECT_TYPES[0])
    setContentType('short_drama')
    setVideoRatio('9:16')
    setArtStyle('漫画风格')
    setCustomArtStyle('')
  }

  const openCreateModal = () => {
    resetCreateForm()
    setShowCreate(true)
  }

  const closeCreateModal = () => {
    setShowCreate(false)
    resetCreateForm()
  }

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectApi.list().then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; intro?: string; type?: string; content_type?: ContentTypeValue; art_style?: string; video_ratio?: string }) => projectApi.create(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      closeCreateModal()
      navigate({ to: `/projects/${res.data.id}/novel` })
      showToast('请先上传或解析小说，准备好原始内容后再启动流水线', 'info', 5000)
    },
    onError: (err) => {
      showToast(`创建失败：${toErrMsg(err)}`, 'error', 7000)
    },
  })

  const getPipelineProgress = (project: Project) => {
    const state = project.pipeline_state
    const done = STAGE_ORDER.filter((s) => state[s] === 'done').length
    return { done, total: STAGE_ORDER.length }
  }

  const handleCreate = () => {
    if (!name.trim()) return

    const resolvedArtStyle = artStyle === 'custom' ? customArtStyle.trim() : artStyle
    if (!resolvedArtStyle) {
      showToast('请先填写画风', 'error')
      return
    }

    createMutation.mutate({
      name: name.trim(),
      intro: intro.trim() || undefined,
      type: projectType,
      content_type: contentType,
      video_ratio: videoRatio,
      art_style: resolvedArtStyle,
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">我的项目</h1>
          <p className="text-sm text-muted-foreground mt-1">管理你的 AI 短剧创作项目</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          新建项目
        </button>
      </div>

      {/* 创建弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">新建项目</h2>
              <span className="text-xs text-muted-foreground">步骤 {step} / 2</span>
            </div>

            {step === 1 ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground">项目名称 *</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：都市爱恋短剧"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">项目简介（可选）</label>
                  <textarea
                    value={intro}
                    onChange={(e) => setIntro(e.target.value)}
                    placeholder="简述项目风格和主题..."
                    rows={3}
                    className="mt-1 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">📌 内容类型（必选）</label>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    {CONTENT_TYPE_OPTIONS.map((item) => (
                      <label
                        key={item.value}
                        className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                          contentType === item.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="content_type"
                            value={item.value}
                            checked={contentType === item.value}
                            onChange={() => setContentType(item.value)}
                            className="h-3.5 w-3.5"
                          />
                          <span>{item.label}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">题材类型</label>
                  <select
                    value={projectType}
                    onChange={(e) => setProjectType(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {PROJECT_TYPES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">视频比例</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {VIDEO_RATIOS.map((ratio) => (
                      <label
                        key={ratio.value}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                          videoRatio === ratio.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                        }`}
                      >
                        <input
                          type="radio"
                          name="video_ratio"
                          value={ratio.value}
                          checked={videoRatio === ratio.value}
                          onChange={(e) => setVideoRatio(e.target.value)}
                          className="h-3.5 w-3.5"
                        />
                        {ratio.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground mb-2">画风</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ART_STYLE_OPTIONS.map((option) => (
                      <label
                        key={option}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                          artStyle === option ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                        }`}
                      >
                        <input
                          type="radio"
                          name="art_style"
                          value={option}
                          checked={artStyle === option}
                          onChange={() => setArtStyle(option)}
                          className="h-3.5 w-3.5"
                        />
                        {option === 'custom' ? '其他（自定义）' : option}
                      </label>
                    ))}
                  </div>
                  {artStyle === 'custom' && (
                    <input
                      value={customArtStyle}
                      onChange={(e) => setCustomArtStyle(e.target.value)}
                      placeholder="请输入自定义画风"
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  )}
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeCreateModal}
                disabled={createMutation.isPending}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              {step === 2 && (
                <button
                  onClick={() => setStep(1)}
                  disabled={createMutation.isPending}
                  className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  上一步
                </button>
              )}
              {step === 1 ? (
                <button
                  onClick={() => setStep(2)}
                  disabled={!name.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  下一步
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  创建项目
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 项目列表 */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 text-center">
          <div className="rounded-xl bg-primary/10 p-3">
            <Clapperboard className="h-8 w-8 text-primary" />
          </div>
          <p className="text-base font-medium text-foreground">还没有项目，开始你的第一个 AI 短剧</p>
          <p className="text-sm text-muted-foreground">上传小说 → 生成大纲 → 生成剧本 → 生成分镜 → 合成视频</p>
          <button
            onClick={openCreateModal}
            className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            新建项目
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const { done, total } = getPipelineProgress(project)
            const progressPct = Math.round((done / total) * 100)
            return (
              <div
                key={project.id}
                onClick={() => navigate({ to: `/projects/${project.id}` })}
                className="group cursor-pointer rounded-xl border border-border bg-card p-5 hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/5 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10">
                      <Film className="h-4 w-4 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="font-medium text-foreground">{project.name}</h3>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {contentTypeLabel(project.content_type)}
                        {project.type ? ` · ${project.type}` : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>

                {project.intro && (
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{project.intro}</p>
                )}

                {/* 进度 */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span>整体进度</span>
                    <span>{done}/{total} 阶段完成</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                {/* 阶段状态点 */}
                <div className="mt-3 flex gap-1.5">
                  {STAGE_ORDER.map((stage) => {
                    const status = project.pipeline_state[stage]
                    return (
                      <div
                        key={stage}
                        title={STAGE_LABELS[stage]}
                        className={`h-1.5 flex-1 rounded-full ${
                          status === 'done' ? 'bg-emerald-500' :
                          status === 'running' ? 'bg-blue-500 animate-pulse' :
                          status === 'paused' ? 'bg-amber-500' :
                          status === 'cancelled' ? 'bg-orange-500' :
                          status === 'failed' ? 'bg-red-500' :
                          'bg-muted'
                        }`}
                      />
                    )
                  })}
                </div>

                <p className="mt-3 text-xs text-muted-foreground">{formatDate(project.created_at)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function contentTypeLabel(value: ContentTypeValue): string {
  const map: Record<ContentTypeValue, string> = {
    short_drama: '短剧',
    web_novel: '网文',
    mystery: '悬疑',
    general: '通用',
  }
  return map[value] || value
}
