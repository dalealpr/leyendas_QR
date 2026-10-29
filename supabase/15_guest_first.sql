-- =========================================================
-- PARTE 15: El invitado llega ANTES que la leyenda
-- Requiere haber ejecutado antes schema.sql y 02 a 14.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
--   • Desde la ventana Invitados, el staff busca la leyenda (todavía no
--     escaneada) y registra a su invitado como ingresado, con su nombre (opcional).
--   • Los QR NO se modifican: el nombre del invitado va en una tabla aparte
--     (ticket_guest_names) y el ingreso se marca en guest_at, igual que
--     cuando el escáner registra al invitado.
--   • Cuando después llega la leyenda, el escáner sabe que su invitado ya entró.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Nombre del invitado (tabla aparte; sin fila = sin nombre)
-- ---------------------------------------------------------
create table if not exists public.ticket_guest_names (
  ticket_id uuid primary key references public.tickets (id) on delete cascade,
  guest_name text not null check (length(trim(guest_name)) between 1 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ticket_guest_names enable row level security;

-- Lectura: quien puede ver el QR puede ver el nombre de su invitado
drop policy if exists "ticket_guest_names_select" on public.ticket_guest_names;
create policy "ticket_guest_names_select"
  on public.ticket_guest_names for select
  to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));

-- Nadie escribe directo: solo con las funciones de abajo
revoke insert, update, delete on public.ticket_guest_names from anon, authenticated;
revoke all on public.ticket_guest_names from anon;
grant select on public.ticket_guest_names to authenticated;

-- ---------------------------------------------------------
-- 2. Registrar al invitado que llega primero (todo el staff)
--    UN SOLO UPDATE atómico: el invitado entra una sola vez.
--    Para el staff (no admin), solo en el evento activo.
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

  -- No se actualizó: ¿por qué?
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
  return json_build_object('ok', false, 'reason', 'ya_ingresado', 'guest_at', v_guest_at);
end;
$$;

revoke execute on function public.register_guest_first(uuid, text) from public, anon;
grant execute on function public.register_guest_first(uuid, text) to authenticated;

-- ---------------------------------------------------------
-- 3. validate_ticket (reemplaza la de 11_guests.sql)
--    Igual que antes, y además en 'ok' devuelve guest_at y guest_name:
--    si el invitado ya entró antes, la app NO pregunta "¿Viene con invitado?".
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
-- 4. set_guest_status (reemplaza la de 11_guests.sql)
--    Ya no exige que la leyenda haya ingresado (el invitado puede llegar antes).
--    Al dejarlo pendiente también se borra su nombre.
-- ---------------------------------------------------------
create or replace function public.set_guest_status(p_ticket_id uuid, p_entered boolean, p_password text)
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

  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_entered then
    update public.tickets
       set guest_at = coalesce(guest_at, now()),
           guest_by = coalesce(guest_by, auth.uid())
     where id = p_ticket_id
    returning guest_at into v_guest_at;
  else
    update public.tickets set guest_at = null, guest_by = null where id = p_ticket_id;
    delete from public.ticket_guest_names where ticket_id = p_ticket_id;
    v_guest_at := null;
  end if;

  return json_build_object('ok', true, 'guest_at', v_guest_at);
end;
$$;

revoke execute on function public.set_guest_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_guest_status(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------
-- 5. set_ticket_status (reemplaza la de 11_guests.sql)
--    Al marcar "no escaneado" se borra también el invitado y su nombre.
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
    v_used_at := null;
  end if;

  return json_build_object('ok', true, 'used_at', v_used_at);
end;
$$;

revoke execute on function public.set_ticket_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_ticket_status(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------
-- 6. reset_event_status (reemplaza la de 13_reset_event_status.sql)
--    También borra los nombres de invitados del evento.
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

  return json_build_object('ok', true, 'reset', v_reset);
end;
$$;

revoke execute on function public.reset_event_status(text, text) from public, anon;
grant execute on function public.reset_event_status(text, text) to authenticated;

-- ---------------------------------------------------------
-- 7. ticket_stats (reemplaza la de 11_guests.sql)
--    Agrega guests_waiting: leyenda dentro y su invitado todavía no.
--    (Antes se calculaba como used - guests, que deja de cuadrar
--     si hay invitados que entraron antes que su leyenda.)
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
  guests_waiting bigint
)
language sql
stable
set search_path = ''
as $$
  select e.id, e.name, e.sort_order, e.guests_enabled,
         count(t.id),
         count(t.used_at),
         count(t.guest_at),
         count(t.id) filter (where t.used_at is not null and t.guest_at is null)
    from public.events e
    left join public.tickets t on t.event_id = e.id
   group by e.id
   order by e.sort_order;
$$;

revoke execute on function public.ticket_stats() from public, anon;
grant execute on function public.ticket_stats() to authenticated;

notify pgrst, 'reload schema';
