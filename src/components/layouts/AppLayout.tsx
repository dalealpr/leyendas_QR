import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/auth-context'
import type { Role } from '../../types/auth'
import logo from '../../assets/leyendas.jpg'

const links: { to: string; label: string; roles: Role[] }[] = [
  { to: '/contador', label: 'Contador', roles: ['admin', 'dashboard', 'scanner'] },
  { to: '/invitados', label: 'Invitados', roles: ['admin', 'dashboard', 'scanner'] },
  { to: '/generar', label: 'Generar', roles: ['admin'] },
  { to: '/editar', label: 'Editar', roles: ['admin'] },
  { to: '/anios', label: 'Años', roles: ['admin'] },
  { to: '/premiacion', label: 'Premiación', roles: ['admin'] },
  { to: '/escanear', label: 'Escanear', roles: ['admin', 'dashboard', 'scanner'] },
]

export function AppLayout() {
  const { session, role, signOut } = useAuth()
  const visible = links.filter((l) => role && l.roles.includes(role))

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <img src={logo} alt="Leyendas" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
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
        </div>
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
