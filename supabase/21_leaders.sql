-- =========================================================
-- PARTE 21: Líderes
-- Requiere haber ejecutado antes schema.sql y 02 a 20.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
--   • Leyendas con QR: la marca va en una tabla APARTE (ticket_leaders).
--     Los QR NO se modifican. Se carga por SQL (ver punto 4).
--   • Personas de Listas: nueva columna is_leader (casilla en la ventana Listas).
--   • En la app: etiqueta "Líder" y filtro "Líderes". No cambia conteos ni orden.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Líderes de las leyendas con QR (sin fila = no es líder)
-- ---------------------------------------------------------
create table if not exists public.ticket_leaders (
  ticket_id uuid primary key references public.tickets (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.ticket_leaders enable row level security;

-- Lectura: quien puede ver el QR puede ver si es líder
drop policy if exists "ticket_leaders_select" on public.ticket_leaders;
create policy "ticket_leaders_select"
  on public.ticket_leaders for select
  to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));

-- Desde la app nadie escribe: se carga por SQL
revoke insert, update, delete on public.ticket_leaders from anon, authenticated;
revoke all on public.ticket_leaders from anon;
grant select on public.ticket_leaders to authenticated;

-- ---------------------------------------------------------
-- 2. Líder en las personas de Listas
-- ---------------------------------------------------------
alter table public.extra_people
  add column if not exists is_leader boolean not null default false;

-- ---------------------------------------------------------
-- 3. add_extra_person / update_extra_person con la casilla "Líder"
--    (reemplazan las de 19_extra_lists.sql; cambia la firma, por eso se borran antes)
-- ---------------------------------------------------------
drop function if exists public.add_extra_person(uuid, text, boolean, smallint);
drop function if exists public.update_extra_person(uuid, text, boolean, smallint);

create or replace function public.add_extra_person(
  p_group_id uuid,
  p_name text,
  p_is_leyenda boolean,
  p_years smallint,
  p_is_leader boolean
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

  insert into public.extra_people (group_id, name, is_leyenda, years, is_leader, entered_at, entered_by, created_by)
  values (
    p_group_id,
    v_name,
    v_leyenda,
    case when v_leyenda then p_years end,
    coalesce(p_is_leader, false),
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
  p_years smallint,
  p_is_leader boolean
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
         is_leader = coalesce(p_is_leader, false),
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

revoke execute on function public.add_extra_person(uuid, text, boolean, smallint, boolean) from public, anon;
revoke execute on function public.update_extra_person(uuid, text, boolean, smallint, boolean) from public, anon;
grant execute on function public.add_extra_person(uuid, text, boolean, smallint, boolean) to authenticated;
grant execute on function public.update_extra_person(uuid, text, boolean, smallint, boolean) to authenticated;

-- ---------------------------------------------------------
-- 4. Cargar los líderes de CORPORATIVO (y sus años)
--    Para otro evento: copia este bloque y cambia el evento, los nombres y los años.
-- ---------------------------------------------------------
with lideres(nombre, years) as (
  values
    ('ALONSO BEINGOLEA', 15),
    ('AGUSTINA OCHOA', 25),
    ('MARCIO BATISTA JULIANO', 30)
),
encontrados as (
  select t.id, l.years
    from lideres l
    join public.tickets t
      on t.event_id = 'corporativo'
     and lower(trim(t.name)) = lower(l.nombre)
),
marca as (
  insert into public.ticket_leaders (ticket_id)
  select id from encontrados
  on conflict (ticket_id) do nothing
)
-- Sus años (tabla de años de siempre; se actualizan si ya tenían otros)
insert into public.ticket_years (ticket_id, years)
select id, years::smallint from encontrados
on conflict (ticket_id) do update set years = excluded.years, updated_at = now();

-- Comprobación: deben salir los 3, con "es_lider = true" y sus años
select t.name,
       exists (select 1 from public.ticket_leaders l where l.ticket_id = t.id) as es_lider,
       y.years
  from public.tickets t
  left join public.ticket_years y on y.ticket_id = t.id
 where t.event_id = 'corporativo'
   and lower(trim(t.name)) in ('alonso beingolea', 'agustina ochoa', 'marcio batista juliano')
 order by t.name;

notify pgrst, 'reload schema';
