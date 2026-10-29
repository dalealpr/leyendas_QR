-- =========================================================
-- PARTE 11: Invitados (1 invitado por QR)
-- Requiere haber ejecutado antes schema.sql y 02 a 10.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
--   • El admin activa los invitados por evento (Editar).
--   • En esos eventos, cada QR deja entrar al titular y a 1 invitado,
--     que puede llegar junto con el titular o después (se escanea el mismo QR).
-- =========================================================

-- ---------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------
alter table public.events
  add column if not exists guests_enabled boolean not null default false;

alter table public.tickets
  add column if not exists guest_at timestamptz,
  add column if not exists guest_by uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------
-- 2. Activar / desactivar invitados de un evento
--    → está en 12_toggle_password.sql (pide la contraseña del admin)
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- 3. validate_ticket (reemplaza la de 10_validate_active_event.sql)
--    Igual que antes, y además:
--      • ok → 'guests' = true si el evento lleva invitado (la app pregunta)
--      • QR ya usado con invitado pendiente → 'invitado_pendiente'
--      • QR ya usado con invitado ingresado → 'ya_usado' con 'guest_at'
-- ---------------------------------------------------------
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
  v_guest_at timestamptz;
  v_guests boolean;
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  v_is_admin := public.is_admin();
  v_active := public.active_event_id();

  if not v_is_admin and v_active is null then
    return json_build_object('ok', false, 'reason', 'sin_evento_activo');
  end if;

  -- UN SOLO UPDATE atómico (evita la doble entrada del titular)
  update public.tickets
     set used_at = now(),
         used_by = auth.uid()
   where code = trim(p_code)
     and used_at is null
     and (v_is_admin or event_id = v_active)
  returning name, event_id into v_name, v_event_id;

  if found then
    select e.guests_enabled into v_guests from public.events e where e.id = v_event_id;
    return json_build_object(
      'ok', true,
      'name', v_name,
      'event_name', (select name from public.events where id = v_event_id),
      'guests', coalesce(v_guests, false)
    );
  end if;

  -- No se actualizó: ¿no existe, es de otro evento o ya estaba usado?
  select t.name, t.used_at, t.guest_at, t.event_id, e.guests_enabled
    into v_name, v_used_at, v_guest_at, v_event_id, v_guests
    from public.tickets t
    join public.events e on e.id = t.event_id
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

  if v_guests and v_guest_at is null then
    return json_build_object('ok', false, 'reason', 'invitado_pendiente', 'name', v_name, 'used_at', v_used_at);
  end if;

  return json_build_object('ok', false, 'reason', 'ya_usado', 'used_at', v_used_at, 'guest_at', v_guest_at);
end;
$$;

revoke execute on function public.validate_ticket(text) from public, anon;
grant execute on function public.validate_ticket(text) to authenticated;

-- ---------------------------------------------------------
-- 4. Registrar el ingreso del invitado (al escanear)
--    UN SOLO UPDATE atómico: el invitado entra una sola vez.
-- ---------------------------------------------------------
create or replace function public.register_guest(p_code text)
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
  v_guest_at timestamptz;
  v_guests boolean;
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  v_is_admin := public.is_admin();
  v_active := public.active_event_id();

  if not v_is_admin and v_active is null then
    return json_build_object('ok', false, 'reason', 'sin_evento_activo');
  end if;

  update public.tickets t
     set guest_at = now(),
         guest_by = auth.uid()
   where t.code = trim(p_code)
     and t.used_at is not null
     and t.guest_at is null
     and (v_is_admin or t.event_id = v_active)
     and exists (select 1 from public.events e where e.id = t.event_id and e.guests_enabled)
  returning t.name into v_name;

  if found then
    return json_build_object('ok', true, 'name', v_name);
  end if;

  -- No se actualizó: ¿por qué?
  select t.used_at, t.guest_at, t.event_id, e.guests_enabled
    into v_used_at, v_guest_at, v_event_id, v_guests
    from public.tickets t
    join public.events e on e.id = t.event_id
   where t.code = trim(p_code);

  if not found then
    return json_build_object('ok', false, 'reason', 'invalido');
  end if;
  if not v_is_admin and v_event_id is distinct from v_active then
    return json_build_object('ok', false, 'reason', 'otro_evento');
  end if;
  if not v_guests then
    return json_build_object('ok', false, 'reason', 'sin_invitados');
  end if;
  if v_used_at is null then
    return json_build_object('ok', false, 'reason', 'titular_pendiente');
  end if;
  return json_build_object('ok', false, 'reason', 'ya_ingresado', 'guest_at', v_guest_at);
end;
$$;

revoke execute on function public.register_guest(text) from public, anon;
grant execute on function public.register_guest(text) to authenticated;

-- ---------------------------------------------------------
-- 5. Cambiar a mano el estado del invitado (solo admin, con contraseña)
--    Solo si el titular ya ingresó.
-- ---------------------------------------------------------
create or replace function public.set_guest_status(p_ticket_id uuid, p_entered boolean, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used_at timestamptz;
  v_guest_at timestamptz;
begin
  if not public.verify_admin_password(p_password) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  select used_at into v_used_at from public.tickets where id = p_ticket_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_used_at is null then
    return json_build_object('ok', false, 'reason', 'titular_pendiente');
  end if;

  if p_entered then
    -- Si ya estaba ingresado se conserva la hora original
    update public.tickets
       set guest_at = coalesce(guest_at, now()),
           guest_by = coalesce(guest_by, auth.uid())
     where id = p_ticket_id
    returning guest_at into v_guest_at;
  else
    update public.tickets set guest_at = null, guest_by = null where id = p_ticket_id;
    v_guest_at := null;
  end if;

  return json_build_object('ok', true, 'guest_at', v_guest_at);
end;
$$;

revoke execute on function public.set_guest_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_guest_status(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------
-- 6. set_ticket_status (reemplaza la de 06_ticket_status.sql)
--    Igual que antes, pero al marcar "no escaneado" también se borra
--    el ingreso del invitado: el QR queda como nuevo.
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
    update public.tickets
       set used_at = coalesce(used_at, now()),
           used_by = coalesce(used_by, auth.uid())
     where id = p_ticket_id
    returning used_at into v_used_at;
  else
    update public.tickets
       set used_at = null,
           used_by = null,
           guest_at = null,
           guest_by = null
     where id = p_ticket_id;
    v_used_at := null;
  end if;

  return json_build_object('ok', true, 'used_at', v_used_at);
end;
$$;

revoke execute on function public.set_ticket_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_ticket_status(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------
-- 7. ticket_stats (reemplaza la de 03_events.sql)
--    Agrega: guests_enabled y guests (invitados ingresados)
--    Cambia el tipo de retorno, por eso se borra antes.
-- ---------------------------------------------------------
drop function if exists public.ticket_stats();

create function public.ticket_stats()
returns table (
  event_id text,
  event_name text,
  sort_order int,
  guests_enabled boolean,
  total bigint,
  used bigint,
  guests bigint
)
language sql
stable
set search_path = ''
as $$
  select e.id, e.name, e.sort_order, e.guests_enabled, count(t.id), count(t.used_at), count(t.guest_at)
    from public.events e
    left join public.tickets t on t.event_id = e.id
   group by e.id
   order by e.sort_order;
$$;

revoke execute on function public.ticket_stats() from public, anon;
grant execute on function public.ticket_stats() to authenticated;

-- ---------------------------------------------------------
-- 8. Dejar SUPPLY ATE con invitados activados
--    (después se puede cambiar desde Editar)
-- ---------------------------------------------------------
update public.events set guests_enabled = true where id = 'supply_ate';

notify pgrst, 'reload schema';
