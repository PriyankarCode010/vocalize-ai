-- Meetings core tables
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid references auth.users on delete set null,
  title text,
  status text check (status in ('scheduled','live','ended')) default 'live',
  created_at timestamptz default now()
);

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

-- Optional profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);



