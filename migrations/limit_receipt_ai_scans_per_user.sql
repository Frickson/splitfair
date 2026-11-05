-- A limited server-side quota keeps a shared free-tier Gemini key from being exhausted.
create table if not exists public.receipt_scan_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_utc date not null,
  used_count integer not null default 0 check (used_count >= 0),
  last_request_at timestamptz not null default now(),
  primary key (user_id, day_utc)
);
alter table public.receipt_scan_quota enable row level security;
revoke all on public.receipt_scan_quota from public, anon, authenticated;
grant select, insert, update on public.receipt_scan_quota to service_role;

create or replace function public.claim_receipt_scan_quota(p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  if p_user_id is null then return false; end if;
  insert into public.receipt_scan_quota(user_id,day_utc,used_count,last_request_at)
  values (p_user_id, (now() at time zone 'utc')::date, 1, now())
  on conflict (user_id,day_utc)
  do update set used_count=public.receipt_scan_quota.used_count+1,
                last_request_at=now()
  where public.receipt_scan_quota.used_count < 20
    and public.receipt_scan_quota.last_request_at < now() - interval '8 seconds'
  returning used_count into v_count;
  return v_count is not null;
end;
$$;
revoke all on function public.claim_receipt_scan_quota(uuid) from public,anon,authenticated;
grant execute on function public.claim_receipt_scan_quota(uuid) to service_role;