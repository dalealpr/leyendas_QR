/** Fila de public.events (ver supabase/03_events.sql). Son fijos. */
export interface Event {
  id: string
  name: string
  sort_order: number
  /** Solo un evento puede estar activo (ver supabase/09_active_event.sql) */
  is_active: boolean
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
  total: number
  used: number
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

/** Respuesta de supabase.rpc('validate_ticket', { p_code }) */
export type ValidateTicketResult =
  | { ok: true; name: string | null; event_name: string | null }
  | { ok: false; reason: 'ya_usado'; used_at: string }
  | { ok: false; reason: 'invalido' }
  /** QR de un evento que no es el activo (no se gasta) */
  | { ok: false; reason: 'otro_evento'; event_name: string | null }
  /** No hay evento activo y el usuario no es admin */
  | { ok: false; reason: 'sin_evento_activo' }
