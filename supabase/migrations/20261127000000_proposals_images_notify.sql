-- 社員自揪申請＋管理員審核、活動圖片（最多 3 張）、成團 LINE 通知只發一次。

-- 活動狀態：open＝上架中、cancelled＝取消、pending＝社員自揪待審核、rejected＝審核退回
alter table public.activities drop constraint if exists activities_status_check;
alter table public.activities
  add constraint activities_status_check check (status in ('open', 'cancelled', 'pending', 'rejected'));

alter table public.activities
  add column images              text[] not null default '{}'
                                 check (cardinality(images) <= 3),   -- Storage 路徑（activity-images bucket）
  add column review_note         text,                               -- 退回原因（申請人看得到）
  add column reviewed_at         timestamptz,
  add column reviewed_by         uuid references public.members(id),
  add column reached_notified_at timestamptz;                        -- 成團通知已發送的時間（避免重複發）

-- 已經成團的活動視為「已通知過」，部署後不會補發舊的成團通知
update public.activities a set reached_notified_at = now()
where (select count(*) from public.signups s where s.activity_id = a.id and s.cancelled_at is null) >= a.threshold;

create index activities_created_by_idx on public.activities (created_by);
create index activities_pending_idx on public.activities (status) where status in ('pending', 'rejected');

-- 活動圖片：公開 bucket（網址含隨機 ID、無法列出清單）；上傳一律經過後端 API
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('activity-images', 'activity-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
