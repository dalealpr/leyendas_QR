import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../ui/Modal'
import type { RegisterGuestFirstResult } from '../../types/ticket'

/** Igual que el límite de supabase/15_guest_first.sql */
const MAX_NAME = 120

const errors: Record<Exclude<RegisterGuestFirstResult, { ok: true }>['reason'], string> = {
  not_found: 'Este QR ya no existe.',
  otro_evento: 'Esta leyenda es de otro evento, no del evento activo.',
  sin_evento_activo: 'No hay evento activo. Pide al admin que lo active.',
  sin_invitados: 'Este evento no tiene invitados activados.',
  nombre_largo: `El nombre puede tener hasta ${MAX_NAME} caracteres.`,
  ya_ingresado: 'El invitado de esta leyenda ya ingresó.',
}

interface Props {
  ticketId: string
  /** Nombre de la leyenda */
  leyendaName: string | null
  onClose: () => void
  onAdded: () => void
}

/**
 * Registra al invitado que llega ANTES que su leyenda (ventana Invitados).
 * El nombre es opcional. Los QR no se modifican: el nombre va en una tabla aparte.
 */
export function AddGuestDialog({ ticketId, leyendaName, onClose, onAdded }: Props) {
  const formId = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { data, error } = await supabase.rpc('register_guest_first', {
      p_ticket_id: ticketId,
      p_guest_name: name.trim() || null,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    const result = data as RegisterGuestFirstResult
    if (!result.ok) {
      setError(errors[result.reason])
      return
    }
    onAdded()
  }

  return (
    <Modal
      title="Agregar invitado"
      description={
        <>
          Invitado de <strong className="text-foreground">{leyendaName || 'Sin nombre'}</strong>
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
            {busy ? 'Agregando…' : 'Agregar'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-3 text-sm text-foreground-soft">
        <p>
          El invitado quedará como <strong className="text-success">ingresado</strong> aunque la leyenda
          todavía no llegue. Cuando la leyenda se escanee, no se volverá a preguntar por su invitado.
        </p>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-foreground-soft">
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

        {error && (
          <p role="alert" className="text-danger-soft">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
