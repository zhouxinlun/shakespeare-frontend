import { Loader2, RotateCcw, Save, Settings2 } from 'lucide-react'

import type { AIConfig, AIModelMap } from '@/types/api'

type ModelMapRow = {
  map: AIModelMap
  expectedType?: string
  options: AIConfig[]
}

type Props = {
  modelMapLoading: boolean
  modelMapWithOptions: ModelMapRow[]
  mapDrafts: Record<string, string>
  aiConfigById: Record<number, AIConfig>
  isMapBusy: (key: string) => boolean
  onChangeDraft: (key: string, value: string) => void
  onSaveMap: (key: string, value: string) => void
  onResetMap: (key: string, value: string) => void
  onOpenStrategy: (map: AIModelMap, options: AIConfig[]) => void
}

export function ModelMapSection({
  modelMapLoading,
  modelMapWithOptions,
  mapDrafts,
  aiConfigById,
  isMapBusy,
  onChangeDraft,
  onSaveMap,
  onResetMap,
  onOpenStrategy,
}: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">Agent 模型映射</h2>
      <p className="mt-1 text-xs text-muted-foreground">将业务能力 key 绑定到具体 AI 配置</p>

      <div className="mt-4 space-y-2">
        {modelMapLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载中...</div>
        ) : modelMapWithOptions.map(({ map, expectedType, options }) => {
          const draft = mapDrafts[map.key] ?? (map.config_id == null ? '' : String(map.config_id))
          const current = map.config_id == null ? '' : String(map.config_id)
          const mapBusy = isMapBusy(map.key)
          const fallbackChain = (map.fallback_config_ids ?? [])
            .map((cid) => {
              const cfg = aiConfigById[cid]
              if (!cfg) return `#${cid}`
              return `#${cfg.id} ${cfg.manufacturer}/${cfg.model}`
            })
            .join(' → ')
          return (
            <div key={map.id} className="grid grid-cols-1 gap-2 rounded-md border border-border/60 p-3 md:grid-cols-[220px_120px_1fr]">
              <div>
                <p className="text-sm font-medium">{map.name}</p>
                <p className="text-xs text-muted-foreground">{map.key}</p>
              </div>
              <div className="text-xs text-muted-foreground">{expectedType ?? 'all'}</div>
              <div className="space-y-2">
                <select
                  value={draft}
                  onChange={(e) => onChangeDraft(map.key, e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">未绑定</option>
                  {options.map((cfg) => (
                    <option key={cfg.id} value={cfg.id}>
                      #{cfg.id} {cfg.manufacturer}/{cfg.model} ({cfg.type})
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSaveMap(map.key, draft)}
                    disabled={mapBusy || draft === current}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />保存映射
                  </button>
                  <button
                    onClick={() => onResetMap(map.key, current)}
                    disabled={mapBusy || draft === current}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />重置
                  </button>
                  <button
                    onClick={() => onOpenStrategy(map, options)}
                    disabled={mapBusy || !(draft ? Number(draft) : map.config_id)}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <Settings2 className="h-3.5 w-3.5" />策略
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {fallbackChain ? `Fallback: ${fallbackChain}` : 'Fallback: 未配置'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
