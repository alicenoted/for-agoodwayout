// 出走社活動接龍：後端 API（Supabase Edge Function）
//
// 每個請求都要帶 LINE 的 ID token。先向 LINE 驗證「這真的是本人」，
// 再用 service role 讀寫資料庫。網頁不能直接讀資料庫；連活動和名單也要
// 「通過審核」的成員才拿得到。
//
// 呼叫方式：POST /functions/v1/api  body: { action, idToken, ...參數 }

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// LINE Login channel ID（公開值；LIFF ID 的前半段）
const LINE_CHANNEL_ID = Deno.env.get("LINE_CHANNEL_ID") ?? "2012620335";

// 官方帳號（Messaging API）的金鑰：存在 Supabase Edge Function Secrets，不放在程式碼裡。
// 沒設定時不發 LINE 通知，其他功能照常。
const LINE_MESSAGING_TOKEN = Deno.env.get("LINE_MESSAGING_TOKEN") ?? "";
const LIFF_URL = Deno.env.get("LIFF_URL") ?? "https://liff.line.me/2012620335-Hk2HkkYY";

// 活動圖片（Supabase Storage，公開 bucket）
const BUCKET = "activity-images";
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMG_PATH = /^act\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const MAX_PENDING_PROPOSALS = 5;   // 每人同時最多幾個「待審核」的自揪申請

// 每日排程（Supabase pg_cron 每天早上呼叫一次 action: "cron_daily"）用的密碼：
// 資料庫自己產生、存在 app_secrets（只有後端讀得到）；有設 Edge Function Secret CRON_SECRET 時以它為準
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
async function cronSecret(): Promise<string> {
  if (CRON_SECRET) return CRON_SECRET;
  const { data } = await db.from("app_secrets").select("value").eq("key", "cron").maybeSingle();
  return data?.value ?? "";
}
const FLOP_WARN_DAYS = Number(Deno.env.get("FLOP_WARN_DAYS") ?? "7");   // 活動前幾天還沒成團就提醒管理員「即將流標」

// 允許呼叫這個 API 的網站
const ALLOWED_ORIGINS = [
  "https://alicenoted.github.io",
  "http://localhost:8000",
];

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CATEGORIES = ["host", "select", "member", "social"];

class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Vary": "Origin",
  };
}

// 向 LINE 驗證 ID token，回傳 LINE 的使用者識別碼與顯示名稱
async function verifyLine(idToken: unknown): Promise<{ userId: string; name: string | null }> {
  if (typeof idToken !== "string" || !idToken) throw new ApiError(401, "missing_token");
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID }),
  });
  if (!res.ok) throw new ApiError(401, "invalid_token");
  const p = await res.json();
  if (!p.sub) throw new ApiError(401, "invalid_token");
  return { userId: p.sub, name: p.name ?? null };
}

type Member = {
  id: string;
  nickname: string;
  is_admin: boolean;
  status: "pending" | "approved" | "disabled";
  line_display_name: string | null;
};
const STATUSES = ["pending", "approved", "disabled"];

async function findMember(lineUserId: string): Promise<Member | null> {
  const { data, error } = await db
    .from("members")
    .select("id, nickname, is_admin, status, line_display_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function requireMember(m: Member | null): Member {
  if (!m) throw new ApiError(403, "no_nickname");
  return m;
}

// 通過審核才能看活動、接龍
function requireApproved(m: Member | null): Member {
  const member = requireMember(m);
  if (member.status !== "approved") throw new ApiError(403, member.status); // pending / disabled
  return member;
}

function requireAdmin(m: Member | null): Member {
  const member = requireApproved(m);
  if (!member.is_admin) throw new ApiError(403, "not_admin");
  return member;
}

const memberOut = (m: Member) => ({ nickname: m.nickname, is_admin: m.is_admin, status: m.status });

// PostgREST 每次最多回 1000 筆，超過就分頁讀完
async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

function cleanNickname(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < 1 || [...s].length > 12) throw new ApiError(400, "bad_nickname");
  return s;
}

// 方案選項：一行一個，最多 10 個（方案名稱裡常有「$1,450」這種逗號，所以只用換行分隔）
function cleanOptions(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const list = v.split(/\r?\n/).map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 10);
  return list.length ? list.join("\n") : null;
}
const optionList = (s: string | null) => (s ? s.split("\n") : []);

// 圖片：只接受這個 API 上傳時產生的路徑，最多 3 張
function cleanImages(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ApiError(400, "bad_images");
  const list = [...new Set(v.map(String))];
  if (list.length > MAX_IMAGES || list.some((p) => !IMG_PATH.test(p))) throw new ApiError(400, "bad_images");
  return list;
}

// 只接受活動表單裡允許的欄位，並檢查內容
function cleanActivity(a: Record<string, unknown>) {
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const int = (v: unknown) => Number.isInteger(Number(v)) ? Number(v) : NaN;
  const out = {
    category: str(a.category),
    title: str(a.title),
    host_name: str(a.host_name),
    event_date: str(a.event_date),
    time_text: str(a.time_text, 50) || null,
    place: str(a.place) || null,
    price: int(a.price ?? 0),
    price_note: str(a.price_note) || null,
    capacity: int(a.capacity),
    threshold: int(a.threshold),
    description: str(a.description, 4000) || null,
    booking_url: str(a.booking_url, 500) || null,
    options: cleanOptions(a.options),
    wait_max: int(a.wait_max ?? 0),
    images: cleanImages(a.images),
  };
  if (out.booking_url && !/^https?:\/\//.test(out.booking_url)) throw new ApiError(400, "bad_booking_url");
  if (!(out.wait_max >= 0 && out.wait_max <= 20)) throw new ApiError(400, "bad_wait_max");
  if (!CATEGORIES.includes(out.category)) throw new ApiError(400, "bad_category");
  if (!out.title || !out.host_name) throw new ApiError(400, "missing_fields");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.event_date)) throw new ApiError(400, "bad_date");
  if (!(out.price >= 0)) throw new ApiError(400, "bad_price");
  if (!(out.capacity >= 1) || !(out.threshold >= 1)) throw new ApiError(400, "bad_numbers");
  if (out.threshold > out.capacity) throw new ApiError(400, "threshold_over_capacity");
  return out;
}

async function mySignupIds(memberId: string): Promise<string[]> {
  const { data, error } = await db
    .from("signups")
    .select("activity_id")
    .eq("member_id", memberId)
    .is("cancelled_at", null);
  if (error) throw error;
  return data.map((r) => r.activity_id);
}

const ACT_FIELDS =
  "id, category, title, host_name, event_date, time_text, place, price, price_note, capacity, threshold, description, booking_url, options, wait_max, images, status, created_by, review_note, reviewed_at, created_at, cancel_reason";

// 圖片沒有任何活動在用了才真的刪掉（「複製活動」會共用同一張圖）
async function cleanupImages(paths: string[]) {
  const gone: string[] = [];
  for (const p of new Set(paths)) {
    const { data } = await db.from("activities").select("id").contains("images", [p]).limit(1);
    if (!data?.length) gone.push(p);
  }
  if (gone.length) {
    const { error } = await db.storage.from(BUCKET).remove(gone);
    if (error) console.error("image cleanup failed", error);
  }
}

// 檢查上傳檔案的內容真的是圖片（看檔頭，不信任瀏覽器給的類型）
function imageExt(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/* ---------- LINE 通知（官方帳號） ---------- */
// 只有「加了官方帳號好友」的人收得到；通知失敗不影響主要動作，只記錄在 log。
async function pushLine(to: (string | null | undefined)[], text: string) {
  const ids = [...new Set(to.filter((x): x is string => !!x))];
  if (!LINE_MESSAGING_TOKEN || !ids.length) return;
  for (let i = 0; i < ids.length; i += 500) {   // multicast 一次最多 500 人
    try {
      const res = await fetch("https://api.line.me/v2/bot/message/multicast", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_MESSAGING_TOKEN}` },
        body: JSON.stringify({ to: ids.slice(i, i + 500), messages: [{ type: "text", text: text.slice(0, 4900) }] }),
      });
      if (!res.ok) console.error("LINE multicast failed", res.status, await res.text());
    } catch (e) {
      console.error("LINE multicast error", e);
    }
  }
}

// 通知在背景送出，不讓使用者等 LINE 回應
function background(p: Promise<unknown>) {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else return p;
}

async function adminLineIds(): Promise<string[]> {
  const { data } = await db.from("members").select("line_user_id").eq("is_admin", true).eq("status", "approved");
  return (data ?? []).map((m) => m.line_user_id);
}
async function lineIdOf(memberId: string | null): Promise<string | null> {
  if (!memberId) return null;
  const { data } = await db.from("members").select("line_user_id").eq("id", memberId).maybeSingle();
  return data?.line_user_id ?? null;
}

function fmtWhen(a: { event_date: string; time_text: string | null }) {
  const d = new Date(a.event_date + "T00:00:00Z");
  const week = "日一二三四五六"[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${week}）${a.time_text ? " " + a.time_text : ""}`;
}
const evLink = (id: string) => `${LIFF_URL}?ev=${id}`;
const twToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);   // 台灣日期

// LINE 訊息裡的付款連結加 openExternalBrowser=1：在 LINE 裡點開會改用手機預設瀏覽器
function extUrl(u: string) {
  try{ const x = new URL(u); x.searchParams.set('openExternalBrowser', '1'); return x.toString(); } catch { return u; }
}

const NOTIFY_FIELDS = "id, title, event_date, time_text, capacity, threshold, wait_max, price, price_note, booking_url, category, created_by, status";
type NotifyAct = {
  id: string; title: string; event_date: string; time_text: string | null; capacity: number; threshold: number;
  wait_max: number; price: number; price_note: string | null; booking_url: string | null; category: string;
  created_by: string | null; status: string;
};

// 付款說明（成團通知、成團後接龍、候補遞補共用）
function payText(a: NotifyAct) {
  const price = a.price ? `$${Number(a.price).toLocaleString("en-US")}${a.price_note ? `（${a.price_note}）` : ""}` : "免費";
  const how = a.booking_url
    ? `請在活動前 7 天完成預約付款：\n${extUrl(a.booking_url)}`
    : a.category === "member"
    ? "付款方式請留意揪團人在 LINE 社群的說明。"
    : "管理員會在 LINE 社群公告付款方式，請留意訊息。";
  return `費用：${price}\n${how}`;
}


// 有效的接龍，依時間排序（前 capacity 位是正取，之後是候補）
async function activeSignups(activityId: string) {
  return await fetchAll<any>(() =>
    db.from("signups")
      .select("id, member_id, created_at, paid, members(nickname, line_user_id, line_display_name)")
      .eq("activity_id", activityId).is("cancelled_at", null)
      .order("created_at").order("id")
  );
}

// 人數達到開班門檻時發「成團通知」：正取的團員（請匯款）＋管理員。
// 用 reached_notified_at 鎖住，同一場只會發一次（兩人同時接龍、之後有人取消再補上都不會重發）。
async function maybeNotifyReached(activityId: string): Promise<boolean> {
  if (!LINE_MESSAGING_TOKEN) return false;
  const { data: pre } = await db.from("activities")
    .select("threshold, status, reached_notified_at").eq("id", activityId).maybeSingle();
  if (!pre || pre.status !== "open" || pre.reached_notified_at) return false;
  const list = await activeSignups(activityId);
  if (list.length < pre.threshold) return false;

  const { data: a } = await db.from("activities")
    .update({ reached_notified_at: new Date().toISOString() })
    .eq("id", activityId).is("reached_notified_at", null)
    .select(NOTIFY_FIELDS).maybeSingle<NotifyAct>();
  if (!a) return false;   // 別的請求已經發過了

  await pushLine(
    list.slice(0, a.capacity).map((s) => s.members?.line_user_id),
    `🎉【成團通知】${a.title}\n${fmtWhen(a)}\n已達 ${a.threshold} 人開班門檻，活動確定舉行！\n${payText(a)}\n\n活動頁：${evLink(a.id)}`,
  );
  await pushLine(
    await adminLineIds(),
    `✅【成團】${a.title}\n${fmtWhen(a)}・目前 ${Math.min(list.length, a.capacity)}／${a.capacity} 人（門檻 ${a.threshold} 人）\n` +
      (a.booking_url ? "團員已收到預約付款通知。" : "這場沒有預約付款連結，請到 LINE 社群公告付款方式。") +
      `\n每天早上 9:00 的「每日提醒」會列出還沒付款的人。\n${evLink(a.id)}`,
  );
  return true;
}

// 名額剛好滿了：通知管理員一次，之後才開放候補
async function maybeNotifyFull(activityId: string) {
  if (!LINE_MESSAGING_TOKEN) return;
  const { data: pre } = await db.from("activities").select("capacity, status, full_notified_at").eq("id", activityId).maybeSingle();
  if (!pre || pre.status !== "open" || pre.full_notified_at) return;
  const { count } = await db.from("signups")
    .select("id", { count: "exact", head: true }).eq("activity_id", activityId).is("cancelled_at", null);
  if ((count ?? 0) < pre.capacity) return;
  const { data: a } = await db.from("activities")
    .update({ full_notified_at: new Date().toISOString() })
    .eq("id", activityId).is("full_notified_at", null)
    .select(NOTIFY_FIELDS).maybeSingle<NotifyAct>();
  if (!a) return;
  await pushLine(
    await adminLineIds(),
    `📣【滿團】${a.title}\n${fmtWhen(a)}\n名額 ${a.capacity} 人已滿${a.wait_max ? `，接下來開放候補 ${a.wait_max} 位` : "（沒有開放候補）"}。\n想參加的人多，可以考慮加開一場。\n${evLink(a.id)}`,
  );
}

// 接龍之後：剛好成團 → 成團通知；已經成團後才接龍（正取）→ 通知這個人付款；剛好滿團 → 通知管理員
async function afterJoin(activityId: string, memberId: string) {
  try {
    const justReached = await maybeNotifyReached(activityId);
    if (!justReached && LINE_MESSAGING_TOKEN) {
      const { data: a } = await db.from("activities").select(`${NOTIFY_FIELDS}, reached_notified_at`).eq("id", activityId).maybeSingle();
      if (a?.reached_notified_at) {
        const list = await activeSignups(activityId);
        const idx = list.findIndex((s) => s.member_id === memberId);
        if (idx >= 0 && idx < a.capacity) {
          await pushLine(
            [list[idx].members?.line_user_id],
            `🎉【接龍成功・請付款】${a.title}\n${fmtWhen(a)}\n這場已經成團，你是正取第 ${idx + 1} 位。\n${payText(a)}\n\n活動頁：${evLink(a.id)}`,
          );
        }
      }
    }
    await maybeNotifyFull(activityId);
  } catch (e) {
    console.error("afterJoin notify error", e);
  }
}

// 活動流標或刪除時，通知所有接龍的人（正取＋候補）；已付款的人另外說明退款
async function notifyCancelled(a: NotifyAct, list: any[], head: string, reasonLine: string) {
  const base = `${head}${a.title}\n${fmtWhen(a)}\n${reasonLine}`;
  const paid = list.filter((s, i) => i < a.capacity && s.paid);
  const unpaid = list.filter((s, i) => !(i < a.capacity && s.paid));
  await pushLine(unpaid.map((s) => s.members?.line_user_id), `${base}\n\n謝謝你的接龍，下次見！`);
  await pushLine(paid.map((s) => s.members?.line_user_id), `${base}\n\n你已付款的費用，管理員會另外聯繫你辦理退款。造成不便很抱歉。`);
}

// 每日排程（台灣時間早上 9:00）：把「即將流標」和「待付款」合成一則「每日提醒」發給管理員。
// 兩段都沒有內容就不發；同一天只發一次（notify_log）。
// 即將流標：活動前 FLOP_WARN_DAYS 天內還沒到開班門檻，每場只列一次（flop_warned_at）。
async function runDaily() {
  const today = twToday();
  const out = { flopWarned: 0, unpaid: 0, sent: false };
  if (!LINE_MESSAGING_TOKEN) return out;
  const { error: dup } = await db.from("notify_log").insert({ key: `daily:${today}` });
  if (dup) return out;   // 主鍵重複＝今天已經發過

  const acts = await fetchAll<any>(() =>
    db.from("activities").select(`${NOTIFY_FIELDS}, flop_warned_at`)
      .eq("status", "open").gte("event_date", today).order("event_date")
  );
  const limit = new Date(Date.parse(today + "T00:00:00Z") + FLOP_WARN_DAYS * 86400_000).toISOString().slice(0, 10);
  const flopLines: string[] = [], payBlocks: string[] = [];
  for (const a of acts) {
    const list = await activeSignups(a.id);
    if (list.length < a.threshold) {
      if (a.flop_warned_at || a.event_date > limit) continue;
      const { data: locked } = await db.from("activities").update({ flop_warned_at: new Date().toISOString() })
        .eq("id", a.id).is("flop_warned_at", null).select("id").maybeSingle();
      if (!locked) continue;
      const days = Math.round((Date.parse(a.event_date) - Date.parse(today)) / 86400_000);
      const line = `▸ ${fmtWhen(a)} ${a.title}\n　${list.length}／${a.threshold} 人，還差 ${a.threshold - list.length} 人（還有 ${days} 天）`;
      flopLines.push(line);
      out.flopWarned++;
      continue;
    }
    const due = list.slice(0, a.capacity).filter((s) => !s.paid);
    if (!due.length) continue;
    out.unpaid += due.length;
    payBlocks.push(`▸ ${fmtWhen(a)} ${a.title}（${due.length} 人）\n` +
      due.map((s) => `　${s.members?.nickname ?? "?"}${s.members?.line_display_name ? `（LINE：${s.members.line_display_name}）` : ""}`).join("\n"));
  }
  if (!flopLines.length && !payBlocks.length) return out;

  const fit = (blocks: string[], room: number) => {
    let body = "";
    for (const [i, b] of blocks.entries()) {
      if ((body + b).length > room) return body + `\n…還有 ${blocks.length - i} 場，請到後台查看`;
      body += (body ? "\n" : "") + b;
    }
    return body;
  };
  const [, m, d] = today.split("-").map(Number);
  const parts = [`☀️【出走社每日提醒】${m}/${d}`];
  if (flopLines.length) {
    parts.push(`⚠️ 即將流標（${flopLines.length} 場）\n${fit(flopLines, 1500)}\n要流標請到後台打開那場按「流標」，會通知接龍的人；想再等等就不用動作。`);
  }
  if (payBlocks.length) {
    parts.push(`💰 待付款（共 ${out.unpaid} 人）\n${fit(payBlocks, 2500)}\n收到款項後，請到後台名單勾「已付款」。`);
  }
  parts.push(`${LIFF_URL}?page=events`);
  await pushLine(await adminLineIds(), parts.join("\n\n"));
  out.sent = true;

  return out;
}

// 只回傳給前端需要的欄位；review_note 只給管理員和申請人本人
function activityOut(a: any, viewer: Member) {
  const own = a.created_by === viewer.id;
  return {
    id: a.id, category: a.category, title: a.title, host_name: a.host_name, event_date: a.event_date,
    time_text: a.time_text, place: a.place, price: a.price, price_note: a.price_note, capacity: a.capacity,
    threshold: a.threshold, description: a.description, booking_url: a.booking_url, options: a.options,
    wait_max: a.wait_max, images: a.images ?? [], status: a.status, mine_created: own,
    cancel_reason: a.cancel_reason ?? null,
    ...(viewer.is_admin || own
      ? { review_note: a.review_note, reviewed_at: a.reviewed_at, created_at: a.created_at }
      : {}),
    ...(viewer.is_admin ? { proposer: a.creator?.nickname ?? null, proposer_line: a.creator?.line_display_name ?? null } : {}),
  };
}

async function handle(body: Record<string, unknown>) {
  const line = await verifyLine(body.idToken);
  let member = await findMember(line.userId);

  // 順手更新 LINE 顯示名稱（只給管理員辨識用）
  if (member && line.name && member.line_display_name !== line.name) {
    await db.from("members").update({ line_display_name: line.name }).eq("id", member.id);
  }

  switch (body.action) {
    case "me": {
      if (!member) return { member: null, mySignups: [] };
      return {
        member: memberOut(member),
        mySignups: member.status === "approved" ? await mySignupIds(member.id) : [],
      };
    }

    // 活動與名單（只有通過審核的成員拿得到；名單只含暱稱）
    case "data": {
      const m = requireApproved(member);
      const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
      // 管理員也拿得到「待審核／已退回」的社員自揪申請
      // 流標（cancelled）的活動也列出來，讓接龍過的人看得到原因
      const statuses = m.is_admin ? ["open", "cancelled", "pending", "rejected"] : ["open", "cancelled"];
      const activities = await fetchAll<any>(() =>
        db.from("activities")
          .select(`${ACT_FIELDS}, creator:members!activities_created_by_fkey(nickname, line_display_name)`)
          .in("status", statuses)
          .gte("event_date", since)
          .order("event_date")
          .order("created_at")
      );
      // 我自己送出、還沒上架的自揪申請
      const { data: mine, error: mineErr } = await db.from("activities")
        .select(ACT_FIELDS)
        .eq("created_by", m.id)
        .in("status", ["pending", "rejected"])
        .order("created_at", { ascending: false });
      if (mineErr) throw mineErr;
      const ids = activities.filter((a) => a.status === "open" || a.status === "cancelled").map((a) => a.id);
      const signups = ids.length
        ? await fetchAll<any>(() =>
          db.from("signups")
            .select("activity_id, created_at, option, members(nickname)")
            .in("activity_id", ids)
            .is("cancelled_at", null)
            .order("created_at")
        )
        : [];
      return {
        activities: activities.map((a) => activityOut(a, m)),
        myProposals: m.is_admin ? [] : mine.map((a) => activityOut(a, m)),
        signups: signups.map((s) => ({ activity_id: s.activity_id, nickname: s.members?.nickname, option: s.option })),
      };
    }

    case "set_nickname": {
      const nickname = cleanNickname(body.nickname);
      const q = member
        ? db.from("members").update({ nickname }).eq("id", member.id)
        : db.from("members").insert({ line_user_id: line.userId, line_display_name: line.name, nickname });
      const { error } = await q;
      if (error) {
        if (error.code === "23505") throw new ApiError(409, "nickname_taken");
        throw error;
      }
      member = await findMember(line.userId);
      return { member: memberOut(member!) };
    }

    case "join": {
      const m = requireApproved(member);
      const activityId = String(body.activityId ?? "");
      const { data: act } = await db.from("activities").select("options").eq("id", activityId).maybeSingle();
      const opts = optionList(act?.options ?? null);
      let option: string | null = typeof body.option === "string" ? body.option.trim() : null;
      if (opts.length) {
        if (!option || !opts.includes(option)) throw new ApiError(400, "bad_option");
      } else option = null;
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 100) || null : null;
      const { data, error } = await db.rpc("join_activity", {
        p_activity: activityId,
        p_member: m.id,
        p_option: option,
        p_note: note,
      });
      if (error) throw error;
      if (data === "ok" || data === "reached") await background(afterJoin(activityId, m.id));
      return { result: data }; // ok / reached / waitlist / full / already_joined / not_found
    }

    // 「關於出走社」等網站內容（通過審核的成員才讀得到）
    case "about": {
      requireApproved(member);
      const { data } = await db.from("site_content").select("body, updated_at").eq("key", "about").maybeSingle();
      return { body: data?.body ?? "", updated_at: data?.updated_at ?? null };
    }

    // 上傳一張活動圖片（前端已先縮圖成 JPEG）。回傳路徑，存活動時再帶進 images。
    case "upload_image": {
      requireApproved(member);
      const b64 = typeof body.data === "string" ? body.data.replace(/^data:[^,]*,/, "") : "";
      if (!b64 || b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) throw new ApiError(400, "image_too_large");
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } catch {
        throw new ApiError(400, "bad_image");
      }
      if (bytes.length > MAX_IMAGE_BYTES) throw new ApiError(400, "image_too_large");
      const ext = imageExt(bytes);
      if (!ext) throw new ApiError(400, "bad_image");
      const path = `act/${crypto.randomUUID()}.${ext}`;
      const { error } = await db.storage.from(BUCKET)
        .upload(path, bytes, { contentType: MIME[ext], cacheControl: "31536000", upsert: false });
      if (error) throw error;
      return { path };
    }

    // ---------- 社員自揪：送出申請 → 管理員審核 → 上架 ----------
    case "propose_activity": {
      const m = requireApproved(member);
      const a = cleanActivity({ ...(body.activity ?? {}) as Record<string, unknown>, category: "member" });
      a.booking_url = null;   // 預約付款連結只有管理員能設定
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);   // 台灣日期
      if (a.event_date < today) throw new ApiError(400, "date_passed");
      const id = typeof body.id === "string" && body.id ? body.id : null;
      let notify = true;
      if (id) {
        // 修改自己「待審核／已退回」的申請；已退回的改完會重新送審
        const { data: old } = await db.from("activities").select("status, created_by, images").eq("id", id).maybeSingle();
        if (!old || old.created_by !== m.id || !["pending", "rejected"].includes(old.status)) throw new ApiError(404, "not_found");
        notify = old.status === "rejected";
        const { error } = await db.from("activities")
          .update({ ...a, status: "pending", review_note: null, reviewed_at: null, reviewed_by: null })
          .eq("id", id);
        if (error) throw error;
        await cleanupImages((old.images ?? []).filter((p: string) => !a.images.includes(p)));
      } else {
        const { count } = await db.from("activities")
          .select("id", { count: "exact", head: true }).eq("created_by", m.id).eq("status", "pending");
        if ((count ?? 0) >= MAX_PENDING_PROPOSALS) throw new ApiError(400, "too_many_pending");
        const { error } = await db.from("activities").insert({ ...a, status: "pending", created_by: m.id });
        if (error) throw error;
      }
      if (notify) {
        await background(adminLineIds().then((ids) =>
          pushLine(ids, `🙋【自揪申請待審核】${a.title}\n${fmtWhen(a)}\n申請人：${m.nickname}\n請到後台「活動管理 → 待審核」審核\n${LIFF_URL}?page=review`)
        ));
      }
      return { ok: true };
    }

    case "withdraw_proposal": {
      const m = requireApproved(member);
      const id = String(body.id ?? "");
      const { data: old } = await db.from("activities").select("status, created_by, images").eq("id", id).maybeSingle();
      if (!old || old.created_by !== m.id || !["pending", "rejected"].includes(old.status)) throw new ApiError(404, "not_found");
      const { error } = await db.from("activities").delete().eq("id", id);
      if (error) throw error;
      await cleanupImages(old.images ?? []);
      return { ok: true };
    }

    // ---------- 管理員 ----------
    case "admin_review_activity": {
      const me = requireAdmin(member);
      const id = String(body.id ?? "");
      const approve = body.decision === "approve";
      if (!approve && body.decision !== "reject") throw new ApiError(400, "bad_decision");
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) || null : null;
      if (!approve && !note) throw new ApiError(400, "note_required");   // 退回一定要給更改建議
      const { data: a, error } = await db.from("activities")
        .update({
          status: approve ? "open" : "rejected",
          review_note: note,   // 更改建議：退回、通過都保留（申請人在「我的自揪」看得到）
          reviewed_at: new Date().toISOString(),
          reviewed_by: me.id,
        })
        .eq("id", id).eq("status", "pending")
        .select("id, title, event_date, time_text, created_by")
        .maybeSingle();
      if (error) throw error;
      if (!a) throw new ApiError(409, "not_pending");   // 已經被別的管理員審過了
      const to = [await lineIdOf(a.created_by)];
      await background(pushLine(
        to,
        approve
          ? `🎉【自揪審核通過】${a.title}\n${fmtWhen(a)}\n已經上架，大家可以開始接龍囉！${note ? `\n\n管理員的更改建議：${note}` : ""}\n${evLink(a.id)}`
          : `↩️【自揪申請退回】${a.title}\n${fmtWhen(a)}\n${note ? `更改建議：${note}\n` : ""}請到網站「我的自揪」照建議修改後重新送出。\n${LIFF_URL}?page=proposals`,
      ));
      return { ok: true };
    }

    // 下載 Excel 用：一次拿多場活動的完整名單（含 LINE 名稱、備註、付款）
    case "admin_export": {
      requireAdmin(member);
      const ids = Array.isArray(body.activityIds) ? [...new Set(body.activityIds.map(String))].slice(0, 1000) : [];
      const rows: any[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        rows.push(...await fetchAll<any>(() =>
          db.from("signups")
            .select("activity_id, created_at, option, note, paid, promoted_at, members(nickname, line_display_name)")
            .in("activity_id", ids.slice(i, i + 100))
            .is("cancelled_at", null)
            .order("created_at")
            .order("id")
        ));
      }
      return {
        signups: rows.map((r) => ({
          activity_id: r.activity_id,
          created_at: r.created_at,
          nickname: r.members?.nickname,
          line_name: r.members?.line_display_name,
          option: r.option,
          note: r.note,
          paid: r.paid,
          promoted_at: r.promoted_at,
        })),
      };
    }

    case "admin_save_activity": {
      const m = requireAdmin(member);
      const a = cleanActivity((body.activity ?? {}) as Record<string, unknown>);
      const id = typeof body.id === "string" && body.id ? body.id : null;
      if (id) {
        const { data: old } = await db.from("activities").select("images").eq("id", id).maybeSingle();
        if (!old) throw new ApiError(404, "not_found");
        const { error } = await db.from("activities").update(a).eq("id", id);
        if (error) throw error;
        await cleanupImages((old.images ?? []).filter((p: string) => !a.images.includes(p)));
        await background(maybeNotifyReached(id).then(() => maybeNotifyFull(id)).catch((e) => console.error(e)));   // 例如把門檻調低後剛好成團
        return { ok: true, created: 0 };
      }
      // 新增時可以一次給多個日期（同一份內容，每個日期一場）
      const extra = Array.isArray(body.dates) ? body.dates.map(String) : [];
      const dates = [...new Set([a.event_date, ...extra])].slice(0, 20);
      if (dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new ApiError(400, "bad_date");
      const { error } = await db.from("activities").insert(dates.map((d) => ({ ...a, event_date: d, created_by: m.id })));
      if (error) throw error;
      return { ok: true, created: dates.length };
    }

    // 刪除活動：還沒舉行、有人接龍時要填原因，並用 LINE 通知所有接龍的人
    case "admin_delete_activity": {
      requireAdmin(member);
      const id = String(body.id ?? "");
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
      const { data: old } = await db.from("activities").select(`${NOTIFY_FIELDS}, images`).eq("id", id).maybeSingle();
      if (!old) throw new ApiError(404, "not_found");
      const list = await activeSignups(id);
      const notify = list.length > 0 && old.event_date >= twToday() && old.status === "open";
      if (notify && !reason) throw new ApiError(400, "reason_required");
      const { error } = await db.from("activities").delete().eq("id", id);
      if (error) throw error;
      await cleanupImages(old.images ?? []);
      if (notify) await background(notifyCancelled(old, list, "❌【活動取消】", `原因：${reason}`).catch((e) => console.error(e)));
      return { ok: true, notified: notify ? list.length : 0 };
    }

    // 流標：活動保留（顯示「已流標」），通知所有接龍的人
    case "admin_cancel_activity": {
      requireAdmin(member);
      const id = String(body.id ?? "");
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) || null : null;
      const { data: a, error } = await db.from("activities")
        .update({ status: "cancelled", cancel_reason: reason, cancelled_at: new Date().toISOString() })
        .eq("id", id).eq("status", "open")
        .select(NOTIFY_FIELDS).maybeSingle<NotifyAct>();
      if (error) throw error;
      if (!a) throw new ApiError(409, "not_open");
      const list = await activeSignups(id);
      await background(notifyCancelled(a, list, "😢【活動流標】",
        `很可惜沒有達到 ${a.threshold} 人開班門檻，這次活動取消。${reason ? `\n說明：${reason}` : ""}`).catch((e) => console.error(e)));
      return { ok: true, notified: list.length };
    }

    case "admin_roster": {
      requireAdmin(member);
      const { data, error } = await db
        .from("signups")
        .select("id, created_at, option, note, paid, promoted_at, members(nickname, line_display_name)")
        .eq("activity_id", String(body.activityId ?? ""))
        .is("cancelled_at", null)
        .order("created_at");
      if (error) throw error;
      return {
        roster: data.map((r: any) => ({
          id: r.id,
          created_at: r.created_at,
          nickname: r.members?.nickname,
          line_name: r.members?.line_display_name,
          option: r.option,
          note: r.note,
          paid: r.paid,
          promoted_at: r.promoted_at,
        })),
      };
    }

    // 移除接龍。移除的是正取而且有人在候補 → 候補第 1 位遞補：通知本人付款、通知管理員對帳
    case "admin_remove_signup": {
      requireAdmin(member);
      const signupId = String(body.signupId ?? "");
      const { data: su } = await db.from("signups").select("activity_id").eq("id", signupId).is("cancelled_at", null).maybeSingle();
      if (!su) return { ok: true };
      const before = await activeSignups(su.activity_id);
      const { error } = await db.from("signups")
        .update({ cancelled_at: new Date().toISOString() })
        .eq("id", signupId)
        .is("cancelled_at", null);
      if (error) throw error;
      const { data: a } = await db.from("activities").select(`${NOTIFY_FIELDS}, reached_notified_at`).eq("id", su.activity_id).maybeSingle();
      const idx = before.findIndex((s) => s.id === signupId);
      if (a && a.status === "open" && idx >= 0 && idx < a.capacity && before.length > a.capacity) {
        const removed = before[idx], promoted = before[a.capacity];
        await db.from("signups").update({ promoted_at: new Date().toISOString() }).eq("id", promoted.id);
        const reached = before.length - 1 >= a.threshold;
        const who = `${promoted.members?.nickname ?? "?"}${promoted.members?.line_display_name ? `（LINE：${promoted.members.line_display_name}）` : ""}`;
        await background(Promise.all([
          pushLine([promoted.members?.line_user_id],
            `🎉【候補遞補成功】${a.title}\n${fmtWhen(a)}\n有人取消，你從候補遞補為正取！\n` +
              (reached ? `${payText(a)}\n\n活動頁：${evLink(a.id)}` : `成團後會再通知你付款。\n活動頁：${evLink(a.id)}`)),
          adminLineIds().then((ids) => pushLine(ids,
            `🔁【候補遞補】${a.title}\n${fmtWhen(a)}\n${who} 從候補遞補為正取（補 ${removed.members?.nickname ?? "?"} 的位置）。\n` +
              (reached ? "已通知本人付款，收到款項後請到名單勾「已付款」。" : "還沒成團，成團時會一起通知付款。") + `\n${evLink(a.id)}`)),
        ]).catch((e) => console.error(e)));
        return { ok: true, promoted: promoted.members?.nickname ?? null };
      }
      return { ok: true };
    }

    case "admin_set_paid": {
      requireAdmin(member);
      const { error } = await db.from("signups").update({ paid: body.paid === true }).eq("id", String(body.signupId ?? ""));
      if (error) throw error;
      return { ok: true };
    }

    case "admin_save_about": {
      const m = requireAdmin(member);
      const text = typeof body.body === "string" ? body.body.slice(0, 20000) : "";
      const { error } = await db.from("site_content")
        .upsert({ key: "about", body: text, updated_at: new Date().toISOString(), updated_by: m.id });
      if (error) throw error;
      return { ok: true };
    }

    case "admin_members": {
      requireAdmin(member);
      const [members, active] = await Promise.all([
        fetchAll<any>(() =>
          db.from("members")
            .select("id, nickname, line_display_name, status, is_admin, created_at, reviewed_at")
            .order("created_at", { ascending: false })
        ),
        fetchAll<any>(() => db.from("signups").select("member_id").is("cancelled_at", null)),
      ]);
      const count: Record<string, number> = {};
      active.forEach((s) => { count[s.member_id] = (count[s.member_id] ?? 0) + 1; });
      return {
        members: members.map((m) => ({
          id: m.id,
          nickname: m.nickname,
          line_name: m.line_display_name,
          status: m.status,
          is_admin: m.is_admin,
          created_at: m.created_at,
          reviewed_at: m.reviewed_at,
          active_signups: count[m.id] ?? 0,
        })),
      };
    }

    case "admin_update_member": {
      const me = requireAdmin(member);
      const id = String(body.memberId ?? "");
      const patch: Record<string, unknown> = {};
      if (body.status !== undefined) {
        if (!STATUSES.includes(String(body.status))) throw new ApiError(400, "bad_status");
        patch.status = body.status;
        patch.reviewed_at = new Date().toISOString();
      }
      if (body.is_admin !== undefined) patch.is_admin = body.is_admin === true;
      if (!Object.keys(patch).length) throw new ApiError(400, "nothing_to_update");
      // 不能把自己停用或拿掉自己的管理員，避免後台沒人管
      if (id === me.id && ((patch.status && patch.status !== "approved") || patch.is_admin === false)) {
        throw new ApiError(400, "cannot_change_self");
      }
      const { error } = await db.from("members").update(patch).eq("id", id);
      if (error) throw error;
      return { ok: true };
    }

    default:
      throw new ApiError(400, "unknown_action");
  }
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get("Origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });

  try {
    const body = await req.json();
    // 每日排程：用 x-cron-secret 驗證（不經過 LINE 登入）
    if (body?.action === "cron_daily") {
      const secret = await cronSecret();
      if (!secret || req.headers.get("x-cron-secret") !== secret) throw new ApiError(401, "bad_cron_secret");
      return new Response(JSON.stringify(await runDaily()), { status: 200, headers });
    }
    const result = await handle(body ?? {});
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (e) {
    if (e instanceof ApiError) {
      return new Response(JSON.stringify({ error: e.code }), { status: e.status, headers });
    }
    console.error(e);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }
});
