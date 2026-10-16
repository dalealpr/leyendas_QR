import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/auth-context'
import type { Role } from '../../types/auth'

const links: { to: string; label: string; roles: Role[] }[] = [
  { to: '/contador', label: 'Contador', roles: ['admin', 'dashboard', 'scanner'] },
  { to: '/generar', label: 'Generar', roles: ['admin'] },
  { to: '/editar', label: 'Editar', roles: ['admin'] },
  { to: '/escanear', label: 'Escanear', roles: ['admin', 'dashboard', 'scanner'] },
]

export function AppLayout() {
  const { session, role, signOut } = useAuth()
  const visible = links.filter((l) => role && l.roles.includes(role))

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-3 sm:px-4">
        {/* En celulares angostos las pestañas se deslizan hacia el lado */}
        <nav className="-my-1 flex min-w-0 gap-1 overflow-x-auto py-1">

          {visible.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `shrink-0 rounded-lg px-2.5 py-2 text-sm font-semibold sm:px-3 ${
                  isActive ? 'bg-primary text-on-primary' : 'text-foreground-soft hover:bg-surface'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
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
