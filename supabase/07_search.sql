-- =========================================================
-- PARTE 7: Búsqueda por nombre sin tildes (para el Contador)
-- Requiere haber ejecutado antes 02_tickets.sql.
-- Ejecutar en Supabase → SQL Editor.
--
-- Crea una "columna calculada" name_search: el nombre en minúscula y sin
-- tildes ("María José" → "maria jose"). La app filtra con ella, así
-- "jose" encuentra a "José". No ocupa espacio: se calcula al consultar.
-- =========================================================

create extension if not exists unaccent with schema extensions;

create or replace function public.name_search(t public.tickets)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(extensions.unaccent(coalesce(t.name, 'sin nombre')));
$$;

-- Para que la API detecte la columna nueva de inmediato
notify pgrst, 'reload schema';
