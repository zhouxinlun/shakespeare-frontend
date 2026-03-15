import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function toErrMsg(err: unknown, fallback = '请求失败'): string {
  if (typeof err === 'object' && err && 'response' in err) {
    const maybeResponse = (err as { response?: { data?: { detail?: string } } }).response
    if (maybeResponse?.data?.detail) return maybeResponse.data.detail
  }
  if (err instanceof Error) return err.message
  return fallback
}
