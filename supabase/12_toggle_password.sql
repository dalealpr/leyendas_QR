-- =========================================================
-- PARTE 12: Activar / desactivar evento e invitados con contraseña
-- Requiere haber ejecutado antes schema.sql y 02 a 11.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- Reemplaza set_active_event (09) y set_event_guests (11):
-- ahora piden la contraseña del admin, igual que eliminar QR.
-- Las versiones sin contraseña se borran para que no se puedan seguir usando.
-- =========================================================

drop function if exists public.set_active_event(text);
drop function if exists public.set_event_guests(text, boolean);

-- ---------------------------------------------------------
-- Evento activo
--   p_event_id = null → ningún evento activo
-- ---------------------------------------------------------
create or replace function public.set_active_event(p_event_id text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.verify_admin_password(p_password) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  if p_event_id is not null
     and not exists (select 1 from public.events where id = p_event_id) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Primero se apagan todos y después se enciende uno
  -- (en dos pasos para no chocar con la regla de "solo uno activo")
  update public.events set is_active = false where is_active;
  if p_event_id is not null then
    update public.events set is_active = true where id = p_event_id;
  end if;

  return json_build_object('ok', true, 'active_event_id', p_event_id);
end;
$$;

revoke execute on function public.set_active_event(text, text) from public, anon;
grant execute on function public.set_active_event(text, text) to authenticated;

-- ---------------------------------------------------------
-- Invitados de un evento
-- ---------------------------------------------------------
create or replace function public.set_event_guests(p_event_id text, p_enabled boolean, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.verify_admin_password(p_password) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  update public.events set guests_enabled = p_enabled where id = p_event_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  return json_build_object('ok', true, 'guests_enabled', p_enabled);
end;
$$;

revoke execute on function public.set_event_guests(text, boolean, text) from public, anon;
grant execute on function public.set_event_guests(text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
