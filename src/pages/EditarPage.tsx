import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Table, type Column } from '../components/ui/Table'
import { SearchInput } from '../components/ui/SearchInput'
import { filterTickets } from '../utils/search'
import { countClass } from '../utils/filterChip'
import { extraErrors, type ExtraResult } from '../types/extraLists'
import { PAGE_WIDTH } from '../utils/layout'
import { DeleteTicketDialog } from '../components/common/DeleteTicketDialog'
import { DeleteEventTicketsDialog } from '../components/common/DeleteEventTicketsDialog'
import { SetTicketStatusDialog } from '../components/common/SetTicketStatusDialog'
import { ActiveEventDialog } from '../components/common/ActiveEventDialog'
import { EventGuestsDialog } from '../components/common/EventGuestsDialog'
import { SetGuestStateDialog } from '../components/common/SetGuestStateDialog'
import { LuUserPlus } from 'react-icons/lu'
import { GuestBadge } from '../components/common/GuestBadge'
import { AddGuestDialog } from '../components/common/AddGuestDialog'
import { ResetEventStatusDialog } from '../components/common/ResetEventStatusDialog'
import { YearsCell } from '../components/common/YearsCell'
import type {
  Event,
  GuestState,
  Ticket as TicketBase,
  WithGuestDeclined,
  WithGuestName,
  WithYears,
} from '../types/ticket'

/** Ticket con sus años, el nombre de su invitado y la marca "no viene" (tablas aparte) */
type Ticket = TicketBase & WithYears & WithGuestName & WithGuestDeclined

/** Leyenda de una lista (sin QR) para marcar su ingreso a mano */
interface ExtraLeyenda {
  id: string
  name: string
  years: number | null
  entered_at: string | null
  extra_groups: { name: string; event_id: string }
}

/** Estado actual del invitado de un QR */
const guestState = (t: Ticket): GuestState => (t.guest_at ? 'in' : t.ticket_guest_declined ? 'declined' : 'pending')

const PAGE_SIZE = 10

/** Filtro de la tabla de Editar */
type EditFilter = 'all' | 'used' | 'unused' | 'guest_in' | 'guest_pending' | 'guest_declined'

/** guests = solo en eventos con invitados activados */
const editFilterOptions: { value: EditFilter; label: string; guests?: boolean }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'used', label: 'Escaneados' },
  { value: 'unused', label: 'Sin escanear' },
  { value: 'guest_in', label: 'Invitado ingresado', guests: true },
  // Puede llegar todavía (con o sin la leyenda dentro): son los que muestran "Agregar"
  { value: 'guest_pending', label: 'Invitado por llegar', guests: true },
  { value: 'guest_declined', label: 'Sin invitado (no viene)', guests: true },
]

function matchesEditFilter(t: Ticket, filter: EditFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'used':
      return Boolean(t.used_at)
    case 'unused':
      return !t.used_at
    case 'guest_in':
      return Boolean(t.guest_at)
    case 'guest_pending':
      return !t.guest_at && !t.ticket_guest_declined
    case 'guest_declined':
      return Boolean(t.ticket_guest_declined) && !t.guest_at
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Acción pendiente de confirmar con contraseña */
type PendingAction =
  | { type: 'status'; ticket: Ticket }
  | { type: 'delete'; ticket: Ticket }
  | { type: 'deleteAll' }
  | { type: 'resetAll' }
  | { type: 'activate'; eventId: string | null }
  | { type: 'guests'; enable: boolean }
  | { type: 'guestStatus'; ticket: Ticket }
  | { type: 'addGuest'; ticket: Ticket }

export function EditarPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [search, setSearch] = useState('')

  const eventName = (id: string) => events.find((e) => e.id === id)?.name ?? id
  const activeEvent = events.find((e) => e.is_active) ?? null
  const selectedIsActive = activeEvent?.id === eventId
  const guestsEnabled = events.find((e) => e.id === eventId)?.guests_enabled ?? false

  const loadTickets = async (id: string) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tickets')
      .select('*, ticket_years(years), ticket_guest_names(guest_name), ticket_guest_declined(declined_at)')
      .eq('event_id', id)
      .order('created_at', { ascending: false })
      .returns<Ticket[]>()
    setLoading(false)
    if (error) setError(error.message)
    else setTickets(data)
    void loadExtraLeyendas(id)
  }

  // Leyendas de listas (sin QR): su ingreso se marca a mano (ver supabase/19_extra_lists.sql)
  const [extraLeyendas, setExtraLeyendas] = useState<ExtraLeyenda[]>([])
  const loadExtraLeyendas = async (id: string) => {
    const { data, error } = await supabase
      .from('extra_people')
      .select('id, name, years, entered_at, extra_groups!inner(name, event_id)')
      .eq('extra_groups.event_id', id)
      .eq('is_leyenda', true)
      .order('name')
      .returns<ExtraLeyenda[]>()
    if (error) setError(error.message)
    else setExtraLeyendas(data ?? [])
  }

  const toggleExtraEntry = async (p: ExtraLeyenda) => {
    setNotice(null)
    const { data, error } = await supabase.rpc('set_extra_person_entry', {
      p_person_id: p.id,
      p_entered: !p.entered_at,
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
    setExtraLeyendas((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, entered_at: result.entered_at ?? null } : x)),
    )
    setNotice(`${p.name} quedó como ${result.entered_at ? 'ingresada' : 'pendiente'}.`)
  }

  const changeEvent = (id: string) => {
    setEventId(id)
    setTickets([])
    setPage(0)
    setNotice(null)
    setError(null)
    setSearch('')
    void loadTickets(id)
  }

  // Al entrar: carga los eventos y arranca en el evento activo, si hay
  useEffect(() => {
    supabase
      .from('events')
      .select('*')
      .order('sort_order')
      .returns<Event[]>()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else {
          setEvents(data)
          const active = data.find((e) => e.is_active)
          if (active) changeEvent(active.id)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al entrar
  }, [])

  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const [statusFilter, setStatusFilter] = useState<EditFilter>('all')
  const changeStatusFilter = (value: EditFilter) => {
    setStatusFilter(value)
    setPage(0)
  }

  // Filtro por nombre (también acepta el inicio del código del QR)
  // Filtros por status (los de invitado solo en eventos con invitados activados)
  const shownFilterOptions = editFilterOptions.filter((o) => !o.guests || guestsEnabled)
  const activeFilter = shownFilterOptions.some((o) => o.value === statusFilter) ? statusFilter : 'all'
  const filtered = filterTickets(
    tickets.filter((t) => matchesEditFilter(t, activeFilter)),
    search,
  )
  const query = search.trim()
  const hasFilters = activeFilter !== 'all' || query !== ''

  // Paginado en memoria
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const usedCount = tickets.filter((t) => t.used_at).length
  const guestCount = tickets.filter((t) => t.guest_at).length

  const done = (message: string) => {
    setPending(null)
    setNotice(message)
  }

  const extraColumns: Column<ExtraLeyenda>[] = [
    {
      key: 'name',
      header: 'Leyenda',
      render: (p) => (
        <div className="min-w-0">
          <p className="font-medium">{p.name}</p>
          <p className="text-xs text-muted">
            {p.years ? `${p.years} años` : 'Sin años'} · Lista {p.extra_groups.name}
          </p>
        </div>
      ),
    },
    {
      key: 'entry',
      header: 'Ingreso',
      className: 'w-px whitespace-nowrap',
      render: (p) => (
        <button
          type="button"
          onClick={() => void toggleExtraEntry(p)}
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
  ]

  const columns: Column<Ticket>[] = [
    // Leyenda: nombre y, debajo, sus años y el inicio del código del QR
    {
      key: 'name',
      header: 'Leyenda',
      render: (t) => (
        <div className="min-w-0">
          <p className={t.name ? 'font-medium' : 'italic text-muted'}>{t.name || 'Sin nombre'}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <YearsCell row={t} />
            <span aria-hidden="true">·</span>
            <span className="font-mono">{t.code.slice(0, 8)}…</span>
          </p>
        </div>
      ),
    },
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
    // Invitado: solo en eventos con invitados activados. Se toca para cambiarlo
    // (también si la leyenda no ha entrado: el invitado puede llegar primero).
    ...(guestsEnabled
      ? [
          {
            key: 'guest',
            header: 'Invitado',
            className: 'whitespace-nowrap',
            // Estado del invitado; se toca para cambiarlo (con contraseña)
            render: (t: Ticket) => (
              <button
                type="button"
                onClick={() => {
                  setNotice(null)
                  setPending({ type: 'guestStatus', ticket: t })
                }}
                title="Cambiar estado del invitado"
                className="rounded-lg text-left hover:opacity-80"
              >
                <GuestBadge ticket={t} declined={Boolean(t.ticket_guest_declined)} />
              </button>
            ),
          },
          {
            key: 'guestName',
            header: 'Nombre invitado',
            className: 'whitespace-nowrap',
            // Nombre si se registró; si el invitado todavía puede llegar, el botón para agregarlo
            render: (t: Ticket) => {
              if (t.ticket_guest_names?.guest_name) {
                return <span className="max-w-48 truncate font-medium">{t.ticket_guest_names.guest_name}</span>
              }
              if (!t.guest_at && !t.ticket_guest_declined) {
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null)
                      setPending({ type: 'addGuest', ticket: t })
                    }}
                    title="Agregar invitado"
                    aria-label={`Agregar invitado de ${t.name || 'sin nombre'}`}
                    className="flex items-center gap-1 rounded-lg border border-primary px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
                  >
                    <LuUserPlus className="h-4 w-4" aria-hidden="true" />
                    Agregar
                  </button>
                )
              }
              // Ingresó sin nombre registrado, o no viene
              return <span className="text-muted">—</span>
            },
          },
        ]
      : []),
    {
      key: 'actions',
      header: <span className="sr-only">Acciones</span>,
      className: 'w-px',
      render: (t) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setPending({ type: 'status', ticket: t })
            }}
            // El texto es corto; el detalle queda en el tooltip y para lectores de pantalla
            title={t.used_at ? 'Marcar como no escaneado' : 'Marcar como escaneado'}
            aria-label={t.used_at ? 'Marcar como no escaneado' : 'Marcar como escaneado'}
            className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-semibold ${
              t.used_at
                ? 'border-danger text-danger-soft hover:bg-danger/15' // desmarcar
                : 'border-success text-success hover:bg-success/15' // marcar
            }`}
          >
            {t.used_at ? 'Desmarcar' : 'Marcar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setPending({ type: 'delete', ticket: t })
            }}
            aria-label={`Eliminar QR de ${t.name || 'sin nombre'}`}
            title="Eliminar"
            className="rounded-lg p-2 text-danger-soft hover:bg-danger/15"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className={`${PAGE_WIDTH} space-y-6 py-4`}>
      <section className="space-y-4 rounded-2xl bg-surface p-4">
        <div>
          {/* En web el título va en la barra superior */}
          <h1 className="text-xl font-bold md:hidden">Editar QR</h1>
          <p className="text-sm text-muted">
            Cambia el status o elimina QR. Cada acción pide la contraseña del admin.
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">Evento</span>
          <select
            value={eventId}
            onChange={(e) => changeEvent(e.target.value)}
            className="w-full rounded-lg border border-line bg-background px-3 py-3 text-base text-foreground outline-none focus:border-primary"
          >
            <option value="" disabled>
              Elige un evento…
            </option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
                {ev.is_active ? ' · activo' : ''}
              </option>
            ))}
          </select>
        </label>

        {/* Evento activo: lo que ve el staff en Contador */}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${activeEvent ? 'bg-success' : 'bg-surface-hover'}`}
              aria-hidden="true"
            />
            <p className="truncate text-sm">
              <span className="text-muted">Evento activo: </span>
              <strong>{activeEvent?.name ?? 'ninguno'}</strong>
            </p>
          </div>
          {eventId &&
            (selectedIsActive ? (
              <button
                type="button"
                onClick={() => setPending({ type: 'activate', eventId: null })}
                className="shrink-0 rounded-lg border border-danger px-3 py-2 text-xs font-semibold text-danger-soft hover:bg-danger/15"
              >
                Desactivar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPending({ type: 'activate', eventId })}
                className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:bg-primary-hover"
              >
                Activar {eventName(eventId)}
              </button>
            ))}
        </div>

        {/* Invitados del evento elegido: 1 por QR */}
        {eventId && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${guestsEnabled ? 'bg-success' : 'bg-surface-hover'}`}
                aria-hidden="true"
              />
              <p className="truncate text-sm">
                <span className="text-muted">Invitados: </span>
                <strong>{guestsEnabled ? 'activados' : 'desactivados'}</strong>
              </p>
            </div>
            {guestsEnabled ? (
              <button
                type="button"
                onClick={() => setPending({ type: 'guests', enable: false })}
                className="shrink-0 rounded-lg border border-danger px-3 py-2 text-xs font-semibold text-danger-soft hover:bg-danger/15"
              >
                Desactivar invitados
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPending({ type: 'guests', enable: true })}
                className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:bg-primary-hover"
              >
                Activar invitados
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
            {error}
          </p>
        )}
      </section>

      {!eventId ? (
        <p className="text-center text-muted">Elige un evento para editar sus QR.</p>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="truncate text-lg font-bold">QR · {eventName(eventId)}</h2>
              <span className="shrink-0 text-sm text-muted">
                {usedCount} escaneados / {tickets.length}
                {guestsEnabled && ` · ${guestCount} invitados`}
              </span>
            </div>

            {notice && (
              <p role="status" className="rounded-lg bg-success/15 px-3 py-2 text-sm text-success">
                ✓ {notice}
              </p>
            )}

            {/* Buscador + filtros */}
            {tickets.length > 0 && (
              <>
                <SearchInput value={search} onChange={changeSearch} resultCount={filtered.length} />
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar">
                  {shownFilterOptions.map((o) => {
                    const selected = activeFilter === o.value
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
                        {o.label}{' '}
                        <span className={countClass(selected)}>
                          {tickets.filter((t) => matchesEditFilter(t, o.value)).length}
                        </span>
                      </button>
                    )
                  })}
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter('all')
                        setSearch('')
                        setPage(0)
                      }}
                      className="ml-auto flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-foreground-soft hover:bg-surface-strong"
                    >
                      <span aria-hidden="true">✕</span> Limpiar filtros
                    </button>
                  )}
                </div>
              </>
            )}

            <Table
              columns={columns}
              rows={pageRows}
              getRowKey={(t) => t.id}
              loading={loading}
              emptyMessage={
                query
                  ? `Ningún nombre coincide con “${query}”.`
                  : activeFilter !== 'all'
                    ? 'No hay QR con este filtro.'
                    : 'Este evento no tiene QR.'
              }
              pagination={{
                page: currentPage,
                pageSize: PAGE_SIZE,
                total: filtered.length,
                onPageChange: setPage,
              }}
            />
          </section>

          {/* Leyendas de listas (sin QR): marcar su ingreso a mano */}
          {extraLeyendas.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="truncate text-lg font-bold">Leyendas de listas · sin QR</h2>
                <span className="shrink-0 text-sm text-muted">
                  {extraLeyendas.filter((p) => p.entered_at).length} ingresadas / {extraLeyendas.length}
                </span>
              </div>
              <Table
                columns={extraColumns}
                rows={extraLeyendas}
                getRowKey={(p) => p.id}
                emptyMessage="No hay leyendas en listas."
              />
            </section>
          )}

          {/* Zona de peligro */}
          {tickets.length > 0 && (
            <section className="space-y-4 rounded-2xl border border-danger/40 p-4">
              <h2 className="font-bold text-danger-soft">Zona de peligro</h2>

              {/* Reiniciar status */}
              <div className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold text-warning">Reiniciar status</h3>
                  <p className="text-sm text-muted">
                    Deja todos los QR de {eventName(eventId)} como no escaneados
                    {guestsEnabled && ' y sus invitados como pendientes'}. Los QR no se borran: úsalo para
                    limpiar las pruebas antes de empezar a escanear.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null)
                    setPending({ type: 'resetAll' })
                  }}
                  disabled={usedCount === 0 && guestCount === 0}
                  className="w-full rounded-lg bg-warning/15 py-3 text-sm font-semibold text-warning hover:bg-warning/25 disabled:opacity-40 disabled:hover:bg-warning/15"
                >
                  {usedCount === 0 && guestCount === 0
                    ? 'Reiniciar status (no hay escaneados)'
                    : `Reiniciar status (${usedCount} escaneados${guestCount > 0 ? ` · ${guestCount} invitados` : ''})`}
                </button>
              </div>

              <hr className="border-danger/20" />

              {/* Eliminar todos: solo con el evento desactivado */}
              {selectedIsActive ? (
                <p className="text-sm text-muted">
                  Para eliminar todos los QR, primero desactiva {eventName(eventId)}.
                </p>
              ) : (
                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-danger-soft">Eliminar todos los QR</h3>
                    <p className="text-sm text-muted">
                      Borra todos los QR de {eventName(eventId)}: dejarán de servir en la entrada y habrá que
                      generarlos de nuevo. El evento no se elimina.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null)
                      setPending({ type: 'deleteAll' })
                    }}
                    className="w-full rounded-lg bg-danger/15 py-3 text-sm font-semibold text-danger-soft hover:bg-danger/25"
                  >
                    Eliminar todos los QR ({tickets.length})
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {pending?.type === 'activate' && (
        <ActiveEventDialog
          eventId={pending.eventId}
          eventName={eventName(pending.eventId ?? activeEvent?.id ?? '')}
          currentActiveName={activeEvent?.name ?? null}
          onClose={() => setPending(null)}
          onDone={(activeId) => {
            setEvents((prev) => prev.map((ev) => ({ ...ev, is_active: ev.id === activeId })))
            done(
              activeId
                ? `${eventName(activeId)} es ahora el evento activo.`
                : 'No hay ningún evento activo.',
            )
          }}
        />
      )}

      {pending?.type === 'guests' && (
        <EventGuestsDialog
          eventId={eventId}
          eventName={eventName(eventId)}
          enable={pending.enable}
          onClose={() => setPending(null)}
          onDone={(enabled) => {
            setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, guests_enabled: enabled } : ev)))
            done(`Invitados ${enabled ? 'activados' : 'desactivados'} en ${eventName(eventId)}.`)
          }}
        />
      )}

      {/* Modales con contraseña */}
      {pending?.type === 'addGuest' && (
        <AddGuestDialog
          ticketId={pending.ticket.id}
          leyendaName={pending.ticket.name}
          onClose={() => setPending(null)}
          onAdded={() => {
            done(`Se registró el ingreso del invitado de ${pending.ticket.name || 'QR sin nombre'}.`)
            void loadTickets(eventId)
          }}
        />
      )}

      {pending?.type === 'guestStatus' && (
        <SetGuestStateDialog
          ticketId={pending.ticket.id}
          leyendaName={pending.ticket.name}
          eventName={eventName(eventId)}
          current={guestState(pending.ticket)}
          onClose={() => setPending(null)}
          onUpdated={(id, guestAt, declined) => {
            // Si no quedó ingresado, Supabase también borra el nombre del invitado
            setTickets((prev) =>
              prev.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      guest_at: guestAt,
                      ticket_guest_declined: declined ? { declined_at: new Date().toISOString() } : null,
                      ...(guestAt ? {} : { ticket_guest_names: null }),
                    }
                  : t,
              ),
            )
            done(
              `Invitado de ${pending.ticket.name || 'QR sin nombre'} quedó como ${
                guestAt ? 'ingresado' : declined ? 'no viene' : 'pendiente'
              }.`,
            )
          }}
        />
      )}

      {pending?.type === 'status' && (
        <SetTicketStatusDialog
          ticket={pending.ticket}
          eventName={eventName(eventId)}
          onClose={() => setPending(null)}
          onUpdated={(id, usedAt) => {
            // Al desmarcar, Supabase también borra el ingreso del invitado
            setTickets((prev) =>
              prev.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      used_at: usedAt,
                      ...(usedAt ? {} : { guest_at: null, ticket_guest_names: null, ticket_guest_declined: null }),
                    }
                  : t,
              ),
            )
            done(
              `${pending.ticket.name || 'QR sin nombre'} quedó como ${usedAt ? 'escaneado' : 'no escaneado'}.`,
            )
          }}
        />
      )}

      {pending?.type === 'delete' && (
        <DeleteTicketDialog
          ticket={pending.ticket}
          eventName={eventName(eventId)}
          onClose={() => setPending(null)}
          onDeleted={(id) => {
            setTickets((prev) => prev.filter((t) => t.id !== id))
            done(`Se eliminó el QR de ${pending.ticket.name || 'sin nombre'}.`)
          }}
        />
      )}

      {pending?.type === 'resetAll' && (
        <ResetEventStatusDialog
          eventId={eventId}
          eventName={eventName(eventId)}
          used={usedCount}
          guests={guestCount}
          onClose={() => setPending(null)}
          onReset={(reset) => {
            setTickets((prev) =>
              prev.map((t) => ({
                ...t,
                used_at: null,
                used_by: null,
                guest_at: null,
                guest_by: null,
                ticket_guest_names: null,
                ticket_guest_declined: null,
              })),
            )
            // Supabase también deja sin ingreso a las leyendas de listas (supabase/20_lists_award_reset.sql)
            void loadExtraLeyendas(eventId)
            done(`Se reinició el status de ${reset} QR de ${eventName(eventId)}.`)
          }}
        />
      )}

      {pending?.type === 'deleteAll' && (
        <DeleteEventTicketsDialog
          eventId={eventId}
          eventName={eventName(eventId)}
          total={tickets.length}
          used={usedCount}
          onClose={() => setPending(null)}
          onDeleted={(deleted) => {
            setTickets([])
            setPage(0)
            done(`Se eliminaron ${deleted} QR de ${eventName(eventId)}.`)
          }}
        />
      )}
    </div>
  )
}
