import { useEffect, useState, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Table, type Column } from '../components/ui/Table'
import { SearchInput } from '../components/ui/SearchInput'
import { normalize } from '../utils/search'
import { PAGE_WIDTH } from '../utils/layout'
import { countClass } from '../utils/filterChip'
import {
  YEARS_OPTIONS,
  type Event,
  type LeyendaYears,
  type Ticket,
  type WithAward,
  type WithAwardOrder,
  type WithYears,
} from '../types/ticket'

/** Leyenda con QR, tal como llega de Supabase */
type TicketAwardRow = Pick<Ticket, 'id' | 'name' | 'code' | 'used_at'> & WithYears & WithAward & WithAwardOrder

/** Leyenda de una lista (sin QR), tal como llega de Supabase (ver supabase/19_extra_lists.sql) */
interface ExtraAwardRow {
  id: string
  name: string
  years: LeyendaYears | null
  entered_at: string | null
  delivered_at: string | null
  award_position: number | null
  extra_groups: { name: string }
}

/**
 * Fila de Premiación: misma forma para leyendas con QR y leyendas de listas,
 * así se ordenan y se entregan juntas dentro de su grupo de años.
 */
interface AwardRow {
  kind: 'ticket' | 'extra'
  id: string
  name: string | null
  /** Código del QR (para buscar por él); null en las de listas */
  code: string | null
  years: LeyendaYears | null
  /** Ya entró al evento (QR escaneado o ingreso marcado a mano) */
  present: boolean
  deliveredAt: string | null
  position: number | null
  /** Nombre de la lista, si viene de una */
  listName: string | null
}

const rowKey = (r: AwardRow) => `${r.kind}:${r.id}`

/** Grupos de la tabla, en orden de llamado: 10 → 45 años y al final los que no tienen años */
const GROUPS: (LeyendaYears | null)[] = [...YEARS_OPTIONS, null]

/** Identificador de un grupo para recordar si está desplegado */
const groupKey = (years: LeyendaYears | null) => (years === null ? 'sin' : String(years))

/** Dentro de su grupo: por la posición definida en modo Ordenar; sin posición, al final y por nombre */
function byCallOrder(a: AwardRow, b: AwardRow): number {
  const pa = a.position ?? Number.POSITIVE_INFINITY
  const pb = b.position ?? Number.POSITIVE_INFINITY
  if (pa !== pb) return pa - pb
  return (a.name ?? '').localeCompare(b.name ?? '', 'es')
}

/** Filtro por entrega del reconocimiento */
type AwardFilter = 'all' | 'delivered' | 'pending'

const awardOptions: { value: AwardFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'delivered', label: 'Entregado' },
  { value: 'pending', label: 'Sin entregar' },
]

const matchesAward = (row: AwardRow, filter: AwardFilter) =>
  filter === 'all' || (filter === 'delivered') === Boolean(row.deliveredAt)

/** Filtro por presencia: si la leyenda ya entró al evento */
type PresenceFilter = 'all' | 'present' | 'absent'

const presenceOptions: { value: PresenceFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'present', label: 'Escaneadas (presentes)' },
  { value: 'absent', label: 'Sin escanear (ausentes)' },
]

const matchesPresence = (row: AwardRow, filter: PresenceFilter) =>
  filter === 'all' || (filter === 'present') === row.present

/** Buscador: por nombre (sin tildes) o por el inicio del código del QR */
function matchesSearch(row: AwardRow, search: string): boolean {
  const query = normalize(search)
  if (!query) return true
  return normalize(row.name ?? 'sin nombre').includes(query) || Boolean(row.code?.startsWith(query))
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

/** Campo de posición del modo Ordenar: se aplica al salir del campo o con Enter */
function PositionInput({
  position,
  max,
  disabled,
  label,
  onCommit,
}: {
  position: number
  max: number
  disabled: boolean
  label: string
  onCommit: (position: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const n = Math.round(Number(draft))
    setDraft(null)
    if (Number.isFinite(n) && n !== position) onCommit(Math.min(Math.max(n, 1), max))
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      value={draft ?? position}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="w-14 rounded-lg border border-line bg-background px-2 py-1.5 text-center text-base font-bold tabular-nums outline-none focus:border-primary disabled:opacity-50"
    />
  )
}

/**
 * Premiación (solo admin): marcar a qué leyendas ya se les entregó el reconocimiento (trofeo + kit).
 * Incluye las leyendas con QR y las leyendas de listas (sin QR).
 * Un interruptor por fila, sin modales, para que la entrega sea rápida.
 * Agrupada por años (10 → 45); dentro de cada grupo, en el orden de llamado del modo Ordenar.
 * La entrega y el orden van en tablas aparte: los QR no se modifican.
 */
export function PremiacionPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [rows, setRows] = useState<AwardRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [awardFilter, setAwardFilter] = useState<AwardFilter>('all')
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all')
  // Filas que se están guardando (el interruptor queda bloqueado mientras tanto)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  // Modo Ordenar: muestra flechas y el campo de posición
  const [ordering, setOrdering] = useState(false)
  // Grupo de años cuyo orden se está guardando
  const [savingGroup, setSavingGroup] = useState<LeyendaYears | null | undefined>(undefined)
  // Grupos de años desplegados (empiezan todos cerrados)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const eventName = (id: string) => events.find((e) => e.id === id)?.name ?? id

  /** Leyendas con QR + leyendas de listas del evento, en una sola lista */
  const loadRows = async (id: string) => {
    const [ticketsRes, extrasRes] = await Promise.all([
      supabase
        .from('tickets')
        .select('id, name, code, used_at, ticket_years(years), ticket_awards(delivered_at), ticket_award_order(position)')
        .eq('event_id', id)
        .order('name')
        .returns<TicketAwardRow[]>(),
      supabase
        .from('extra_people')
        .select('id, name, years, entered_at, delivered_at, award_position, extra_groups!inner(name, event_id)')
        .eq('extra_groups.event_id', id)
        .eq('is_leyenda', true)
        .order('name')
        .returns<ExtraAwardRow[]>(),
    ])
    const err = ticketsRes.error ?? extrasRes.error
    if (err) {
      setError(err.message)
      return
    }
    setRows([
      ...(ticketsRes.data ?? []).map(
        (t): AwardRow => ({
          kind: 'ticket',
          id: t.id,
          name: t.name,
          code: t.code,
          years: t.ticket_years?.years ?? null,
          present: Boolean(t.used_at),
          deliveredAt: t.ticket_awards?.delivered_at ?? null,
          position: t.ticket_award_order?.position ?? null,
          listName: null,
        }),
      ),
      ...(extrasRes.data ?? []).map(
        (p): AwardRow => ({
          kind: 'extra',
          id: p.id,
          name: p.name,
          code: null,
          years: p.years,
          present: Boolean(p.entered_at),
          deliveredAt: p.delivered_at,
          position: p.award_position,
          listName: p.extra_groups.name,
        }),
      ),
    ])
  }

  const changeEvent = async (id: string) => {
    setEventId(id)
    setRows([])
    setSearch('')
    setError(null)
    setLoading(true)
    await loadRows(id)
    setLoading(false)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al entrar
  }, [])

  const setRowDelivered = (key: string, deliveredAt: string | null) =>
    setRows((prev) => prev.map((r) => (rowKey(r) === key ? { ...r, deliveredAt } : r)))

  /** Cambia al instante en pantalla y se guarda; si falla, vuelve atrás */
  const toggleAward = async (row: AwardRow) => {
    const key = rowKey(row)
    const previous = row.deliveredAt
    const delivered = !previous
    setError(null)
    setRowDelivered(key, delivered ? new Date().toISOString() : null)
    setSaving((prev) => new Set(prev).add(key))

    const { data, error } =
      row.kind === 'ticket'
        ? await supabase.rpc('set_ticket_award', { p_ticket_id: row.id, p_delivered: delivered })
        : await supabase.rpc('set_extra_person_award', { p_person_id: row.id, p_delivered: delivered })

    setSaving((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    const result = data as { ok: true; delivered_at: string | null } | { ok: false } | null
    if (error || !result?.ok) {
      setRowDelivered(key, previous)
      setError(error?.message ?? `No se pudo guardar la entrega de ${row.name || 'sin nombre'}.`)
      return
    }
    setRowDelivered(key, result.delivered_at)
  }

  const resetFilters = () => {
    setAwardFilter('all')
    setPresenceFilter('all')
    setSearch('')
  }

  // Grupo completo (sin filtros), en orden de llamado: de aquí sale el número de cada leyenda
  const fullGroup = (years: LeyendaYears | null) => rows.filter((r) => r.years === years).sort(byCallOrder)

  /** Mueve una leyenda a otra posición dentro de su grupo de años y guarda el orden del grupo */
  const moveTo = async (row: AwardRow, newIndex: number) => {
    const group = fullGroup(row.years)
    const from = group.findIndex((r) => rowKey(r) === rowKey(row))
    const to = Math.min(Math.max(newIndex, 0), group.length - 1)
    if (from === -1 || from === to) return

    const reordered = [...group]
    reordered.splice(from, 1)
    reordered.splice(to, 0, row)

    // Al instante en pantalla: posiciones 1, 2, 3… para todo el grupo
    const positions = new Map(reordered.map((r, i) => [rowKey(r), i + 1]))
    setRows((prev) => prev.map((r) => (positions.has(rowKey(r)) ? { ...r, position: positions.get(rowKey(r))! } : r)))

    // Se guardan juntas las de QR y las de listas
    const tickets = reordered.flatMap((r, i) => (r.kind === 'ticket' ? [{ id: r.id, pos: i + 1 }] : []))
    const extras = reordered.flatMap((r, i) => (r.kind === 'extra' ? [{ id: r.id, pos: i + 1 }] : []))

    setError(null)
    setSavingGroup(row.years)
    const { data, error } = await supabase.rpc('set_award_order_mixed', {
      p_ticket_ids: tickets.map((t) => t.id),
      p_ticket_positions: tickets.map((t) => t.pos),
      p_person_ids: extras.map((e) => e.id),
      p_person_positions: extras.map((e) => e.pos),
    })
    setSavingGroup(undefined)
    if (error || !(data as { ok: boolean } | null)?.ok) {
      setError(error?.message ?? 'No se pudo guardar el orden. Se recargó la lista.')
      void loadRows(eventId)
    }
  }

  const deliveredCount = rows.filter((r) => r.deliveredAt).length
  const percent = rows.length > 0 ? Math.round((deliveredCount / rows.length) * 100) : 0
  const hasFilters = awardFilter !== 'all' || presenceFilter !== 'all' || search.trim() !== ''

  // Tabla agrupada por años; cada grupo muestra solo las filas que pasan los filtros
  const groups = GROUPS.map((years) => {
    const all = fullGroup(years)
    const visible = all.filter(
      (r) => matchesAward(r, awardFilter) && matchesPresence(r, presenceFilter) && matchesSearch(r, search),
    )
    return { years, all, visible }
  }).filter((g) => g.visible.length > 0)
  const visibleCount = groups.reduce((sum, g) => sum + g.visible.length, 0)

  // Número de llamado de cada leyenda dentro de su grupo (1, 2, 3…)
  const callNumber = new Map<string, { index: number; size: number }>()
  for (const years of GROUPS) {
    const all = fullGroup(years)
    all.forEach((r, index) => callNumber.set(rowKey(r), { index, size: all.length }))
  }

  const columns: Column<AwardRow>[] = [
    {
      key: 'order',
      header: '#',
      className: 'w-px whitespace-nowrap',
      render: (r) => {
        const { index, size } = callNumber.get(rowKey(r)) ?? { index: 0, size: 1 }
        if (!ordering) {
          return <span className="text-lg font-bold tabular-nums text-muted">{index + 1}</span>
        }
        const busy = savingGroup !== undefined
        const arrowClass =
          'rounded-lg border border-line px-2 py-1 text-base font-bold leading-none hover:bg-surface-strong disabled:opacity-30'
        return (
          <div className="flex items-center gap-1">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void moveTo(r, index - 1)}
                disabled={busy || index === 0}
                aria-label={`Subir a ${r.name || 'sin nombre'}`}
                className={arrowClass}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => void moveTo(r, index + 1)}
                disabled={busy || index === size - 1}
                aria-label={`Bajar a ${r.name || 'sin nombre'}`}
                className={arrowClass}
              >
                ↓
              </button>
            </div>
            <PositionInput
              // key: si la posición cambia desde afuera, el campo se reinicia
              key={index}
              position={index + 1}
              max={size}
              disabled={busy}
              label={`Posición de ${r.name || 'sin nombre'}`}
              onCommit={(position) => void moveTo(r, position - 1)}
            />
          </div>
        )
      },
    },
    {
      key: 'name',
      header: 'Nombre',
      render: (r) => (
        <div className="min-w-0">
          <p className={r.name ? 'font-medium' : 'italic text-muted'}>
            {r.name || 'Sin nombre'}
            {/* Leyenda de una lista (sin QR) */}
            {r.listName && (
              <span className="ml-2 rounded-full bg-surface-strong px-2 py-0.5 text-xs font-semibold text-foreground-soft">
                Lista · {r.listName}
              </span>
            )}
          </p>
          {/* Si la leyenda ya entró al evento */}
          <p className={`text-xs ${r.present ? 'text-success' : 'font-semibold text-warning'}`}>
            {r.present ? 'Presente' : 'Ausente'}
          </p>
        </div>
      ),
    },
    {
      key: 'years',
      header: 'Años',
      className: 'whitespace-nowrap',
      render: (r) =>
        r.years ? (
          <span className="font-semibold tabular-nums">{r.years} años</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'award',
      header: 'Reconocimiento',
      className: 'w-px whitespace-nowrap',
      render: (r) => {
        const delivered = Boolean(r.deliveredAt)
        return (
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={delivered}
              aria-label={`Reconocimiento entregado a ${r.name || 'sin nombre'}`}
              onClick={() => void toggleAward(r)}
              disabled={saving.has(rowKey(r))}
              className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                delivered ? 'bg-success' : 'bg-surface-hover'
              }`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  delivered ? 'left-7' : 'left-1'
                }`}
              />
            </button>
            <span className={`w-20 text-xs font-semibold ${delivered ? 'text-success' : 'text-muted'}`}>
              {r.deliveredAt ? `Entregado ${formatTime(r.deliveredAt)}` : 'Sin entregar'}
            </span>
          </div>
        )
      },
    },
  ]

  const chipClass = (selected: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm font-semibold ${
      selected
        ? 'border-primary bg-primary text-on-primary'
        : 'border-line bg-surface text-foreground-soft hover:bg-surface-strong'
    }`

  return (
    <div className={`${PAGE_WIDTH} space-y-6 py-4`}>
      <section className="space-y-4 rounded-2xl bg-surface p-4">
        <div>
          {/* En web el título va en la barra superior */}
          <h1 className="text-xl font-bold md:hidden">Premiación</h1>
          <p className="text-sm text-muted">
            Toca el interruptor para marcar el reconocimiento (trofeo y kit) como entregado. Se guarda al
            instante.
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

        {/* Avance de la premiación */}
        {eventId && !loading && rows.length > 0 && (
          <div>
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-foreground-soft">Reconocimientos entregados</span>
              <span className="tabular-nums">
                <strong className="text-2xl text-success">{deliveredCount}</strong>
                <span className="text-muted"> / {rows.length}</span>
              </span>
            </p>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-background">
              <div
                className="h-full rounded-full bg-success transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 text-center text-base font-semibold text-muted">{percent}% entregado</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
            {error}
          </p>
        )}
      </section>

      {!eventId ? (
        <p className="text-center text-muted">Elige un evento para la premiación.</p>
      ) : (
        <section className="space-y-3">
          {rows.length > 0 && (
            <SearchInput value={search} onChange={setSearch} resultCount={visibleCount} />
          )}

          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-foreground-soft">
              Leyendas · {eventName(eventId)}
            </h2>
            <div className="flex shrink-0 gap-2">
              {hasFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-foreground-soft hover:bg-surface-strong"
                >
                  <span aria-hidden="true">✕</span> Limpiar filtros
                </button>
              )}
              {/* Modo Ordenar: definir el orden de llamado dentro de cada grupo de años */}
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOrdering((v) => !v)}
                  aria-pressed={ordering}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    ordering
                      ? 'bg-primary text-on-primary hover:bg-primary-hover'
                      : 'border border-primary text-primary hover:bg-primary/15'
                  }`}
                >
                  {ordering ? '✓ Listo' : '↕ Ordenar'}
                </button>
              )}
            </div>
          </div>

          {ordering && (
            <p className="rounded-lg bg-primary/15 px-3 py-2 text-sm text-foreground-soft">
              Usa las flechas ↑↓ o escribe la posición para ordenar a cada leyenda{' '}
              <strong className="text-foreground">dentro de su grupo de años</strong>. Se guarda al instante.
            </p>
          )}

          {/* Filtros por entrega (los años ya separan la tabla en grupos) */}
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por entrega">
              {awardOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setAwardFilter(o.value)}
                  aria-pressed={awardFilter === o.value}
                  className={chipClass(awardFilter === o.value)}
                >
                  {o.label}{' '}
                  <span className={countClass(awardFilter === o.value)}>
                    {rows.filter((r) => matchesAward(r, o.value)).length}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Filtros por presencia (ya entraron al evento o no) */}
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por presencia">
              {presenceOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setPresenceFilter(o.value)}
                  aria-pressed={presenceFilter === o.value}
                  className={chipClass(presenceFilter === o.value)}
                >
                  {o.label}{' '}
                  <span className={countClass(presenceFilter === o.value)}>
                    {rows.filter((r) => matchesPresence(r, o.value)).length}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Una tabla por grupo de años, en orden de llamado */}
          {loading || groups.length === 0 ? (
            <Table
              columns={columns}
              rows={[]}
              getRowKey={rowKey}
              loading={loading}
              emptyMessage={
                search.trim()
                  ? `Ningún nombre coincide con “${search.trim()}”.`
                  : hasFilters
                    ? 'No hay leyendas con estos filtros.'
                    : 'Este evento no tiene leyendas.'
              }
            />
          ) : (
            <>
              {/* Abrir / cerrar todos los grupos de una vez */}
              <div className="flex justify-end gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setOpenGroups(new Set(groups.map((g) => groupKey(g.years))))}
                  className="rounded-lg px-2 py-1 font-semibold text-foreground-soft hover:bg-surface-strong"
                >
                  Abrir todos
                </button>
                <button
                  type="button"
                  onClick={() => setOpenGroups(new Set())}
                  className="rounded-lg px-2 py-1 font-semibold text-foreground-soft hover:bg-surface-strong"
                >
                  Cerrar todos
                </button>
              </div>

              {groups.map((g) => {
                const key = groupKey(g.years)
                // Con una búsqueda escrita se abren solos, para ver dónde está el resultado
                const open = openGroups.has(key) || search.trim() !== ''
                const delivered = g.all.filter((r) => r.deliveredAt).length
                return (
                  <div key={key} className="overflow-hidden rounded-2xl border border-line">
                    <button
                      type="button"
                      onClick={() => toggleGroup(key)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 bg-surface px-4 py-3 text-left hover:bg-surface-strong"
                    >
                      {/* Ícono dibujado (no el carácter ▶, que algunos teléfonos muestran como emoji azul) */}
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`h-5 w-5 shrink-0 text-primary transition-transform ${open ? 'rotate-90' : ''}`}
                        aria-hidden="true"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                      <span className="text-base font-bold uppercase tracking-wide text-primary">
                        {g.years ? `${g.years} años` : 'Sin años'}
                      </span>
                      <span className="text-sm text-muted">
                        {g.visible.length === g.all.length
                          ? `${g.all.length} leyendas`
                          : `${g.visible.length} de ${g.all.length}`}
                      </span>
                      {savingGroup === g.years && <span className="text-xs text-muted">Guardando…</span>}
                      {/* Avance del grupo */}
                      <span
                        className={`ml-auto shrink-0 text-sm font-semibold tabular-nums ${
                          delivered === g.all.length ? 'text-success' : 'text-foreground-soft'
                        }`}
                      >
                        {delivered === g.all.length ? '✓ ' : ''}
                        {delivered}/{g.all.length} entregados
                      </span>
                    </button>
                    {open && <Table columns={columns} rows={g.visible} getRowKey={rowKey} />}
                  </div>
                )
              })}
            </>
          )}
        </section>
      )}
    </div>
  )
}
