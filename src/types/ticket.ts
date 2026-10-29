/** Fila de public.events (ver supabase/03_events.sql). Son fijos. */
export interface Event {
  id: string
  name: string
  sort_order: number
  /** Solo un evento puede estar activo (ver supabase/09_active_event.sql) */
  is_active: boolean
  /** Cada QR deja entrar a 1 invitado (ver supabase/11_guests.sql) */
  guests_enabled: boolean
}

/** Fila de public.tickets (ver supabase/02_tickets.sql y 03_events.sql) */
export interface Ticket {
  id: string
  /** Código único que va dentro del QR */
  code: string
  name: string | null
  event_id: string
  /** Fecha ISO en que se escaneó; null si está pendiente */
  used_at: string | null
  /** id del usuario que lo escaneó */
  used_by: string | null
  /** Fecha ISO en que ingresó el invitado; null si está pendiente */
  guest_at: string | null
  /** id del usuario que escaneó al invitado */
  guest_by: string | null
  created_at: string
}

/** Años posibles de una leyenda */
export const YEARS_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45] as const
export type LeyendaYears = (typeof YEARS_OPTIONS)[number]

/**
 * Años de la leyenda, en la tabla aparte public.ticket_years (ver supabase/14_years.sql).
 * Se pide junto al ticket con select('..., ticket_years(years)'); null = sin asignar.
 */
export interface WithYears {
  ticket_years: { years: LeyendaYears } | null
}

/**
 * Nombre del invitado, en la tabla aparte public.ticket_guest_names (ver supabase/15_guest_first.sql).
 * Se pide junto al ticket con select('..., ticket_guest_names(guest_name)'); null = sin nombre.
 */
export interface WithGuestName {
  ticket_guest_names: { guest_name: string } | null
}

/** Respuesta de supabase.rpc('register_guest_first', { p_ticket_id, p_guest_name }) */
export type RegisterGuestFirstResult =
  | { ok: true; guest_at: string; guest_name: string | null }
  | {
      ok: false
      reason: 'not_found' | 'otro_evento' | 'sin_evento_activo' | 'sin_invitados' | 'nombre_largo' | 'no_viene'
    }
  | { ok: false; reason: 'ya_ingresado'; guest_at: string }

/**
 * Marca "Sin invitado" (no viene), en la tabla aparte public.ticket_guest_declined
 * (ver supabase/18_guest_declined.sql). Se pide con select('..., ticket_guest_declined(declined_at)').
 */
export interface WithGuestDeclined {
  ticket_guest_declined: { declined_at: string } | null
}

/** Respuesta de supabase.rpc('decline_guest', { p_code }) */
export type DeclineGuestResult =
  | { ok: true }
  | { ok: false; reason: 'invalido' | 'otro_evento' | 'sin_evento_activo' | 'sin_invitados' | 'titular_pendiente' }
  | { ok: false; reason: 'ya_ingresado'; guest_at: string }

/** Estado del invitado: ingresado, pendiente (puede llegar) o no viene */
export type GuestState = 'in' | 'pending' | 'declined'

/** Respuesta de supabase.rpc('set_guest_state', { p_ticket_id, p_state, p_password }) */
export type SetGuestStateResult =
  | { ok: true; guest_at: string | null; declined: boolean }
  | { ok: false; reason: 'password' | 'not_found' | 'invalid' }

/**
 * Entrega del reconocimiento (trofeo + kit), en la tabla aparte public.ticket_awards (ver supabase/16_awards.sql).
 * Se pide junto al ticket con select('..., ticket_awards(delivered_at)'); null = sin entregar.
 */
export interface WithAward {
  ticket_awards: { delivered_at: string } | null
}

/**
 * Posición de llamado en la Premiación (dentro de su grupo de años), en la tabla aparte
 * public.ticket_award_order (ver supabase/17_award_order.sql). null = sin posición (va por nombre).
 */
export interface WithAwardOrder {
  ticket_award_order: { position: number } | null
}

/** Respuesta de supabase.rpc('set_award_order', { p_ticket_ids }) */
export type SetAwardOrderResult = { ok: true; saved: number } | { ok: false; reason: 'not_found' }

/** Respuesta de supabase.rpc('set_ticket_award', { p_ticket_id, p_delivered }) */
export type SetTicketAwardResult = { ok: true; delivered_at: string | null } | { ok: false; reason: 'not_found' }

/** Años de un ticket traído con ticket_years(years) */
export function ticketYears(t: WithYears): LeyendaYears | null {
  return t.ticket_years?.years ?? null
}

/** Respuesta de supabase.rpc('set_ticket_years', { p_ticket_id, p_years }) */
export type SetTicketYearsResult =
  | { ok: true; years: LeyendaYears | null }
  | { ok: false; reason: 'invalid' | 'not_found' }

/** Datos que se envían al crear un ticket (el resto lo pone la base de datos) */
export interface NewTicket {
  name: string | null
  event_id: string
}

/** Fila de supabase.rpc('ticket_stats') */
export interface EventStats {
  event_id: string
  event_name: string
  sort_order: number
  guests_enabled: boolean
  total: number
  used: number
  /** Invitados ingresados */
  guests: number
  /** Leyenda dentro y su invitado todavía no (ver supabase/15_guest_first.sql) */
  guests_waiting: number
  /** Invitados que no vienen (escaneo "Sin invitado", ver supabase/18_guest_declined.sql) */
  guests_declined: number
}

/** Respuesta de supabase.rpc('delete_ticket', { p_ticket_id, p_password }) */
export type DeleteTicketResult =
  | { ok: true }
  | { ok: false; reason: 'password' | 'not_found' }

/** Respuesta de supabase.rpc('delete_event_tickets', { p_event_id, p_password }) */
export type DeleteEventTicketsResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: 'password' }

/** Respuesta de supabase.rpc('reset_event_status', { p_event_id, p_password }) */
export type ResetEventStatusResult = { ok: true; reset: number } | { ok: false; reason: 'password' }

/** Respuesta de supabase.rpc('set_ticket_status', { p_ticket_id, p_used, p_password }) */
export type SetTicketStatusResult =
  | { ok: true; used_at: string | null }
  | { ok: false; reason: 'password' | 'not_found' }

/** Respuesta de supabase.rpc('set_guest_status', { p_ticket_id, p_entered, p_password }) */
export type SetGuestStatusResult =
  | { ok: true; guest_at: string | null }
  | { ok: false; reason: 'password' | 'not_found' | 'titular_pendiente' }

/** Respuesta de supabase.rpc('set_event_guests', { p_event_id, p_enabled, p_password }) */
export type SetEventGuestsResult =
  | { ok: true; guests_enabled: boolean }
  | { ok: false; reason: 'password' | 'not_found' }

/** Respuesta de supabase.rpc('set_active_event', { p_event_id, p_password }) */
export type SetActiveEventResult =
  | { ok: true; active_event_id: string | null }
  | { ok: false; reason: 'password' | 'not_found' }

/** Respuesta de supabase.rpc('register_guest', { p_code }) */
export type RegisterGuestResult =
  | { ok: true; name: string | null }
  | {
      ok: false
      reason: 'invalido' | 'otro_evento' | 'sin_evento_activo' | 'sin_invitados' | 'titular_pendiente' | 'no_viene'
    }
  | { ok: false; reason: 'ya_ingresado'; guest_at: string }

/** Respuesta de supabase.rpc('validate_ticket', { p_code }) */
export type ValidateTicketResult =
  /**
   * guests = el evento lleva invitado: hay que preguntar si viene,
   * salvo que su invitado ya haya entrado antes (guest_at, ver supabase/15_guest_first.sql)
   */
  | {
      ok: true
      name: string | null
      event_name: string | null
      guests: boolean
      guest_at?: string | null
      guest_name?: string | null
    }
  /** guest_declined = se escaneó "Sin invitado": el QR queda bloqueado */
  | { ok: false; reason: 'ya_usado'; used_at: string; guest_at: string | null; guest_declined?: boolean }
  /** Titular ya ingresó y su invitado todavía no */
  | { ok: false; reason: 'invitado_pendiente'; name: string | null; used_at: string }
  | { ok: false; reason: 'invalido' }
  /** QR de un evento que no es el activo (no se gasta) */
  | { ok: false; reason: 'otro_evento'; event_name: string | null }
  /** No hay evento activo y el usuario no es admin */
  | { ok: false; reason: 'sin_evento_activo' }
