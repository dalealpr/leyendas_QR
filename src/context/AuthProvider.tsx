import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Role } from '../types/auth'
import { AuthContext } from './auth-context'

interface LoadedProfile {
  userId: string
  role: Role | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [profile, setProfile] = useState<LoadedProfile | null>(null)

  // Sesión: onAuthStateChange emite INITIAL_SESSION al suscribirse,
  // y luego SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setSessionReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Rol: se lee de public.profiles cada vez que cambia el usuario.
  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single<{ role: Role }>()
      .then(({ data, error }) => {
        if (cancelled) return
        setProfile({ userId, role: error ? null : data.role })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const roleLoaded = !userId || profile?.userId === userId
  const role = userId && profile?.userId === userId ? profile.role : null

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ session, role, loading: !sessionReady || !roleLoaded, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}
