import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../ui/Modal'
import { extraErrors, type ExtraGuestStatus, type ExtraPerson, type ExtraResult } from '../../types/extraLists'

const MAX_NAME = 120

const options: { value: ExtraGuestStatus; label: string }[] = [
  { value: 'none', label: 'Sin invitado' },
  { value: 'pending', label: 'Con invitado · pendiente' },
  { value: 'in', label: 'Con invitado · ya ingresó' },
]

interface Props {
  person: Pick<ExtraPerson, 'id' | 'name' | 'guest_status' | 'guest_name'>
  onClose: () => void
  /** Se guardó: recargar */
  onSaved: () => void
}

/**
 * Admin: agregar, editar o quitar el invitado de una leyenda de lista (sin QR).
 * Los QR no se tocan: todo va en extra_people (ver supabase/22_extra_guests.sql).
 */
export function ExtraGuestDialog({ person, onClose, onSaved }: Props) {
  const formId = useId()
  const [status, setStatus] = useState<ExtraGuestStatus>(person.guest_status === 'none' ? 'pending' : person.guest_status)
  const [name, setName] = useState(person.guest_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    // Si se borró el nombre, primero se quita (la función mantiene el anterior cuando llega vacío)
    if (status !== 'none' && !name.trim() && person.guest_name) {
      const cleared = await supabase.rpc('set_extra_person_guest', {
        p_person_id: person.id,
        p_status: 'none',
        p_guest_name: null,
      })
      if (cleared.error) {
        setBusy(false)
        setError(cleared.error.message)
        return
      }
    }
    const { data, error } = await supabase.rpc('set_extra_person_guest', {
      p_person_id: person.id,
      p_status: status,
      p_guest_name: status === 'none' ? null : name.trim() || null,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    const result = data as ExtraResult
    if (!result.ok) {
      setError(extraErrors[result.reason])
      return
    }
    onSaved()
  }

  return (
    <Modal
      title="Invitado"
      description={
        <>
          Invitado de <strong className="text-foreground">{person.name}</strong>
        </>
      }
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
            form={formId}
            disabled={busy}
            className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-3 text-sm text-foreground-soft">
        <fieldset className="space-y-2">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="extra-guest-status"
                value={o.value}
                checked={status === o.value}
                onChange={() => setStatus(o.value)}
                className="h-5 w-5 accent-(--color-primary)"
              />
              {o.label}
            </label>
          ))}
        </fieldset>

        {status !== 'none' && (
          <label className="block">
            <span className="mb-1 block font-medium">
              Nombre del invitado <span className="text-muted">(opcional)</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME}
              autoFocus
              autoComplete="off"
              placeholder="Ej. Pedro Soto"
              className="w-full rounded-lg border border-line bg-background px-3 py-3 text-base text-foreground outline-none focus:border-primary"
            />
          </label>
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
