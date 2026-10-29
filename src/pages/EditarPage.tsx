import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Table, type Column } from '../components/ui/Table'
import { SearchInput } from '../components/ui/SearchInput'
import { filterTickets } from '../utils/search'
import { DeleteTicketDialog } from '../components/common/DeleteTicketDialog'
import { DeleteEventTicketsDialog } from '../components/common/DeleteEventTicketsDialog'
import { SetTicketStatusDialog } from '../components/common/SetTicketStatusDialog'
import { ActiveEventDialog } from '../components/common/ActiveEventDialog'
import { EventGuestsDialog } from '../components/common/EventGuestsDialog'
import { SetGuestStateDialog } from '../components/common/SetGuestStateDialog'
import { GuestBadge } from '../components/common/GuestBadge'
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

/** Estado actual del invitado de un QR */
const guestState = (t: Ticket): GuestState => (t.guest_at ? 'in' : t.ticket_guest_declined ? 'declined' : 'pending')

const PAGE_SIZE = 10

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

  // Filtro por nombre (también acepta el inicio del código del QR)
  const filtered = filterTickets(tickets, search)
  const query = search.trim()

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

  const columns: Column<Ticket>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (t) => (
        <div className="min-w-0">
          <p className={t.name ? 'font-medium' : 'italic text-muted'}>{t.name || 'Sin nombre'}</p>
          <p className="font-mono text-xs text-muted">{t.code.slice(0, 8)}…</p>
        </div>
      ),
    },
    {
      key: 'years',
      header: 'Años',
      className: 'whitespace-nowrap',
      render: (t) => <YearsCell row={t} />,
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
                <GuestBadge
                  ticket={t}
                  guestName={t.ticket_guest_names?.guest_name}
                  declined={Boolean(t.ticket_guest_declined)}
                />
              </button>
            ),
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
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
      <section className="space-y-4 rounded-2xl bg-surface p-4">
        <div>
          <h1 className="text-xl font-bold">Editar QR</h1>
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

            {/* Buscador */}
            {tickets.length > 0 && (
              <SearchInput value={search} onChange={changeSearch} resultCount={filtered.length} />
            )}

            <Table
              columns={columns}
              rows={pageRows}
              getRowKey={(t) => t.id}
              loading={loading}
              emptyMessage={query ? `Ningún nombre coincide con “${query}”.` : 'Este evento no tiene QR.'}
              pagination={{
                page: currentPage,
                pageSize: PAGE_SIZE,
                total: filtered.length,
                onPageChange: setPage,
              }}
            />
          </section>

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
