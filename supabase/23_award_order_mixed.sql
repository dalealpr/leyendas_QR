-- =========================================================
-- PARTE 23: Guardar el orden de llamado de la Premiación
-- Requiere haber ejecutado antes schema.sql y 02 a 22.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- Solo crea la función set_award_order_mixed (la misma de 20_lists_award_reset.sql),
-- SIN tocar reset_event_status (la vigente es la de 22_extra_guests.sql).
-- Guarda juntas las posiciones de las leyendas con QR (tabla aparte ticket_award_order)
-- y las de leyendas de listas (extra_people.award_position). Los QR NO se modifican.
-- =========================================================

create or replace function public.set_award_order_mixed(
  p_ticket_ids uuid[],
  p_ticket_positions int[],
  p_person_ids uuid[],
  p_person_positions int[]
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if coalesce(cardinality(p_ticket_ids), 0) <> coalesce(cardinality(p_ticket_positions), 0)
     or coalesce(cardinality(p_person_ids), 0) <> coalesce(cardinality(p_person_positions), 0) then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Leyendas con QR (tabla aparte ticket_award_order)
  if coalesce(cardinality(p_ticket_ids), 0) > 0 then
    insert into public.ticket_award_order (ticket_id, position)
    select u.id, u.pos
      from unnest(p_ticket_ids, p_ticket_positions) as u(id, pos)
     where exists (select 1 from public.tickets t where t.id = u.id)
    on conflict (ticket_id) do update
      set position = excluded.position, updated_at = now();
  end if;

  -- Leyendas de listas
  if coalesce(cardinality(p_person_ids), 0) > 0 then
    update public.extra_people p
       set award_position = u.pos
      from unnest(p_person_ids, p_person_positions) as u(id, pos)
     where p.id = u.id and p.is_leyenda;
  end if;

  return json_build_object('ok', true);
end;
$$;

revoke execute on function public.set_award_order_mixed(uuid[], int[], uuid[], int[]) from public, anon;
grant execute on function public.set_award_order_mixed(uuid[], int[], uuid[], int[]) to authenticated;

notify pgrst, 'reload schema';
