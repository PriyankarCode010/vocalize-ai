-- Fix signaling RLS to allow WebRTC offers/answers/ICE
alter table public.meeting_signals enable row level security;

drop policy if exists ms_insert on public.meeting_signals;
drop policy if exists ms_select on public.meeting_signals;

create policy ms_insert on public.meeting_signals
  for insert
  with check (auth.uid() is not null);

create policy ms_select on public.meeting_signals
  for select
  using (auth.uid() is not null);

-- Optional: allow delete by any authenticated user
drop policy if exists ms_delete on public.meeting_signals;
create policy ms_delete on public.meeting_signals
  for delete
  using (auth.uid() is not null);

-- Ensure meeting_requests is not blocking host approval flow
alter table public.meeting_requests enable row level security;
drop policy if exists mr_insert on public.meeting_requests;
drop policy if exists mr_select on public.meeting_requests;
drop policy if exists mr_update on public.meeting_requests;

create policy mr_insert on public.meeting_requests
  for insert with check (auth.uid() = requester_id);

create policy mr_select on public.meeting_requests
  for select using (
    auth.uid() = requester_id
    or auth.uid() in (select host_id from public.meetings m where m.id = meeting_requests.meeting_id)
  );

create policy mr_update on public.meeting_requests
  for update
  using (
    auth.uid() in (select host_id from public.meetings m where m.id = meeting_requests.meeting_id)
  )
  with check (true);


