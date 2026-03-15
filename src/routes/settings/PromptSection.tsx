import { Loader2, RotateCcw, Save } from 'lucide-react'

import type { PromptConfig } from '@/types/api'

type Props = {
  promptLoading: boolean
  prompts: PromptConfig[]
  promptDrafts: Record<string, string>
  isBusy: (code: string) => boolean
  onChangeDraft: (code: string, value: string) => void
  onReset: (code: string) => void
  onSave: (code: string, value: string) => void
}

export function PromptSection({
  promptLoading,
  prompts,
  promptDrafts,
  isBusy,
  onChangeDraft,
  onReset,
  onSave,
}: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">Prompt 管理</h2>
      <p className="mt-1 text-xs text-muted-foreground">编辑 custom prompt，留空表示使用默认 prompt</p>

      <div className="mt-4 space-y-3">
        {promptLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载中...</div>
        ) : prompts.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无 Prompt</div>
        ) : prompts.slice().sort((a, b) => a.code.localeCompare(b.code)).map((p) => {
          const value = promptDrafts[p.code] ?? ''
          const busy = isBusy(p.code)
          return (
            <div key={p.id} className="rounded-lg border border-border/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.code} · {p.type}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onReset(p.code)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />恢复默认
                  </button>
                  <button
                    onClick={() => onSave(p.code, value)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />保存
                  </button>
                </div>
              </div>

              <textarea
                value={value}
                onChange={(e) => onChangeDraft(p.code, e.target.value)}
                placeholder={p.default_value.slice(0, 120)}
                rows={6}
                className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs"
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
