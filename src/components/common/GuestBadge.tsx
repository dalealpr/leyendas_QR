import type { Ticket } from '../../types/ticket'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  ticket: Pick<Ticket, 'used_at' | 'guest_at'>
}

/**
 * Estado del invitado de un QR:
 * Ingresado (verde) · Pendiente (naranjo) · — si el titular todavía no entra
 */
export function GuestBadge({ ticket }: Props) {
  if (ticket.guest_at) {
    return (
      <span className="inline-flex flex-col">
        <span className="w-fit rounded-full bg-success/15 px-2 py-1 text-xs font-semibold text-success">
          Ingresado
        </span>
        <span className="mt-1 text-xs text-muted">{formatDate(ticket.guest_at)}</span>
      </span>
    )
  }
  if (ticket.used_at) {
    return (
      <span className="rounded-full bg-warning/15 px-2 py-1 text-xs font-semibold text-warning">Pendiente</span>
    )
  }
  return <span className="text-muted">—</span>
}
