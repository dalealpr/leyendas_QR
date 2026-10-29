import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Table, type Column } from '../components/ui/Table'
import { SearchInput } from '../components/ui/SearchInput'
import { Modal } from '../components/ui/Modal'
import { filterTickets } from '../utils/search'
import { countClass } from '../utils/filterChip'
import {
  YEARS_OPTIONS,
  ticketYears,
  type Event,
  type LeyendaYears,
  type SetTicketYearsResult,
  type Ticket,
  type WithYears,
} from '../types/ticket'

const PAGE_SIZE = 25

type YearsRow = Pick<Ticket, 'id' | 'name' | 'code'> & WithYears

/** Estado del guardado de cada fila */
type SaveState = 'saving' | 'saved' | 'error'

/** Filtro de la tabla: todas, sin años o unos años en particular */
type YearsFilter = 'all' | 'missing' | LeyendaYears

const matchesFilter = (row: YearsRow, filter: YearsFilter) =>
  filter === 'all' || (filter === 'missing' ? !ticketYears(row) : ticketYears(row) === filter)

/**
 * Asignar los años de cada leyenda (solo admin).
 * Los años van en una tabla aparte (ticket_years): los QR no se modifican.
 */
export function AniosPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [rows, setRows] = useState<YearsRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [yearsFilter, setYearsFilter] = useState<YearsFilter>('all')
  const [page, setPage] = useState(0)
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  // Cambio de años pendiente de confirmar (solo si la leyenda ya tenía años)
  const [confirm, setConfirm] = useState<{ row: YearsRow; years: LeyendaYears | null } | null>(null)

  const eventName = (id: string) => events.find((e) => e.id === id)?.name ?? id

  const changeEvent = async (id: string) => {
    setEventId(id)
    setRows([])
    setPage(0)
    setSearch('')
    setSaveState({})
    setError(null)
    setLoading(true)
    const { data, error } = await supabase
      .from('tickets')
      .select('id, name, code, ticket_years(years)')
      .eq('event_id', id)
      .order('name')
      .returns<YearsRow[]>()
    setLoading(false)
    if (error) setError(error.message)
    else setRows(data)
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
          if (active) void changeEvent(active.id)
        }
      })
  }, [])

  const changeYears = async (row: YearsRow, years: LeyendaYears | null) => {
    setSaveState((prev) => ({ ...prev, [row.id]: 'saving' }))
    const { data, error } = await supabase.rpc('set_ticket_years', { p_ticket_id: row.id, p_years: years })
    const ok = !error && (data as SetTicketYearsResult).ok
    setSaveState((prev) => ({ ...prev, [row.id]: ok ? 'saved' : 'error' }))
    if (!ok) {
      setError(error?.message ?? 'No se pudieron guardar los años.')
      return
    }
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, ticket_years: years ? { years } : null } : r)),
    )
  }

  /** Primera vez: se guarda directo. Si ya tenía años: se pide confirmar. */
  const requestYears = (row: YearsRow, years: LeyendaYears | null) => {
    if (ticketYears(row)) setConfirm({ row, years })
    else void changeYears(row, years)
  }

  const missingCount = rows.filter((r) => !ticketYears(r)).length
  const filtered = filterTickets(
    rows.filter((r) => matchesFilter(r, yearsFilter)),
    search,
  )
  const filterOptions: { value: YearsFilter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'missing', label: 'Sin años' },
    ...YEARS_OPTIONS.map((y) => ({ value: y, label: `${y} años` })),
  ]
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  const columns: Column<YearsRow>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (r) => <span className={r.name ? 'font-medium' : 'italic text-muted'}>{r.name || 'Sin nombre'}</span>,
    },
    {
      key: 'years',
      header: 'Años',
      className: 'w-px whitespace-nowrap',
      render: (r) => {
        const state = saveState[r.id]
        return (
          <div className="flex items-center gap-2">
            <select
              value={ticketYears(r) ?? ''}
              onChange={(e) => requestYears(r, e.target.value ? (Number(e.target.value) as LeyendaYears) : null)}
              disabled={state === 'saving'}
              aria-label={`Años de ${r.name || 'sin nombre'}`}
              className={`rounded-lg border bg-background px-2 py-2 text-base font-semibold outline-none focus:border-primary disabled:opacity-50 ${
                ticketYears(r) ? 'border-line text-foreground' : 'border-warning/60 text-muted'
              }`}
            >
              <option value="">—</option>
              {YEARS_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y} años
                </option>
              ))}
            </select>
            <span className="w-4 text-sm" aria-live="polite">
              {state === 'saving' && <span className="text-muted">…</span>}
              {state === 'saved' && <span className="text-success">✓</span>}
              {state === 'error' && <span className="text-danger-soft">✕</span>}
            </span>
          </div>
        )
      },
    },
  ]

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
      <section className="space-y-4 rounded-2xl bg-surface p-4">
        <div>
          <h1 className="text-xl font-bold">Años de las leyendas</h1>
          <p className="text-sm text-muted">
            Elige los años de cada leyenda; se guardan al instante. Los QR no se modifican.
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">Evento</span>
          <select
            value={eventId}
            onChange={(e) => void changeEvent(e.target.value)}
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
        {error && (
          <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
            {error}
          </p>
        )}
      </section>

      {!eventId ? (
        <p className="text-center text-muted">Elige un evento para asignar los años.</p>
      ) : (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-lg font-bold">Leyendas · {eventName(eventId)}</h2>
            <span className="shrink-0 text-sm text-muted">
              {!loading &&
                (missingCount > 0 ? (
                  <>
                    <strong className="text-warning">{missingCount}</strong> sin años / {rows.length}
                  </>
                ) : (
                  <span className="text-success">✓ Todas con años</span>
                ))}
            </span>
          </div>

          {rows.length > 0 && (
            <>
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v)
                  setPage(0)
                }}
                resultCount={filtered.length}
              />
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por años">
                {filterOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      setYearsFilter(o.value)
                      setPage(0)
                    }}
                    aria-pressed={yearsFilter === o.value}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                      yearsFilter === o.value
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-line bg-surface text-foreground-soft hover:bg-surface-strong'
                    }`}
                  >
                    {o.label}{' '}
                    <span className={countClass(yearsFilter === o.value)}>
                      {rows.filter((r) => matchesFilter(r, o.value)).length}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <Table
            columns={columns}
            rows={pageRows}
            getRowKey={(r) => r.id}
            loading={loading}
            emptyMessage={
              search.trim()
                ? `Ningún nombre coincide con “${search.trim()}”.`
                : yearsFilter === 'missing'
                  ? 'Todas las leyendas tienen años.'
                  : yearsFilter === 'all'
                    ? 'Este evento no tiene QR.'
                    : `Ninguna leyenda tiene ${yearsFilter} años.`
            }
            pagination={{ page: currentPage, pageSize: PAGE_SIZE, total: filtered.length, onPageChange: setPage }}
          />
        </section>
      )}

      {/* Confirmar cambio de años */}
      {confirm && (
        <Modal
          title="¿Cambiar los años?"
          description={<strong className="text-foreground">{confirm.row.name || 'Sin nombre'}</strong>}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="flex-1 rounded-lg bg-surface-strong py-3 font-semibold hover:bg-surface-hover"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  void changeYears(confirm.row, confirm.years)
                  setConfirm(null)
                }}
                className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover"
              >
                Aceptar
              </button>
            </>
          }
        >
          <p className="flex items-center justify-center gap-3 rounded-lg bg-background px-3 py-4 text-lg font-bold">
            <span className="text-muted line-through">{ticketYears(confirm.row)} años</span>
            <span aria-hidden="true">→</span>
            <span className={confirm.years ? 'text-primary' : 'text-muted'}>
              {confirm.years ? `${confirm.years} años` : 'Sin años'}
            </span>
          </p>
        </Modal>
      )}
    </div>
  )
}
