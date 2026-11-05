-- =========================================================
-- PARTE 22: Invitado para las leyendas de Listas (sin QR)
-- Requiere haber ejecutado antes schema.sql y 02 a 21.
-- Ejecutar en Supabase → SQL Editor. Se puede ejecutar más de una vez.
--
-- Cada leyenda de una lista puede venir con 1 invitado:
--   guest_status = 'none'    → sin invitado
--                  'pending' → con invitado, todavía no ingresa
--                  'in'      → su invitado ya ingresó (guest_at)
--   guest_name   = nombre del invitado (opcional)
-- Como no hay QR, el ingreso del invitado se marca a mano (Listas / Contador / Editar).
-- Los QR NO se tocan: todo va en la tabla extra_people.
-- =========================================================

alter table public.extra_people
  add column if not exists guest_status text not null default 'none',
  add column if not exists guest_name text,
  add column if not exists guest_at timestamptz,
  add column if not exists guest_by uuid references auth.users (id) on delete set null;

alter table public.extra_people drop constraint if exists extra_people_guest_status_check;
alter table public.extra_people
  add constraint extra_people_guest_status_check check (guest_status in ('none', 'pending', 'in'));

alter table public.extra_people drop constraint if exists extra_people_guest_name_check;
alter table public.extra_people
  add constraint extra_people_guest_name_check check (guest_name is null or length(trim(guest_name)) between 1 and 120);

-- ---------------------------------------------------------
-- Cambiar el invitado de una persona de una lista
--   p_status: 'none' (sin invitado) | 'pending' (con invitado) | 'in' (invitado ingresado)
--   p_guest_name: nombre del invitado; null = se mantiene el que tenía
--   admin → cualquier evento; resto del staff → solo el evento activo
--   (el staff solo puede marcar / desmarcar el ingreso: pending ↔ in)
-- ---------------------------------------------------------
create or replace function public.set_extra_person_guest(p_person_id uuid, p_status text, p_guest_name text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_event_id text;
  v_current text;
  v_name text := nullif(trim(coalesce(p_guest_name, '')), '');
  v_guest_at timestamptz;
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_status not in ('none', 'pending', 'in') then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_name is not null and length(v_name) > 120 then
    return json_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;

  v_is_admin := public.is_admin();

  select g.event_id, p.guest_status into v_event_id, v_current
    from public.extra_people p
    join public.extra_groups g on g.id = p.group_id
   where p.id = p_person_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not v_is_admin then
    if v_event_id is distinct from public.active_event_id() then
      return json_build_object('ok', false, 'reason', 'otro_evento');
    end if;
    -- El staff solo marca o desmarca el ingreso de un invitado que ya está anotado
    if v_current = 'none' or p_status = 'none' then
      return json_build_object('ok', false, 'reason', 'invalid');
    end if;
  end if;

  update public.extra_people
     set guest_status = p_status,
         guest_name = case when p_status = 'none' then null else coalesce(v_name, guest_name) end,
         guest_at = case when p_status = 'in' then coalesce(guest_at, now()) end,
         guest_by = case when p_status = 'in' then coalesce(guest_by, auth.uid()) end
   where id = p_person_id
  returning guest_at into v_guest_at;

  return json_build_object('ok', true, 'guest_at', v_guest_at);
end;
$$;

revoke execute on function public.set_extra_person_guest(uuid, text, text) from public, anon;
grant execute on function public.set_extra_person_guest(uuid, text, text) to authenticated;

-- ---------------------------------------------------------
-- reset_event_status (reemplaza la de 20_lists_award_reset.sql)
-- Igual que antes y además: los invitados de listas que ingresaron vuelven a "con invitado".
-- ---------------------------------------------------------
create or replace function public.reset_event_status(p_event_id text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset int;
  v_extra int;
begin
  if not public.verify_admin_password(p_password) then
    return json_build_object('ok', false, 'reason', 'password');
  end if;

  update public.tickets
     set used_at = null,
         used_by = null,
         guest_at = null,
         guest_by = null
   where event_id = p_event_id
     and (used_at is not null or guest_at is not null);
  get diagnostics v_reset = row_count;

  delete from public.ticket_guest_names n
   using public.tickets t
   where t.id = n.ticket_id and t.event_id = p_event_id;

  delete from public.ticket_guest_declined d
   using public.tickets t
   where t.id = d.ticket_id and t.event_id = p_event_id;

  -- Leyendas de listas: sin ingreso, y su invitado (si tenían) vuelve a "con invitado"
  update public.extra_people p
     set entered_at = null,
         entered_by = null,
         guest_status = case when p.guest_status = 'in' then 'pending' else p.guest_status end,
         guest_at = null,
         guest_by = null
    from public.extra_groups g
   where g.id = p.group_id
     and g.event_id = p_event_id
     and p.is_leyenda
     and (p.entered_at is not null or p.guest_status = 'in');
  get diagnostics v_extra = row_count;

  return json_build_object('ok', true, 'reset', v_reset + v_extra);
end;
$$;

revoke execute on function public.reset_event_status(text, text) from public, anon;
grant execute on function public.reset_event_status(text, text) to authenticated;

notify pgrst, 'reload schema';
