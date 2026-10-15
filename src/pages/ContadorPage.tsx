import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/** Respaldo por si Realtime se desconecta */
const POLL_MS = 15000

interface Stats {
  total: number
  used: number
}

export function ContadorPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const refreshTimer = useRef<number | undefined>(undefined)

  const loadStats = useCallback(async () => {
    // head: true → solo trae el conteo, no las filas
    const [totalRes, usedRes] = await Promise.all([
      supabase.from('tickets').select('*', { count: 'exact', head: true }),
      supabase.from('tickets').select('*', { count: 'exact', head: true }).not('used_at', 'is', null),
    ])
    const err = totalRes.error ?? usedRes.error
    if (err) {
      setError(err.message)
      return
    }
    setError(null)
    setStats({ total: totalRes.count ?? 0, used: usedRes.count ?? 0 })
    setUpdatedAt(new Date())
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde Supabase
    void loadStats()

    // Si llegan muchos escaneos seguidos, se recalcula una sola vez cada 500 ms
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(() => void loadStats(), 500)
    }

    const channel = supabase
      .channel('tickets-contador')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, scheduleRefresh)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))

    const poll = window.setInterval(() => void loadStats(), POLL_MS)

    return () => {
      window.clearTimeout(refreshTimer.current)
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [loadStats])

  const total = stats?.total ?? 0
  const used = stats?.used ?? 0
  const pending = total - used
  const percent = total > 0 ? Math.round((used / total) * 100) : 0

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Ingresos</h1>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-success' : 'bg-surface-hover'}`} />
          {live ? 'En vivo' : 'Actualizando cada 15 s'}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
          {error}
        </p>
      )}

      {/* Número principal */}
      <section className="rounded-2xl bg-surface p-6 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-foreground-soft">Escaneados</p>
        <p className="text-8xl font-black tabular-nums text-primary">{stats ? used : '–'}</p>
        <p className="mt-1 text-foreground-soft">de {stats ? total : '–'} tickets emitidos</p>

        <div className="mt-5 h-3 overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-muted">{percent}% ingresado</p>
      </section>

      {/* Detalle */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-surface p-4 text-center">
          <p className="text-sm text-foreground-soft">Total emitidos</p>
          <p className="text-4xl font-bold tabular-nums">{stats ? total : '–'}</p>
        </div>
        <div className="rounded-2xl bg-surface p-4 text-center">
          <p className="text-sm text-foreground-soft">Pendientes</p>
          <p className="text-4xl font-bold tabular-nums">{stats ? pending : '–'}</p>
        </div>
      </section>

      {updatedAt && (
        <p className="text-center text-xs text-muted">
          Última actualización: {updatedAt.toLocaleTimeString('es')}
        </p>
      )}
    </div>
  )
}
