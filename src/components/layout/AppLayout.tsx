import { Outlet, Link, useNavigate } from '@tanstack/react-router'
import { Film, LogOut, Moon, Settings, Sun } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/hooks/useTheme'

export function AppLayout() {
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
            <Film className="h-5 w-5 text-indigo-400" />
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              Shakespeare
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              title={theme === 'dark' ? '切换到白天模式' : '切换到夜晚模式'}
              aria-label={theme === 'dark' ? '切换到白天模式' : '切换到夜晚模式'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link
              to="/settings"
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <span className="text-sm text-muted-foreground">{user?.name}</span>
            <button
              onClick={handleLogout}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
