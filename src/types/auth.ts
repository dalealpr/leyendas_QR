import type { Session } from '@supabase/supabase-js'

/**
 * admin     → todo
 * dashboard → Contador y Escanear (entra a Contador)
 * scanner   → Contador y Escanear (entra a Escanear)
 */
export type Role = 'admin' | 'dashboard' | 'scanner'

export interface AuthState {
  session: Session | null
  /** null si el usuario no tiene perfil o no se pudo leer */
  role: Role | null
  loading: boolean
  signOut: () => Promise<void>
}
