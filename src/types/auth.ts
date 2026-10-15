import type { Session } from '@supabase/supabase-js'

export type Role = 'admin' | 'scanner'

export interface AuthState {
  session: Session | null
  /** null si el usuario no tiene perfil o no se pudo leer */
  role: Role | null
  loading: boolean
  signOut: () => Promise<void>
}
