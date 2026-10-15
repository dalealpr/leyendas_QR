/** Fila de public.tickets (ver supabase/02_tickets.sql) */
export interface Ticket {
  id: string
  /** Código único que va dentro del QR */
  code: string
  name: string | null
  /** Fecha ISO en que se escaneó; null si está pendiente */
  used_at: string | null
  /** id del usuario que lo escaneó */
  used_by: string | null
  created_at: string
}

/** Datos que se envían al crear un ticket (el resto lo pone la base de datos) */
export interface NewTicket {
  name?: string | null
}

/** Respuesta de supabase.rpc('validate_ticket', { p_code }) */
export type ValidateTicketResult =
  | { ok: true; name: string | null }
  | { ok: false; reason: 'ya_usado'; used_at: string }
  | { ok: false; reason: 'invalido' }
