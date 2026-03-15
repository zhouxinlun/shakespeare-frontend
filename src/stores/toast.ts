import { create } from 'zustand'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

interface ToastStore {
  toasts: ToastItem[]
  show: (message: string, tone?: ToastTone, durationMs?: number) => number
  dismiss: (id: number) => void
}

let toastSeed = 1

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  show: (message, tone = 'info', durationMs = 5000) => {
    const id = toastSeed++
    set((state) => ({ toasts: [...state.toasts, { id, tone, message }] }))
    if (durationMs > 0) {
      window.setTimeout(() => {
        get().dismiss(id)
      }, durationMs)
    }
    return id
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
  },
}))
