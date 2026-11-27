# 出走社活動接龍網站

出走社（A Good Way Out）的活動接龍網站。社員用 LINE 登入後，可以看到本月活動、誰已經報名，並 +1 接龍；人數達到開班門檻就成團。

**目前階段：內測中（約 10 人）**。

## 網址

| 用途 | 網址 |
|---|---|
| 分享到 LINE 社群（在 LINE 裡打開會自動登入） | https://liff.line.me/2012620335-Hk2HkkYY |
| 網站本身（一般瀏覽器、管理員用電腦操作） | https://alicenoted.github.io/for-agoodwayout/app/ |
| 介面原型（不需登入，資料只存在自己的瀏覽器） | https://alicenoted.github.io/for-agoodwayout/prototype/stage1_v2.html |
| 體驗模式・社員頁（假資料，不需 LINE） | https://alicenoted.github.io/for-agoodwayout/demo/member/ |
| 體驗模式・管理員頁（假資料，不需 LINE） | https://alicenoted.github.io/for-agoodwayout/demo/admin/ |

> LINE 登入目前是「開發中」狀態，只有管理員和測試者能登入。

## 功能

**社員**
- 用 LINE 登入，第一次設定社群暱稱，管理員審核通過後才看得到內容
- 活動總覽：側邊欄月曆與當月活動類別；活動依月份連續列出，可切換列表／卡片
- 活動詳情：公開接龍名單（只顯示暱稱和方案）、+1 接龍（可選方案、留備註給管理員）
- 名額滿了可以排候補；成團後出現「前往預約付款」按鈕
- 「關於出走社」頁面：介紹、社群規範、預約方式、聯繫管道
- **自揪活動**：社員自己填申請（可附 3 張圖），管理員審核通過才上架；「我的自揪」看審核狀態、退回原因，可修改重送或撤回
- 活動圖片（最多 3 張）：卡片顯示封面，活動頁可左右滑看大圖
- **LINE 通知**（官方帳號，需加好友）：成團時通知正取團員匯款；自揪申請的審核結果
- 名單每 30 秒自動更新

**管理員**
- 新增、編輯、複製、刪除活動（名額、開班門檻、候補人數、方案、預約付款連結、圖片）；新增時可一次建立多個日期
- 審核社員自揪：活動管理的「待審核」分頁（側邊欄顯示數量），可先編輯再通過，退回時填原因
- 活動管理「下載 Excel」：活動總表＋接龍名單（含 LINE 名稱、方案、備註、已付款）
- **LINE 通知**：活動成團、有新的自揪申請
- 查看名單（含 LINE 名稱、方案、備註）、勾選已付款、移除接龍
- 人員清單：審核、停用、設定管理員、匯出 CSV
- 編輯「關於出走社」內容

## 架構

```
LINE（LIFF 自動登入）
  └─ 網頁 app/index.html（GitHub Pages）
       └─ 所有讀寫 ──→ Supabase Edge Function `api`
                          └─ 先向 LINE 驗證是本人、確認已通過審核，再讀寫資料庫
                             （資料庫本身不對外開放）
```

- 資料庫：Supabase（PostgreSQL，東京區）
- 登入：LINE Login＋LIFF
- 主機：GitHub Pages（測試期）

## 個資與隱私

- 只收 LINE 的內部識別碼、LINE 顯示名稱、社群暱稱、接龍時間與選的方案、給管理員的備註
- 活動圖片存在 Supabase Storage 的公開 bucket：網址含隨機碼、無法被列出，但拿到網址的人不用登入就看得到，**不要上傳含個資的圖片**
- 公開頁面只顯示暱稱；LINE 識別碼與名稱只有後端和管理員看得到
- 不收電話、Email、LINE ID

## 目錄

| 路徑 | 內容 |
|---|---|
| `app/` | 正式網頁 |
| `supabase/migrations/` | 資料表與權限設定 |
| `supabase/functions/api/` | 後端 API |
| `demo/` | 體驗模式：`member/`、`admin/` 兩頁＋假後端 `demo-backend.js`（由 `tools/build_demo.py` 從 `app/` 產生） |
| `prototype/` | 介面原型 |
| `docs/DEVELOPMENT.md` | 開發紀錄：決定、設定值、API、進度（**接手前請先讀**） |

## 開發

- 體驗模式（`demo/`）平常不跟著正式網站更新；新功能要先給管理員看時，執行 `python3 tools/build_demo.py` 重新產生（2026-11-27 為了預覽自揪、圖片、LINE 通知、Excel 更新過一次）。
- 網頁是單一 HTML 檔，不需要編譯；推上 `claude/dazzling-bell-q1quxi` 分支後，GitHub Pages 約 1～2 分鐘內更新。
- 資料表變更：在 `supabase/migrations/` 新增 SQL 檔，再套用到 Supabase 專案。
- 後端變更：修改 `supabase/functions/api/index.ts` 後重新部署 Edge Function `api`（`verify_jwt` 維持關閉，由函式自己驗證 LINE 身分）。
- 網頁裡的 LIFF ID、Supabase URL、publishable key 都是公開值；**Channel secret、service role key 等密碼絕對不要放進 repo**。
