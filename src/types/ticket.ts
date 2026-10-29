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
}

/** Respuesta de supabase.rpc('delete_ticket', { p_ticket_id, p_password }) */
export type DeleteTicketResult =
  | { ok: true }
  | { ok: false; reason: 'password' | 'not_found' }

/** Respuesta de supabase.rpc('delete_event_tickets', { p_event_id, p_password }) */
export type DeleteEventTicketsResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: 'password' }

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
  | { ok: false; reason: 'invalido' | 'otro_evento' | 'sin_evento_activo' | 'sin_invitados' | 'titular_pendiente' }
  | { ok: false; reason: 'ya_ingresado'; guest_at: string }

/** Respuesta de supabase.rpc('validate_ticket', { p_code }) */
export type ValidateTicketResult =
  /** guests = el evento lleva invitado: hay que preguntar si viene */
  | { ok: true; name: string | null; event_name: string | null; guests: boolean }
  | { ok: false; reason: 'ya_usado'; used_at: string; guest_at: string | null }
  /** Titular ya ingresó y su invitado todavía no */
  | { ok: false; reason: 'invitado_pendiente'; name: string | null; used_at: string }
  | { ok: false; reason: 'invalido' }
  /** QR de un evento que no es el activo (no se gasta) */
  | { ok: false; reason: 'otro_evento'; event_name: string | null }
  /** No hay evento activo y el usuario no es admin */
  | { ok: false; reason: 'sin_evento_activo' }
