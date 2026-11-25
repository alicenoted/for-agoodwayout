# 出走社活動接龍網站：開發紀錄

給之後接手的人（新的 Claude 對話或工程師）：先讀這份，再動手。

## 目標（第一階段）

先讓社員**看到人潮**：用 LINE 登入後接龍，公開名單只顯示暱稱，資料存在資料庫。
需求來源：`女子出走社` Obsidian 資料夾裡的〈需求重點〉與〈功能結構表〉。

## 已決定的事

| 項目 | 決定 | 原因 |
|---|---|---|
| 身分 | LINE 登入（LIFF）＋社員自填社群暱稱 | 只填暱稱無法辨識本人；LINE 社群沒有對外 API，暱稱只能自填 |
| 資料庫 | Supabase（免費方案，東京區） | 名額搶位不出錯、權限控管完整、即時更新 |
| 統計 | 之後每天匯出到 Google 試算表 | 管理員習慣用試算表；兼作備份 |
| 測試主機 | GitHub Pages | repo 為公開，免費、有 HTTPS |
| 正式主機 | 上線前再決定（Cloudflare Pages 候選） | GitHub Pages / Vercel 免費版都不適合商業用途 |
| 工程 | 第一階段由 Claude 擔任，沒有真人工程師 | — |

## 架構

```
社員手機（LINE 內開啟）
  └─ 網頁（GitHub Pages，靜態檔）
       └─ 所有讀寫 ───→ Supabase Edge Function `api`
                          ├─ 用 LINE 驗證 ID token（確認是本人）
                          ├─ 檢查審核狀態（待審核／停用的人拿不到任何資料）
                          └─ 用 service role 讀寫資料庫
資料庫對 anon / authenticated 完全不開放（2026-11-15 起）
```

- **不需要 LINE Channel secret**：驗證 ID token 只要 Channel ID。
- 網頁上會出現的 LIFF ID、Supabase URL、publishable key 都是**公開值**，可以放在程式碼裡；資料庫已不對它開放任何讀寫。
- service role key 只存在 Supabase Edge Function 的環境設定，**絕對不放進 repo**。

## 資料表（`supabase/migrations/`）

| 表 | 內容 | 公開？ |
|---|---|---|
| `members` | LINE 內部 ID、LINE 顯示名稱、社群暱稱、是否為管理員、審核狀態（`pending` / `approved` / `disabled`）、審核時間 | 否 |
| `activities` | 類別、名稱、日期、地點、費用、名額、開班門檻 | 否（通過審核的成員經由 API 讀取） |
| `signups` | 哪個社員、哪場活動、接龍時間、取消時間 | 否（API 只回傳暱稱） |

- 新成員預設 `pending`；管理員在後台「人員清單」通過後才看得到活動。

- `join_activity()`：鎖住活動那一列再檢查名額，避免兩人同時搶到最後一位。只有後端能呼叫。
- 2026-11-15 已在本機 PostgreSQL 16 模擬 Supabase 預設權限測過：重複接龍、額滿、取消後遞補、訪客讀不到 LINE ID、訪客無法直接寫入，皆正確。
- 已套用到 Supabase 專案。Security Advisor 會提示「RLS 已開啟但沒有 policy」（INFO），這是刻意的：三張表都只讓後端讀寫。

## 服務與公開設定值

| 服務 | 值 |
|---|---|
| Supabase 專案 | `agoodwayout`，URL `https://qceomzxgeqromtbdxinf.supabase.co`（組織 `alicenoted-job`，東京） |
| GitHub Pages | 從 `claude/dazzling-bell-q1quxi` 分支根目錄發布：`https://alicenoted.github.io/for-agoodwayout/` |
| GitHub repo | `alicenoted/for-agoodwayout`（2026-11-25 從 `alicenoted-coder` 轉移過來；舊的 `alicenoted-coder.github.io` Pages 網址已失效） |
| LINE Login channel（測試） | Provider `出走社測試`，Channel ID `2012620335`（開發中狀態，只有管理員／測試者能登入） |
| LIFF app（測試） | LIFF ID `2012620335-Hk2HkkYY`，網址 `https://liff.line.me/2012620335-Hk2HkkYY`，Endpoint `https://alicenoted.github.io/for-agoodwayout/app/` |
| Edge Function | `api`（`verify_jwt` 關閉，改由函式自己向 LINE 驗證 ID token） |
| 官方帳號（測試） | `出走社測試`；目前**沒有使用**（LINE 通知已移除）。Supabase Secrets 裡的 `LINE_MESSAGING_TOKEN` 已用不到，可刪除 |

> 正式上線時：在**出走社官方帳號所屬的 Provider** 底下另建 LINE Login channel＋LIFF，替換 `app/index.html` 的 `CONFIG.liffId` 與 Edge Function 的 `LINE_CHANNEL_ID`，並清除測試資料。

## 目錄

| 路徑 | 內容 |
|---|---|
| `app/index.html` | **正式網頁**：LINE 登入（LIFF）＋讀寫 Supabase。版面沿用 `prototype/stage1_v2.html` |
| `supabase/functions/api/` | 後端 API：驗證 LINE 身分後處理暱稱、接龍、管理員操作 |
| `prototype/` | 介面原型（純前端、資料存瀏覽器）。`stage1_v2.html` 是目前定稿的版面（左側日曆） |
| `demo/` | **2026-11-25 起停止同步**（管理員要求之後只改正式網站）；保留當時的畫面供體驗。體驗模式。`demo-backend.js` 是假後端（規則對照 `supabase/functions/api`）；`member/`、`admin/` 兩頁由 `tools/build_demo.py` 從 `app/index.html` 產生，**不要直接改**，改 `app/` 後重新產生 |
| `docs/diagrams/` | 說明用的圖（體驗模式結構與流程） |
| `supabase/migrations/` | 資料表定義 |
| `docs/` | 本文件 |

## 內測（2026-11 起，約 10 人）

- 沿用測試用的 LINE Login channel／LIFF（Provider `出走社測試`），channel 切成 Published 讓內測者能登入；靠「人員審核」擋住陌生人。
- 保留示範活動，讓內測者有東西可以試；管理員會自行新增真實活動。
- 暫不合併到 `main`，所以沒有「防暫停」排程：一週沒人用 Supabase 會暫停，需要時再喚醒。
- **正式公開前要再決定**：若要用官方帳號傳訊息給社員，需在正式官方帳號的 Provider 底下重建 LINE Login＋LIFF（內測者需重新登入、重新審核），並清除測試資料、加上防暫停與備份。

## 進度

- [x] 介面原型（完整版、第一階段、第一階段＋日曆）
- [x] 資料表設計與本機測試
- [x] 建立 Supabase 專案 `agoodwayout`（東京，ref `qceomzxgeqromtbdxinf`）並套用資料表
- [x] 建立 LINE Login channel＋LIFF app（測試用 Provider）
- [x] Edge Function：驗證 LINE 身分、設定暱稱、接龍、管理員（新增／編輯／刪除活動、看名單、移除接龍）
- [x] 把原型接上資料庫與 LINE 登入（`app/`，以模擬的 LINE／Supabase 回應跑過完整流程）
- [x] 管理員後台接上資料庫
- [x] 開啟 GitHub Pages
- [x] 實機測試：LINE 登入、設定暱稱（2026-11-15，管理員本人）
- [x] 管理員帳號設為 `is_admin`（暱稱「設計師愛麗絲」）
- [x] 實機測試：接龍、管理員新增活動（2026-11-15）
- [x] ~~成團時用官方帳號通知管理員~~（2026-11-15 做好並實測成功；2026-11-25 依管理員要求移除所有 LINE 通知）
- [x] 人員審核：新成員待審核、管理員通過後才看得到內容（待審核人數顯示在後台側邊欄）
- [x] 後台「人員清單」：審核／停用／恢復、設定管理員、匯出 CSV
- [x] 後台改成左側側邊欄；每個項目有自己的網址尾巴：`#events` 活動管理、`#members` 人員清單（沒有尾巴＝社員畫面；可加書籤、重新整理不跳走、上一頁可退回）
- [ ] 實機測試：人員審核、人員清單
- [x] 體驗模式加入模擬 LINE 登入（社群連結 → 授權畫面 → 進網站；按過「許可」會記住，「重來一次」清除）
- [x] 體驗模式：社員頁 `demo/member/`、管理員頁 `demo/admin/`，同一台電腦兩個視窗即時同步，資料只存在瀏覽器（不連 LINE、不連 Supabase）
- [ ] 從 LINE 社群對話紀錄新增活動（提案中，見下方）
- [ ] 每日匯出到 Google 試算表

## API 一覽（`POST /functions/v1/api`，body 帶 `action` 與 `idToken`）

| action | 誰能用 | 說明 |
|---|---|---|
| `me` | 登入者 | 回傳暱稱、是否管理員、審核狀態、自己接龍的活動 |
| `set_nickname` | 登入者 | 第一次建立社員資料（狀態 `pending`）或修改暱稱；重複回 `409 nickname_taken` |
| `data` | 通過審核者 | 近 180 天起的開放活動＋各活動的接龍暱稱 |
| `join` | 通過審核者 | 呼叫 `join_activity()`，回 `ok` / `reached`（這位剛好讓活動成團）/ `full` / `already_joined` / `not_found` |
| `admin_save_activity` / `admin_delete_activity` | 管理員 | 新增、編輯、刪除活動 |
| `admin_roster` / `admin_remove_signup` | 管理員 | 看名單（含 LINE 名稱）、移除接龍 |
| `admin_members` / `admin_update_member` | 管理員 | 人員清單；改審核狀態、設定管理員（不能停用或取消自己） |

未通過審核的人呼叫需要審核的 action 會收到 `403 pending` 或 `403 disabled`。

## 需要管理員本人處理的事

- 各服務的帳號登入、核准、付款
- 保管密碼與金鑰（Channel secret、service role key 不要貼到對話裡）
- LINE Developers 裡把測試者加入 channel（開發中狀態只有測試者能登入）
