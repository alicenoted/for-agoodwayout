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
| `activities` | 類別、名稱、日期、地點、費用、名額、開班門檻、候補人數 `wait_max`、預約付款連結 `booking_url`、方案選項 `options`（一行一個）、圖片 `images`（Storage 路徑，最多 3 個）、狀態 `status`（`open` 上架／`pending` 自揪待審核／`rejected` 退回／`cancelled`）、退回原因 `review_note`、成團通知時間 `reached_notified_at` | 否（通過審核的成員經由 API 讀取；待審核／退回只有管理員和申請人本人看得到） |
| `signups` | 哪個社員、哪場活動、接龍時間、取消時間、選的方案 `option`、給管理員的備註 `note`、已付款 `paid` | 否（API 只回傳暱稱和方案） |
| `site_content` | 網站文字內容（目前只有 `about`：關於出走社） | 否（通過審核的成員經由 API 讀取） |

- 新成員預設 `pending`；管理員在後台「人員清單」通過後才看得到活動。
- Storage bucket `activity-images`：公開讀取、單檔 2MB、只收 JPEG/PNG/WebP。上傳一律經過 API（`upload_image`，會檢查檔頭）；前端先縮成長邊 1600px 的 JPEG。刪除活動或移除圖片時，沒有其他活動在用（「複製」會共用圖片）才刪檔。

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
| 官方帳號（測試） | `出走社測試`，Messaging API 屬於 Provider `出走社測試`（跟 LINE Login 同一個，所以 user ID 通用）；金鑰存在 Supabase Edge Function Secrets 的 `LINE_MESSAGING_TOKEN`（不在 repo）。2026-11-27 起重新使用（成團、自揪審核通知） |

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
- [x] 後台改成左側側邊欄；每個項目有自己的網址尾巴：`#events` 活動管理、`#members` 人員清單、`#content` 關於出走社（沒有尾巴＝社員畫面；可加書籤、重新整理不跳走、上一頁可退回）
- [ ] 實機測試：人員審核、人員清單
- [x] 體驗模式加入模擬 LINE 登入（社群連結 → 授權畫面 → 進網站；按過「許可」會記住，「重來一次」清除）
- [x] 體驗模式：社員頁 `demo/member/`、管理員頁 `demo/admin/`，同一台電腦兩個視窗即時同步，資料只存在瀏覽器（不連 LINE、不連 Supabase）
- [x] 從共用試算表搬進網站（2026-11-25）：候補（名額滿後可再排 N 位，取消時依序遞補）、成團後顯示「前往預約付款」連結、接龍時選方案、給管理員的備註、後台名單勾「已付款」、活動「複製」、新增活動時一次建立多個日期
- [x] 匯入試算表中即將舉行的社課 10 場（油畫 2、香氛食療 5、人類圖 3）；試算表上已有的接龍名字沒有匯入，需本人登入後重新接龍
- [x] 「關於出走社」頁面（社員 `#about`；內容取自試算表【必讀】分頁，後台 `#content` 可編輯）
- [ ] 實機測試：候補、預約付款按鈕、已付款、關於出走社
- [x] 社員自揪：社員送申請（類別固定「社員自揪」、不能填預約付款連結、每人最多 5 筆待審核）→ 管理員在「活動管理 → 待審核」通過或退回（退回要填原因）→ 退回的可修改重送（2026-11-27）
- [x] 活動圖片最多 3 張（2026-11-27）
- [x] LINE 通知（2026-11-27，重新加回）：成團 → 正取團員（附預約付款連結）＋管理員（社員自揪再加揪團人）；自揪申請 → 管理員；審核結果 → 申請人。成團通知用 `reached_notified_at` 確保每場只發一次；部署時已成團的活動不補發
- [x] 活動管理「下載 Excel」（SheetJS，按下才從 jsDelivr 載入）：活動總表＋接龍名單（2026-11-27）
- [x] 手機版後台：寬表格只在框內左右滑，不再撐寬整頁
- [ ] 實機測試：自揪申請／審核、圖片上傳（iPhone、Android、LINE 內建瀏覽器）、LINE 通知、下載 Excel
- [ ] 研究藍星的規定（上面都做完後再討論）
- [ ] 從 LINE 社群對話紀錄新增活動（提案中，見下方）
- [ ] 每日匯出到 Google 試算表

## API 一覽（`POST /functions/v1/api`，body 帶 `action` 與 `idToken`）

| action | 誰能用 | 說明 |
|---|---|---|
| `me` | 登入者 | 回傳暱稱、是否管理員、審核狀態、自己接龍的活動 |
| `set_nickname` | 登入者 | 第一次建立社員資料（狀態 `pending`）或修改暱稱；重複回 `409 nickname_taken` |
| `data` | 通過審核者 | 近 180 天起的開放活動＋各活動的接龍暱稱；管理員另外拿到待審核／退回的自揪申請（含申請人）；社員另外拿到自己的申請 `myProposals` |
| `join` | 通過審核者 | 接龍後若達開班門檻且還沒發過，發成團通知。帶 `option`（有方案時必填，否則 `400 bad_option`）、`note`（選填，100 字內）。呼叫 `join_activity()`，回 `ok` / `reached`（這位剛好讓活動成團）/ `waitlist`（正取已滿，排進候補）/ `full`（正取和候補都滿）/ `already_joined` / `not_found` |
| `about` | 通過審核者 | 「關於出走社」內容 |
| `upload_image` | 通過審核者 | `data`＝圖片 data URL（2MB 內、檔頭須為 JPEG/PNG/WebP）。回傳 `path`，存活動時放進 `images` |
| `propose_activity` | 通過審核者 | 送出自揪申請（`activity`）；帶 `id`＝修改自己待審核／已退回的申請（退回的會重新送審）。新申請與退回後重送會通知管理員。錯誤：`too_many_pending`、`date_passed` |
| `withdraw_proposal` | 通過審核者 | 撤回（刪除）自己待審核／已退回的申請 |
| `admin_save_activity` / `admin_delete_activity` | 管理員 | 新增、編輯、刪除活動；新增時可帶 `dates` 陣列，同一份內容一次建立多場 |
| `admin_review_activity` | 管理員 | `decision`＝`approve` / `reject`、`note`＝退回原因。只處理 `pending` 的申請（否則 `409 not_pending`），結果用 LINE 通知申請人 |
| `admin_export` | 管理員 | `activityIds` 陣列 → 這些活動的完整接龍名單（下載 Excel 用） |
| `admin_roster` / `admin_remove_signup` / `admin_set_paid` | 管理員 | 看名單（含 LINE 名稱、方案、備註、已付款）、移除接龍、勾選已付款 |
| `admin_save_about` | 管理員 | 儲存「關於出走社」內容（2 萬字內） |
| `admin_members` / `admin_update_member` | 管理員 | 人員清單；改審核狀態、設定管理員（不能停用或取消自己） |

未通過審核的人呼叫需要審核的 action 會收到 `403 pending` 或 `403 disabled`。

## LINE 通知的限制（2026-11-27）

- **要加官方帳號好友才收得到**。沒加好友的人不會收到，也不會有錯誤提示（multicast 不回報個別失敗）。建議在 LINE Developers 的 LINE Login channel 設定「Add friend option」（登入時順便邀請加好友），並在社群公告。
- **訊息則數有上限**：成團通知是「每位收件人算一則」。台灣官方帳號免費方案每月則數有限（以 LINE 官方帳號後台「方案」頁為準），超過就發不出去；社員多了以後可能要升級付費方案。
- **user ID 只在同一個 Provider 內通用**：現在 LINE Login 和官方帳號都在測試 Provider `出走社測試`，所以發得到。正式上線若改用正式官方帳號，LINE Login＋LIFF 也要搬到同一個 Provider（見上方「正式上線時」）。
- 沒設定 `LINE_MESSAGING_TOKEN` 時不發通知，其他功能照常。
- 不會通知的情況：候補遞補成正取、管理員移除接龍、成團後又掉到門檻以下再補上（只發第一次）。

## 活動圖片的限制

- Supabase 免費方案：Storage 1GB（壓縮後一張約 200～500KB，約可放幾千張）、每月流量有上限；圖片只在卡片封面和活動頁載入。
- 公開 bucket：網址有隨機碼、無法列出清單，但拿到網址的人不必登入就看得到。
- iPhone 的 HEIC 照片在 iPhone 上會自動轉 JPEG；少數 Android 手機選 HEIC 可能讀不到，會提示換成 JPG/PNG。
- 上傳後沒存檔就離開的圖片會留在 Storage（不影響功能，之後可加定期清理）。

## 需要管理員本人處理的事

- 各服務的帳號登入、核准、付款
- 保管密碼與金鑰（Channel secret、service role key 不要貼到對話裡）
- LINE Developers 裡把測試者加入 channel（開發中狀態只有測試者能登入）
