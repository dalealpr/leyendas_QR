import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../ui/Modal'
import { PasswordInput } from '../ui/PasswordInput'
import type { SetEventGuestsResult } from '../../types/ticket'

interface Props {
  eventId: string
  eventName: string
  /** true = activar invitados, false = desactivar */
  enable: boolean
  onClose: () => void
  onDone: (enabled: boolean) => void
}

/** Confirma activar / desactivar los invitados de un evento (solo admin, con contraseña) */
export function EventGuestsDialog({ eventId, eventName, enable, onClose, onDone }: Props) {
  const formId = useId()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { data, error } = await supabase.rpc('set_event_guests', {
      p_event_id: eventId,
      p_enabled: enable,
      p_password: password,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    const result = data as SetEventGuestsResult
    if (!result.ok) {
      setPassword('')
      setError(result.reason === 'password' ? 'Contraseña incorrecta. No se cambió nada.' : 'Ese evento no existe.')
      return
    }
    onDone(enable)
  }

  return (
    <Modal
      title={enable ? `¿Activar invitados en ${eventName}?` : `¿Desactivar invitados en ${eventName}?`}
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
              enable ? 'bg-primary text-on-primary hover:bg-primary-hover' : 'bg-danger text-white hover:opacity-90'
            }`}
          >
            {busy ? 'Guardando…' : enable ? 'Activar' : 'Desactivar'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-3 text-sm text-foreground-soft">
        {enable ? (
          <p>
            Cada QR de <strong className="text-foreground">{eventName}</strong> dejará entrar al titular y a{' '}
            <strong className="text-foreground">1 invitado</strong>. Al escanear se preguntará si viene con
            invitado; si llega después, se escanea el mismo QR otra vez.
          </p>
        ) : (
          <p>
            El escáner dejará de preguntar por el invitado. Los invitados que ya ingresaron se mantienen
            registrados.
          </p>
        )}

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
