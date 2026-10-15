-- =========================================================
-- PARTE 1: Roles de usuario (admin / scanner)
-- Ejecutar en Supabase → SQL Editor ANTES de crear los usuarios.
-- =========================================================

-- Roles posibles
create type public.app_role as enum ('admin', 'scanner');

-- Un perfil por cada usuario de auth.users
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role public.app_role not null default 'scanner',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cada usuario solo puede leer su propio perfil.
-- No hay policies de insert/update/delete: nadie puede cambiarse el rol desde el cliente.
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- Crea el perfil automáticamente (rol 'scanner') al crear un usuario en Authentication
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper para usar en las policies de RLS (tickets, contador, etc.)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- =========================================================
-- Después de crear los usuarios, promover al admin:
--   update public.profiles set role = 'admin' where email = 'admin@tudominio.com';
-- =========================================================
