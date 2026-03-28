-- Meetings core tables
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid references auth.users on delete set null,
  title text,
  status text check (status in ('scheduled','live','ended')) default 'live',
  created_at timestamptz default now()
);

-- Optional: add meetings to the Realtime publication so clients receive host_id updates
-- when the current host leaves and a guest is promoted (see api/meeting/leave).
-- alter publication supabase_realtime add table public.meetings;

-- Tracks last time this room had any activity (signals / requests).
alter table public.meetings
add column if not exists last_activity_at timestamptz default now();

create table if not exists public.meeting_requests (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings on delete cascade,
  requester_id uuid references auth.users on delete set null,
  requester_name text,
  status text check (status in ('pending','approved','rejected')) default 'pending',
  created_at timestamptz default now()
);

create table if not exists public.meeting_signals (
  id bigserial primary key,
  meeting_id uuid references public.meetings on delete cascade,
  from_peer text not null,
  to_peer text,
  type text check (type in ('offer','answer','ice')),
  payload jsonb not null,
  created_at timestamptz default now()
);

-- Deletes old signaling/request rows for rooms that have been inactive for N minutes.
-- This prevents stale WebRTC signals from accumulating and affecting later joins.
create or replace function public.cleanup_inactive_meeting_data(p_minutes integer default 20)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.meeting_signals ms
  using public.meetings m
  where ms.meeting_id = m.id
    and m.last_activity_at < now() - make_interval(mins => p_minutes);

  delete from public.meeting_requests mr
  using public.meetings m
  where mr.meeting_id = m.id
    and m.last_activity_at < now() - make_interval(mins => p_minutes);
end;
$$;

create or replace function public.touch_meeting_activity_and_cleanup()
returns trigger
language plpgsql
security definer
as $$
declare
  has_inactive_rooms boolean;
begin
  update public.meetings
  set last_activity_at = now()
  where id = NEW.meeting_id;

  -- Only run cleanup when there is something eligible to clean.
  select exists (
    select 1
    from public.meetings
    where last_activity_at < now() - make_interval(mins => 20)
    limit 1
  ) into has_inactive_rooms;

  if has_inactive_rooms then
    perform public.cleanup_inactive_meeting_data(20);
  end if;

  return NEW;
end;
$$;

drop trigger if exists meeting_signals_touch_activity on public.meeting_signals;
create trigger meeting_signals_touch_activity
after insert on public.meeting_signals
for each row
execute function public.touch_meeting_activity_and_cleanup();

drop trigger if exists meeting_requests_touch_activity on public.meeting_requests;
create trigger meeting_requests_touch_activity
after insert or update on public.meeting_requests
for each row
execute function public.touch_meeting_activity_and_cleanup();

-- Optional profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);




