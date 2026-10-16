import { supabase } from '../../lib/supabase'
import { PasswordConfirmDialog } from './PasswordConfirmDialog'
import type { DeleteEventTicketsResult } from '../../types/ticket'

interface Props {
  eventId: string
  eventName: string
  total: number
  used: number
  onClose: () => void
  onDeleted: (deleted: number) => void
}

/**
 * Pide la contraseña del admin antes de borrar TODOS los QR de un evento.
 * La verificación la hace Supabase (función delete_event_tickets).
 */
export function DeleteEventTicketsDialog({ eventId, eventName, total, used, onClose, onDeleted }: Props) {
  const handleConfirm = async (password: string) => {
    const { data, error } = await supabase.rpc('delete_event_tickets', {
      p_event_id: eventId,
      p_password: password,
    })
    if (error) return error.message
    const result = data as DeleteEventTicketsResult
    if (result.ok) {
      onDeleted(result.deleted)
      return null
    }
    return 'Contraseña incorrecta. No se eliminó ningún QR.'
  }

  return (
    <PasswordConfirmDialog
      title={`¿Eliminar todos los QR de ${eventName}?`}
      description={
        <>
          Se eliminarán <strong className="text-foreground">{total} QR</strong>
          {used > 0 && <> ({used} ya escaneados)</>}.
        </>
      }
      warning={
        <>
          Ninguno de estos QR funcionará en la entrada
          {used > 0 && ' y los ingresos de este evento volverán a 0'}. El evento no se borra.
        </>
      }
      confirmLabel={`Eliminar ${total} QR`}
      busyLabel="Eliminando…"
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  )
}
