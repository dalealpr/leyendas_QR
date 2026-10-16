import { supabase } from '../../lib/supabase'
import { PasswordConfirmDialog } from './PasswordConfirmDialog'
import type { DeleteTicketResult, Ticket } from '../../types/ticket'

interface Props {
  ticket: Pick<Ticket, 'id' | 'name' | 'used_at'>
  eventName?: string
  onClose: () => void
  onDeleted: (ticketId: string) => void
}

/**
 * Pide la contraseña del admin antes de borrar un QR.
 * La verificación la hace Supabase (función delete_ticket), no el navegador.
 */
export function DeleteTicketDialog({ ticket, eventName, onClose, onDeleted }: Props) {
  const handleConfirm = async (password: string) => {
    const { data, error } = await supabase.rpc('delete_ticket', {
      p_ticket_id: ticket.id,
      p_password: password,
    })
    if (error) return error.message
    const result = data as DeleteTicketResult
    if (result.ok || result.reason === 'not_found') {
      // not_found: alguien ya lo había borrado; igual se quita de la lista
      onDeleted(ticket.id)
      return null
    }
    return 'Contraseña incorrecta. El QR no se eliminó.'
  }

  return (
    <PasswordConfirmDialog
      title="¿Eliminar este QR?"
      description={
        <>
          <strong className="text-foreground">{ticket.name || 'Sin nombre'}</strong>
          {eventName && <> · {eventName}</>}
        </>
      }
      warning={
        ticket.used_at
          ? 'Este QR ya fue escaneado. Si lo eliminas, también se descuenta de los ingresos.'
          : 'El QR dejará de funcionar en la entrada.'
      }
      confirmLabel="Eliminar"
      busyLabel="Eliminando…"
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  )
}
