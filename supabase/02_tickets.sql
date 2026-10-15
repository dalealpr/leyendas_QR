-- =========================================================
-- PARTE 2: Tickets y validación de QR
-- Requiere haber ejecutado antes schema.sql (roles / profiles / is_admin).
-- Ejecutar en Supabase → SQL Editor.
-- =========================================================

-- pgcrypto da gen_random_bytes(). En Supabase vive en el schema "extensions".
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------
-- Tabla
-- ---------------------------------------------------------
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  name text,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Seguridad (RLS)
-- ---------------------------------------------------------
alter table public.tickets enable row level security;

-- Solo el admin ve la lista de tickets (y los totales del dashboard)
create policy "tickets_select_admin"
  on public.tickets for select
  to authenticated
  using ((select public.is_admin()));

-- Solo el admin crea tickets, y siempre "sin usar"
create policy "tickets_insert_admin"
  on public.tickets for insert
  to authenticated
  with check ((select public.is_admin()) and used_at is null and used_by is null);

-- Sin policies de update/delete = nadie puede modificar ni borrar desde la app.
-- Además quitamos el permiso a nivel de tabla, por si alguien agrega una policy por error.
revoke update, delete on public.tickets from anon, authenticated;
revoke all on public.tickets from anon;

-- ---------------------------------------------------------
-- Validación: la ÚNICA forma de marcar un ticket como usado
-- ---------------------------------------------------------
create or replace function public.validate_ticket(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_used_at timestamptz;
begin
  -- Debe haber sesión y el usuario debe tener perfil (admin o scanner)
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- UN SOLO UPDATE atómico: solo marca si todavía no estaba usado.
  -- Si dos personas escanean el mismo QR a la vez, Postgres bloquea la fila
  -- y solo una de las dos consigue actualizarla.
  update public.tickets
     set used_at = now(),
         used_by = auth.uid()
   where code = trim(p_code)
     and used_at is null
  returning name into v_name;

  if found then
    return json_build_object('ok', true, 'name', v_name);
  end if;

  -- No se actualizó: o ya estaba usado, o no existe
  select used_at into v_used_at
    from public.tickets
   where code = trim(p_code);

  if found then
    return json_build_object('ok', false, 'reason', 'ya_usado', 'used_at', v_used_at);
  end if;

  return json_build_object('ok', false, 'reason', 'invalido');
end;
$$;

revoke execute on function public.validate_ticket(text) from public, anon;
grant execute on function public.validate_ticket(text) to authenticated;

-- ---------------------------------------------------------
-- Realtime: para que el dashboard se actualice solo.
-- Respeta RLS, así que solo el admin recibe los cambios.
-- ---------------------------------------------------------
alter publication supabase_realtime add table public.tickets;
