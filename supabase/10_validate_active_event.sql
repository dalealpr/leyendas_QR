-- =========================================================
-- PARTE 10: Escanear solo con evento activo
-- Requiere haber ejecutado antes 09_active_event.sql.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- Reemplaza validate_ticket:
--   • admin           → puede escanear cualquier QR, haya o no evento activo
--   • resto del staff → sin evento activo: rechazado ('sin_evento_activo')
--                       QR de otro evento: rechazado ('otro_evento') y NO se gasta
-- Sigue siendo UN SOLO UPDATE atómico (evita la doble entrada).
-- =========================================================

create or replace function public.validate_ticket(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_active text;
  v_name text;
  v_event_id text;
  v_used_at timestamptz;
begin
  -- Debe haber sesión y el usuario debe tener perfil
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  v_is_admin := public.is_admin();
  v_active := public.active_event_id();

  if not v_is_admin and v_active is null then
    return json_build_object('ok', false, 'reason', 'sin_evento_activo');
  end if;

  -- UN SOLO UPDATE atómico: marca solo si no estaba usado
  -- y (para quien no es admin) solo si es del evento activo.
  update public.tickets
     set used_at = now(),
         used_by = auth.uid()
   where code = trim(p_code)
     and used_at is null
     and (v_is_admin or event_id = v_active)
  returning name, event_id into v_name, v_event_id;

  if found then
    return json_build_object(
      'ok', true,
      'name', v_name,
      'event_name', (select name from public.events where id = v_event_id)
    );
  end if;

  -- No se actualizó: ¿no existe, es de otro evento o ya estaba usado?
  select t.used_at, t.event_id into v_used_at, v_event_id
    from public.tickets t
   where t.code = trim(p_code);

  if not found then
    return json_build_object('ok', false, 'reason', 'invalido');
  end if;

  if not v_is_admin and v_event_id is distinct from v_active then
    return json_build_object(
      'ok', false,
      'reason', 'otro_evento',
      'event_name', (select name from public.events where id = v_event_id)
    );
  end if;

  return json_build_object('ok', false, 'reason', 'ya_usado', 'used_at', v_used_at);
end;
$$;

revoke execute on function public.validate_ticket(text) from public, anon;
grant execute on function public.validate_ticket(text) to authenticated;
