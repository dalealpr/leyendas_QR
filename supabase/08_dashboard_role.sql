-- =========================================================
-- PARTE 8: Rol "dashboard" + Contador para todos los usuarios
-- Requiere haber ejecutado antes schema.sql y 02 a 07.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- Permisos:
--   admin            → todo
--   dashboard/scanner→ ver tickets y totales (Contador) y escanear
--   ❌ crear, editar, cambiar status o eliminar siguen siendo solo admin
-- =========================================================

-- 1. Nuevo valor del rol
alter type public.app_role add value if not exists 'dashboard';

-- 2. ¿Puede ver tickets? Cualquier usuario del staff (con perfil, de cualquier rol)
create or replace function public.can_view_tickets()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

revoke execute on function public.can_view_tickets() from public, anon;
grant execute on function public.can_view_tickets() to authenticated;

-- 3. Lectura de tickets: antes solo admin, ahora todo el staff.
--    (Crear tickets sigue siendo solo admin: la policy de insert no cambia.)
drop policy if exists "tickets_select_admin" on public.tickets;
drop policy if exists "tickets_select_viewers" on public.tickets;

create policy "tickets_select_viewers"
  on public.tickets for select
  to authenticated
  using ((select public.can_view_tickets()));

-- =========================================================
-- 4. DESPUÉS de ejecutar lo anterior, en una query NUEVA, asigna el rol:
--
--   update public.profiles set role = 'dashboard' where email = 'dashboard@leyendas.com';
--
-- (Va aparte porque Postgres no deja usar un valor nuevo del rol
--  en la misma ejecución en que se crea.)
-- =========================================================
