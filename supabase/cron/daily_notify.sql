-- 每日排程：台灣時間每天早上 9:00 呼叫 api 的 cron_daily
--   1. 活動前 7 天還沒成團 → 提醒管理員「即將流標」（每場一次）
--   2. 今日待付款名單 → 傳給管理員（一天一次，有人未付款才發）
--
-- 部署時手動執行一次（不放進 migrations，因為需要先設定密碼）：
--   1. Supabase → Edge Functions → Secrets 新增 CRON_SECRET（一串隨機字，例如 openssl rand -hex 24 產生）
--   2. Supabase → Database → Extensions 開啟 pg_cron、pg_net
--   3. 把同一串密碼存進 Vault：
--        select vault.create_secret('<同一串密碼>', 'cron_secret');
--   4. 執行下面這段（密碼從 Vault 讀，不會寫在排程裡）
--
-- 01:00 UTC = 台灣 09:00

select cron.schedule(
  'gwo-daily-notify',
  '0 1 * * *',
  $$
  select net.http_post(
    url     := 'https://qceomzxgeqromtbdxinf.supabase.co/functions/v1/api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{"action":"cron_daily"}'::jsonb
  );
  $$
);

-- 停用：select cron.unschedule('gwo-daily-notify');
