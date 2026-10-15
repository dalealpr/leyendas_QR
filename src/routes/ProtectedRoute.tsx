import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { FullScreenMessage } from '../components/ui/FullScreenMessage'
import type { Role } from '../types/auth'
import { homeFor } from '../utils/roles'

interface Props {
  /** Roles que pueden ver estas rutas. Si se omite, cualquier usuario con sesión. */
  allow?: Role[]
}

export function ProtectedRoute({ allow }: Props) {
  const { session, role, loading, signOut } = useAuth()
  const location = useLocation()

  if (loading) {
    return <FullScreenMessage>Cargando…</FullScreenMessage>
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!role) {
    return (
      <FullScreenMessage>
        <p>Tu usuario no tiene un rol asignado. Pide al administrador que lo configure.</p>
        <button
          onClick={signOut}
          className="rounded-lg bg-surface-strong px-4 py-2 font-semibold hover:bg-surface-hover"
        >
          Cerrar sesión
        </button>
      </FullScreenMessage>
    )
  }

  if (allow && !allow.includes(role)) {
    return <Navigate to={homeFor(role)} replace />
  }

  return <Outlet />
}
