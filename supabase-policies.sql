-- Meetings: read for lobby; only host may update (e.g. host transfer on leave); creator inserts as host
alter table public.meetings enable row level security;

drop policy if exists meetings_select_public on public.meetings;
create policy meetings_select_public on public.meetings
  for select using (true);

drop policy if exists meetings_insert_host on public.meetings;
create policy meetings_insert_host on public.meetings
  for insert with check (auth.uid() = host_id);

drop policy if exists meetings_update_host on public.meetings;
create policy meetings_update_host on public.meetings
  for update using (auth.uid() = host_id);

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

-- Meeting chat: host or approved guest only
alter table public.meeting_chat_messages enable row level security;
drop policy if exists mcm_select on public.meeting_chat_messages;
drop policy if exists mcm_insert on public.meeting_chat_messages;
drop policy if exists mcm_delete on public.meeting_chat_messages;

create policy mcm_select on public.meeting_chat_messages
  for select using (
    auth.uid() is not null
    and (
      auth.uid() in (select m.host_id from public.meetings m where m.id = meeting_chat_messages.meeting_id)
      or exists (
        select 1 from public.meeting_requests mr
        where mr.meeting_id = meeting_chat_messages.meeting_id
          and mr.requester_id = auth.uid()
          and mr.status = 'approved'
      )
    )
  );

create policy mcm_insert on public.meeting_chat_messages
  for insert with check (
    auth.uid() = sender_id
    and (
      auth.uid() in (select m.host_id from public.meetings m where m.id = meeting_chat_messages.meeting_id)
      or exists (
        select 1 from public.meeting_requests mr
        where mr.meeting_id = meeting_chat_messages.meeting_id
          and mr.requester_id = auth.uid()
          and mr.status = 'approved'
      )
    )
  );

create policy mcm_delete on public.meeting_chat_messages
  for delete using (
    auth.uid() is not null
    and (
      auth.uid() in (select m.host_id from public.meetings m where m.id = meeting_chat_messages.meeting_id)
      or exists (
        select 1 from public.meeting_requests mr
        where mr.meeting_id = meeting_chat_messages.meeting_id
          and mr.requester_id = auth.uid()
          and mr.status = 'approved'
      )
    )
  );

alter table public.meeting_chat_clear_votes enable row level security;
drop policy if exists mccv_select on public.meeting_chat_clear_votes;
drop policy if exists mccv_upsert on public.meeting_chat_clear_votes;
drop policy if exists mccv_update on public.meeting_chat_clear_votes;
drop policy if exists mccv_delete on public.meeting_chat_clear_votes;

create policy mccv_select on public.meeting_chat_clear_votes
  for select using (
    auth.uid() is not null
    and (
      auth.uid() in (select m.host_id from public.meetings m where m.id = meeting_chat_clear_votes.meeting_id)
      or exists (
        select 1 from public.meeting_requests mr
        where mr.meeting_id = meeting_chat_clear_votes.meeting_id
          and mr.requester_id = auth.uid()
          and mr.status = 'approved'
      )
    )
  );

create policy mccv_upsert on public.meeting_chat_clear_votes
  for insert with check (
    auth.uid() = user_id
    and (
      auth.uid() in (select m.host_id from public.meetings m where m.id = meeting_chat_clear_votes.meeting_id)
      or exists (
        select 1 from public.meeting_requests mr
        where mr.meeting_id = meeting_chat_clear_votes.meeting_id
          and mr.requester_id = auth.uid()
          and mr.status = 'approved'
      )
    )
  );

create policy mccv_update on public.meeting_chat_clear_votes
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy mccv_delete on public.meeting_chat_clear_votes
  for delete using (
    auth.uid() is not null
    and (
      auth.uid() in (select m.host_id from public.meetings m where m.id = meeting_chat_clear_votes.meeting_id)
      or exists (
        select 1 from public.meeting_requests mr
        where mr.meeting_id = meeting_chat_clear_votes.meeting_id
          and mr.requester_id = auth.uid()
          and mr.status = 'approved'
      )
    )
  );


