import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import type { IconType } from 'react-icons'
import {
  LuChartColumn,
  LuClipboardList,
  LuLogOut,
  LuMenu,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuPencil,
  LuQrCode,
  LuScanLine,
  LuTrophy,
  LuX,
} from 'react-icons/lu'
import { useAuth } from '../../context/auth-context'
import type { Role } from '../../types/auth'
import logo from '../../assets/leyendas.jpg'
import { PAGE_WIDTH } from '../../utils/layout'

/** Ventanas del menú: ícono (colección Lucide de react-icons), nombre y quién la ve */
const links: { to: string; label: string; icon: IconType; roles: Role[] }[] = [
  { to: '/contador', label: 'Contador', icon: LuChartColumn, roles: ['admin', 'dashboard', 'scanner'] },
  { to: '/generar', label: 'Generar', icon: LuQrCode, roles: ['admin'] },
  { to: '/editar', label: 'Editar', icon: LuPencil, roles: ['admin'] },
  { to: '/premiacion', label: 'Premiación', icon: LuTrophy, roles: ['admin'] },
  { to: '/listas', label: 'Listas', icon: LuClipboardList, roles: ['admin'] },
  { to: '/escanear', label: 'Escanear', icon: LuScanLine, roles: ['admin', 'dashboard', 'scanner'] },
]

/** Estilo de cada ventana del menú; size = alto y tamaño de letra (la barra web y el panel de celular difieren) */
const navItemClass = (isActive: boolean, size: string) =>
  `flex items-center gap-3 rounded-lg px-3 font-semibold transition-colors ${size} ${
    isActive ? 'bg-primary text-on-primary' : 'text-foreground-soft hover:bg-surface hover:text-primary'
  }`

/** Clave para recordar si la barra lateral está encogida (tablet) */
const COLLAPSED_KEY = 'sidebar-collapsed'

export function AppLayout() {
  const { session, role, signOut } = useAuth()
  const visible = links.filter((l) => role && l.roles.includes(role))
  // Celular: panel del menú abierto encima de la pantalla
  const [mobileOpen, setMobileOpen] = useState(false)
  // Tablet: barra lateral encogida (solo íconos); se recuerda en este dispositivo
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1')
      } catch {
        // sin almacenamiento: solo dura mientras la página esté abierta
      }
      return !prev
    })
  const { pathname } = useLocation()
  const current = visible.find((l) => pathname.startsWith(l.to))

  // Panel de celular: se cierra con Escape y bloquea el scroll de la página mientras está abierto
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [mobileOpen])

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* Web/tablet: barra lateral de arriba a abajo (sticky + h-dvh: queda fija al bajar en páginas largas).
          Tablet: se encoge a solo íconos y se vuelve a sacar con el botón de arriba.
          Web ancha (desktop): siempre desplegada, sin botón. */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col gap-2 border-r border-line py-4 transition-[width] duration-200 md:flex desktop:w-56 desktop:px-3 ${
          collapsed ? 'w-16 px-2' : 'w-56 px-3'
        }`}
      >
        <div className={`mb-3 flex items-center gap-3 ${collapsed ? 'flex-col desktop:flex-row' : ''}`}>
          <img src={logo} alt="Leyendas" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          <span className={`flex-1 text-lg font-bold text-primary ${collapsed ? 'hidden desktop:inline' : ''}`}>
            Leyendas
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Mostrar menú' : 'Encoger menú'}
            title={collapsed ? 'Mostrar menú' : 'Encoger menú'}
            aria-expanded={!collapsed}
            className="rounded-lg p-2 text-foreground-soft hover:bg-surface hover:text-primary desktop:hidden"
          >
            {collapsed ? (
              <LuPanelLeftOpen className="h-5 w-5" aria-hidden="true" />
            ) : (
              <LuPanelLeftClose className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Menú">
          {visible.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              // Encogida: el nombre queda en el tooltip y para lectores de pantalla
              title={collapsed ? l.label : undefined}
              aria-label={l.label}
              className={({ isActive }) =>
                navItemClass(isActive, `h-11 text-sm ${collapsed ? 'justify-center desktop:justify-start' : ''}`)
              }
            >
              <l.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className={collapsed ? 'hidden desktop:inline' : ''}>{l.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior: correo y Salir, con el mismo ancho y márgenes que el contenido */}
        <header className={`${PAGE_WIDTH} flex items-center justify-between gap-2 py-3 md:pb-3 md:pt-6`}>
          {/* Celular: botón ☰ que abre el menú + logo y nombre de la ventana actual */}
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
              aria-expanded={mobileOpen}
              className="rounded-lg p-2 text-foreground-soft hover:bg-surface hover:text-primary"
            >
              <LuMenu className="h-6 w-6" aria-hidden="true" />
            </button>
            <img src={logo} alt="Leyendas" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
            {current && <span className="truncate font-semibold">{current.label}</span>}
          </div>
          {/* Web/tablet: nombre de la ventana actual (el menú está en la barra lateral) */}
          <p className="hidden truncate text-3xl font-semibold md:block">{current?.label}</p>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">{session?.user.email}</span>
            <button
              onClick={signOut}
              className="flex items-center gap-2 rounded-lg bg-surface-strong px-3 py-2 text-sm font-semibold hover:bg-surface-hover"
            >
              <LuLogOut className="h-4 w-4" aria-hidden="true" />
              Salir
            </button>
          </div>
        </header>

        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>

      {/* Celular: panel del menú encima de la pantalla, entra desde la izquierda.
          Se cierra al elegir una ventana, con la ✕, tocando afuera o con Escape. */}
      <div className={`fixed inset-0 z-50 md:hidden ${mobileOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileOpen}>
        {/* Fondo oscuro: tocarlo cierra el menú */}
        <div
          onClick={() => setMobileOpen(false)}
          className={`absolute inset-0 bg-black/70 transition-opacity duration-200 ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
          className={`absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col gap-2 border-r border-line bg-background px-3 py-4 shadow-xl transition-transform duration-200 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-2 flex items-center gap-3">
            <img src={logo} alt="Leyendas" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            <span className="flex-1 text-lg font-bold text-primary">Leyendas</span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar menú"
              tabIndex={mobileOpen ? 0 : -1}
              className="rounded-lg p-2 text-foreground-soft hover:bg-surface hover:text-primary"
            >
              <LuX className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>

          <nav className="flex flex-col gap-1">
            {visible.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setMobileOpen(false)}
                tabIndex={mobileOpen ? 0 : -1}
                className={({ isActive }) => navItemClass(isActive, 'h-12 text-base')}
              >
                <l.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                {l.label}
              </NavLink>
            ))}
          </nav>

          {/* El correo no cabe arriba en celular: se muestra aquí */}
          {session?.user.email && (
            <p className="mt-auto truncate border-t border-line pt-3 text-xs text-muted">{session.user.email}</p>
          )}
        </aside>
      </div>
    </div>
  )
}
