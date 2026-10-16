-- =========================================================
-- PARTE 4: Eliminar QR (solo admin, con su contraseña)
-- Requiere haber ejecutado antes schema.sql, 02_tickets.sql y 03_events.sql.
-- Ejecutar en Supabase → SQL Editor.
--
-- La tabla tickets sigue sin permitir DELETE desde la app.
-- Esta función es la ÚNICA forma de borrar, y exige:
--   1. que quien la llama sea admin
--   2. que escriba SU contraseña actual (se compara con la de Supabase Auth)
-- La contraseña nunca se guarda en el código ni en la base: solo se compara.
-- =========================================================

create or replace function public.delete_ticket(p_ticket_id uuid, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password_ok boolean;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- Compara con el hash de la contraseña del usuario que está logueado
  select u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
    into v_password_ok
    from auth.users u
   where u.id = auth.uid();

  if not coalesce(v_password_ok, false) then
    perform pg_sleep(1); -- frena intentos repetidos de adivinar la contraseña
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  delete from public.tickets where id = p_ticket_id;

  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  return json_build_object('ok', true);
end;
$$;

revoke execute on function public.delete_ticket(uuid, text) from public, anon;
grant execute on function public.delete_ticket(uuid, text) to authenticated;
