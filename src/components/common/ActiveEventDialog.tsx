import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../ui/Modal'
import { PasswordInput } from '../ui/PasswordInput'
import type { SetActiveEventResult } from '../../types/ticket'

interface Props {
  /** Evento a activar, o null para desactivar todos */
  eventId: string | null
  eventName: string
  /** Evento activo actual (si lo hay), para avisar que se desactivará */
  currentActiveName: string | null
  onClose: () => void
  onDone: (activeEventId: string | null) => void
}

/** Confirma activar / desactivar el evento activo (solo admin, con contraseña) */
export function ActiveEventDialog({ eventId, eventName, currentActiveName, onClose, onDone }: Props) {
  const formId = useId()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activating = eventId !== null

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { data, error } = await supabase.rpc('set_active_event', { p_event_id: eventId, p_password: password })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    const result = data as SetActiveEventResult
    if (!result.ok) {
      setPassword('')
      setError(result.reason === 'password' ? 'Contraseña incorrecta. No se cambió nada.' : 'Ese evento no existe.')
      return
    }
    onDone(eventId)
  }

  return (
    <Modal
      title={activating ? `¿Activar ${eventName}?` : `¿Desactivar ${eventName}?`}
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
            disabled={busy || !password}
            className={`flex-1 rounded-lg py-3 font-semibold disabled:opacity-50 ${
              activating
                ? 'bg-primary text-on-primary hover:bg-primary-hover'
                : 'bg-danger text-white hover:opacity-90'
            }`}
          >
            {busy ? 'Guardando…' : activating ? 'Activar' : 'Desactivar'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-3 text-sm text-foreground-soft">
        {activating ? (
          <>
            <p>
              El staff verá en <strong className="text-foreground">Contador</strong> solo los ingresos de{' '}
              <strong className="text-foreground">{eventName}</strong>.
            </p>
            {currentActiveName && currentActiveName !== eventName && (
              <p className="rounded-lg bg-primary/15 px-3 py-2">
                ⚠ <strong className="text-foreground">{currentActiveName}</strong> dejará de estar activo
                (solo puede haber un evento activo a la vez).
              </p>
            )}
          </>
        ) : (
          <p>
            No quedará ningún evento activo. El staff verá el aviso “El evento no ha sido activado”.
          </p>
        )}
        <p className="text-xs text-muted">Admin y dashboard siguen viendo todos los eventos.</p>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">Contraseña del admin</span>
          <PasswordInput value={password} onChange={setPassword} autoFocus />
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
