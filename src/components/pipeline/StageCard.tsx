import { CheckCircle2, XCircle, Loader2, Clock, PauseCircle, Play, RefreshCw, MessageSquare, ChevronRight, Square, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StageStatus, PipelineStage } from '@/types/pipeline'
import { CHAT_STAGES } from '@/types/pipeline'

interface StageCardProps {
  stage: PipelineStage
  label: string
  status: StageStatus
  progress?: number
  message?: string
  error?: string | null
  isDisabled?: boolean  // 前置依赖未完成
  onRun: () => void
  onCancel?: () => void
  onConfirm: () => void
  onReset: () => void
  onClear?: () => void
  onChat?: () => void
  onView?: () => void
  index: number
}

const statusConfig: Record<StageStatus, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'text-muted-foreground', icon: <Clock className="w-4 h-4" />, label: '待开始' },
  running: { color: 'text-blue-400', icon: <Loader2 className="w-4 h-4 animate-spin" />, label: '生成中' },
  paused: { color: 'text-amber-400', icon: <PauseCircle className="w-4 h-4" />, label: '待确认' },
  done: { color: 'text-emerald-400', icon: <CheckCircle2 className="w-4 h-4" />, label: '已完成' },
  failed: { color: 'text-red-400', icon: <XCircle className="w-4 h-4" />, label: '失败' },
  cancelled: { color: 'text-orange-400', icon: <Square className="w-4 h-4" />, label: '已停止' },
  skipped: { color: 'text-muted-foreground', icon: <ChevronRight className="w-4 h-4" />, label: '已跳过' },
}

export function StageCard({
  stage, label, status, progress, message, error,
  isDisabled, onRun, onCancel, onConfirm, onReset, onClear, onChat, onView, index
}: StageCardProps) {
  const cfg = statusConfig[status] ?? statusConfig.pending
  const supportsChat = CHAT_STAGES.includes(stage)

  return (
    <div className={cn(
      'rounded-lg border bg-card p-4 transition-all',
      status === 'running' && 'border-blue-500/50 shadow-blue-500/10 shadow-lg',
      status === 'paused' && 'border-amber-500/50',
      status === 'done' && 'border-emerald-500/20',
      status === 'failed' && 'border-red-500/50',
      status === 'cancelled' && 'border-orange-500/40',
      status === 'pending' && 'border-border/50',
    )}>
      <div className="flex items-center justify-between">
        {/* 左侧：序号 + 标签 + 状态 */}
        <div className="flex items-center gap-3">
          <span className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
            status === 'done' ? 'bg-emerald-500/20 text-emerald-400' :
            status === 'running' ? 'bg-blue-500/20 text-blue-400' :
            status === 'paused' ? 'bg-amber-500/20 text-amber-400' :
            status === 'failed' ? 'bg-red-500/20 text-red-400' :
            status === 'cancelled' ? 'bg-orange-500/20 text-orange-400' :
            'bg-muted text-muted-foreground'
          )}>
            {index}
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            <div className={cn('flex items-center gap-1 text-xs mt-0.5', cfg.color)}>
              {cfg.icon}
              <span>{cfg.label}</span>
              {status === 'running' && progress !== undefined && (
                <span className="ml-1 text-muted-foreground">{progress}%</span>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-2">
          {status === 'pending' && (
            <button
              onClick={onRun}
              disabled={isDisabled}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                isDisabled
                  ? 'cursor-not-allowed bg-muted text-muted-foreground'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              <Play className="w-3 h-3" />
              生成{label}
            </button>
          )}

          {status === 'running' && (
            <>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="flex items-center gap-1.5 rounded-md border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10"
                >
                  <Square className="w-3 h-3" />
                  停止
                </button>
              )}
              <span className="text-xs text-muted-foreground animate-pulse">{message || '处理中...'}</span>
            </>
          )}

          {status === 'paused' && (
            <>
              <button
                onClick={onConfirm}
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="w-3 h-3" />
                确认通过
              </button>
              {supportsChat && onChat && (
                <button
                  onClick={onChat}
                  className="flex items-center gap-1.5 rounded-md border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10"
                >
                  <MessageSquare className="w-3 h-3" />
                  修改
                </button>
              )}
            </>
          )}

          {status === 'done' && (
            <>
              {onView && (
                <button
                  onClick={onView}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                >
                  查看
                </button>
              )}
              {supportsChat && onChat && (
                <button
                  onClick={onChat}
                  className="flex items-center gap-1.5 rounded-md border border-indigo-500/50 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-indigo-500/10"
                >
                  <MessageSquare className="w-3 h-3" />
                  Chat 优化
                </button>
              )}
              <button
                onClick={onReset}
                className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                title="重新生成"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              {onClear && (
                <button
                  onClick={onClear}
                  className="rounded-md border border-red-500/40 p-1.5 text-red-300 hover:bg-red-500/10"
                  title="清空结果"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}

          {(status === 'failed' || status === 'cancelled') && (
            <>
              <span className={cn('text-xs', status === 'failed' ? 'text-red-400' : 'text-orange-400')}>
                {status === 'failed' ? (error || '生成失败') : (message || '任务已停止')}
              </span>
              <button
                onClick={onRun}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white',
                  status === 'failed' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'
                )}
              >
                <RefreshCw className="w-3 h-3" />
                重试
              </button>
              {onClear && (
                <button
                  onClick={onClear}
                  className="rounded-md border border-red-500/40 p-1.5 text-red-300 hover:bg-red-500/10"
                  title="清空结果"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 进度条（RUNNING 状态） */}
      {status === 'running' && progress !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          {message && <p className="mt-1.5 text-xs text-muted-foreground">{message}</p>}
        </div>
      )}

      {/* PAUSED 提示 */}
      {status === 'paused' && message && (
        <p className="mt-2 text-xs text-amber-400/80">{message}</p>
      )}
    </div>
  )
}
