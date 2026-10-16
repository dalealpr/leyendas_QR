import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/auth-context'
import { useActiveEvent } from '../hooks/useActiveEvent'
import { Table, type Column } from '../components/ui/Table'
import { SearchInput } from '../components/ui/SearchInput'
import { ilikePattern, normalize } from '../utils/search'
import type { EventStats, Ticket } from '../types/ticket'

/** Respaldo por si Realtime se desconecta */
const POLL_MS = 15000

/** Valor del filtro para ver todos los eventos juntos */
const ALL = 'all'

const PAGE_SIZE = 10

type TicketRow = Pick<Ticket, 'id' | 'name' | 'event_id' | 'used_at' | 'created_at'>

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ContadorPage() {
  const { role } = useAuth()
  // admin y dashboard eligen evento; el resto solo ve el evento activo
  const canChooseEvent = role === 'admin' || role === 'dashboard'

  const [stats, setStats] = useState<EventStats[] | null>(null)
  const [filter, setFilter] = useState(ALL)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const refreshTimer = useRef<number | undefined>(undefined)

  // Evento activo (lo define el admin en Editar); se actualiza solo
  const { activeEvent, loaded: activeLoaded } = useActiveEvent()

  /** Evento cuyos datos se muestran: el elegido, o el activo si no puede elegir */
  const effectiveFilter = canChooseEvent ? filter : (activeEvent?.id ?? null)
  const waitingActivation = !canChooseEvent && activeLoaded && !activeEvent

  // Tabla de tickets (paginada en Supabase)
  const [page, setPage] = useState(0)
  const [ticketRows, setTicketRows] = useState<TicketRow[]>([])
  const [ticketTotal, setTicketTotal] = useState(0)
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const lastRequest = useRef(0)

  // Si el admin cambia el evento activo, la tabla vuelve a la página 1
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicio al cambiar de evento
    setPage(0)
  }, [effectiveFilter])

  // Buscador: se consulta a Supabase 300 ms después de dejar de escribir
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(normalize(search)), 300)
    return () => window.clearTimeout(id)
  }, [search])

  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const loadTickets = useCallback(async () => {
    const requestId = ++lastRequest.current
    // Sin evento activo, quien no puede elegir no ve nada
    if (effectiveFilter === null) {
      setTicketRows([])
      setTicketTotal(0)
      setTicketsLoading(false)
      return
    }
    setTicketsLoading(true)
    const from = page * PAGE_SIZE
    let query = supabase
      .from('tickets')
      .select('id, name, event_id, used_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (effectiveFilter !== ALL) query = query.eq('event_id', effectiveFilter)
    if (debouncedSearch) {
      // name_search = nombre sin tildes (supabase/07_search.sql)
      const byName = `name_search.ilike.${ilikePattern(debouncedSearch)}`
      // Si parece un código de QR (hex), también busca por el inicio del código
      query = /^[0-9a-f]+$/.test(debouncedSearch)
        ? query.or(`${byName},code.like.${debouncedSearch}*`)
        : query.ilike('name_search', ilikePattern(debouncedSearch))
    }

    const { data, count, error } = await query.returns<TicketRow[]>()
    if (requestId !== lastRequest.current) return // llegó una respuesta más nueva
    setTicketsLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setTicketRows(data)
    setTicketTotal(count ?? 0)
  }, [page, effectiveFilter, debouncedSearch])

  // Siempre apunta a la última versión, para usarla desde Realtime
  const loadTicketsRef = useRef(loadTickets)
  useEffect(() => {
    loadTicketsRef.current = loadTickets
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar de página o evento
    void loadTickets()
  }, [loadTickets])

  const changeFilter = (value: string) => {
    setFilter(value)
    setPage(0)
  }

  // Una sola consulta trae total y escaneados de cada evento
  const loadStats = useCallback(async () => {
    const { data, error } = await supabase.rpc('ticket_stats')
    if (error) {
      setError(error.message)
      return
    }
    setError(null)
    setStats((data as EventStats[]).map((s) => ({ ...s, total: Number(s.total), used: Number(s.used) })))
    setUpdatedAt(new Date())
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde Supabase
    void loadStats()

    // Si llegan muchos cambios seguidos, se recalcula una sola vez cada 500 ms
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(() => {
        void loadStats()
        void loadTicketsRef.current()
      }, 500)
    }

    const channel = supabase
      .channel('tickets-contador')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, scheduleRefresh)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))

    const poll = window.setInterval(() => {
      void loadStats()
      void loadTicketsRef.current()
    }, POLL_MS)

    return () => {
      window.clearTimeout(refreshTimer.current)
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [loadStats])

  // Al cambiar el evento activo, el staff recibe datos de otro evento: recalcular totales
  const activeId = activeEvent?.id
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar el evento activo
    if (activeId) void loadStats()
  }, [activeId, loadStats])

  const rows = stats ?? []
  const shown =
    effectiveFilter === ALL ? rows : rows.filter((s) => s.event_id === effectiveFilter)
  const total = shown.reduce((sum, s) => sum + s.total, 0)
  const used = shown.reduce((sum, s) => sum + s.used, 0)
  const pending = total - used
  const percent = total > 0 ? Math.round((used / total) * 100) : 0
  const value = (n: number) => (stats ? n : '–')
  const eventName = (id: string) => rows.find((s) => s.event_id === id)?.event_name ?? id
  const isActive = (id: string) => activeEvent?.id === id

  const columns: Column<TicketRow>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (t) => (
        <span className={t.name ? 'font-medium' : 'italic text-muted'}>{t.name || 'Sin nombre'}</span>
      ),
    },
    // La columna Evento solo hace falta cuando se ven todos juntos
    ...(effectiveFilter === ALL
      ? [{ key: 'event', header: 'Evento', className: 'whitespace-nowrap', render: (t: TicketRow) => eventName(t.event_id) }]
      : []),
    {
      key: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      render: (t) =>
        t.used_at ? (
          <span className="inline-flex flex-col">
            <span className="w-fit rounded-full bg-success/15 px-2 py-1 text-xs font-semibold text-success">
              Escaneado
            </span>
            <span className="mt-1 text-xs text-muted">{formatDate(t.used_at)}</span>
          </span>
        ) : (
          <span className="rounded-full bg-surface-strong px-2 py-1 text-xs font-semibold text-foreground-soft">
            No escaneado
          </span>
        ),
    },
  ]

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-bold">Ingresos</h1>
      <span className="flex items-center gap-2 text-xs text-muted">
        <span className={`h-2 w-2 rounded-full ${live ? 'bg-success' : 'bg-surface-hover'}`} />
        {live ? 'En vivo' : 'Actualizando cada 15 s'}
      </span>
    </div>
  )

  // Staff sin evento activo: solo el aviso
  if (waitingActivation) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
        {header}
        <section className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-8 text-center">
          <span className="text-5xl" aria-hidden="true">
            ⏸
          </span>
          <p className="text-xl font-bold">El evento no ha sido activado</p>
          <p className="text-foreground-soft">Actívalo con la cuenta admin.</p>
          <p className="text-xs text-muted">Esta pantalla se actualiza sola cuando se active.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
      {header}

      {canChooseEvent ? (
        /* Filtro por evento (admin y dashboard) */
        <select
          value={filter}
          onChange={(e) => changeFilter(e.target.value)}
          aria-label="Filtrar por evento"
          className="w-full rounded-lg border border-line bg-surface px-3 py-3 text-base font-semibold text-foreground outline-none focus:border-primary"
        >
          <option value={ALL}>Todos los eventos</option>
          {rows.map((s) => (
            <option key={s.event_id} value={s.event_id}>
              {s.event_name}
              {isActive(s.event_id) ? ' · activo' : ''}
            </option>
          ))}
        </select>
      ) : (
        /* El resto ve el evento activo, sin poder cambiarlo */
        <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-surface px-4 py-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted">Evento activo</p>
            <p className="truncate text-lg font-bold">{activeEvent?.name ?? '…'}</p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
          {error}
        </p>
      )}

      {/* Número principal */}
      <section className="rounded-2xl bg-surface p-6 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-foreground-soft">Escaneados</p>
        <p className="text-8xl font-black tabular-nums text-primary">{value(used)}</p>
        <p className="mt-1 text-foreground-soft">de {value(total)} tickets emitidos</p>

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
          <p className="text-4xl font-bold tabular-nums">{value(total)}</p>
        </div>
        <div className="rounded-2xl bg-surface p-4 text-center">
          <p className="text-sm text-foreground-soft">Pendientes</p>
          <p className="text-4xl font-bold tabular-nums">{value(pending)}</p>
        </div>
      </section>

      {/* Desglose por evento (admin y dashboard, en "Todos los eventos") */}
      {canChooseEvent && filter === ALL && rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">Por evento</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
            {rows.map((s) => (
              <li key={s.event_id}>
                <button
                  onClick={() => changeFilter(s.event_id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-strong"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{s.event_name}</span>
                    {isActive(s.event_id) && (
                      <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                        Activo
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-foreground-soft">
                    <span className="font-bold text-primary">{s.used}</span> / {s.total}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tickets del evento */}
      <section className="space-y-3">
        <SearchInput
          value={search}
          onChange={changeSearch}
          // El conteo se muestra cuando ya llegó la respuesta de esta búsqueda
          resultCount={
            normalize(search) === debouncedSearch && !ticketsLoading ? ticketTotal : undefined
          }
        />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          {effectiveFilter === ALL ? 'Todos los QR' : `QR · ${eventName(effectiveFilter ?? '')}`}
        </h2>
        <Table
          columns={columns}
          rows={ticketRows}
          getRowKey={(t) => t.id}
          loading={ticketsLoading}
          emptyMessage={
            debouncedSearch
              ? `Ningún nombre coincide con “${search.trim()}”.`
              : 'Todavía no hay QR para este evento.'
          }
          pagination={{ page, pageSize: PAGE_SIZE, total: ticketTotal, onPageChange: setPage }}
        />
      </section>

      {updatedAt && (
        <p className="text-center text-xs text-muted">
          Última actualización: {updatedAt.toLocaleTimeString('es')}
        </p>
      )}
    </div>
  )
}
