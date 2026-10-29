import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { AppLayout } from '../components/layouts/AppLayout'
import { LoginPage } from '../pages/LoginPage'
import { ContadorPage } from '../pages/ContadorPage'
import { GenerarPage } from '../pages/GenerarPage'
import { EditarPage } from '../pages/EditarPage'
import { EscanearPage } from '../pages/EscanearPage'
import { AniosPage } from '../pages/AniosPage'
import { PremiacionPage } from '../pages/PremiacionPage'
import { useAuth } from '../context/auth-context'
import { homeFor } from '../utils/roles'

function HomeRedirect() {
  const { role } = useAuth()
  return <Navigate to={role ? homeFor(role) : '/login'} replace />
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route element={<AppLayout />}>
            <Route path="/escanear" element={<EscanearPage />} />

            <Route element={<ProtectedRoute allow={['admin', 'dashboard', 'scanner']} />}>
              <Route path="/contador" element={<ContadorPage />} />
              <Route path="/invitados" element={<ContadorPage key="invitados" tableOnly />} />
            </Route>

            <Route element={<ProtectedRoute allow={['admin']} />}>
              <Route path="/generar" element={<GenerarPage />} />
              <Route path="/editar" element={<EditarPage />} />
              <Route path="/anios" element={<AniosPage />} />
              <Route path="/premiacion" element={<PremiacionPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
