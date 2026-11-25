-- 從共用試算表的做法搬進網站：
--   預約連結（成團後付款）、方案選項（一行一個）、候補、已付款標記，以及「關於出走社」頁面內容。

alter table public.activities
  add column booking_url text,                                  -- 預約付款連結（simplybook 等）
  add column options     text,                                  -- 接龍可選方案，一行一個（名稱裡可能有「$1,450」的逗號）
  add column wait_max    integer not null default 0
                         check (wait_max between 0 and 20);     -- 候補人數上限

alter table public.signups
  add column option text,                                       -- 接龍時選的方案（公開顯示在名單上）
  add column note   text,                                       -- 給管理員的備註（只有管理員看得到）
  add column paid   boolean not null default false;             -- 管理員勾選「已付款」

-- 網站文字內容（例如「關於出走社」）。只透過後端 API 給通過審核的成員讀。
create table public.site_content (
  key         text primary key,
  body        text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.members(id)
);
alter table public.site_content enable row level security;
revoke all on public.site_content from anon, authenticated;

-- 接龍：名額內 → ok / reached（剛好成團）；名額滿但候補有空位 → waitlist；都滿 → full
drop function public.join_activity(uuid, uuid);
create function public.join_activity(p_activity uuid, p_member uuid, p_option text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity  integer;
  v_threshold integer;
  v_wait      integer;
  v_count     integer;
begin
  select capacity, threshold, wait_max into v_capacity, v_threshold, v_wait
  from activities
  where id = p_activity and status = 'open'
  for update;

  if not found then return 'not_found'; end if;

  if exists (select 1 from signups
             where activity_id = p_activity and member_id = p_member and cancelled_at is null) then
    return 'already_joined';
  end if;

  select count(*) into v_count from signups
  where activity_id = p_activity and cancelled_at is null;

  if v_count >= v_capacity + v_wait then return 'full'; end if;

  insert into signups (activity_id, member_id, option, note) values (p_activity, p_member, p_option, p_note);

  if v_count >= v_capacity then return 'waitlist'; end if;
  if v_count + 1 = v_threshold then return 'reached'; end if;
  return 'ok';
end;
$$;
revoke all on function public.join_activity(uuid, uuid, text, text) from public, anon, authenticated;
