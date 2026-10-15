import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/auth-context'
import type { Role } from '../../types/auth'

const links: { to: string; label: string; roles: Role[] }[] = [
  { to: '/contador', label: 'Contador', roles: ['admin'] },
  { to: '/generar', label: 'Generar', roles: ['admin'] },
  { to: '/escanear', label: 'Escanear', roles: ['admin', 'scanner'] },
]

export function AppLayout() {
  const { session, role, signOut } = useAuth()
  const visible = links.filter((l) => role && l.roles.includes(role))

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <nav className="flex gap-1">
          {visible.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-semibold ${
                  isActive ? 'bg-primary text-on-primary' : 'text-foreground-soft hover:bg-surface'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted sm:inline">{session?.user.email}</span>
          <button
            onClick={signOut}
            className="rounded-lg bg-surface-strong px-3 py-2 text-sm font-semibold hover:bg-surface-hover"
          >
            Salir
          </button>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
