-- =========================================================
-- PARTE 20: Listas en Premiación y en "Reiniciar status"
-- Requiere haber ejecutado antes schema.sql y 02 a 19.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
--   • Orden de llamado mixto: en un mismo grupo de años pueden ir leyendas con QR
--     (ticket_award_order) y leyendas de listas (extra_people.award_position).
--   • Reiniciar status también deja SIN ingreso a las leyendas de listas del evento
--     (los asistentes normales de las listas no se tocan).
--   Los QR NO se modifican.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Guardar el orden de UN grupo de años, mezclando QR y listas (solo admin)
--    Cada arreglo trae los ids y su posición (1, 2, 3…) dentro del grupo.
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- 2. reset_event_status (reemplaza la de 18_guest_declined.sql)
--    Igual que antes y además deja sin ingreso a las leyendas de listas del evento.
-- ---------------------------------------------------------
create or replace function public.reset_event_status(p_event_id text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset int;
  v_extra int;
begin
  if not public.verify_admin_password(p_password) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  update public.tickets
     set used_at = null,
         used_by = null,
         guest_at = null,
         guest_by = null
   where event_id = p_event_id
     and (used_at is not null or guest_at is not null);
  get diagnostics v_reset = row_count;

  delete from public.ticket_guest_names n
   using public.tickets t
   where t.id = n.ticket_id and t.event_id = p_event_id;

  delete from public.ticket_guest_declined d
   using public.tickets t
   where t.id = d.ticket_id and t.event_id = p_event_id;

  -- Leyendas de listas: vuelven a quedar sin ingreso
  update public.extra_people p
     set entered_at = null,
         entered_by = null
    from public.extra_groups g
   where g.id = p.group_id
     and g.event_id = p_event_id
     and p.is_leyenda
     and p.entered_at is not null;
  get diagnostics v_extra = row_count;

  return json_build_object('ok', true, 'reset', v_reset + v_extra);
end;
$$;

revoke execute on function public.reset_event_status(text, text) from public, anon;
grant execute on function public.reset_event_status(text, text) to authenticated;

notify pgrst, 'reload schema';
