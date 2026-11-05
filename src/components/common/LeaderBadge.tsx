import { LuCrown } from 'react-icons/lu'

/** Etiqueta dorada "Líder" que va junto al nombre (ver supabase/21_leaders.sql) */
export function LeaderBadge() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 align-middle text-xs font-semibold text-primary">
      <LuCrown className="h-3.5 w-3.5" aria-hidden="true" />
      Líder
    </span>
  )
}
