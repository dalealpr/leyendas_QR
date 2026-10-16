import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/auth-context'
import { homeFor } from '../utils/roles'
import { PasswordInput } from '../components/ui/PasswordInput'

export function LoginPage() {
  const { session, role, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Ya hay sesión y rol: mandarlo a su pantalla
  if (!loading && session && role) {
    return <Navigate to={homeFor(role)} replace />
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setSubmitting(false)
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Email o contraseña incorrectos'
          : error.message,
      )
    }
    // Si fue exitoso, AuthProvider recibe la sesión y este componente redirige.
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-surface p-6 shadow-xl"
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Control de ingreso</h1>
          <p className="mt-1 text-sm text-muted">Inicia sesión con tu cuenta de staff</p>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-line bg-background px-3 py-3 text-base text-foreground outline-none focus:border-primary"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">Contraseña</span>
          <PasswordInput value={password} onChange={setPassword} />
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || (!!session && loading)}
          className="w-full rounded-lg bg-primary py-3 text-base font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
        >
          {submitting || (session && loading) ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
