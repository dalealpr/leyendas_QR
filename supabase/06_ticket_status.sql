-- =========================================================
-- PARTE 6: Cambiar status de un QR (escaneado ↔ no escaneado)
-- Solo admin, con su contraseña.
-- Requiere haber ejecutado antes schema.sql y 02 a 05.
-- Ejecutar en Supabase → SQL Editor.
-- =========================================================

-- ---------------------------------------------------------
-- Helper interno: ¿la contraseña es la del admin logueado?
-- NO se puede llamar desde la app (sin grant); solo lo usan otras funciones.
-- ---------------------------------------------------------
create or replace function public.verify_admin_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
    into v_ok
    from auth.users u
   where u.id = auth.uid();

  if not coalesce(v_ok, false) then
    perform pg_sleep(1); -- frena intentos repetidos de adivinar la contraseña
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function public.verify_admin_password(text) from public, anon, authenticated;

-- ---------------------------------------------------------
-- Cambiar status
--   p_used = true  → marcar como escaneado (cuenta como ingreso)
--   p_used = false → marcar como NO escaneado (el QR vuelve a funcionar)
-- ---------------------------------------------------------
create or replace function public.set_ticket_status(p_ticket_id uuid, p_used boolean, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used_at timestamptz;
begin
  if not public.verify_admin_password(p_password) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_used then
    -- Si ya estaba escaneado se conserva la hora original
    update public.tickets
       set used_at = coalesce(used_at, now()),
           used_by = coalesce(used_by, auth.uid())
     where id = p_ticket_id
    returning used_at into v_used_at;
  else
    update public.tickets
       set used_at = null,
           used_by = null
     where id = p_ticket_id;
    v_used_at := null;
  end if;

  return json_build_object('ok', true, 'used_at', v_used_at);
end;
$$;

revoke execute on function public.set_ticket_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_ticket_status(uuid, boolean, text) to authenticated;
