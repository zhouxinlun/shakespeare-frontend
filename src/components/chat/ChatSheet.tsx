import { useState, useRef, useEffect } from 'react'
import { X, Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PipelineStage, SSEEvent } from '@/types/pipeline'
import { STAGE_LABELS } from '@/types/pipeline'
import { pipelineApi } from '@/lib/api'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

interface ChatSheetProps {
  projectId: number
  stage: PipelineStage
  open: boolean
  onClose: () => void
}

export function ChatSheet({ projectId, stage, open, onClose }: ChatSheetProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || isLoading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    const assistantId = (Date.now() + 1).toString()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', isStreaming: true }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setIsLoading(true)

    // 关闭之前的 SSE 连接
    esRef.current?.close()

    try {
      // 使用 fetch 做 POST + SSE
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/pipeline/${projectId}/chat/${stage}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: input }),
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as SSEEvent
              if (event.type === 'content' && event.data && typeof event.data === 'object' && 'chunk' in event.data) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + (event.data as { chunk: string }).chunk }
                      : m
                  )
                )
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: '请求失败，请重试', isStreaming: false } : m
        )
      )
    } finally {
      setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, isStreaming: false } : m))
      setIsLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col border-l border-border bg-background shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">{STAGE_LABELS[stage]} · Chat 优化</p>
          <p className="text-xs text-muted-foreground">通过对话修改和优化内容</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground mt-8">
            <p>你可以在这里修改和优化{STAGE_LABELS[stage]}内容</p>
            <p className="mt-1">例如："把第2集的开场改得更吸引人"</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm',
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            )}>
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              {msg.isStreaming && (
                <span className="inline-block w-1 h-4 bg-current animate-pulse ml-0.5" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="输入修改指令... (Enter 发送，Shift+Enter 换行)"
            rows={2}
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={send}
            disabled={isLoading || !input.trim()}
            className={cn(
              'rounded-md p-2 transition-colors self-end',
              isLoading || !input.trim()
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
