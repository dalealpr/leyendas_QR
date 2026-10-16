import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Event } from '../types/ticket'

export type ActiveEvent = Pick<Event, 'id' | 'name'>

/** Respaldo por si Realtime se desconecta */
const POLL_MS = 15000

/**
 * Evento activo (lo define el admin en Editar).
 * Se actualiza solo cuando cambia, vía Realtime y con un respaldo cada 15 s.
 */
export function useActiveEvent() {
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, name')
        .eq('is_active', true)
        .maybeSingle<ActiveEvent>()
      if (cancelled) return
      if (error) setError(error.message)
      else {
        setError(null)
        // Mismo evento → mismo objeto, para no recargar de más
        setActiveEvent((prev) => (prev?.id === data?.id && prev?.name === data?.name ? prev : data))
      }
      setLoaded(true)
    }

    void load()

    // Nombre único: cada pantalla que usa el hook tiene su propio canal
    const channel = supabase
      .channel(`active-event-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => void load())
      .subscribe()

    const poll = window.setInterval(() => void load(), POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [])

  return { activeEvent, loaded, error }
}
