-- =========================================================
-- PARTE 16: Premiación (entrega del reconocimiento: trofeo + kit)
-- Requiere haber ejecutado antes schema.sql y 02 a 15.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- La entrega se guarda en una tabla APARTE (ticket_awards):
-- la tabla tickets y los QR NO se modifican.
-- Con fila = reconocimiento entregado. Sin fila = sin entregar.
-- Solo el admin la cambia (ventana Premiación).
-- =========================================================

create table if not exists public.ticket_awards (
  -- Un registro por QR; si se elimina el QR, se borra su entrega
  ticket_id uuid primary key references public.tickets (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  delivered_by uuid references auth.users (id) on delete set null
);

alter table public.ticket_awards enable row level security;

-- Lectura: quien puede ver el QR puede ver si se le entregó el reconocimiento
drop policy if exists "ticket_awards_select" on public.ticket_awards;
create policy "ticket_awards_select"
  on public.ticket_awards for select
  to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));

-- Nadie escribe directo: solo con la función de abajo
revoke insert, update, delete on public.ticket_awards from anon, authenticated;
revoke all on public.ticket_awards from anon;
grant select on public.ticket_awards to authenticated;

-- ---------------------------------------------------------
-- Marcar / desmarcar reconocimiento entregado (solo admin, sin contraseña:
-- la entrega es rápida y se corrige con el mismo interruptor)
-- ---------------------------------------------------------
create or replace function public.set_ticket_award(p_ticket_id uuid, p_delivered boolean)
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

  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_delivered then
    -- Si ya estaba entregado se conserva la hora original
    insert into public.ticket_awards (ticket_id, delivered_by)
    values (p_ticket_id, auth.uid())
    on conflict (ticket_id) do nothing;
    select delivered_at into v_delivered_at from public.ticket_awards where ticket_id = p_ticket_id;
  else
    delete from public.ticket_awards where ticket_id = p_ticket_id;
    v_delivered_at := null;
  end if;

  return json_build_object('ok', true, 'delivered_at', v_delivered_at);
end;
$$;

revoke execute on function public.set_ticket_award(uuid, boolean) from public, anon;
grant execute on function public.set_ticket_award(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
