import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import { outlineApi } from '@/lib/api'
import { ChatSheet } from '@/components/chat/ChatSheet'
import { cn } from '@/lib/utils'

export function OutlinePage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string }
  const id = parseInt(projectId)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [chatOpen, setChatOpen] = useState(false)

  const { data: outlines = [] } = useQuery({
    queryKey: ['outlines', id],
    queryFn: () => outlineApi.list(id).then((r) => r.data),
  })

  const selected = outlines.find((o) => o.id === selectedId) ?? outlines[0]

  return (
    <div className="flex gap-4 h-full">
      {/* 左侧集数列表 */}
      <aside className="w-52 shrink-0 space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          大纲列表（{outlines.length} 集）
        </h3>
        {outlines.map((outline) => (
          <button
            key={outline.id}
            onClick={() => setSelectedId(outline.id)}
            className={cn(
              'w-full text-left rounded-md px-3 py-2 text-sm transition-colors',
              (selectedId === outline.id || (!selectedId && outline === outlines[0]))
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <p className="font-medium">第 {outline.episode_index} 集</p>
            <p className="text-xs truncate mt-0.5 opacity-70">{outline.title || '未命名'}</p>
          </button>
        ))}
      </aside>

      {/* 右侧内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {selected ? `第 ${selected.episode_index} 集《${selected.title}》` : '大纲详情'}
          </h2>
          <button
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-indigo-500/50 px-3 py-1.5 text-sm text-indigo-400 hover:bg-indigo-500/10"
          >
            <MessageSquare className="h-4 w-4" />
            Chat 优化大纲
          </button>
        </div>

        {selected && (
          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            {/* 核心矛盾 */}
            <Section title="核心矛盾">
              <p className="text-sm">{(selected.data as Record<string,string>).coreConflict}</p>
            </Section>

            {/* 剧情主干 */}
            <Section title="剧情主干（outline）">
              <p className="text-sm leading-relaxed">{(selected.data as Record<string,string>).outline}</p>
            </Section>

            {/* 关键事件 */}
            <Section title="关键事件 [起承转合]">
              <div className="grid grid-cols-2 gap-2">
                {(['起', '承', '转', '合'] as const).map((label, i) => {
                  const events = (selected.data as Record<string, string[]>).keyEvents ?? []
                  return (
                    <div key={label} className="rounded-md bg-muted/50 p-2.5">
                      <span className="text-xs font-bold text-indigo-400">{label}</span>
                      <p className="text-xs mt-1 text-muted-foreground">{events[i] ?? '-'}</p>
                    </div>
                  )
                })}
              </div>
            </Section>

            {/* 情绪曲线 */}
            <Section title="情绪曲线">
              <p className="text-sm font-mono">{(selected.data as Record<string,string>).emotionalCurve}</p>
            </Section>

            {/* 开场钩子 / 结尾悬念 */}
            <div className="grid grid-cols-2 gap-4">
              <Section title="开场钩子">
                <p className="text-sm">{(selected.data as Record<string,string>).openingHook}</p>
              </Section>
              <Section title="结尾悬念">
                <p className="text-sm">{(selected.data as Record<string,string>).endingHook}</p>
              </Section>
            </div>
          </div>
        )}
      </div>

      {/* Chat 侧边栏 */}
      {chatOpen && (
        <ChatSheet
          projectId={id}
          stage="outline"
          open={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">{title}</h4>
      {children}
    </div>
  )
}
