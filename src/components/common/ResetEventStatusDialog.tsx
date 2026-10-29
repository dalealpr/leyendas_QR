import { supabase } from '../../lib/supabase'
import { PasswordConfirmDialog } from './PasswordConfirmDialog'
import type { ResetEventStatusResult } from '../../types/ticket'

interface Props {
  eventId: string
  eventName: string
  used: number
  /** Invitados ingresados (0 si el evento no tiene invitados) */
  guests: number
  onClose: () => void
  onReset: (reset: number) => void
}

/**
 * Pide la contraseña del admin antes de dejar todos los QR de un evento como no escaneados
 * (y sus invitados como pendientes). Los QR no se borran.
 * La verificación la hace Supabase (función reset_event_status).
 */
export function ResetEventStatusDialog({ eventId, eventName, used, guests, onClose, onReset }: Props) {
  const handleConfirm = async (password: string) => {
    const { data, error } = await supabase.rpc('reset_event_status', {
      p_event_id: eventId,
      p_password: password,
    })
    if (error) return error.message
    const result = data as ResetEventStatusResult
    if (result.ok) {
      onReset(result.reset)
      return null
    }
    return 'Contraseña incorrecta. No se cambió ningún status.'
  }

  return (
    <PasswordConfirmDialog
      title={`¿Reiniciar el status de ${eventName}?`}
      description={
        <>
          <strong className="text-foreground">{used} escaneados</strong> volverán a “no escaneado”
          {guests > 0 && (
            <>
              {' '}
              y <strong className="text-foreground">{guests} invitados</strong> a “pendiente”
            </>
          )}
          . Los QR no se borran.
        </>
      }
      warning={
        <>
          Los ingresos de este evento volverán a 0 y todos los QR VOLVERÁN a servir en la entrada.
        </>
      }
      confirmLabel="Reiniciar status"
      busyLabel="Reiniciando…"
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  )
}
