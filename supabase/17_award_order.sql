-- =========================================================
-- PARTE 17: Orden de llamado en la Premiación
-- Requiere haber ejecutado antes schema.sql y 02 a 16.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- La Premiación se ordena por años (10 → 45) y, dentro de cada grupo de años,
-- por la posición que define el admin (modo Ordenar). Sin posición = por nombre.
-- La posición va en una tabla APARTE (ticket_award_order): los QR NO se modifican.
-- =========================================================

create table if not exists public.ticket_award_order (
  -- Un registro por QR; si se elimina el QR, se borra su posición
  ticket_id uuid primary key references public.tickets (id) on delete cascade,
  position int not null check (position > 0),
  updated_at timestamptz not null default now()
);

alter table public.ticket_award_order enable row level security;

-- Lectura: quien puede ver el QR puede ver su posición
drop policy if exists "ticket_award_order_select" on public.ticket_award_order;
create policy "ticket_award_order_select"
  on public.ticket_award_order for select
  to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));

-- Nadie escribe directo: solo con la función de abajo
revoke insert, update, delete on public.ticket_award_order from anon, authenticated;
revoke all on public.ticket_award_order from anon;
grant select on public.ticket_award_order to authenticated;

-- ---------------------------------------------------------
-- Guardar el orden de UN grupo de años (solo admin)
--   p_ticket_ids = los QR del grupo, en el orden de llamado.
--   Se guardan como posiciones 1, 2, 3… (todo en una sola transacción).
-- ---------------------------------------------------------
create or replace function public.set_award_order(p_ticket_ids uuid[])
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_ticket_ids is null or cardinality(p_ticket_ids) = 0 then
    return json_build_object('ok', true, 'saved', 0);
  end if;

  -- Todos los QR deben existir
  select count(*) into v_count from public.tickets where id = any (p_ticket_ids);
  if v_count <> cardinality(p_ticket_ids) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into public.ticket_award_order (ticket_id, position)
  select id, ord::int
    from unnest(p_ticket_ids) with ordinality as u(id, ord)
  on conflict (ticket_id) do update
    set position = excluded.position, updated_at = now();

  return json_build_object('ok', true, 'saved', cardinality(p_ticket_ids));
end;
$$;

revoke execute on function public.set_award_order(uuid[]) from public, anon;
grant execute on function public.set_award_order(uuid[]) to authenticated;

notify pgrst, 'reload schema';
