import { AlertCircle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react'
import { useToastStore } from '@/stores/toast'

type ToastTone = 'success' | 'error' | 'info'

type ToneMeta = {
  title: string
  icon: LucideIcon
  accentClass: string
  iconClass: string
}

function toneMeta(tone: ToastTone): ToneMeta {
  if (tone === 'success') {
    return {
      title: '操作成功',
      icon: CheckCircle2,
      accentClass: 'bg-emerald-400/80',
      iconClass: 'text-emerald-300',
    }
  }
  if (tone === 'error') {
    return {
      title: '操作失败',
      icon: AlertCircle,
      accentClass: 'bg-red-400/85',
      iconClass: 'text-red-300',
    }
  }
  return {
    title: '系统提示',
    icon: Info,
    accentClass: 'bg-sky-400/80',
    iconClass: 'text-sky-300',
  }
}

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (!toasts.length) return null

  return (
    <div className="fixed right-4 top-16 z-50 w-full max-w-sm space-y-2">
      {toasts.map((t) => {
        const meta = toneMeta(t.tone)
        const Icon = meta.icon
        return (
        <div key={t.id} className="relative overflow-hidden rounded-lg border border-border/70 bg-card/95 px-3 py-2.5 text-foreground shadow-2xl backdrop-blur-sm">
          <span className={`absolute inset-y-0 left-0 w-1 ${meta.accentClass}`} />
          <div className="flex items-start gap-2.5 pl-1">
            <div className={`mt-0.5 ${meta.iconClass}`}><Icon className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {meta.title}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm leading-5 text-foreground/95">{t.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="关闭提示"
              title="关闭提示"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )})}
    </div>
  )
}
