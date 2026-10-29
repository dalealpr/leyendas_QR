-- =========================================================
-- PARTE 9: Evento activo
-- Requiere haber ejecutado antes schema.sql y 02 a 08.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
--   • El admin activa UN evento (solo puede haber uno activo a la vez).
--   • admin y dashboard ven los tickets de todos los eventos.
--   • scanner solo ve los tickets del evento activo (o nada si no hay).
-- =========================================================

-- ---------------------------------------------------------
-- 1. Columna is_active + regla "solo uno activo"
-- ---------------------------------------------------------
alter table public.events
  add column if not exists is_active boolean not null default false;

-- Índice único parcial: como máximo UNA fila con is_active = true
create unique index if not exists events_only_one_active
  on public.events ((true))
  where is_active;

-- ---------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------
-- id del evento activo (null si no hay)
create or replace function public.active_event_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.events where is_active limit 1;
$$;

-- ¿Puede ver tickets de TODOS los eventos? (admin o dashboard)
create or replace function public.can_view_all_tickets()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role::text in ('admin', 'dashboard')
  );
$$;

revoke execute on function public.active_event_id() from public, anon;
grant execute on function public.active_event_id() to authenticated;
revoke execute on function public.can_view_all_tickets() from public, anon;
grant execute on function public.can_view_all_tickets() to authenticated;

-- ---------------------------------------------------------
-- 3. Lectura de tickets
--    admin / dashboard → todos
--    resto del staff   → solo los del evento activo
-- ---------------------------------------------------------
drop policy if exists "tickets_select_admin" on public.tickets;
drop policy if exists "tickets_select_viewers" on public.tickets;
drop policy if exists "tickets_select_staff" on public.tickets;

create policy "tickets_select_staff"
  on public.tickets for select
  to authenticated
  using (
    (select public.can_view_all_tickets())
    or (
      (select public.can_view_tickets())
      and event_id = (select public.active_event_id())
    )
  );

-- ---------------------------------------------------------
-- 4. Activar / desactivar (solo admin)
--    p_event_id = null → ningún evento activo
--    ⚠ Reemplazada en 12_toggle_password.sql (con contraseña).
--      Si vuelves a ejecutar este archivo, ejecuta después el 12.
-- ---------------------------------------------------------
create or replace function public.set_active_event(p_event_id text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
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

revoke execute on function public.set_active_event(text) from public, anon;
grant execute on function public.set_active_event(text) to authenticated;

-- ---------------------------------------------------------
-- 5. Realtime en events: el Contador se entera al instante
--    cuando el admin cambia el evento activo
-- ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end;
$$;

notify pgrst, 'reload schema';
