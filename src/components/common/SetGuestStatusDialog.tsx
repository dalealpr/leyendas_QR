import { supabase } from '../../lib/supabase'
import { PasswordConfirmDialog } from './PasswordConfirmDialog'
import type { SetGuestStatusResult, Ticket } from '../../types/ticket'

interface Props {
  ticket: Pick<Ticket, 'id' | 'name' | 'guest_at'>
  eventName?: string
  onClose: () => void
  onUpdated: (ticketId: string, guestAt: string | null) => void
}

/**
 * Cambia el invitado de un QR entre pendiente ↔ ingresado, pidiendo la contraseña del admin.
 * La verificación la hace Supabase (función set_guest_status).
 */
export function SetGuestStatusDialog({ ticket, eventName, onClose, onUpdated }: Props) {
  // Lo que se va a hacer es lo contrario de su estado actual
  const markEntered = !ticket.guest_at

  const handleConfirm = async (password: string) => {
    const { data, error } = await supabase.rpc('set_guest_status', {
      p_ticket_id: ticket.id,
      p_entered: markEntered,
      p_password: password,
    })
    if (error) return error.message
    const result = data as SetGuestStatusResult
    if (result.ok) {
      onUpdated(ticket.id, result.guest_at)
      return null
    }
    if (result.reason === 'not_found') return 'Este QR ya no existe.'
    if (result.reason === 'titular_pendiente') return 'El titular todavía no ingresa.'
    return 'Contraseña incorrecta. El invitado no se cambió.'
  }

  return (
    <PasswordConfirmDialog
      title={markEntered ? '¿Marcar invitado como ingresado?' : '¿Marcar invitado como pendiente?'}
      description={
        <>
          Invitado de <strong className="text-foreground">{ticket.name || 'Sin nombre'}</strong>
          {eventName && <> · {eventName}</>}
        </>
      }
      warning={
        markEntered
          ? 'Se contará como ingreso del invitado y ya NO podrá entrar con este QR.'
          : 'Se descuenta de los invitados ingresados y el invitado PODRÁ entrar de nuevo con este QR.'
      }
      confirmLabel={markEntered ? 'Marcar ingresado' : 'Marcar pendiente'}
      busyLabel="Guardando…"
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  )
}
