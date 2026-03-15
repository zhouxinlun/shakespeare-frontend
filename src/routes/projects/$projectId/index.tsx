import { useEffect } from 'react'
import { useParams, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BookOpen, FileText, Film, Layers, Sparkles } from 'lucide-react'
import { PipelinePanel } from '@/components/pipeline/PipelinePanel'
import { novelApi, projectApi } from '@/lib/api'
import { useToastStore } from '@/stores/toast'

export function ProjectPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string }
  const id = parseInt(projectId)
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectApi.get(id).then((r) => r.data),
  })
  const { data: stats } = useQuery({
    queryKey: ['novels-stats', id],
    queryFn: () => novelApi.stats(id).then((r) => r.data),
  })

  useEffect(() => {
    if (!project || stats === undefined) return
    if (stats.total_chapters > 0) return
    navigate({ to: `/projects/${id}/novel`, replace: true })
    showToast('请先上传或解析小说，准备好原始内容后再开始流水线', 'info', 4000)
  }, [id, navigate, project, showToast, stats])

  const novelReady = (stats?.total_chapters ?? 0) > 0

  const navItems = [
    { label: novelReady ? '小说管理' : '小说管理 · 必需', icon: BookOpen, to: `/projects/${id}/novel` },
    { label: '大纲查看', icon: Layers, to: `/projects/${id}/outline` },
    { label: '剧本查看', icon: FileText, to: `/projects/${id}/script` },
    { label: '分镜查看', icon: Film, to: `/projects/${id}/storyboard` },
  ]

  return (
    <div className="flex gap-6">
      {/* 左侧边栏 */}
      <aside className="w-56 shrink-0">
        <Link to="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" />
          返回项目列表
        </Link>

        {project && (
          <div className="mb-4 rounded-lg border border-border bg-card p-3">
            <h2 className="font-semibold text-sm text-foreground truncate">{project.name}</h2>
            {project.intro && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{project.intro}</p>
            )}
            <div className="mt-3 flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2 text-xs">
              <span className="text-muted-foreground">小说状态</span>
              <span className={novelReady ? 'text-emerald-400' : 'text-amber-400'}>
                {novelReady ? '已准备，可启动流水线' : '未准备，请先解析小说'}
              </span>
            </div>
          </div>
        )}

        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                item.to.endsWith('/novel') && !novelReady
                  ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* 右侧主内容 */}
      <div className="flex-1 min-w-0">
        {novelReady ? (
          <PipelinePanel projectId={id} />
        ) : (
          <div className="rounded-2xl border border-amber-500/30 bg-card p-8">
            <div className="max-w-xl">
              <div className="mb-4 inline-flex rounded-full bg-amber-500/10 p-3 text-amber-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">先准备小说内容，再启动流水线</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                当前项目还没有章节数据。先进入小说管理页上传或智能解析原文，准备好后再生成大纲、剧本和分镜。
              </p>
              <button
                onClick={() => navigate({ to: `/projects/${id}/novel` })}
                className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                去小说管理
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
