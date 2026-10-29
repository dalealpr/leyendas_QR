import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../ui/Modal'
import { PasswordInput } from '../ui/PasswordInput'
import type { GuestState, SetGuestStateResult } from '../../types/ticket'

const options: { value: GuestState; label: string; hint: string; className: string }[] = [
  {
    value: 'in',
    label: 'Ingresado',
    hint: 'El invitado ya entró.',
    className: 'text-success',
  },
  {
    value: 'pending',
    label: 'Pendiente',
    hint: 'Puede llegar después: se registra escaneando el QR otra vez.',
    className: 'text-warning',
  },
  {
    value: 'declined',
    label: 'No viene',
    hint: 'La leyenda vino sin invitado: el QR queda bloqueado para el invitado.',
    className: 'text-foreground-soft',
  },
]

interface Props {
  ticketId: string
  leyendaName: string | null
  eventName?: string
  current: GuestState
  onClose: () => void
  onUpdated: (ticketId: string, guestAt: string | null, declined: boolean) => void
}

/**
 * Cambia a mano el estado del invitado de un QR (solo admin, con contraseña).
 * La verificación la hace Supabase (función set_guest_state).
 */
export function SetGuestStateDialog({ ticketId, leyendaName, eventName, current, onClose, onUpdated }: Props) {
  const formId = useId()
  const [state, setState] = useState<GuestState>(current)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { data, error } = await supabase.rpc('set_guest_state', {
      p_ticket_id: ticketId,
      p_state: state,
      p_password: password,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    const result = data as SetGuestStateResult
    if (!result.ok) {
      setPassword('')
      setError(
        result.reason === 'password'
          ? 'Contraseña incorrecta. El invitado no se cambió.'
          : result.reason === 'not_found'
            ? 'Este QR ya no existe.'
            : 'Estado no válido.',
      )
      return
    }
    onUpdated(ticketId, result.guest_at, result.declined)
  }

  return (
    <Modal
      title="Estado del invitado"
      description={
        <>
          Invitado de <strong className="text-foreground">{leyendaName || 'Sin nombre'}</strong>
          {eventName && <> · {eventName}</>}
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
            disabled={busy || !password || state === current}
            className="flex-1 rounded-lg bg-primary py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4 text-sm">
        <div className="space-y-2" role="radiogroup" aria-label="Estado del invitado">
          {options.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${
                state === o.value ? 'border-primary bg-primary/10' : 'border-line hover:bg-surface-strong'
              }`}
            >
              <input
                type="radio"
                name={`${formId}-state`}
                value={o.value}
                checked={state === o.value}
                onChange={() => setState(o.value)}
                className="mt-1 accent-[var(--color-primary)]"
              />
              <span>
                <span className={`block font-semibold ${o.className}`}>
                  {o.label}
                  {o.value === current && <span className="ml-2 text-xs font-normal text-muted">(actual)</span>}
                </span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">Contraseña del admin</span>
          <PasswordInput value={password} onChange={setPassword} />
        </label>

        {error && (
          <p role="alert" className="text-danger-soft">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
