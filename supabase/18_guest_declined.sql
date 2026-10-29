-- =========================================================
-- PARTE 18: Tercera opción al escanear — "Sin invitado" (no viene)
-- Requiere haber ejecutado antes schema.sql y 02 a 17.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- Al escanear una leyenda de un evento con invitados hay 3 opciones:
--   • Con invitado    → el invitado entra ahora (guest_at, como antes)
--   • Llega después   → queda pendiente (no se guarda nada, como antes)
--   • Sin invitado    → su invitado NO viene: se marca en una tabla APARTE
--                       (ticket_guest_declined). Los QR NO se modifican.
-- Si se vuelve a escanear un QR marcado "Sin invitado" → YA USADO (bloqueado).
-- Solo el admin lo corrige desde Editar.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Marca "no viene" (tabla aparte; sin fila = no marcado)
-- ---------------------------------------------------------
create table if not exists public.ticket_guest_declined (
  ticket_id uuid primary key references public.tickets (id) on delete cascade,
  declined_at timestamptz not null default now(),
  declined_by uuid references auth.users (id) on delete set null
);

alter table public.ticket_guest_declined enable row level security;

drop policy if exists "ticket_guest_declined_select" on public.ticket_guest_declined;
create policy "ticket_guest_declined_select"
  on public.ticket_guest_declined for select
  to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));

revoke insert, update, delete on public.ticket_guest_declined from anon, authenticated;
revoke all on public.ticket_guest_declined from anon;
grant select on public.ticket_guest_declined to authenticated;

-- ---------------------------------------------------------
-- 2. Marcar "Sin invitado" al escanear (todo el staff)
--    Solo si la leyenda ya entró, el evento tiene invitados y el invitado no entró.
-- ---------------------------------------------------------
create or replace function public.decline_guest(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_active text;
  v_id uuid;
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

  select t.id, t.event_id, t.used_at, t.guest_at, e.guests_enabled
    into v_id, v_event_id, v_used_at, v_guest_at, v_guests
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
  if v_guest_at is not null then
    return json_build_object('ok', false, 'reason', 'ya_ingresado', 'guest_at', v_guest_at);
  end if;

  insert into public.ticket_guest_declined (ticket_id, declined_by)
  values (v_id, auth.uid())
  on conflict (ticket_id) do nothing;

  return json_build_object('ok', true);
end;
$$;

revoke execute on function public.decline_guest(text) from public, anon;
grant execute on function public.decline_guest(text) to authenticated;

-- ---------------------------------------------------------
-- 3. validate_ticket (reemplaza la de 15_guest_first.sql)
--    Re-escaneo de un QR marcado "Sin invitado" → YA USADO con guest_declined = true.
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
  v_id uuid;
  v_name text;
  v_event_id text;
  v_used_at timestamptz;
  v_guest_at timestamptz;
  v_guests boolean;
  v_declined boolean;
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
  returning id, name, event_id, guest_at into v_id, v_name, v_event_id, v_guest_at;

  if found then
    select e.guests_enabled into v_guests from public.events e where e.id = v_event_id;
    return json_build_object(
      'ok', true,
      'name', v_name,
      'event_name', (select name from public.events where id = v_event_id),
      'guests', coalesce(v_guests, false),
      'guest_at', v_guest_at,
      'guest_name', (select guest_name from public.ticket_guest_names where ticket_id = v_id)
    );
  end if;

  -- No se actualizó: ¿no existe, es de otro evento o ya estaba usado?
  select t.id, t.name, t.used_at, t.guest_at, t.event_id, e.guests_enabled
    into v_id, v_name, v_used_at, v_guest_at, v_event_id, v_guests
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

  v_declined := exists (select 1 from public.ticket_guest_declined where ticket_id = v_id);

  if v_guests and v_guest_at is null and not v_declined then
    return json_build_object('ok', false, 'reason', 'invitado_pendiente', 'name', v_name, 'used_at', v_used_at);
  end if;

  return json_build_object(
    'ok', false,
    'reason', 'ya_usado',
    'used_at', v_used_at,
    'guest_at', v_guest_at,
    'guest_declined', v_declined
  );
end;
$$;

revoke execute on function public.validate_ticket(text) from public, anon;
grant execute on function public.validate_ticket(text) to authenticated;

-- ---------------------------------------------------------
-- 4. register_guest (reemplaza la de 11_guests.sql)
--    No registra al invitado de una leyenda marcada "Sin invitado".
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
  v_id uuid;
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
     and not exists (select 1 from public.ticket_guest_declined d where d.ticket_id = t.id)
  returning t.name into v_name;

  if found then
    return json_build_object('ok', true, 'name', v_name);
  end if;

  select t.id, t.used_at, t.guest_at, t.event_id, e.guests_enabled
    into v_id, v_used_at, v_guest_at, v_event_id, v_guests
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
  if v_guest_at is null then
    return json_build_object('ok', false, 'reason', 'no_viene');
  end if;
  return json_build_object('ok', false, 'reason', 'ya_ingresado', 'guest_at', v_guest_at);
end;
$$;

revoke execute on function public.register_guest(text) from public, anon;
grant execute on function public.register_guest(text) to authenticated;

-- ---------------------------------------------------------
-- 5. register_guest_first (reemplaza la de 15_guest_first.sql)
--    Tampoco registra al invitado de una leyenda marcada "Sin invitado".
-- ---------------------------------------------------------
create or replace function public.register_guest_first(p_ticket_id uuid, p_guest_name text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_active text;
  v_event_id text;
  v_guest_at timestamptz;
  v_guests boolean;
  v_name text := nullif(trim(coalesce(p_guest_name, '')), '');
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if v_name is not null and length(v_name) > 120 then
    return json_build_object('ok', false, 'reason', 'nombre_largo');
  end if;

  v_is_admin := public.is_admin();
  v_active := public.active_event_id();

  if not v_is_admin and v_active is null then
    return json_build_object('ok', false, 'reason', 'sin_evento_activo');
  end if;

  update public.tickets t
     set guest_at = now(),
         guest_by = auth.uid()
   where t.id = p_ticket_id
     and t.guest_at is null
     and (v_is_admin or t.event_id = v_active)
     and exists (select 1 from public.events e where e.id = t.event_id and e.guests_enabled)
     and not exists (select 1 from public.ticket_guest_declined d where d.ticket_id = t.id)
  returning t.guest_at into v_guest_at;

  if found then
    if v_name is not null then
      insert into public.ticket_guest_names (ticket_id, guest_name, created_by)
      values (p_ticket_id, v_name, auth.uid())
      on conflict (ticket_id) do update
        set guest_name = excluded.guest_name, created_by = excluded.created_by, created_at = now();
    end if;
    return json_build_object('ok', true, 'guest_at', v_guest_at, 'guest_name', v_name);
  end if;

  select t.event_id, t.guest_at, e.guests_enabled
    into v_event_id, v_guest_at, v_guests
    from public.tickets t
    join public.events e on e.id = t.event_id
   where t.id = p_ticket_id;

  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not v_is_admin and v_event_id is distinct from v_active then
    return json_build_object('ok', false, 'reason', 'otro_evento');
  end if;
  if not v_guests then
    return json_build_object('ok', false, 'reason', 'sin_invitados');
  end if;
  if v_guest_at is null then
    return json_build_object('ok', false, 'reason', 'no_viene');
  end if;
  return json_build_object('ok', false, 'reason', 'ya_ingresado', 'guest_at', v_guest_at);
end;
$$;

revoke execute on function public.register_guest_first(uuid, text) from public, anon;
grant execute on function public.register_guest_first(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- 6. Cambiar a mano el estado del invitado (solo admin, con contraseña)
--    p_state: 'in' (ingresado) | 'pending' (pendiente) | 'declined' (no viene)
-- ---------------------------------------------------------
create or replace function public.set_guest_state(p_ticket_id uuid, p_state text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest_at timestamptz;
begin
  if not public.verify_admin_password(p_password) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  if p_state not in ('in', 'pending', 'declined') then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_state = 'in' then
    update public.tickets
       set guest_at = coalesce(guest_at, now()),
           guest_by = coalesce(guest_by, auth.uid())
     where id = p_ticket_id
    returning guest_at into v_guest_at;
    delete from public.ticket_guest_declined where ticket_id = p_ticket_id;
  else
    update public.tickets set guest_at = null, guest_by = null where id = p_ticket_id;
    delete from public.ticket_guest_names where ticket_id = p_ticket_id;
    v_guest_at := null;
    if p_state = 'declined' then
      insert into public.ticket_guest_declined (ticket_id, declined_by)
      values (p_ticket_id, auth.uid())
      on conflict (ticket_id) do nothing;
    else
      delete from public.ticket_guest_declined where ticket_id = p_ticket_id;
    end if;
  end if;

  return json_build_object('ok', true, 'guest_at', v_guest_at, 'declined', p_state = 'declined');
end;
$$;

revoke execute on function public.set_guest_state(uuid, text, text) from public, anon;
grant execute on function public.set_guest_state(uuid, text, text) to authenticated;

-- ---------------------------------------------------------
-- 7. set_ticket_status (reemplaza la de 15_guest_first.sql)
--    Al marcar "no escaneado" también se borra la marca "no viene".
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
    delete from public.ticket_guest_names where ticket_id = p_ticket_id;
    delete from public.ticket_guest_declined where ticket_id = p_ticket_id;
    v_used_at := null;
  end if;

  return json_build_object('ok', true, 'used_at', v_used_at);
end;
$$;

revoke execute on function public.set_ticket_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_ticket_status(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------
-- 8. reset_event_status (reemplaza la de 15_guest_first.sql)
--    También borra las marcas "no viene" del evento.
-- ---------------------------------------------------------
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

  delete from public.ticket_guest_names n
   using public.tickets t
   where t.id = n.ticket_id and t.event_id = p_event_id;

  delete from public.ticket_guest_declined d
   using public.tickets t
   where t.id = d.ticket_id and t.event_id = p_event_id;

  return json_build_object('ok', true, 'reset', v_reset);
end;
$$;

revoke execute on function public.reset_event_status(text, text) from public, anon;
grant execute on function public.reset_event_status(text, text) to authenticated;

-- ---------------------------------------------------------
-- 9. ticket_stats (reemplaza la de 15_guest_first.sql)
--    Agrega guests_declined (no vienen).
--    guests_waiting ya no cuenta a los que no vienen.
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
  guests bigint,
  guests_waiting bigint,
  guests_declined bigint
)
language sql
stable
set search_path = ''
as $$
  select e.id, e.name, e.sort_order, e.guests_enabled,
         count(t.id),
         count(t.used_at),
         count(t.guest_at),
         count(t.id) filter (where t.used_at is not null and t.guest_at is null and d.ticket_id is null),
         count(d.ticket_id)
    from public.events e
    left join public.tickets t on t.event_id = e.id
    left join public.ticket_guest_declined d on d.ticket_id = t.id
   group by e.id
   order by e.sort_order;
$$;

revoke execute on function public.ticket_stats() from public, anon;
grant execute on function public.ticket_stats() to authenticated;

notify pgrst, 'reload schema';
