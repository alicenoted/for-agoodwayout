# 出走社活動接龍網站

出走社（A Good Way Out）的活動接龍網站。社員用 LINE 登入後，可以看到本月活動、誰已經報名，並 +1 接龍；人數達到開班門檻就成團。

**目前階段：第一階段測試中**：先讓大家看到報名人潮（公開接龍名單＋資料庫）。

## 網址

| 用途 | 網址 |
|---|---|
| 分享到 LINE 社群（在 LINE 裡打開會自動登入） | https://liff.line.me/2012620335-Hk2HkkYY |
| 網站本身（一般瀏覽器、管理員用電腦操作） | https://alicenoted.github.io/for-agoodwayout/app/ |
| 介面原型（不需登入，資料只存在自己的瀏覽器） | https://alicenoted.github.io/for-agoodwayout/prototype/stage1_v2.html |
| 體驗模式・社員頁（假資料，不需 LINE） | https://alicenoted.github.io/for-agoodwayout/demo/member/ |
| 體驗模式・管理員頁（假資料，不需 LINE） | https://alicenoted.github.io/for-agoodwayout/demo/admin/ |

> LINE 登入目前是「開發中」狀態，只有管理員和測試者能登入。

## 功能（第一階段）

**社員**
- 用 LINE 登入，第一次設定社群暱稱
- 本月活動總覽：左側日曆、四類活動分頁（出走社主辦／出走社嚴選／社員自揪／社交活動）
- 活動卡片：價格、成團進度、已報名的人；自己有接龍的會標示「你已接龍」
- 活動詳情：公開接龍名單（只顯示暱稱）、+1 接龍
- 名單每 30 秒自動更新

**管理員**
- 新增、編輯、刪除活動（名額上限、開班門檻等）
- 查看名單（含 LINE 名稱，只有管理員看得到）、移除接龍

## 架構

```
LINE（LIFF 自動登入）
  └─ 網頁 app/index.html（GitHub Pages）
       ├─ 讀：活動、暱稱名單 ───→ Supabase 資料庫（只開放公開資料）
       └─ 寫：暱稱、接龍、管理 ─→ Supabase Edge Function `api`
                                    └─ 先向 LINE 驗證是本人，再寫入資料庫
```

- 資料庫：Supabase（PostgreSQL，東京區）
- 登入：LINE Login＋LIFF
- 主機：GitHub Pages（測試期）

## 個資與隱私

- 只收 LINE 的內部識別碼、LINE 顯示名稱、社群暱稱、接龍時間
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

- 體驗模式（`demo/`）自 2026-11-25 起不再跟著正式網站更新；需要時可執行 `python3 tools/build_demo.py` 重新產生。
- 網頁是單一 HTML 檔，不需要編譯；推上 `claude/dazzling-bell-q1quxi` 分支後，GitHub Pages 約 1～2 分鐘內更新。
- 資料表變更：在 `supabase/migrations/` 新增 SQL 檔，再套用到 Supabase 專案。
- 後端變更：修改 `supabase/functions/api/index.ts` 後重新部署 Edge Function `api`（`verify_jwt` 維持關閉，由函式自己驗證 LINE 身分）。
- 網頁裡的 LIFF ID、Supabase URL、publishable key 都是公開值；**Channel secret、service role key 等密碼絕對不要放進 repo**。
