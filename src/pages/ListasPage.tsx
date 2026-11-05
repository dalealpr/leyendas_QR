import { useEffect, useState, type FormEvent } from 'react'
import { LuPencil, LuPlus, LuTrash2, LuUserPlus } from 'react-icons/lu'
import { supabase } from '../lib/supabase'
import { Table, type Column } from '../components/ui/Table'
import { Modal } from '../components/ui/Modal'
import { PasswordConfirmDialog } from '../components/common/PasswordConfirmDialog'
import { PAGE_WIDTH } from '../utils/layout'
import { YEARS_OPTIONS, type Event, type LeyendaYears } from '../types/ticket'
import { extraErrors, type ExtraGroup, type ExtraPerson, type ExtraResult } from '../types/extraLists'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const inputClass =
  'w-full rounded-lg border border-line bg-background px-3 py-2.5 text-base text-foreground outline-none focus:border-primary'

/** Acción pendiente de confirmar */
type Pending =
  | { type: 'renameGroup'; group: ExtraGroup }
  | { type: 'deleteGroup'; group: ExtraGroup }
  | { type: 'editPerson'; person: ExtraPerson }
  | { type: 'deletePerson'; person: ExtraPerson }

/**
 * Listas (solo admin): personas sin QR agregadas a mano, agrupadas (ej. "Gerencia").
 * Persona normal → queda ingresada al agregarla.
 * Incluida como leyenda → su ingreso se marca a mano; cuenta como leyenda y aparece en Premiación.
 * Todo va en tablas aparte (extra_groups / extra_people): los QR no se modifican.
 */
export function ListasPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState('')
  const [groups, setGroups] = useState<ExtraGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  const eventName = (id: string) => events.find((e) => e.id === id)?.name ?? id

  const loadGroups = async (id: string) => {
    const { data, error } = await supabase
      .from('extra_groups')
      .select('id, event_id, name, sort_order, extra_people(*)')
      .eq('event_id', id)
      .order('sort_order')
      .order('created_at', { referencedTable: 'extra_people' })
      .returns<ExtraGroup[]>()
    if (error) setError(error.message)
    else setGroups(data)
  }

  const changeEvent = async (id: string) => {
    setEventId(id)
    setGroups([])
    setError(null)
    setNotice(null)
    setLoading(true)
    await loadGroups(id)
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

  /** Llama a una función de listas; si sale bien muestra el aviso y recarga */
  const run = async (fn: string, args: Record<string, unknown>, okMessage: string): Promise<string | null> => {
    setError(null)
    const { data, error } = await supabase.rpc(fn, args)
    if (error) return error.message
    const result = data as ExtraResult
    if (!result.ok) return extraErrors[result.reason]
    setNotice(okMessage)
    await loadGroups(eventId)
    return null
  }

  const createGroup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setCreating(true)
    const name = newGroupName.trim()
    const message = await run('create_extra_group', { p_event_id: eventId, p_name: name }, `Se creó la lista "${name}".`)
    setCreating(false)
    if (message) setError(message)
    else setNewGroupName('')
  }

  const toggleEntry = async (person: ExtraPerson) => {
    const message = await run(
      'set_extra_person_entry',
      { p_person_id: person.id, p_entered: !person.entered_at },
      `${person.name} quedó como ${person.entered_at ? 'pendiente' : 'ingresada'}.`,
    )
    if (message) setError(message)
  }

  const totalPeople = groups.reduce((sum, g) => sum + g.extra_people.length, 0)

  return (
    <div className={`${PAGE_WIDTH} space-y-6 py-4`}>
      <section className="space-y-4 rounded-2xl bg-surface p-4">
        <div>
          {/* En web el título va en la barra superior */}
          <h1 className="text-xl font-bold md:hidden">Listas</h1>
          <p className="text-sm text-muted">
            Personas sin QR que se registran a mano (ej. Gerencia). Suman al total de asistentes. Si se incluyen
            como leyenda, cuentan también como leyendas y su ingreso se marca a mano.
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

        {/* Nueva lista */}
        {eventId && (
          <form onSubmit={createGroup} className="flex gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              maxLength={80}
              placeholder="Nombre de la nueva lista (ej. Gerencia)"
              aria-label="Nombre de la nueva lista"
              className={inputClass}
            />
            <button
              type="submit"
              disabled={creating || !newGroupName.trim()}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
            >
              <LuPlus className="h-5 w-5" aria-hidden="true" />
              {creating ? 'Creando…' : 'Nueva lista'}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger-soft">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-success/15 px-3 py-2 text-sm text-success">
            ✓ {notice}
          </p>
        )}
      </section>

      {!eventId ? (
        <p className="text-center text-muted">Elige un evento para ver sus listas.</p>
      ) : loading ? (
        <p className="text-center text-muted">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="text-center text-muted">
          {eventName(eventId)} todavía no tiene listas. Crea la primera arriba.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {groups.length} {groups.length === 1 ? 'lista' : 'listas'} · {totalPeople}{' '}
            {totalPeople === 1 ? 'persona' : 'personas'}
          </p>
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              onAddPerson={(name, isLeyenda, years) =>
                run(
                  'add_extra_person',
                  { p_group_id: g.id, p_name: name, p_is_leyenda: isLeyenda, p_years: years },
                  `Se agregó a ${name} en ${g.name}.`,
                )
              }
              onToggleEntry={(p) => void toggleEntry(p)}
              onRename={() => setPending({ type: 'renameGroup', group: g })}
              onDelete={() => setPending({ type: 'deleteGroup', group: g })}
              onEditPerson={(p) => setPending({ type: 'editPerson', person: p })}
              onDeletePerson={(p) => setPending({ type: 'deletePerson', person: p })}
            />
          ))}
        </>
      )}

      {pending?.type === 'renameGroup' && (
        <RenameGroupDialog
          group={pending.group}
          onClose={() => setPending(null)}
          onSave={async (name) => {
            const message = await run(
              'rename_extra_group',
              { p_group_id: pending.group.id, p_name: name },
              `La lista ahora se llama "${name.trim()}".`,
            )
            if (!message) setPending(null)
            return message
          }}
        />
      )}

      {pending?.type === 'deleteGroup' && (
        <PasswordConfirmDialog
          title={`¿Eliminar la lista ${pending.group.name}?`}
          description={
            <>
              Se eliminarán también sus{' '}
              <strong className="text-foreground">{pending.group.extra_people.length} personas</strong>.
            </>
          }
          warning="Dejarán de contar en el total de asistentes del Contador."
          confirmLabel="Eliminar lista"
          busyLabel="Eliminando…"
          onClose={() => setPending(null)}
          onConfirm={async (password) => {
            const message = await run(
              'delete_extra_group',
              { p_group_id: pending.group.id, p_password: password },
              `Se eliminó la lista "${pending.group.name}".`,
            )
            if (!message) setPending(null)
            return message
          }}
        />
      )}

      {pending?.type === 'editPerson' && (
        <PersonDialog
          person={pending.person}
          onClose={() => setPending(null)}
          onSave={async (name, isLeyenda, years) => {
            const message = await run(
              'update_extra_person',
              { p_person_id: pending.person.id, p_name: name, p_is_leyenda: isLeyenda, p_years: years },
              `Se guardaron los cambios de ${name.trim()}.`,
            )
            if (!message) setPending(null)
            return message
          }}
        />
      )}

      {pending?.type === 'deletePerson' && (
        <ConfirmDialog
          title={`¿Quitar a ${pending.person.name}?`}
          text="Se elimina de la lista y deja de contar en el total de asistentes."
          confirmLabel="Quitar"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const message = await run(
              'delete_extra_person',
              { p_person_id: pending.person.id },
              `Se quitó a ${pending.person.name}.`,
            )
            if (!message) setPending(null)
            return message
          }}
        />
      )}
    </div>
  )
}

interface GroupCardProps {
  group: ExtraGroup
  /** Devuelve null si salió bien o el mensaje de error */
  onAddPerson: (name: string, isLeyenda: boolean, years: LeyendaYears | null) => Promise<string | null>
  onToggleEntry: (person: ExtraPerson) => void
  onRename: () => void
  onDelete: () => void
  onEditPerson: (person: ExtraPerson) => void
  onDeletePerson: (person: ExtraPerson) => void
}

/** Una lista: encabezado, formulario para agregar personas y su tabla */
function GroupCard({ group, onAddPerson, onToggleEntry, onRename, onDelete, onEditPerson, onDeletePerson }: GroupCardProps) {
  const [name, setName] = useState('')
  const [isLeyenda, setIsLeyenda] = useState(false)
  const [years, setYears] = useState<LeyendaYears | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const people = group.extra_people
  const entered = people.filter((p) => p.entered_at).length
  const leyendas = people.filter((p) => p.is_leyenda).length

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const message = await onAddPerson(name.trim(), isLeyenda, isLeyenda && years ? years : null)
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    // Listo para la siguiente persona (se mantiene "leyenda" por si se cargan varias seguidas)
    setName('')
  }

  const columns: Column<ExtraPerson>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (p) => <span className="font-medium">{p.name}</span>,
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
      className: 'whitespace-nowrap',
      // Tocar para marcar / desmarcar el ingreso (sobre todo para las leyendas)
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
              <span className="mt-1 text-xs text-muted">{formatTime(p.entered_at)}</span>
            </span>
          ) : (
            <span className="rounded-full bg-warning/15 px-2 py-1 text-xs font-semibold text-warning">
              Pendiente · marcar
            </span>
          )}
        </button>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Acciones</span>,
      className: 'w-px',
      render: (p) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => onEditPerson(p)}
            title="Editar"
            aria-label={`Editar a ${p.name}`}
            className="rounded-lg p-2 text-foreground-soft hover:bg-surface-strong hover:text-primary"
          >
            <LuPencil className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onDeletePerson(p)}
            title="Quitar"
            aria-label={`Quitar a ${p.name}`}
            className="rounded-lg p-2 text-danger-soft hover:bg-danger/15"
          >
            <LuTrash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <section className="space-y-3 rounded-2xl border border-line p-4">
      {/* Encabezado de la lista */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold text-primary">{group.name}</h2>
          <p className="text-sm text-muted">
            {people.length} {people.length === 1 ? 'persona' : 'personas'} · {entered} ingresadas
            {leyendas > 0 && ` · ${leyendas} ${leyendas === 1 ? 'leyenda' : 'leyendas'}`}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onRename}
            title="Renombrar lista"
            aria-label={`Renombrar la lista ${group.name}`}
            className="rounded-lg p-2 text-foreground-soft hover:bg-surface-strong hover:text-primary"
          >
            <LuPencil className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Eliminar lista"
            aria-label={`Eliminar la lista ${group.name}`}
            className="rounded-lg p-2 text-danger-soft hover:bg-danger/15"
          >
            <LuTrash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Agregar persona */}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface p-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Nombre de la persona"
          aria-label={`Nombre de la persona para ${group.name}`}
          className={`${inputClass} min-w-48 flex-1`}
        />
        <label className="flex items-center gap-2 text-sm font-medium text-foreground-soft">
          <input
            type="checkbox"
            checked={isLeyenda}
            onChange={(e) => setIsLeyenda(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-primary)]"
          />
          Incluir como leyenda
        </label>
        {isLeyenda && (
          <select
            value={years}
            onChange={(e) => setYears(e.target.value ? (Number(e.target.value) as LeyendaYears) : '')}
            aria-label="Años de la leyenda"
            className="rounded-lg border border-line bg-background px-3 py-2.5 text-base text-foreground outline-none focus:border-primary"
          >
            <option value="">Años…</option>
            {YEARS_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y} años
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
        >
          <LuUserPlus className="h-5 w-5" aria-hidden="true" />
          {busy ? 'Agregando…' : 'Agregar'}
        </button>
        {error && (
          <p role="alert" className="w-full text-sm text-danger-soft">
            {error}
          </p>
        )}
        {isLeyenda && (
          <p className="w-full text-xs text-muted">
            Las leyendas quedan <strong className="text-warning">pendientes</strong>: su ingreso se marca a mano.
          </p>
        )}
      </form>

      <Table columns={columns} rows={people} getRowKey={(p) => p.id} emptyMessage="Esta lista todavía no tiene personas." />
    </section>
  )
}

/** Renombrar una lista */
function RenameGroupDialog({
  group,
  onClose,
  onSave,
}: {
  group: ExtraGroup
  onClose: () => void
  onSave: (name: string) => Promise<string | null>
}) {
  const [name, setName] = useState(group.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setError(await onSave(name))
    setBusy(false)
  }

  return (
    <Modal
      title="Renombrar lista"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-lg bg-surface-strong py-3 font-semibold hover:bg-surface-hover disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="rename-group-form"
            disabled={busy || !name.trim()}
            className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="rename-group-form" onSubmit={submit} className="space-y-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoFocus
          aria-label="Nombre de la lista"
          className={inputClass}
        />
        {error && (
          <p role="alert" className="text-sm text-danger-soft">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

/** Editar una persona: nombre, ¿leyenda?, años */
function PersonDialog({
  person,
  onClose,
  onSave,
}: {
  person: ExtraPerson
  onClose: () => void
  onSave: (name: string, isLeyenda: boolean, years: LeyendaYears | null) => Promise<string | null>
}) {
  const [name, setName] = useState(person.name)
  const [isLeyenda, setIsLeyenda] = useState(person.is_leyenda)
  const [years, setYears] = useState<LeyendaYears | ''>(person.years ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setError(await onSave(name, isLeyenda, isLeyenda && years ? years : null))
    setBusy(false)
  }

  return (
    <Modal
      title="Editar persona"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-lg bg-surface-strong py-3 font-semibold hover:bg-surface-hover disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="person-form"
            disabled={busy || !name.trim()}
            className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="person-form" onSubmit={submit} className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-foreground-soft">Nombre</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2 font-medium text-foreground-soft">
          <input
            type="checkbox"
            checked={isLeyenda}
            onChange={(e) => setIsLeyenda(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-primary)]"
          />
          Incluir como leyenda
        </label>
        {isLeyenda && (
          <label className="block">
            <span className="mb-1 block font-medium text-foreground-soft">Años</span>
            <select
              value={years}
              onChange={(e) => setYears(e.target.value ? (Number(e.target.value) as LeyendaYears) : '')}
              className={inputClass}
            >
              <option value="">Sin años</option>
              {YEARS_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y} años
                </option>
              ))}
            </select>
          </label>
        )}
        {person.is_leyenda && !isLeyenda && (
          <p className="rounded-lg bg-warning/15 px-3 py-2 text-warning">
            Al dejar de ser leyenda sale de Premiación (y se borra su reconocimiento, si estaba entregado).
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger-soft">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

/** Confirmación simple (sin contraseña) */
function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string
  text: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      title={title}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-lg bg-surface-strong py-3 font-semibold hover:bg-surface-hover disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(await onConfirm())
              setBusy(false)
            }}
            className="flex-1 rounded-lg bg-danger py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Quitando…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-foreground-soft">{text}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-soft">
          {error}
        </p>
      )}
    </Modal>
  )
}
