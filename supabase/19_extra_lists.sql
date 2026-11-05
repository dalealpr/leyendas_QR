-- =========================================================
-- PARTE 19: Listas (personas sin QR agregadas a mano)
-- Requiere haber ejecutado antes schema.sql y 02 a 18.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
--   • Por evento se crean listas (ej. "Gerencia", "Prensa").
--   • Cada lista tiene personas: nombre, ¿incluir como leyenda?, años (si es leyenda).
--   • NO tienen QR. Los QR y la tabla tickets NO se tocan: todo va en tablas nuevas.
--   • Ingreso:
--       - persona normal  → queda ingresada al agregarla (se registra cuando llega)
--       - incluida como leyenda → empieza SIN ingreso; se marca a mano (Editar / Contador)
--   • Las incluidas como leyenda cuentan en la card Leyendas y aparecen en Premiación.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------
create table if not exists public.extra_groups (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events (id),
  name text not null check (length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (event_id, name)
);

create table if not exists public.extra_people (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.extra_groups (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  is_leyenda boolean not null default false,
  -- Años solo para leyendas (opcional: sin años va al grupo "Sin años" en Premiación)
  years smallint check (years is null or years in (10, 15, 20, 25, 30, 35, 40, 45)),
  -- Ingreso al evento (null = todavía no ingresa)
  entered_at timestamptz,
  entered_by uuid references auth.users (id) on delete set null,
  -- Premiación: reconocimiento entregado y orden de llamado dentro de su grupo de años
  delivered_at timestamptz,
  delivered_by uuid references auth.users (id) on delete set null,
  award_position int check (award_position is null or award_position > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint extra_people_years_only_leyenda check (is_leyenda or years is null)
);

create index if not exists extra_groups_event_idx on public.extra_groups (event_id);
create index if not exists extra_people_group_idx on public.extra_people (group_id);

-- ---------------------------------------------------------
-- 2. Lectura: igual que los QR
--    admin / dashboard → todos los eventos; resto del staff → solo el evento activo
-- ---------------------------------------------------------
alter table public.extra_groups enable row level security;
alter table public.extra_people enable row level security;

drop policy if exists "extra_groups_select" on public.extra_groups;
create policy "extra_groups_select"
  on public.extra_groups for select
  to authenticated
  using (
    (select public.can_view_all_tickets())
    or ((select public.can_view_tickets()) and event_id = (select public.active_event_id()))
  );

drop policy if exists "extra_people_select" on public.extra_people;
create policy "extra_people_select"
  on public.extra_people for select
  to authenticated
  using (exists (select 1 from public.extra_groups g where g.id = group_id));

-- Nadie escribe directo: solo con las funciones de abajo
revoke insert, update, delete on public.extra_groups, public.extra_people from anon, authenticated;
revoke all on public.extra_groups, public.extra_people from anon;
grant select on public.extra_groups, public.extra_people to authenticated;

-- ---------------------------------------------------------
-- 3. Listas (solo admin)
-- ---------------------------------------------------------
create or replace function public.create_extra_group(p_event_id text, p_name text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 80 then
    return json_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if exists (select 1 from public.extra_groups where event_id = p_event_id and lower(name) = lower(v_name)) then
    return json_build_object('ok', false, 'reason', 'duplicado');
  end if;

  insert into public.extra_groups (event_id, name, sort_order, created_by)
  values (
    p_event_id,
    v_name,
    coalesce((select max(sort_order) + 1 from public.extra_groups where event_id = p_event_id), 1),
    auth.uid()
  )
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.rename_extra_group(p_group_id uuid, p_name text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_event_id text;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 80 then
    return json_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;
  select event_id into v_event_id from public.extra_groups where id = p_group_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if exists (
    select 1 from public.extra_groups
     where event_id = v_event_id and lower(name) = lower(v_name) and id <> p_group_id
  ) then
    return json_build_object('ok', false, 'reason', 'duplicado');
  end if;

  update public.extra_groups set name = v_name where id = p_group_id;
  return json_build_object('ok', true);
end;
$$;

-- Borra la lista y todas sus personas: pide la contraseña del admin
create or replace function public.delete_extra_group(p_group_id uuid, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  if not public.verify_admin_password(p_password) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;
  select count(*) into v_deleted from public.extra_people where group_id = p_group_id;
  delete from public.extra_groups where id = p_group_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  return json_build_object('ok', true, 'deleted_people', v_deleted);
end;
$$;

-- ---------------------------------------------------------
-- 4. Personas (solo admin)
-- ---------------------------------------------------------
create or replace function public.add_extra_person(
  p_group_id uuid,
  p_name text,
  p_is_leyenda boolean,
  p_years smallint
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_leyenda boolean := coalesce(p_is_leyenda, false);
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 120 then
    return json_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;
  if not exists (select 1 from public.extra_groups where id = p_group_id) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_years is not null and (not v_leyenda or p_years not in (10, 15, 20, 25, 30, 35, 40, 45)) then
    return json_build_object('ok', false, 'reason', 'anios_invalidos');
  end if;

  insert into public.extra_people (group_id, name, is_leyenda, years, entered_at, entered_by, created_by)
  values (
    p_group_id,
    v_name,
    v_leyenda,
    case when v_leyenda then p_years end,
    -- Persona normal: ingresa al agregarla. Leyenda: el ingreso se marca a mano.
    case when v_leyenda then null else now() end,
    case when v_leyenda then null else auth.uid() end,
    auth.uid()
  )
  returning id into v_id;

  return json_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.update_extra_person(
  p_person_id uuid,
  p_name text,
  p_is_leyenda boolean,
  p_years smallint
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_leyenda boolean := coalesce(p_is_leyenda, false);
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 120 then
    return json_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;
  if p_years is not null and (not v_leyenda or p_years not in (10, 15, 20, 25, 30, 35, 40, 45)) then
    return json_build_object('ok', false, 'reason', 'anios_invalidos');
  end if;

  update public.extra_people
     set name = v_name,
         is_leyenda = v_leyenda,
         years = case when v_leyenda then p_years end,
         -- Si deja de ser leyenda, ya no participa de la premiación
         delivered_at = case when v_leyenda then delivered_at end,
         delivered_by = case when v_leyenda then delivered_by end,
         award_position = case when v_leyenda then award_position end
   where id = p_person_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.delete_extra_person(p_person_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  delete from public.extra_people where id = p_person_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------
-- 5. Marcar ingreso a mano (Editar / Contador)
--    admin → cualquier evento; resto del staff → solo el evento activo
-- ---------------------------------------------------------
create or replace function public.set_extra_person_entry(p_person_id uuid, p_entered boolean)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id text;
  v_entered_at timestamptz;
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select g.event_id into v_event_id
    from public.extra_people p
    join public.extra_groups g on g.id = p.group_id
   where p.id = p_person_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.is_admin() and v_event_id is distinct from public.active_event_id() then
    return json_build_object('ok', false, 'reason', 'otro_evento');
  end if;

  if p_entered then
    -- Si ya estaba ingresada se conserva la hora original
    update public.extra_people
       set entered_at = coalesce(entered_at, now()),
           entered_by = coalesce(entered_by, auth.uid())
     where id = p_person_id
    returning entered_at into v_entered_at;
  else
    update public.extra_people set entered_at = null, entered_by = null where id = p_person_id;
    v_entered_at := null;
  end if;

  return json_build_object('ok', true, 'entered_at', v_entered_at);
end;
$$;

-- ---------------------------------------------------------
-- 6. Premiación de las leyendas de listas (solo admin)
-- ---------------------------------------------------------
create or replace function public.set_extra_person_award(p_person_id uuid, p_delivered boolean)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivered_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.extra_people where id = p_person_id and is_leyenda) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_delivered then
    update public.extra_people
       set delivered_at = coalesce(delivered_at, now()),
           delivered_by = coalesce(delivered_by, auth.uid())
     where id = p_person_id
    returning delivered_at into v_delivered_at;
  else
    update public.extra_people set delivered_at = null, delivered_by = null where id = p_person_id;
    v_delivered_at := null;
  end if;

  return json_build_object('ok', true, 'delivered_at', v_delivered_at);
end;
$$;

-- ---------------------------------------------------------
-- 7. Permisos de las funciones
-- ---------------------------------------------------------
revoke execute on function public.create_extra_group(text, text) from public, anon;
revoke execute on function public.rename_extra_group(uuid, text) from public, anon;
revoke execute on function public.delete_extra_group(uuid, text) from public, anon;
revoke execute on function public.add_extra_person(uuid, text, boolean, smallint) from public, anon;
revoke execute on function public.update_extra_person(uuid, text, boolean, smallint) from public, anon;
revoke execute on function public.delete_extra_person(uuid) from public, anon;
revoke execute on function public.set_extra_person_entry(uuid, boolean) from public, anon;
revoke execute on function public.set_extra_person_award(uuid, boolean) from public, anon;

grant execute on function public.create_extra_group(text, text) to authenticated;
grant execute on function public.rename_extra_group(uuid, text) to authenticated;
grant execute on function public.delete_extra_group(uuid, text) to authenticated;
grant execute on function public.add_extra_person(uuid, text, boolean, smallint) to authenticated;
grant execute on function public.update_extra_person(uuid, text, boolean, smallint) to authenticated;
grant execute on function public.delete_extra_person(uuid) to authenticated;
grant execute on function public.set_extra_person_entry(uuid, boolean) to authenticated;
grant execute on function public.set_extra_person_award(uuid, boolean) to authenticated;

-- ---------------------------------------------------------
-- 8. Realtime: el Contador se entera al instante de los ingresos de listas
-- ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'extra_people'
  ) then
    alter publication supabase_realtime add table public.extra_people;
  end if;
end;
$$;

notify pgrst, 'reload schema';
