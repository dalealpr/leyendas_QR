import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/auth-context'
import { useActiveEvent } from '../hooks/useActiveEvent'
import { Table, type Column } from '../components/ui/Table'
import { LuCircleCheck, LuTrophy } from 'react-icons/lu'
import { GuestBadge } from '../components/common/GuestBadge'
import { LeaderBadge } from '../components/common/LeaderBadge'
import { YearsCell } from '../components/common/YearsCell'
import { SearchInput } from '../components/ui/SearchInput'
import { ilikePattern, normalize } from '../utils/search'
import { PAGE_WIDTH } from '../utils/layout'
import { countClass } from '../utils/filterChip'
import { canHaveGuest, extraErrors, type ExtraGroup, type ExtraPerson, type ExtraResult } from '../types/extraLists'
import { ExtraGuestCell } from '../components/common/ExtraGuestCell'
import { ExtraGuestDialog } from '../components/common/ExtraGuestDialog'
import {
  YEARS_OPTIONS,
  type EventStats,
  type LeyendaYears,
  type Ticket,
  type WithAward,
  type WithGuestDeclined,
  type WithGuestName,
  type WithLeader,
  type WithYears,
} from '../types/ticket'

/** Respaldo por si Realtime se desconecta */
const POLL_MS = 15000

/** Valor del filtro para ver todos los eventos juntos */
const ALL = 'all'

const PAGE_SIZE = 10

type TicketRow = Pick<Ticket, 'id' | 'name' | 'event_id' | 'used_at' | 'guest_at' | 'created_at'> &
  WithYears &
  WithGuestName &
  WithGuestDeclined &
  WithAward &
  WithLeader

/** Filtro de la tabla por status */
type StatusFilter =
  | 'all'
  | 'used'
  | 'guest_in'
  | 'used_guest_pending'
  | 'unused_guest_in'
  | 'unused_no_guest'
  | 'guest_declined'
  | 'leaders'

type StatusOption = { value: StatusFilter; label: string; guests?: boolean }

/** Contador. guests = solo se muestra si hay eventos con invitados activados */
const statusOptions: StatusOption[] = [
  { value: 'all', label: 'Todos' },
  { value: 'used', label: 'Leyendas escaneadas' },
  // Solo aparece si el evento tiene líderes
  { value: 'leaders', label: 'Líderes' },
  { value: 'guest_in', label: 'Invitados ingresados', guests: true },
  // La leyenda ya ingresó y su invitado todavía no
  { value: 'used_guest_pending', label: 'Escaneados · invitado pendiente', guests: true },
  // El invitado llegó primero y la leyenda todavía no se escanea
  { value: 'unused_guest_in', label: 'Sin escanear · invitado dentro', guests: true },
  // Leyenda sin escanear y sin invitado registrado (el invitado se agrega en Editar)
  { value: 'unused_no_guest', label: 'Sin invitado agregado', guests: true },
  // Se escaneó "Sin invitado": su invitado no viene
  { value: 'guest_declined', label: 'Sin invitado (no viene)', guests: true },
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
  const isGuestFilter = statusOptions.some((o) => o.guests && o.value === statusFilter)
  const effectiveStatus: StatusFilter = isGuestFilter && !guestEventIds ? 'all' : statusFilter

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
  const [leaderCount, setLeaderCount] = useState(0)
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

    // Cuántos líderes hay (para el filtro "Líderes"; ver supabase/21_leaders.sql)
    let leadersQuery = supabase.from('ticket_leaders').select('ticket_id, tickets!inner(event_id)', { count: 'exact', head: true })
    if (effectiveFilter !== ALL) leadersQuery = leadersQuery.eq('tickets.event_id', effectiveFilter)
    const { count: leaders, error: leadersError } = await leadersQuery
    if (leadersError) setError(leadersError.message)
    else setLeaderCount(leaders ?? 0)
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
    // Filtro "Líderes": !inner deja solo los QR marcados como líder
    const leadersJoin = effectiveStatus === 'leaders' ? 'ticket_leaders!inner(created_at)' : 'ticket_leaders(created_at)'
    let query = supabase
      .from('tickets')
      .select(
        `id, name, event_id, used_at, guest_at, created_at, ${yearsJoin}, ${leadersJoin}, ticket_guest_names(guest_name), ticket_guest_declined(declined_at), ticket_awards(delivered_at)`,
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (effectiveFilter !== ALL) query = query.eq('event_id', effectiveFilter)
    if (typeof yearsFilter === 'number') query = query.eq('ticket_years.years', yearsFilter)
    if (effectiveStatus === 'used') query = query.not('used_at', 'is', null)
    if (effectiveStatus !== 'all' && effectiveStatus !== 'used' && effectiveStatus !== 'leaders') {
      // Filtros de invitados: solo QR de eventos con invitados activados (igual que la card de Invitados)
      query = query.in('event_id', guestEventIds.split(','))
      if (effectiveStatus === 'guest_in') query = query.not('guest_at', 'is', null)
      // Pendiente = todavía puede llegar: sin los que "no vienen"
      if (effectiveStatus === 'used_guest_pending')
        query = query.not('used_at', 'is', null).is('guest_at', null).is('ticket_guest_declined', null)
      if (effectiveStatus === 'guest_declined') query = query.not('ticket_guest_declined', 'is', null)
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
  }, [page, effectiveFilter, effectiveStatus, guestEventIds, yearsFilter, debouncedSearch])

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
        guests_declined: Number(s.guests_declined),
      })),
    )
    setUpdatedAt(new Date())
  }, [])

  // Listas (personas sin QR agregadas a mano, ver supabase/19_extra_lists.sql)
  const [extraGroups, setExtraGroups] = useState<ExtraGroup[]>([])
  const loadExtras = useCallback(async () => {
    if (effectiveFilter === null) {
      setExtraGroups([])
      return
    }
    let query = supabase
      .from('extra_groups')
      .select('id, event_id, name, sort_order, extra_people(*)')
      .order('sort_order')
      .order('created_at', { referencedTable: 'extra_people' })
    if (effectiveFilter !== ALL) query = query.eq('event_id', effectiveFilter)
    const { data, error } = await query.returns<ExtraGroup[]>()
    if (error) {
      setError(error.message)
      return
    }
    setExtraGroups(data)
  }, [effectiveFilter])

  // Siempre apunta a la última versión, para usarla desde Realtime
  const loadExtrasRef = useRef(loadExtras)
  useEffect(() => {
    loadExtrasRef.current = loadExtras
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga al cambiar de evento
    void loadExtras()
  }, [loadExtras])

  /** Marcar / desmarcar a mano el ingreso de una persona de una lista */
  const toggleExtraEntry = async (person: ExtraPerson) => {
    const { data, error } = await supabase.rpc('set_extra_person_entry', {
      p_person_id: person.id,
      p_entered: !person.entered_at,
    })
    if (error) {
      setError(error.message)
      return
    }
    const result = data as ExtraResult
    if (!result.ok) {
      setError(extraErrors[result.reason])
      return
    }
    await loadExtras()
  }

  const [editingExtraGuest, setEditingExtraGuest] = useState<ExtraPerson | null>(null)

  /** Marcar / desmarcar a mano el ingreso del invitado de una leyenda de lista */
  const toggleExtraGuest = async (person: ExtraPerson) => {
    const { data, error } = await supabase.rpc('set_extra_person_guest', {
      p_person_id: person.id,
      p_status: person.guest_status === 'in' ? 'pending' : 'in',
      p_guest_name: null,
    })
    if (error) {
      setError(error.message)
      return
    }
    const result = data as ExtraResult
    if (!result.ok) {
      setError(extraErrors[result.reason])
      return
    }
    await loadExtras()
  }

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
        void loadExtrasRef.current()
      }, 500)
    }

    const channel = supabase
      .channel('tickets-contador')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extra_people' }, scheduleRefresh)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))

    const poll = window.setInterval(() => {
      void loadStats()
      void loadTicketsRef.current()
      void loadYearCountsRef.current()
      void loadExtrasRef.current()
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
  const value = (n: number) => (stats ? n : '–')
  const eventName = (id: string) => rows.find((s) => s.event_id === id)?.event_name ?? id
  const isActive = (id: string) => activeEvent?.id === id
  const hasGuests = (id: string) => rows.find((s) => s.event_id === id)?.guests_enabled ?? false

  // Invitados: solo cuentan los eventos con invitados activados
  const withGuests = shown.filter((s) => s.guests_enabled)
  // Invitados que no vienen (se escaneó "Sin invitado"): no cuentan en el total ni en pendientes
  const guestsDeclined = withGuests.reduce((sum, s) => sum + s.guests_declined, 0)
  // 1 invitado por QR: el total de invitados es el total de QR menos los que no vienen
  const guestsTotal = withGuests.reduce((sum, s) => sum + s.total, 0) - guestsDeclined
  const guestsIn = withGuests.reduce((sum, s) => sum + s.guests, 0)
  // Titular ya ingresó y su invitado todavía puede llegar (contado en Supabase: hay invitados
  // que entran antes que su leyenda y otros que no vienen, así que used - guests no sirve)
  const guestsWaiting = withGuests.reduce((sum, s) => sum + s.guests_waiting, 0)
  // Invitado dentro y su leyenda todavía no:
  // invitados ingresados − leyendas dentro con invitado (= dentro − esperando − no vienen)
  const guestsFirst =
    guestsIn - (withGuests.reduce((sum, s) => sum + s.used, 0) - guestsWaiting - guestsDeclined)
  // Leyenda sin escanear y sin invitado agregado (eventos con invitados)
  const unusedNoGuest = withGuests.reduce((sum, s) => sum + s.total - s.used, 0) - guestsFirst

  // Listas: las personas incluidas como leyenda suman a la card Leyendas; el resto, solo al total
  const extraPeople = extraGroups.flatMap((g) => g.extra_people)
  const extraLeyendas = extraPeople.filter((p) => p.is_leyenda)
  const extraLeyendasIn = extraLeyendas.filter((p) => p.entered_at).length
  const extraOthers = extraPeople.filter((p) => !p.is_leyenda)
  const extraOthersIn = extraOthers.filter((p) => p.entered_at).length
  const hasExtras = extraPeople.length > 0
  // Invitados de las leyendas de listas (ver supabase/22_extra_guests.sql)
  // (leyendas y líderes de listas)
  const extraGuests = extraPeople.filter((p) => canHaveGuest(p) && p.guest_status !== 'none')
  const extraGuestsIn = extraGuests.filter((p) => p.guest_status === 'in').length
  const extraGuestsWaiting = extraGuests.filter((p) => p.guest_status === 'pending' && p.entered_at).length

  // Card Invitados: invitados de QR + invitados de listas (leyendas y líderes)
  const showGuestsCard = withGuests.length > 0 || extraGuests.length > 0
  const allGuestsTotal = guestsTotal + extraGuests.length
  const allGuestsIn = guestsIn + extraGuestsIn
  const allGuestsWaiting = guestsWaiting + extraGuestsWaiting
  const allGuestsPercent = allGuestsTotal > 0 ? Math.round((allGuestsIn / allGuestsTotal) * 100) : 0

  // Card Líderes: solo los líderes de listas que NO son leyendas
  const leaders = extraOthers.filter((p) => p.is_leader)
  const leadersTotal = leaders.length
  const leadersIn = leaders.filter((p) => p.entered_at).length
  const leadersPercent = leadersTotal > 0 ? Math.round((leadersIn / leadersTotal) * 100) : 0
  const showLeadersCard = leadersTotal > 0

  // Card Leyendas: leyendas con QR + leyendas de listas
  const leyTotal = total + extraLeyendas.length
  const leyUsed = used + extraLeyendasIn
  const leyPending = leyTotal - leyUsed
  const leyPercent = leyTotal > 0 ? Math.round((leyUsed / leyTotal) * 100) : 0

  // Total asistentes: leyendas + invitados (sin los que no vienen) + personas de listas
  const peopleTotal = leyTotal + allGuestsTotal + extraOthers.length
  const peopleIn = leyUsed + allGuestsIn + extraOthersIn
  // Card Total asistentes: con invitados o con listas
  const showPeopleCard = showGuestsCard || hasExtras
  // Cuántas cards hay en la fila (para armar la grilla)
  const cardCount = 1 + Number(showGuestsCard) + Number(showLeadersCard) + Number(showPeopleCard)
  const peoplePercent = peopleTotal > 0 ? Math.round((peopleIn / peopleTotal) * 100) : 0
  // Ancho de cada tramo de la barra, sobre el total de asistentes
  const share = (n: number) => (peopleTotal > 0 ? (n / peopleTotal) * 100 : 0)

  const columns: Column<TicketRow>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (t) => (
        <span className={t.name ? 'font-medium' : 'italic text-muted'}>
          {t.name || 'Sin nombre'}
          {t.ticket_leaders && <LeaderBadge />}
        </span>
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
    // Invitado: solo si algún evento visible tiene invitados activados
    ...(withGuests.length > 0
      ? [
          {
            key: 'guest',
            header: 'Invitado',
            className: 'whitespace-nowrap',
            render: (t: TicketRow) =>
              hasGuests(t.event_id) ? (
                <GuestBadge
                  ticket={t}
                  guestName={t.ticket_guest_names?.guest_name}
                  declined={Boolean(t.ticket_guest_declined)}
                />
              ) : null,
          },
        ]
      : []),
    // Reconocimiento (Premiación): ✓ verde si se entregó, — si no
    {
      key: 'award',
      header: (
        <span title="Reconocimiento entregado" className="inline-flex">
          <LuTrophy className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Reconocimiento</span>
        </span>
      ),
      className: 'w-px text-center',
      render: (t: TicketRow) =>
        t.ticket_awards ? (
          <span title={`Entregado ${formatDate(t.ticket_awards.delivered_at)}`} className="inline-flex">
            <LuCircleCheck className="h-5 w-5 text-success" aria-hidden="true" />
            <span className="sr-only">Entregado</span>
          </span>
        ) : (
          <span title="Sin entregar" className="text-muted">
            —<span className="sr-only">Sin entregar</span>
          </span>
        ),
    },
  ]

  const header = (
    // En web el título va en la barra superior: aquí solo queda el indicador "En vivo", a la derecha
    <div className="flex items-center justify-between md:justify-end">
      <h1 className="text-xl font-bold md:hidden">Ingresos</h1>
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
    <div className={`${PAGE_WIDTH} flex flex-1 flex-col gap-6 py-4`}>
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

      {/* Cards: Leyendas · Invitados · Líderes · Total asistentes (siempre al final).
          Tablet horizontal → de a 2 por fila (Total ocupa la fila si queda sola); web ancha → todas en una fila */}
        <div
          className={`flex flex-col gap-6 ${
            cardCount === 4
              ? 'tablet-landscape:grid tablet-landscape:grid-cols-2 desktop:grid-cols-4'
              : cardCount === 3
                ? 'tablet-landscape:grid tablet-landscape:grid-cols-2 desktop:grid-cols-3'
                : cardCount === 2
                  ? 'tablet-landscape:grid tablet-landscape:grid-cols-2'
                  : ''
          }`}
        >
          <CountCard
            title="Leyendas"
            total={value(leyTotal)}
            done={{ label: 'Escaneados', value: value(leyUsed), className: 'text-success' }}
            pending={value(leyPending)}
            percent={leyPercent}
            barClassName="bg-success"
            // Leyendas de listas (sin QR): ya sumadas arriba
            extra={
              extraLeyendas.length > 0 && (
                <p className="mt-3 text-sm text-muted">
                  Incluye <strong className="font-bold text-foreground">{extraLeyendas.length}</strong>{' '}
                  {extraLeyendas.length === 1 ? 'leyenda' : 'leyendas'} de listas ({extraLeyendasIn} ingresadas)
                </p>
              )
            }
          />

          {/* Invitados (solo eventos con invitados activados) */}
          {showGuestsCard && (
            <CountCard
              title="Invitados"
              total={value(allGuestsTotal)}
              done={{ label: 'Ingresados', value: value(allGuestsIn), className: 'text-success' }}
              pending={value(allGuestsTotal - allGuestsIn)}
              percent={allGuestsPercent}
              barClassName="bg-success"
              // Invitados pendientes cuyo titular (la leyenda) ya ingresó
              footer={
                <p className="mt-6 flex items-center justify-center gap-2 border-t border-line pt-5 text-sm text-foreground-soft tablet-landscape:text-base">
                  <span className="text-3xl font-semibold leading-none tabular-nums text-warning tablet-landscape:text-4xl">
                    {value(allGuestsWaiting)}
                  </span>
                  <span>
                    {allGuestsWaiting === 1 ? 'invitado' : 'invitados'}{' '}
                    <strong className="font-bold text-foreground">
                      {allGuestsWaiting === 1 ? 'pendiente' : 'pendientes'}
                    </strong>{' '}
                    con la leyenda dentro
                  </span>
                </p>
              }
              // Se escanearon "Sin invitado": ya descontados del total
              extra={
                (extraGuests.length > 0 || (stats && guestsDeclined > 0)) && (
                  <>
                    {extraGuests.length > 0 && (
                      <p className="mt-3 text-sm text-muted">
                        Incluye <strong className="font-bold text-foreground">{extraGuests.length}</strong>{' '}
                        {extraGuests.length === 1 ? 'invitado' : 'invitados'} de listas ({extraGuestsIn}{' '}
                        {extraGuestsIn === 1 ? 'ingresado' : 'ingresados'})
                      </p>
                    )}
                    {stats && guestsDeclined > 0 && (
                      <p className="mt-3 text-sm text-muted">
                        <strong className="font-bold text-foreground">{guestsDeclined}</strong>{' '}
                        {guestsDeclined === 1 ? 'leyenda vino' : 'leyendas vinieron'} sin invitado (no cuentan en el
                        total)
                      </p>
                    )}
                  </>
                )
              }
            />
          )}

          {/* Líderes que no son leyendas (personas de listas marcadas como líder) */}
          {showLeadersCard && (
            <CountCard
              title="Líderes"
              total={leadersTotal}
              done={{ label: 'Ingresados', value: leadersIn, className: 'text-success' }}
              pending={leadersTotal - leadersIn}
              percent={leadersPercent}
              barClassName="bg-success"
              extra={<p className="mt-3 text-sm text-muted">Líderes de listas que no son leyendas</p>}
            />
          )}

          {/* Total asistentes (leyendas + invitados + listas), siempre la última card:
              tablet → ocupa la fila completa si queda sola; web ancha → última de la fila */}
          {showPeopleCard && (
        <section
          className={`rounded-2xl bg-surface px-5 py-6 tablet-landscape:py-8 ${
            cardCount % 2 === 1 ? 'tablet-landscape:col-span-2 desktop:col-span-1' : ''
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="flex items-center gap-2 text-base font-medium uppercase tracking-wide text-foreground-soft tablet-landscape:text-lg">
              Total asistentes
              <span className="rounded-full bg-surface-strong px-3 py-0.5 text-base font-semibold normal-case tracking-normal text-foreground tablet-landscape:text-lg">
                Total {value(peopleTotal)}
              </span>
            </p>
            <p className="tabular-nums">
              <span className="text-4xl font-bold text-success tablet-landscape:text-5xl desktop:text-6xl">
                {value(peopleIn)}
              </span>
              <span className="text-lg text-muted"> / {value(peopleTotal)}</span>
              <span className="ml-3 text-lg font-semibold text-foreground-soft">{peoplePercent}%</span>
            </p>
          </div>

          {/* Barra: tramo de leyendas + tramo de invitados */}
          <div
            className="mt-4 flex h-5 overflow-hidden rounded-full bg-background"
            role="img"
            aria-label={`${peopleIn} de ${peopleTotal} asistentes ingresados`}
          >
            <div className="h-full bg-success transition-all duration-500" style={{ width: `${share(leyUsed)}%` }} />
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${share(allGuestsIn)}%` }} />
            <div
              className="h-full bg-foreground-soft transition-all duration-500"
              style={{ width: `${share(extraOthersIn)}%` }}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground-soft">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-success" aria-hidden="true" />
              Leyendas <strong className="tabular-nums text-foreground">{value(leyUsed)}</strong>
            </span>
            {showGuestsCard && (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-primary" aria-hidden="true" />
                Invitados <strong className="tabular-nums text-foreground">{value(allGuestsIn)}</strong>
              </span>
            )}
            {extraOthers.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-foreground-soft" aria-hidden="true" />
                Listas <strong className="tabular-nums text-foreground">{extraOthersIn}</strong>
              </span>
            )}
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-background ring-1 ring-line" aria-hidden="true" />
              Pendientes{' '}
              <strong className="tabular-nums text-warning">{value(peopleTotal - peopleIn)}</strong>
            </span>
            {/* Solo informativo: no está en la barra ni en el total */}
            {withGuests.length > 0 && (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full border border-dashed border-muted" aria-hidden="true" />
                Leyendas sin invitado <strong className="tabular-nums text-foreground">{value(guestsDeclined)}</strong>
              </span>
            )}
          </div>
        </section>
          )}
        </div>

      {/* Listas: una tabla por lista (personas sin QR agregadas a mano en la ventana Listas) */}
      {extraGroups.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">Listas</h2>
          <div className="grid gap-4 desktop:grid-cols-2">
            {extraGroups.map((g) => (
              <ExtraGroupTable
                key={g.id}
                group={g}
                eventLabel={effectiveFilter === ALL ? eventName(g.event_id) : null}
                onToggleEntry={(p) => void toggleExtraEntry(p)}
                onToggleGuest={(p) => void toggleExtraGuest(p)}
                onEditGuest={role === 'admin' ? setEditingExtraGuest : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {editingExtraGuest && (
        <ExtraGuestDialog
          person={editingExtraGuest}
          onClose={() => setEditingExtraGuest(null)}
          onSaved={() => {
            setEditingExtraGuest(null)
            void loadExtras()
          }}
        />
      )}

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
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {effectiveFilter === ALL ? 'Todos los QR' : `QR · ${eventName(effectiveFilter ?? '')}`}
          </h2>
          {/* Solo aparece si hay algún filtro o búsqueda puesta */}
          {(search || effectiveStatus !== 'all' || yearsFilter !== 'all') && (
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

        {/* Filtros por status */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
          {statusOptions
            .filter((o) => !o.guests || guestEventIds)
            .filter((o) => o.value !== 'leaders' || leaderCount > 0)
            .map((o) => {
              const selected = effectiveStatus === o.value
              const count = {
                all: total,
                used,
                guest_in: guestsIn,
                used_guest_pending: guestsWaiting,
                unused_guest_in: guestsFirst,
                unused_no_guest: unusedNoGuest,
                guest_declined: guestsDeclined,
                leaders: leaderCount,
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
                  {o.label} <span className={countClass(selected)}>{value(count)}</span>
                </button>
              )
            })}
        </div>

        {/* Filtros por años de la leyenda */}
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
                <span className={countClass(selected)}>{stats && yearCounts ? count : '–'}</span>
              </button>
            )
          })}
        </div>

        <Table
          columns={columns}
          rows={ticketRows}
          getRowKey={(t) => t.id}
          loading={ticketsLoading}
          emptyMessage={
            debouncedSearch
              ? `Ningún nombre coincide con “${search.trim()}”.`
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
    </div>
  )
}

interface ExtraGroupTableProps {
  group: ExtraGroup
  /** Nombre del evento (solo en "Todos los eventos") */
  eventLabel: string | null
  onToggleEntry: (person: ExtraPerson) => void
  onToggleGuest: (person: ExtraPerson) => void
  /** Solo admin: agregar / editar / quitar el invitado */
  onEditGuest?: (person: ExtraPerson) => void
}

/** Tabla de una lista en el Contador: nombre, tipo, ingreso e invitado (se marcan a mano tocándolos) */
function ExtraGroupTable({ group, eventLabel, onToggleEntry, onToggleGuest, onEditGuest }: ExtraGroupTableProps) {
  const people = group.extra_people
  const entered = people.filter((p) => p.entered_at).length
  // Columna Invitado: solo si hay leyendas o líderes (pueden venir con invitado)
  const hasLeyendas = people.some(canHaveGuest)

  const columns: Column<ExtraPerson>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (p) => (
        <span className="font-medium">
          {p.name}
          {p.is_leader && <LeaderBadge />}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Tipo',
      className: 'whitespace-nowrap',
      render: (p) =>
        p.is_leyenda ? (
          <span className="rounded-full bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
            Leyenda{p.years ? ` · ${p.years} años` : ''}
          </span>
        ) : (
          <span className="text-xs text-muted">Participante</span>
        ),
    },
    {
      key: 'entry',
      header: 'Ingreso',
      className: 'w-px whitespace-nowrap',
      render: (p) => (
        <button
          type="button"
          onClick={() => onToggleEntry(p)}
          title={p.entered_at ? 'Marcar como pendiente' : 'Marcar ingreso'}
          className="rounded-lg text-left hover:opacity-80"
        >
          {p.entered_at ? (
            <span className="inline-flex flex-col">
              <span className="w-fit rounded-full bg-success/15 px-2 py-1 text-xs font-semibold text-success">
                Ingresado
              </span>
              <span className="mt-1 text-xs text-muted">{formatDate(p.entered_at)}</span>
            </span>
          ) : (
            <span className="rounded-full bg-warning/15 px-2 py-1 text-xs font-semibold text-warning">
              Pendiente · marcar
            </span>
          )}
        </button>
      ),
    },
    ...(hasLeyendas
      ? [
          {
            key: 'guest',
            header: 'Invitado',
            className: 'w-px whitespace-nowrap',
            render: (p: ExtraPerson) => (
              <ExtraGuestCell
                person={p}
                onToggle={() => onToggleGuest(p)}
                onEdit={onEditGuest ? () => onEditGuest(p) : undefined}
              />
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-base font-bold text-primary">
          {group.name}
          {eventLabel && <span className="ml-2 text-xs font-normal text-muted">{eventLabel}</span>}
        </h3>
        <span className="shrink-0 text-sm tabular-nums text-foreground-soft">
          <strong className="text-success">{entered}</strong> / {people.length} ingresados
        </span>
      </div>
      <Table columns={columns} rows={people} getRowKey={(p) => p.id} emptyMessage="Lista sin personas." />
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
  /** Nota chica debajo del footer */
  extra?: ReactNode
}

/** Card de conteo: título con el total, ingresados | pendientes y barra de avance */
function CountCard({ title, total, done, pending, percent, barClassName, footer, extra }: CountCardProps) {
  return (
    // Todo alineado arriba: en tablet las dos cards quedan con título, números y barra a la misma altura
    <section className="flex flex-col justify-start rounded-2xl bg-surface px-5 py-8 text-center tablet-landscape:py-10">
      <p className="flex items-center justify-center gap-2 text-base font-medium uppercase tracking-wide text-foreground-soft tablet-landscape:text-lg">
        {title}
        <span className="rounded-full bg-surface-strong px-3 py-0.5 text-base font-semibold normal-case tracking-normal text-foreground tablet-landscape:text-lg">
          Total {total}
        </span>
      </p>

      <div className="mt-4 grid grid-cols-2 divide-x divide-line">
        <div>
          <p className="text-base text-foreground-soft tablet-landscape:text-lg">{done.label}</p>
          {/* Web ancha: 3 cards en fila → 112 px, lo más grande en que caben 3 cifras por columna */}
          <p className={`text-7xl font-bold tabular-nums tablet-landscape:text-9xl desktop:text-[7rem] ${done.className}`}>
            {done.value}
          </p>
        </div>
        <div>
          <p className="text-base text-foreground-soft tablet-landscape:text-lg">Pendientes</p>
          <p className="text-7xl font-bold tabular-nums text-warning tablet-landscape:text-9xl desktop:text-[7rem]">
            {pending}
          </p>
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
      {extra}
    </section>
  )
}
