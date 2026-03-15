import { Loader2, Save, Trash2 } from 'lucide-react'

import type { ProviderBaseURLMap } from '@/types/api'

type Props = {
  manufacturers: readonly string[]
  manufacturer: string
  baseUrlPrefix: string
  onManufacturerChange: (value: string) => void
  onBaseUrlPrefixChange: (value: string) => void
  onCreate: () => void
  createPending: boolean
  providerMapLoading: boolean
  providerBaseURLRows: ProviderBaseURLMap[]
  isDeleting: (id: number) => boolean
  onDelete: (row: ProviderBaseURLMap) => void
}

export function ProviderMappingSection({
  manufacturers,
  manufacturer,
  baseUrlPrefix,
  onManufacturerChange,
  onBaseUrlPrefixChange,
  onCreate,
  createPending,
  providerMapLoading,
  providerBaseURLRows,
  isDeleting,
  onDelete,
}: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">供应商域名映射</h2>
      <p className="mt-1 text-xs text-muted-foreground">支持 1 个供应商对应多个 Base URL 前缀；新增配置时会优先命中这里，再走自动推断</p>

      <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]">
        <select
          value={manufacturer}
          onChange={(e) => onManufacturerChange(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">请选择供应商</option>
          {manufacturers.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          value={baseUrlPrefix}
          onChange={(e) => onBaseUrlPrefixChange(e.target.value)}
          placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={onCreate}
          disabled={createPending}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {createPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          新增映射
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {providerMapLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载中...</div>
        ) : providerBaseURLRows.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无自定义映射</div>
        ) : providerBaseURLRows.map((row) => {
          const deleting = isDeleting(row.id)
          return (
            <div key={row.id} className="grid grid-cols-1 gap-2 rounded-md border border-border/60 p-3 md:grid-cols-[160px_1fr_auto]">
              <div className="text-sm font-medium">{row.manufacturer}</div>
              <div className="truncate text-xs text-muted-foreground">{row.base_url_prefix}</div>
              <div className="flex justify-end">
                <button
                  onClick={() => onDelete(row)}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
