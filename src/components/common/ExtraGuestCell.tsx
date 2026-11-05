import { LuPencil } from 'react-icons/lu'
import { canHaveGuest, type ExtraPerson } from '../../types/extraLists'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  person: Pick<ExtraPerson, 'is_leyenda' | 'is_leader' | 'guest_status' | 'guest_name' | 'guest_at'>
  /** Marcar / desmarcar el ingreso del invitado (pendiente ↔ ingresado) */
  onToggle: () => void
  /** Solo admin: agregar, editar o quitar el invitado (abre ExtraGuestDialog) */
  onEdit?: () => void
}

/**
 * Invitado de una leyenda o líder de lista (sin QR, ver supabase/22_extra_guests.sql):
 * Sin invitado (admin: se toca para editarlo) ·Pendiente (se toca para marcar el ingreso) · Ingresado (se toca para deshacer).
 */
export function ExtraGuestCell({ person, onToggle, onEdit }: Props) {
  if (!canHaveGuest(person)) return <span className="text-muted">—</span>
  if (person.guest_status === 'none') {
    // Admin: el texto "Sin invitado" se toca para agregar o cambiar el invitado
    return onEdit ? (
      <button
        type="button"
        onClick={onEdit}
        title="Agregar o cambiar invitado"
        className="flex items-center gap-1 rounded-lg px-1 py-1 text-xs text-muted hover:bg-surface-strong hover:text-foreground"
      >
        Sin invitado
        <LuPencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    ) : (
      <span className="text-xs text-muted">Sin invitado</span>
    )
  }

  const entered = person.guest_status === 'in'
  return (
    <span className="inline-flex items-start gap-1">
      <button
        type="button"
        onClick={onToggle}
        title={entered ? 'Marcar invitado como pendiente' : 'Marcar ingreso del invitado'}
        className="rounded-lg text-left hover:opacity-80"
      >
        <span className="inline-flex flex-col">
          {entered ? (
            <span className="w-fit rounded-full bg-success/15 px-2 py-1 text-xs font-semibold text-success">
              Ingresado
            </span>
          ) : (
            <span className="w-fit rounded-full bg-warning/15 px-2 py-1 text-xs font-semibold text-warning">
              Pendiente · marcar
            </span>
          )}
          {person.guest_name && <span className="mt-1 max-w-40 truncate text-xs font-medium">{person.guest_name}</span>}
          {entered && person.guest_at && (
            <span className={`text-xs text-muted ${person.guest_name ? '' : 'mt-1'}`}>{formatDate(person.guest_at)}</span>
          )}
        </span>
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          title="Editar invitado"
          aria-label="Editar invitado"
          className="rounded-lg p-1 text-muted hover:bg-surface-strong hover:text-foreground"
        >
          <LuPencil className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
