import { useEffect, useRef, useCallback } from 'react'
import type { SSEEvent } from '@/types/pipeline'

interface UseSSEOptions {
  onEvent: (event: SSEEvent) => void
  onError?: (error: Event) => void
  onOpen?: () => void
}

export function useSSE(url: string | null, options: UseSSEOptions) {
  const esRef = useRef<EventSource | null>(null)
  const { onEvent, onError, onOpen } = options

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!url) return
    close()

    const token = localStorage.getItem('token')
    // EventSource 不支持自定义 headers，通过 query param 传 token
    const fullUrl = token ? `${url}?token=${token}` : url
    const es = new EventSource(fullUrl)
    esRef.current = es

    es.onopen = () => onOpen?.()

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent
        onEvent(event)
      } catch {
        // ignore parse error
      }
    }

    const onFallbackWarning = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent
        onEvent(event)
      } catch {
        // ignore parse error
      }
    }
    es.addEventListener('fallback_warning', onFallbackWarning)

    es.onerror = (e) => {
      onError?.(e)
      es.close()
      esRef.current = null
    }

    return () => {
      es.removeEventListener('fallback_warning', onFallbackWarning)
      es.close()
      esRef.current = null
    }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  return { close, isConnected: !!esRef.current }
}
