import { ticketYears, type WithYears } from '../../types/ticket'

/** Años de la leyenda para las tablas; — si todavía no se asignan */
export function YearsCell({ row }: { row: WithYears }) {
  const years = ticketYears(row)
  return years ? (
    <span className="font-semibold tabular-nums">{years} años</span>
  ) : (
    <span className="text-muted">—</span>
  )
}
