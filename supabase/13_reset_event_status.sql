-- =========================================================
-- PARTE 13: Reiniciar el status de todos los QR de un evento
-- Solo admin, con su contraseña.
-- Requiere haber ejecutado antes schema.sql y 02 a 11.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- Deja todos los QR del evento como "no escaneado" y su invitado como pendiente.
-- Los QR NO se borran (sirve para limpiar las pruebas antes del evento).
-- =========================================================

create or replace function public.reset_event_status(p_event_id text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset int;
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

  return json_build_object('ok', true, 'reset', v_reset);
end;
$$;

revoke execute on function public.reset_event_status(text, text) from public, anon;
grant execute on function public.reset_event_status(text, text) to authenticated;

notify pgrst, 'reload schema';
