import type { Ticket } from '../types/ticket'

/** Minúsculas y sin tildes: "José" y "jose" coinciden */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/** Filtra tickets en memoria por nombre (o por el inicio del código del QR) */
export function filterTickets<T extends Pick<Ticket, 'name' | 'code'>>(tickets: T[], search: string): T[] {
  const query = normalize(search)
  if (!query) return tickets
  return tickets.filter(
    (t) => normalize(t.name ?? 'sin nombre').includes(query) || t.code.startsWith(query),
  )
}

/** Para búsquedas en Supabase con ilike: escapa los comodines % y _ */
export function ilikePattern(search: string): string {
  return `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
