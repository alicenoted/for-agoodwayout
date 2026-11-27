-- 每日排程：台灣時間每天早上 9:00（UTC 01:00）呼叫 api 的 cron_daily，
-- 發一則「每日提醒」給管理員（即將流標＋待付款）。
--
-- 排程和後端用同一組隨機密碼互相確認，密碼由資料庫自己產生、存在 app_secrets，
-- 不經過任何人手上，也不放進 repo。

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 只有資料庫擁有者和後端（service role）讀得到
create table public.app_secrets (
  key   text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

insert into public.app_secrets (key, value)
values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

select cron.schedule(
  'gwo-daily-notify',
  '0 1 * * *',
  $$
  select net.http_post(
    url     := 'https://qceomzxgeqromtbdxinf.supabase.co/functions/v1/api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where key = 'cron')
    ),
    body    := '{"action":"cron_daily"}'::jsonb
  );
  $$
);

-- 停用：select cron.unschedule('gwo-daily-notify');
