-- LINE 通知第二輪：滿團、候補遞補、流標、活動刪除、每日待付款名單。

alter table public.activities
  add column full_notified_at timestamptz,    -- 「滿團」已通知管理員的時間（每場只發一次）
  add column flop_warned_at   timestamptz,    -- 「即將流標」已提醒管理員的時間（每場只發一次）
  add column cancel_reason    text,           -- 流標（status = 'cancelled'）時給社員看的說明
  add column cancelled_at     timestamptz;

alter table public.signups
  add column promoted_at timestamptz;          -- 從候補遞補為正取的時間（對帳用）

-- 已經滿團的活動視為「已通知過」，部署後不補發
update public.activities a set full_notified_at = now()
where (select count(*) from public.signups s where s.activity_id = a.id and s.cancelled_at is null) >= a.capacity;

-- 每日排程發過什麼（例如 digest:2026-11-28），避免同一天重發
create table public.notify_log (
  key      text primary key,
  sent_at  timestamptz not null default now()
);
alter table public.notify_log enable row level security;
revoke all on public.notify_log from anon, authenticated;
