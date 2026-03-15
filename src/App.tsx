import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter, createRoute, createRootRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { ToastViewport } from '@/components/ui/ToastViewport'
import { ProjectListPage } from '@/routes/index'
import { ProjectPage } from '@/routes/projects/$projectId/index'
import { NovelPage } from '@/routes/projects/$projectId/novel'
import { OutlinePage } from '@/routes/projects/$projectId/outline'
import { SettingsPage } from '@/routes/settings'
import { useAuthStore } from '@/stores/auth'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

// ===== Login Page =====
function LoginPage() {
  const { setAuth } = useAuthStore()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    try {
      const { authApi } = await import('@/lib/api')
      const res = await authApi.login(username, password)
      const { token, user } = res.data.data
      setAuth(token, user)
      navigate({ to: '/' })
    } catch {
      setError('用户名或密码错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-2xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
            Shakespeare
          </h1>
          <p className="text-sm text-muted-foreground mt-1">AI 短剧生成平台</p>
        </div>
        <div className="space-y-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="密码"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </div>
      </div>
    </div>
  )
}
// ===== Router =====
const rootRoute = createRootRoute({ component: AppLayout })
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage })
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    const token = localStorage.getItem('token')
    if (!token) throw redirect({ to: '/login' })
  },
  component: ProjectListPage,
})
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: ProjectPage,
})
const outlineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/outline',
  component: OutlinePage,
})
const novelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/novel',
  component: NovelPage,
})
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: () => {
    const token = localStorage.getItem('token')
    if (!token) throw redirect({ to: '/login' })
  },
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([loginRoute, indexRoute, projectRoute, novelRoute, outlineRoute, settingsRoute])

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ToastViewport />
    </QueryClientProvider>
  )
}
