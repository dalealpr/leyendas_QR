-- =========================================================
-- PARTE 3: Eventos
-- Requiere haber ejecutado antes schema.sql y 02_tickets.sql.
-- Ejecutar en Supabase → SQL Editor.
--
-- Los eventos son fijos: se cargan aquí y no se editan desde la app.
-- =========================================================

-- ---------------------------------------------------------
-- Tabla de eventos
-- ---------------------------------------------------------
create table public.events (
  id text primary key,          -- identificador interno (no cambiar)
  name text not null unique,    -- nombre que se muestra en la app
  sort_order int not null       -- orden en los selectores
);

insert into public.events (id, name, sort_order) values
  ('t77',         'T77',           1),
  ('arequipa',    'AREQUIPA',      2),
  ('supply_ate',  'SUPPLY ATE',    3),
  ('cusco',       'CUSCO',         4),
  ('corporativo', 'CORPORATIVO',   5),
  ('san_juan',    'SAN JUAN',      6),
  ('motupe',      'MOTUPE',        7),
  ('prueba',      'EVENTO PRUEBA', 8);

alter table public.events enable row level security;

-- Cualquier usuario con sesión puede leer la lista de eventos
create policy "events_select_authenticated"
  on public.events for select
  to authenticated
  using (true);

-- Nadie puede crear, editar ni borrar eventos desde la app
revoke insert, update, delete on public.events from anon, authenticated;
revoke all on public.events from anon;

-- ---------------------------------------------------------
-- Cada ticket pertenece a un evento (obligatorio)
-- ---------------------------------------------------------
alter table public.tickets
  add column event_id text references public.events (id);

-- Tickets creados antes de este cambio (pruebas) → EVENTO PRUEBA
update public.tickets set event_id = 'prueba' where event_id is null;

alter table public.tickets
  alter column event_id set not null;

create index tickets_event_id_idx on public.tickets (event_id);

-- ---------------------------------------------------------
-- Totales por evento para el dashboard (una sola consulta)
-- security invoker (por defecto): respeta RLS, así que solo el admin ve números reales.
-- ---------------------------------------------------------
create or replace function public.ticket_stats()
returns table (event_id text, event_name text, sort_order int, total bigint, used bigint)
language sql
stable
set search_path = ''
as $$
  select e.id, e.name, e.sort_order, count(t.id), count(t.used_at)
    from public.events e
    left join public.tickets t on t.event_id = e.id
   group by e.id
   order by e.sort_order;
$$;

revoke execute on function public.ticket_stats() from public, anon;
grant execute on function public.ticket_stats() to authenticated;

-- Para que la API detecte las tablas/columnas nuevas de inmediato
notify pgrst, 'reload schema';
