-- =========================================================
-- PARTE 14: Años de cada leyenda
-- Requiere haber ejecutado antes schema.sql y 02 a 13.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- Los años se guardan en una tabla APARTE (ticket_years):
-- la tabla tickets y los QR NO se modifican.
-- Valores posibles: 10, 15, 20, 25, 30, 35, 40 o 45.
-- Sin fila = todavía no se le asignan años.
-- Solo el admin los cambia (ventana Años).
-- =========================================================

create table if not exists public.ticket_years (
  -- Un registro por QR; si se elimina el QR, se borran sus años
  ticket_id uuid primary key references public.tickets (id) on delete cascade,
  years smallint not null check (years in (10, 15, 20, 25, 30, 35, 40, 45)),
  updated_at timestamptz not null default now()
);

alter table public.ticket_years enable row level security;

-- Lectura: quien puede ver el QR puede ver sus años
-- (la subconsulta respeta las policies de tickets)
drop policy if exists "ticket_years_select" on public.ticket_years;
create policy "ticket_years_select"
  on public.ticket_years for select
  to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));

-- Nadie escribe directo: solo con la función de abajo
revoke insert, update, delete on public.ticket_years from anon, authenticated;
revoke all on public.ticket_years from anon;
grant select on public.ticket_years to authenticated;

-- ---------------------------------------------------------
-- Asignar / quitar los años de un QR (solo admin)
--   p_years = null → sin años
-- ---------------------------------------------------------
create or replace function public.set_ticket_years(p_ticket_id uuid, p_years smallint)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_years is null then
    delete from public.ticket_years where ticket_id = p_ticket_id;
  elsif p_years not in (10, 15, 20, 25, 30, 35, 40, 45) then
    return json_build_object('ok', false, 'reason', 'invalid');
  else
    insert into public.ticket_years (ticket_id, years)
    values (p_ticket_id, p_years)
    on conflict (ticket_id) do update set years = excluded.years, updated_at = now();
  end if;

  return json_build_object('ok', true, 'years', p_years);
end;
$$;

revoke execute on function public.set_ticket_years(uuid, smallint) from public, anon;
grant execute on function public.set_ticket_years(uuid, smallint) to authenticated;

notify pgrst, 'reload schema';
