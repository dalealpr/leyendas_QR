import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/auth-context'
import { useActiveEvent } from '../hooks/useActiveEvent'
import { Table, type Column } from '../components/ui/Table'
import { GuestBadge } from '../components/common/GuestBadge'
import { YearsCell } from '../components/common/YearsCell'
import { SearchInput } from '../components/ui/SearchInput'
import { ilikePattern, normalize } from '../utils/search'
import { AddGuestDialog } from '../components/common/AddGuestDialog'
import {
  YEARS_OPTIONS,
  type EventStats,
  type LeyendaYears,
  type Ticket,
  type WithGuestName,
  type WithYears,
} from '../types/ticket'

/** Respaldo por si Realtime se desconecta */
const POLL_MS = 15000

/** Valor del filtro para ver todos los eventos juntos */
const ALL = 'all'

const PAGE_SIZE = 10

type TicketRow = Pick<Ticket, 'id' | 'name' | 'event_id' | 'used_at' | 'guest_at' | 'created_at'> &
  WithYears &
  WithGuestName

/** Filtro de la tabla por status */
type StatusFilter = 'all' | 'used' | 'guest_in' | 'used_guest_pending' | 'unused_guest_in' | 'unused_no_guest'

type StatusOption = { value: StatusFilter; label: string; guests?: boolean }

/** Contador. guests = solo se muestra si hay eventos con invitados activados */
const statusOptions: StatusOption[] = [
  { value: 'all', label: 'Todos' },
  { value: 'used', label: 'Leyendas escaneadas' },
  { value: 'guest_in', label: 'Invitados ingresados', guests: true },
  // La leyenda ya ingresó y su invitado todavía no
  { value: 'used_guest_pending', label: 'Escaneados · invitado pendiente', guests: true },
  // El invitado llegó primero y la leyenda todavía no se escanea
  { value: 'unused_guest_in', label: 'Sin escanear · invitado dentro', guests: true },
]

/** Ventana Invitados (todas son leyendas sin escanear) */
const invitadosStatusOptions: StatusOption[] = [
  { value: 'all', label: 'Todos' },
  { value: 'unused_guest_in', label: 'Sin escanear · invitado dentro', guests: true },
  { value: 'unused_no_guest', label: 'Sin invitado agregado', guests: true },
]

/** Filtro de la tabla por años de la leyenda */
type YearsFilter = 'all' | LeyendaYears

const yearsOptions: { value: YearsFilter; label: string }[] = [
  { value: 'all', label: 'Todos los años' },
  ...YEARS_OPTIONS.map((y) => ({ value: y, label: `${y} años` })),
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface ContadorPageProps {
  /**
   * Ventana Invitados: solo la tabla con el buscador y los filtros de status
   * (sin cards, sin desglose por evento y sin filtros de años).
   */
  tableOnly?: boolean
}

export function ContadorPage({ tableOnly = false }: ContadorPageProps) {
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

  // Admin y dashboard: al entrar, el selector arranca en el evento activo (una sola vez;
  // después pueden elegir otro o "Todos los eventos")
  const defaultApplied = useRef(false)
  useEffect(() => {
    if (!canChooseEvent || !activeLoaded || defaultApplied.current) return
    defaultApplied.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- valor inicial del selector
    if (activeEvent) setFilter(activeEvent.id)
  }, [canChooseEvent, activeLoaded, activeEvent])

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

  // Filtro por status. Los de invitados solo existen si hay eventos con invitados activados.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  // Como texto, para no recargar la tabla cada vez que se refrescan los totales
  const guestEventIds = (stats ?? [])
    .filter((s) => s.guests_enabled && (effectiveFilter === ALL || s.event_id === effectiveFilter))
    .map((s) => s.event_id)
    .join(',')
  const shownStatusOptions = tableOnly ? invitadosStatusOptions : statusOptions
  const isGuestFilter = shownStatusOptions.some((o) => o.guests && o.value === statusFilter)
  const effectiveStatus: StatusFilter = isGuestFilter && !guestEventIds ? 'all' : statusFilter

  // Ventana Invitados: leyenda a la que se le está agregando el invitado
  const [addGuestFor, setAddGuestFor] = useState<TicketRow | null>(null)

  const changeStatusFilter = (value: StatusFilter) => {
    setStatusFilter(value)
    setPage(0)
  }

  // Filtro por años de la leyenda (tabla aparte ticket_years)
  const [yearsFilter, setYearsFilter] = useState<YearsFilter>('all')
  const changeYearsFilter = (value: YearsFilter) => {
    setYearsFilter(value)
    setPage(0)
  }

  // Cuántas leyendas hay con cada años (para los números de los filtros)
  const [yearCounts, setYearCounts] = useState<Partial<Record<LeyendaYears, number>> | null>(null)
  const loadYearCounts = useCallback(async () => {
    if (effectiveFilter === null) {
      setYearCounts({})
      return
    }
    let query = supabase.from('ticket_years').select('years, tickets!inner(event_id)')
    if (effectiveFilter !== ALL) query = query.eq('tickets.event_id', effectiveFilter)
    const { data, error } = await query.returns<{ years: LeyendaYears }[]>()
    if (error) {
      setError(error.message)
      return
    }
    const counts: Partial<Record<LeyendaYears, number>> = {}
    for (const { years } of data) counts[years] = (counts[years] ?? 0) + 1
    setYearCounts(counts)
  }, [effectiveFilter])

  // Siempre apunta a la última versión, para usarla desde Realtime
  const loadYearCountsRef = useRef(loadYearCounts)
  useEffect(() => {
    loadYearCountsRef.current = loadYearCounts
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar de evento
    void loadYearCounts()
  }, [loadYearCounts])

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
    // Con unos años en particular, !inner deja solo los QR que tienen esos años
    const yearsJoin = typeof yearsFilter === 'number' ? 'ticket_years!inner(years)' : 'ticket_years(years)'
    let query = supabase
      .from('tickets')
      .select(`id, name, event_id, used_at, guest_at, created_at, ${yearsJoin}, ticket_guest_names(guest_name)`, {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (effectiveFilter !== ALL) query = query.eq('event_id', effectiveFilter)
    // Ventana Invitados: solo leyendas que todavía no se escanean
    if (tableOnly) query = query.is('used_at', null)
    if (typeof yearsFilter === 'number') query = query.eq('ticket_years.years', yearsFilter)
    if (effectiveStatus === 'used') query = query.not('used_at', 'is', null)
    if (effectiveStatus !== 'all' && effectiveStatus !== 'used') {
      // Filtros de invitados: solo QR de eventos con invitados activados (igual que la card de Invitados)
      query = query.in('event_id', guestEventIds.split(','))
      if (effectiveStatus === 'guest_in') query = query.not('guest_at', 'is', null)
      if (effectiveStatus === 'used_guest_pending') query = query.not('used_at', 'is', null).is('guest_at', null)
      if (effectiveStatus === 'unused_guest_in') query = query.is('used_at', null).not('guest_at', 'is', null)
      if (effectiveStatus === 'unused_no_guest') query = query.is('used_at', null).is('guest_at', null)
    }
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
  }, [page, effectiveFilter, effectiveStatus, guestEventIds, yearsFilter, debouncedSearch, tableOnly])

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
    setStats(
      (data as EventStats[]).map((s) => ({
        ...s,
        total: Number(s.total),
        used: Number(s.used),
        guests: Number(s.guests),
        guests_waiting: Number(s.guests_waiting),
      })),
    )
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
        void loadYearCountsRef.current()
      }, 500)
    }

    const channel = supabase
      .channel('tickets-contador')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, scheduleRefresh)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))

    const poll = window.setInterval(() => {
      void loadStats()
      void loadTicketsRef.current()
      void loadYearCountsRef.current()
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
  const hasGuests = (id: string) => rows.find((s) => s.event_id === id)?.guests_enabled ?? false

  // Invitados: solo cuentan los eventos con invitados activados
  const withGuests = shown.filter((s) => s.guests_enabled)
  // 1 invitado por QR: el total de invitados es el total de QR
  const guestsTotal = withGuests.reduce((sum, s) => sum + s.total, 0)
  const guestsIn = withGuests.reduce((sum, s) => sum + s.guests, 0)
  const guestsPending = guestsTotal - guestsIn
  // Titular ya ingresó y su invitado todavía no (contado en Supabase: hay invitados
  // que entran antes que su leyenda, así que used - guests no sirve)
  const guestsWaiting = withGuests.reduce((sum, s) => sum + s.guests_waiting, 0)
  // Invitado dentro y su leyenda todavía no:
  // invitados ingresados − (leyendas dentro con invitado = leyendas dentro − las que esperan invitado)
  const guestsFirst = guestsIn - (withGuests.reduce((sum, s) => sum + s.used, 0) - guestsWaiting)
  // Leyenda sin escanear y sin invitado agregado (eventos con invitados)
  const unusedNoGuest = withGuests.reduce((sum, s) => sum + s.total - s.used, 0) - guestsFirst
  const guestsPercent = guestsTotal > 0 ? Math.round((guestsIn / guestsTotal) * 100) : 0

  const columns: Column<TicketRow>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (t) => (
        <span className={t.name ? 'font-medium' : 'italic text-muted'}>{t.name || 'Sin nombre'}</span>
      ),
    },
    {
      key: 'years',
      header: 'Años',
      className: 'whitespace-nowrap',
      render: (t) => <YearsCell row={t} />,
    },
    // La columna Evento solo hace falta cuando se ven todos juntos
    ...(effectiveFilter === ALL
      ? [{ key: 'event', header: 'Evento', className: 'whitespace-nowrap', render: (t: TicketRow) => eventName(t.event_id) }]
      : []),
    // En la ventana Invitados todas son "No escaneado" y su invitado "—": no hacen falta
    ...(tableOnly
      ? []
      : [
          {
            key: 'status',
            header: 'Status',
            className: 'whitespace-nowrap',
            render: (t: TicketRow) =>
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
        ]),
    // Ventana Invitados: registrar al invitado que llega antes que su leyenda
    ...(tableOnly && withGuests.length > 0
      ? [
          {
            key: 'guest',
            header: 'Invitado',
            className: 'w-px whitespace-nowrap text-right',
            render: (t: TicketRow) => {
              if (!hasGuests(t.event_id)) return <span className="text-muted">—</span>
              if (t.guest_at) {
                return (
                  <span className="inline-flex flex-col items-end">
                    <span className="w-fit rounded-full bg-success/15 px-2 py-1 text-xs font-semibold text-success">
                      Ingresado
                    </span>
                    <span className="mt-1 max-w-40 truncate text-xs text-muted">
                      {t.ticket_guest_names?.guest_name ? `${t.ticket_guest_names.guest_name} · ` : ''}
                      {formatDate(t.guest_at)}
                    </span>
                  </span>
                )
              }
              return (
                <button
                  type="button"
                  onClick={() => setAddGuestFor(t)}
                  aria-label={`Agregar invitado de ${t.name || 'sin nombre'}`}
                  className="rounded-lg border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/15"
                >
                  + Agregar
                </button>
              )
            },
          },
        ]
      : []),
    // Invitado: solo si algún evento visible tiene invitados activados
    ...(!tableOnly && withGuests.length > 0
      ? [
          {
            key: 'guest',
            header: 'Invitado',
            className: 'whitespace-nowrap',
            render: (t: TicketRow) =>
              hasGuests(t.event_id) ? (
                <GuestBadge ticket={t} guestName={t.ticket_guest_names?.guest_name} />
              ) : null,
          },
        ]
      : []),
  ]

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-bold">{tableOnly ? 'Invitados' : 'Ingresos'}</h1>
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
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 tablet-landscape:max-w-5xl">
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

      {/* En tablet horizontal: escaneados a la izquierda, invitados a la derecha */}
      {!tableOnly && (
        <div
          className={`flex flex-col gap-6 ${withGuests.length > 0 ? 'tablet-landscape:grid tablet-landscape:grid-cols-2' : ''}`}
        >
          <CountCard
            title="Leyendas"
            total={value(total)}
            done={{ label: 'Escaneados', value: value(used), className: 'text-success' }}
            pending={value(pending)}
            percent={percent}
            barClassName="bg-success"
          />

          {/* Invitados (solo eventos con invitados activados) */}
          {withGuests.length > 0 && (
            <CountCard
              title="Invitados"
              total={value(guestsTotal)}
              done={{ label: 'Ingresados', value: value(guestsIn), className: 'text-success' }}
              pending={value(guestsPending)}
              percent={guestsPercent}
              barClassName="bg-success"
              // Invitados pendientes cuyo titular (la leyenda) ya ingresó
              footer={
                <p className="mt-4 flex items-center justify-center gap-2 text-sm text-foreground-soft tablet-landscape:text-base">
                  <span className="text-2xl font-bold leading-none tabular-nums text-warning tablet-landscape:text-3xl">
                    {value(guestsWaiting)}
                  </span>
                  <span>
                    {guestsWaiting === 1 ? 'invitado' : 'invitados'}{' '}
                    <strong className="font-bold text-foreground">
                      {guestsWaiting === 1 ? 'pendiente' : 'pendientes'}
                    </strong>{' '}
                    con la leyenda dentro
                  </span>
                </p>
              }
            />
          )}
        </div>
      )}

      {/* Desglose por evento (admin y dashboard, en "Todos los eventos") */}
      {!tableOnly && canChooseEvent && filter === ALL && rows.length > 0 && (
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {tableOnly ? (
              <>
                Leyendas no escaneadas
                {effectiveFilter !== ALL && ` · ${eventName(effectiveFilter ?? '')}`}{' '}
                <span className="text-warning tabular-nums">{value(pending)}</span>
              </>
            ) : effectiveFilter === ALL ? (
              'Todos los QR'
            ) : (
              `QR · ${eventName(effectiveFilter ?? '')}`
            )}
          </h2>
          {/* Solo aparece si hay algún filtro o búsqueda puesta */}
          {(search || effectiveStatus !== 'all' || (!tableOnly && yearsFilter !== 'all')) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all')
                setYearsFilter('all')
                setSearch('')
                setPage(0)
              }}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-foreground-soft hover:bg-surface-strong"
            >
              <span aria-hidden="true">✕</span> Limpiar filtros
            </button>
          )}
        </div>

        {/* Filtros por status (la ventana Invitados tiene los suyos) */}
        {(!tableOnly || guestEventIds) && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
            {shownStatusOptions
              .filter((o) => !o.guests || guestEventIds)
              .map((o) => {
                const selected = effectiveStatus === o.value
                const count = {
                  // En la ventana Invitados "Todos" son las leyendas sin escanear
                  all: tableOnly ? pending : total,
                  used,
                  guest_in: guestsIn,
                  used_guest_pending: guestsWaiting,
                  unused_guest_in: guestsFirst,
                  unused_no_guest: unusedNoGuest,
                }[o.value]
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => changeStatusFilter(o.value)}
                    aria-pressed={selected}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                      selected
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-line bg-surface text-foreground-soft hover:bg-surface-strong'
                    }`}
                  >
                    {o.label} <span className="tabular-nums opacity-75">{value(count)}</span>
                  </button>
                )
              })}
          </div>
        )}

        {/* Filtros por años de la leyenda */}
        {!tableOnly && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por años">
            {yearsOptions.map((o) => {
              const selected = yearsFilter === o.value
              const count = o.value === 'all' ? total : (yearCounts?.[o.value] ?? 0)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => changeYearsFilter(o.value)}
                  aria-pressed={selected}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    selected
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-line bg-surface text-foreground-soft hover:bg-surface-strong'
                  }`}
                >
                  {o.label}{' '}
                  <span className="tabular-nums opacity-75">{stats && yearCounts ? count : '–'}</span>
                </button>
              )
            })}
          </div>
        )}

        <Table
          columns={columns}
          rows={ticketRows}
          getRowKey={(t) => t.id}
          loading={ticketsLoading}
          emptyMessage={
            debouncedSearch
              ? `Ningún nombre coincide con “${search.trim()}”.`
              : tableOnly && effectiveStatus === 'all'
                ? 'Todas las leyendas ya fueron escaneadas.'
                : effectiveStatus === 'all' && yearsFilter === 'all'
                ? 'Todavía no hay QR para este evento.'
                : 'No hay QR con estos filtros.'
          }
          pagination={{ page, pageSize: PAGE_SIZE, total: ticketTotal, onPageChange: setPage }}
        />
      </section>

      {updatedAt && (
        <p className="text-center text-xs text-muted">
          Última actualización: {updatedAt.toLocaleTimeString('es')}
        </p>
      )}

      {addGuestFor && (
        <AddGuestDialog
          ticketId={addGuestFor.id}
          leyendaName={addGuestFor.name}
          onClose={() => setAddGuestFor(null)}
          onAdded={() => {
            setAddGuestFor(null)
            void loadStats()
            void loadTicketsRef.current()
          }}
        />
      )}
    </div>
  )
}

interface CountCardProps {
  title: string
  total: number | string
  /** Los que ya entraron (número de la izquierda) */
  done: { label: string; value: number | string; className: string }
  pending: number | string
  percent: number
  barClassName: string
  footer?: ReactNode
}

/** Card de conteo: título con el total, ingresados | pendientes y barra de avance */
function CountCard({ title, total, done, pending, percent, barClassName, footer }: CountCardProps) {
  return (
    <section className="flex flex-col justify-center rounded-2xl bg-surface px-5 py-6 text-center">
      <p className="flex items-center justify-center gap-2 text-base font-medium uppercase tracking-wide text-foreground-soft tablet-landscape:text-lg">
        {title}
        <span className="rounded-full bg-surface-strong px-3 py-0.5 text-sm font-semibold normal-case tracking-normal text-foreground tablet-landscape:text-base">
          Total {total}
        </span>
      </p>

      <div className="mt-4 grid grid-cols-2 divide-x divide-line">
        <div>
          <p className="text-base text-foreground-soft tablet-landscape:text-lg">{done.label}</p>
          <p className={`text-6xl font-black tabular-nums tablet-landscape:text-8xl ${done.className}`}>
            {done.value}
          </p>
        </div>
        <div>
          <p className="text-base text-foreground-soft tablet-landscape:text-lg">Pendientes</p>
          <p className="text-6xl font-black tabular-nums text-warning tablet-landscape:text-8xl">{pending}</p>
        </div>
      </div>

      <div className="mt-5 h-3 overflow-hidden rounded-full bg-background">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClassName}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-base font-semibold text-muted tablet-landscape:text-lg">{percent}% ingresado</p>
      {footer}
    </section>
  )
}
