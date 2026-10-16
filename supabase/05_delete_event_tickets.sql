-- =========================================================
-- PARTE 5: Eliminar TODOS los QR de un evento (solo admin, con su contraseña)
-- Requiere haber ejecutado antes schema.sql, 02, 03 y 04.
-- Ejecutar en Supabase → SQL Editor.
--
-- Mismo mecanismo que delete_ticket: la contraseña se compara con la de
-- Supabase Auth del admin logueado; nunca se guarda en el código.
-- Los eventos NO se borran, solo sus tickets.
-- =========================================================

create or replace function public.delete_event_tickets(p_event_id text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password_ok boolean;
  v_deleted int;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
    into v_password_ok
    from auth.users u
   where u.id = auth.uid();

  if not coalesce(v_password_ok, false) then
    perform pg_sleep(1); -- frena intentos repetidos de adivinar la contraseña
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  delete from public.tickets where event_id = p_event_id;
  get diagnostics v_deleted = row_count;

  return json_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke execute on function public.delete_event_tickets(text, text) from public, anon;
grant execute on function public.delete_event_tickets(text, text) to authenticated;
