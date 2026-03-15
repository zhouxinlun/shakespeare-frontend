import { GripVertical, Loader2, Plus, Save, Trash2, X } from 'lucide-react'
import type { DragEvent } from 'react'

import type { AIConfig } from '@/types/api'

export type StrategyDraft = {
  key: string
  name: string
  expectedType?: string
  chain: number[]
  addCandidateId: string
}

type Props = {
  draft: StrategyDraft | null
  aiConfigById: Record<number, AIConfig>
  strategyAddOptions: AIConfig[]
  onClose: () => void
  onDragStart: (configId: number, isPrimary: boolean, event: DragEvent<HTMLDivElement>) => void
  onDragOver: (isPrimary: boolean, event: DragEvent<HTMLDivElement>) => void
  onDrop: (targetId: number, event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onRemoveFallback: (configId: number) => void
  onChangeCandidate: (value: string) => void
  onAddFallback: () => void
  onSave: () => void
  saving: boolean
}

export function StrategyEditor({
  draft,
  aiConfigById,
  strategyAddOptions,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onRemoveFallback,
  onChangeCandidate,
  onAddFallback,
  onSave,
  saving,
}: Props) {
  if (!draft) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border/70 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold">配置 {draft.key} 的备用模型链</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              说明：当前模型不可用时，将按顺序依次尝试备用模型（类型 {draft.expectedType ?? 'all'}）
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="关闭"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-4">
          {draft.chain.map((configId, index) => {
            const cfg = aiConfigById[configId]
            const label = cfg
              ? `#${cfg.id} ${cfg.manufacturer}/${cfg.model} (${cfg.type})`
              : `#${configId}（配置不存在或无权限）`
            const isPrimary = index === 0
            return (
              <div
                key={`${configId}-${index}`}
                draggable={!isPrimary}
                onDragStart={(event) => onDragStart(configId, isPrimary, event)}
                onDragOver={(event) => onDragOver(isPrimary, event)}
                onDrop={(event) => onDrop(configId, event)}
                onDragEnd={onDragEnd}
                className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <GripVertical className={`h-4 w-4 ${isPrimary ? 'text-muted-foreground/30' : 'cursor-grab text-muted-foreground'}`} />
                  <span className="w-5 text-xs text-muted-foreground">{index + 1}.</span>
                  <span className="truncate text-sm">{label}</span>
                  {isPrimary && (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                      主模型
                    </span>
                  )}
                </div>
                {!isPrimary && (
                  <button
                    type="button"
                    onClick={() => onRemoveFallback(configId)}
                    className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    移除
                  </button>
                )}
              </div>
            )
          })}

          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
            <select
              value={draft.addCandidateId}
              onChange={(e) => onChangeCandidate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">+ 添加备用模型</option>
              {strategyAddOptions.map((cfg) => (
                <option key={cfg.id} value={cfg.id}>
                  #{cfg.id} {cfg.manufacturer}/{cfg.model} ({cfg.type})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onAddFallback}
              disabled={!draft.addCandidateId}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              添加
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border/70 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
