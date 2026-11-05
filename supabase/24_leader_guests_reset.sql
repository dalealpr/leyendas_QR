-- =========================================================
-- PARTE 24: Invitados de los líderes de Listas (aunque no sean leyendas)
-- Requiere haber ejecutado antes schema.sql y 02 a 23.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- set_extra_person_guest (22_extra_guests.sql) ya sirve para cualquier persona de una lista.
-- Aquí solo se actualiza reset_event_status (reemplaza la de 22_extra_guests.sql):
-- igual que antes y además los invitados de los LÍDERES que no son leyendas
-- vuelven a "con invitado" al reiniciar el status.
-- Los QR NO se tocan.
-- =========================================================

create or replace function public.reset_event_status(p_event_id text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset int;
  v_extra int;
  v_guests int;
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

  -- Leyendas de listas: sin ingreso
  update public.extra_people p
     set entered_at = null,
         entered_by = null
    from public.extra_groups g
   where g.id = p.group_id
     and g.event_id = p_event_id
     and p.is_leyenda
     and p.entered_at is not null;
  get diagnostics v_extra = row_count;

  -- Invitados de listas (leyendas y líderes) que ingresaron: vuelven a "con invitado"
  update public.extra_people p
     set guest_status = 'pending',
         guest_at = null,
         guest_by = null
    from public.extra_groups g
   where g.id = p.group_id
     and g.event_id = p_event_id
     and p.guest_status = 'in';
  get diagnostics v_guests = row_count;

  return json_build_object('ok', true, 'reset', v_reset + v_extra + v_guests);
end;
$$;

revoke execute on function public.reset_event_status(text, text) from public, anon;
grant execute on function public.reset_event_status(text, text) to authenticated;

notify pgrst, 'reload schema';
