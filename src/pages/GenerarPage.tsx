import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { ExcelImport } from '../components/common/ExcelImport'
import { downloadEventPdf } from '../utils/ticketsPdf'
import { TicketQrModal } from '../components/common/TicketQrModal'
import { BulkCreatedModal } from '../components/common/BulkCreatedModal'
import { Table, type Column } from '../components/ui/Table'
import type { Event, NewTicket, Ticket } from '../types/ticket'

const PAGE_SIZE = 10

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Encabezado numerado de cada paso */
function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-bold">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-on-primary">
        {n}
      </span>
      {children}
    </h2>
  )
}

export function GenerarPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [mode, setMode] = useState<'individual' | 'excel'>('individual')
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null)
  /** true si el QR abierto se acaba de generar (muestra el aviso de éxito) */
  const [justCreated, setJustCreated] = useState(false)
  /** Cantidad generada desde Excel (abre el modal de éxito) */
  const [bulkCreated, setBulkCreated] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [page, setPage] = useState(0)

  const loadData = useCallback(async () => {
    const [eventsRes, ticketsRes] = await Promise.all([
      supabase.from('events').select('*').order('sort_order').returns<Event[]>(),
      supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .returns<Ticket[]>(),
    ])
    const err = eventsRes.error ?? ticketsRes.error
    if (err) setError(err.message)
    if (eventsRes.data) {
      setEvents(eventsRes.data)
      // Por defecto, el evento activo (si todavía no se eligió otro)
      const active = eventsRes.data.find((e) => e.is_active)
      if (active) setEventId((prev) => prev || active.id)
    }
    if (ticketsRes.data) setTickets(ticketsRes.data)
    setListLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde Supabase
    void loadData()
  }, [loadData])

  const eventName = (id: string) => events.find((e) => e.id === id)?.name ?? id

  const changeEvent = (id: string) => {
    setEventId(id)
    setSelected(null)
    setPage(0)
  }

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!eventId) return
    setError(null)
    setCreating(true)
    const newTicket: NewTicket = { name: name.trim() || null, event_id: eventId }
    const { data, error } = await supabase
      .from('tickets')
      .insert(newTicket)
      .select()
      .single<Ticket>()
    setCreating(false)
    if (error) {
      setError(error.message)
      return
    }
    setSelected(data)
    setJustCreated(true)
    setName('')
    setPage(0)
    setTickets((prev) => [data, ...prev])
  }

  const handleDownloadPdf = async () => {
    setError(null)
    setPdfProgress({ done: 0, total: visibleTickets.length })
    try {
      await downloadEventPdf(visibleTickets, eventName(eventId), (done, total) =>
        setPdfProgress({ done, total }),
      )
    } catch (err) {
      setError(`No se pudo generar el PDF: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPdfProgress(null)
    }
  }

  const handleBulkCreated = (created: Ticket[]) => {
    setSelected(null)
    setPage(0)
    setTickets((prev) => [...created, ...prev])
    setBulkCreated(created.length)
  }

  // Tickets del evento elegido
  const visibleTickets = eventId ? tickets.filter((t) => t.event_id === eventId) : []
  const existingNames = new Set(
    visibleTickets.flatMap((t) => (t.name ? [t.name.toLocaleLowerCase('es')] : [])),
  )
  const usedCount = visibleTickets.filter((t) => t.used_at).length

  // Paginado en memoria (los tickets del evento ya están cargados)
  const pageCount = Math.max(1, Math.ceil(visibleTickets.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1) // por si se borró el último de la página
  const pageRows = visibleTickets.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

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
    {
      key: 'actions',
      header: <span className="sr-only">Acciones</span>,
      className: 'w-px text-right',
      render: (t) => (
        <button
          type="button"
          onClick={() => {
            setJustCreated(false)
            setSelected(t)
          }}
          className="whitespace-nowrap rounded-lg bg-surface-strong px-3 py-2 text-xs font-semibold hover:bg-surface-hover"
        >
          Ver QR
        </button>
      ),
    },
  ]

  return (
    <div className="mx-auto w-full max-w-md space-y-6 p-4">
      {/* Encabezado + evento (aplica a generar y a descargar) */}
      <section className="space-y-4 rounded-2xl bg-surface p-4">
        <div>
          <h1 className="text-xl font-bold">Generar y descargar QR</h1>
          <p className="text-sm text-muted">Elige el evento con el que vas a trabajar.</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">Evento</span>
          <select
            required
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
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
            {error}
          </p>
        )}
      </section>

      {!eventId ? (
        <p className="text-center text-muted">
          {listLoading ? 'Cargando…' : 'Elige un evento para generar o descargar sus QR.'}
        </p>
      ) : (
        <>
          {/* 1 · Generar */}
          <section className="space-y-4 rounded-2xl bg-surface p-4">
            <StepTitle n={1}>Generar</StepTitle>

            <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-background p-1">
              {(
                [
                  ['individual', 'Individual'],
                  ['excel', 'Desde Excel'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className={`rounded-md py-2 text-sm font-semibold ${
                    mode === value
                      ? 'bg-primary text-on-primary'
                      : 'text-foreground-soft hover:bg-surface-strong'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'individual' ? (
              <form onSubmit={handleCreate} className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-foreground-soft">
                    Nombre del asistente (opcional)
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    className="w-full rounded-lg border border-line bg-background px-3 py-3 text-base text-foreground outline-none focus:border-primary"
                  />
                </label>
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full rounded-lg bg-primary py-3 text-base font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                >
                  {creating ? 'Generando…' : 'Generar QR'}
                </button>
              </form>
            ) : (
              <ExcelImport
                key={eventId}
                eventId={eventId}
                eventName={eventName(eventId)}
                existingNames={existingNames}
                onCreated={handleBulkCreated}
              />
            )}
          </section>

          {/* 2 · Descargar */}
          <section className="space-y-4 rounded-2xl bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <StepTitle n={2}>Descargar</StepTitle>
              <span className="shrink-0 text-sm text-muted">
                {usedCount} escaneados / {visibleTickets.length}
              </span>
            </div>

            {visibleTickets.length > 0 && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={pdfProgress !== null}
                  className="w-full rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                >
                  {pdfProgress
                    ? `Generando PDF… ${pdfProgress.done}/${pdfProgress.total}`
                    : `Descargar PDF · ${visibleTickets.length} QR`}
                </button>
                <p className="text-center text-xs text-muted">
                  Un QR por página con el nombre debajo, en orden alfabético. Para uno solo, usa “Ver QR”.
                </p>
              </div>
            )}

            <Table
              columns={columns}
              rows={pageRows}
              getRowKey={(t) => t.id}
              loading={listLoading}
              emptyMessage="Este evento todavía no tiene QR. Genéralos en el paso 1."
              pagination={{
                page: currentPage,
                pageSize: PAGE_SIZE,
                total: visibleTickets.length,
                onPageChange: setPage,
              }}
            />
          </section>
        </>
      )}

      {/* Ver QR (o QR recién generado) */}
      {selected && (
        <TicketQrModal
          ticket={selected}
          eventName={eventName(selected.event_id)}
          onClose={() => setSelected(null)}
          successMessage={justCreated ? 'QR generado satisfactoriamente' : undefined}
        />
      )}

      {/* Resultado de generar desde Excel */}
      {bulkCreated !== null && eventId && (
        <BulkCreatedModal
          count={bulkCreated}
          eventName={eventName(eventId)}
          eventTotal={visibleTickets.length}
          pdfProgress={pdfProgress}
          onDownloadPdf={handleDownloadPdf}
          onClose={() => setBulkCreated(null)}
        />
      )}
    </div>
  )
}
