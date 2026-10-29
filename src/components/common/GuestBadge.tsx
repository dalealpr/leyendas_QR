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
  /** Nombre del invitado, si se registró (ver supabase/15_guest_first.sql) */
  guestName?: string | null
  /** Se escaneó "Sin invitado": su invitado no viene (ver supabase/18_guest_declined.sql) */
  declined?: boolean
}

/**
 * Estado del invitado de un QR:
 * Ingresado (verde, con nombre si lo tiene) · No viene (gris) · Pendiente (naranjo) · — si el titular todavía no entra.
 * El invitado puede figurar como Ingresado aunque su leyenda no haya entrado (llegó primero).
 */
export function GuestBadge({ ticket, guestName, declined }: Props) {
  if (ticket.guest_at) {
    return (
      <span className="inline-flex flex-col">
        <span className="w-fit rounded-full bg-success/15 px-2 py-1 text-xs font-semibold text-success">
          Ingresado
        </span>
        {guestName && <span className="mt-1 max-w-40 truncate text-xs font-medium">{guestName}</span>}
        <span className={`text-xs text-muted ${guestName ? '' : 'mt-1'}`}>{formatDate(ticket.guest_at)}</span>
      </span>
    )
  }
  if (declined) {
    return (
      <span className="rounded-full bg-surface-strong px-2 py-1 text-xs font-semibold text-foreground-soft">
        No viene
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
