import type { LeyendaYears } from './ticket'

/**
 * Listas de personas sin QR, agregadas a mano (ver supabase/19_extra_lists.sql).
 * Ej. "Gerencia": cuentan en el total; las incluidas como leyenda cuentan también como leyendas.
 */

/** Invitado de una persona de lista: sin invitado · con invitado (pendiente) · invitado ingresado */
export type ExtraGuestStatus = 'none' | 'pending' | 'in'

/** Fila de public.extra_people */
export interface ExtraPerson {
  id: string
  group_id: string
  name: string
  /** Incluida como leyenda: cuenta en la card Leyendas y aparece en Premiación */
  is_leyenda: boolean
  years: LeyendaYears | null
  /** Líder (ver supabase/21_leaders.sql) */
  is_leader: boolean
  /** Invitado (leyendas y líderes, ver supabase/22_extra_guests.sql) */
  guest_status: ExtraGuestStatus
  guest_name: string | null
  /** Ingreso del invitado (marcado a mano) */
  guest_at: string | null
  /** Ingreso al evento; null = todavía no ingresa (las leyendas se marcan a mano) */
  entered_at: string | null
  delivered_at: string | null
  award_position: number | null
  created_at: string
}

/** Pueden venir con invitado: las leyendas y los líderes (aunque no sean leyendas) */
export const canHaveGuest = (p: Pick<ExtraPerson, 'is_leyenda' | 'is_leader'>) => p.is_leyenda || p.is_leader

/** Fila de public.extra_groups, con sus personas */
export interface ExtraGroup {
  id: string
  event_id: string
  name: string
  sort_order: number
  extra_people: ExtraPerson[]
}

/** Respuesta común de las funciones de listas */
export type ExtraResult =
  | { ok: true; id?: string; entered_at?: string | null; deleted_people?: number }
  | {
      ok: false
      reason: 'nombre_invalido' | 'duplicado' | 'not_found' | 'anios_invalidos' | 'password' | 'otro_evento' | 'invalid'
    }

/** Mensajes para mostrar cuando una función de listas falla */
export const extraErrors: Record<Extract<ExtraResult, { ok: false }>['reason'], string> = {
  nombre_invalido: 'Escribe un nombre (máximo 120 caracteres).',
  duplicado: 'Ya existe una lista con ese nombre en este evento.',
  not_found: 'Ya no existe. Recarga la página.',
  anios_invalidos: 'Los años solo se asignan a personas incluidas como leyenda.',
  password: 'Contraseña incorrecta.',
  otro_evento: 'Solo puedes marcar ingresos del evento activo.',
  invalid: 'Esa opción no está disponible.',
}
