import { supabase } from '../../lib/supabase'
import { PasswordConfirmDialog } from './PasswordConfirmDialog'
import type { SetTicketStatusResult, Ticket } from '../../types/ticket'

interface Props {
  ticket: Pick<Ticket, 'id' | 'name' | 'used_at'>
  eventName?: string
  onClose: () => void
  onUpdated: (ticketId: string, usedAt: string | null) => void
}

/**
 * Cambia un QR de escaneado ↔ no escaneado, pidiendo la contraseña del admin.
 * La verificación la hace Supabase (función set_ticket_status).
 */
export function SetTicketStatusDialog({ ticket, eventName, onClose, onUpdated }: Props) {
  // Lo que se va a hacer es lo contrario de su estado actual
  const markUsed = !ticket.used_at

  const handleConfirm = async (password: string) => {
    const { data, error } = await supabase.rpc('set_ticket_status', {
      p_ticket_id: ticket.id,
      p_used: markUsed,
      p_password: password,
    })
    if (error) return error.message
    const result = data as SetTicketStatusResult
    if (result.ok) {
      onUpdated(ticket.id, result.used_at)
      return null
    }
    if (result.reason === 'not_found') return 'Este QR ya no existe.'
    return 'Contraseña incorrecta. El status no se cambió.'
  }

  return (
    <PasswordConfirmDialog
      title={markUsed ? '¿Marcar como escaneado?' : '¿Marcar como no escaneado?'}
      description={
        <>
          <strong className="text-foreground">{ticket.name || 'Sin nombre'}</strong>
          {eventName && <> · {eventName}</>}
        </>
      }
      warning={
        markUsed
          ? 'Se contará como ingreso y el QR ya NO servirá en la entrada.'
          : 'Se descuenta de los ingresos y el QR VOLVERÁ a servir en la entrada: esa persona podrá ingresar de nuevo.'
      }
      confirmLabel={markUsed ? 'Marcar escaneado' : 'Marcar no escaneado'}
      busyLabel="Guardando…"
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  )
}
