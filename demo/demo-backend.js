/*
 * 出走社活動接龍：體驗模式的「假後端」
 *
 * 讓 app/index.html 不用 LINE、不用 Supabase 也能完整操作：
 *  - 假的 LIFF：社員頁第一次打開會走一次模擬的 LINE 登入流程（點連結 → 授權 → 進網站）
 *  - 攔截對後端 API 的呼叫，改用存在瀏覽器 localStorage 的假資料回應
 *  - 規則和正式後端（supabase/functions/api）一樣：審核、名額、候補、成團、自揪審核、管理員權限
 *  - 正式後端會用官方帳號傳 LINE 通知；體驗模式改成存進「模擬 LINE 通知」收件匣（頁面上方的 📩 按鈕）
 *  - 圖片存在瀏覽器裡（localStorage），容量有限，大約十幾張
 *
 * 社員頁和管理員頁在同一個網站底下，共用同一份 localStorage，所以一邊操作另一邊會即時更新。
 * 每個頁面在載入本檔前要先設定 window.DEMO_ROLE = 'member' 或 'admin'。
 */
(function () {
  const KEY = 'gwo-demo-db';
  const IMG_PREFIX = 'gwo-demo-img:';
  const ROLE = window.DEMO_ROLE === 'admin' ? 'admin' : 'member';
  const PERSONAS = {
    member: { line: 'U-demo-member', lineName: '體驗用 LINE 帳號' },
    admin:  { line: 'U-demo-admin',  lineName: '管理員（你）' },
  };
  const LIFF_URL = 'https://liff.line.me/2012620335-Hk2HkkYY';

  // ---------- 假資料 ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dayAfter = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  let seq = 0;
  const uid = (p) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

  // 示範圖片：用 SVG 畫的漸層＋字，不佔空間
  const SEED_IMAGES = {
    'seed:aroma':  ['#7a5c3e', '#e8c99b', '🌿', '調香'],
    'seed:aroma2': ['#4f6b52', '#d9e4c8', '🧴', '擴香石'],
    'seed:hike':   ['#2f6f7e', '#f0c27b', '⛰️', '陽明山'],
    'seed:hike2':  ['#3f7fb0', '#bfe0d9', '🥾', '健行'],
    'seed:knit':   ['#b4577e', '#f6d6c8', '🧶', '編織'],
  };
  function seedSvg(path) {
    const [a, b, emoji, word] = SEED_IMAGES[path] || ['#607789', '#dfe7ea', '🖼', '圖片'];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
      <rect width="800" height="600" fill="url(#g)"/><text x="400" y="290" font-size="150" text-anchor="middle">${emoji}</text>
      <text x="400" y="420" font-size="64" fill="#fff" text-anchor="middle" font-family="sans-serif" font-weight="700">${word}</text>
      <text x="400" y="560" font-size="26" fill="rgba(255,255,255,.8)" text-anchor="middle" font-family="sans-serif">示範圖片</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function seed() {
    const members = [
      { id: 'm-admin', line: PERSONAS.admin.line, line_name: PERSONAS.admin.lineName, nickname: '出走社管理員', is_admin: true,  status: 'approved', created_at: iso(60 * 24 * 30) },
      { id: 'm-1', line: 'U-1', line_name: 'Mei Chen',   nickname: '小美', is_admin: false, status: 'approved', created_at: iso(60 * 24 * 20) },
      { id: 'm-2', line: 'U-2', line_name: '芋圓好好吃', nickname: '芋圓', is_admin: false, status: 'approved', created_at: iso(60 * 24 * 18) },
      { id: 'm-3', line: 'U-3', line_name: 'Yuki',       nickname: 'Yuki', is_admin: false, status: 'approved', created_at: iso(60 * 24 * 12) },
      { id: 'm-4', line: 'U-4', line_name: '阿哲',       nickname: '阿哲', is_admin: false, status: 'approved', created_at: iso(60 * 24 * 6) },
    ];
    const A = (id, category, title, host_name, d, time_text, place, price, price_note, capacity, threshold, description, more = {}) =>
      ({ id, category, title, host_name, event_date: dayAfter(d), time_text, place, price, price_note, capacity, threshold, description,
         booking_url: null, options: null, wait_max: 0, images: [], status: 'open', created_by: 'm-admin', review_note: null,
         reached_notified_at: null, created_at: iso(60 * 24 * 10), ...more });
    const activities = [
      A('a-1', 'host',   '秋冬香氛調香課｜木質調擴香石', '香氛老師 Yen', 3,  '14:00–16:30', '出走社社辦', 1500, '含材料', 8, 4,
        '用雪松、檀香與一點橙花，調出屬於自己的秋冬氣味。\n每人完成一顆擴香石＋10ml 精油瓶。',
        { images: ['seed:aroma', 'seed:aroma2'], booking_url: 'https://agoodwayout.simplybook.asia/' }),
      A('a-2', 'member', '週五電影夜',                   '阿哲', 5,  '19:30',       '信義區影城', 0,    '票價自付', 6, 3, '看完找間咖啡廳聊聊心得，想來就 +1。', { created_by: 'm-4' }),
      A('a-3', 'select', '旅行寫作講座：把出走寫成故事', '合作講者 林小路', 8, '14:00–16:00', '合作場地・中山區', 1200, '含一杯飲品', 20, 10, '講者分享十年旅行寫作經驗。'),
      A('a-4', 'host',   '編織課｜冬日圍巾起針班',       '編織老師 Rita', 10, '14:00–17:00', '出走社社辦', 1800, '含毛線、棒針', 4, 2,
        '從起針到收針，三小時織出圍巾的第一段。',
        { images: ['seed:knit'], wait_max: 2, options: '單堂體驗（$1,800）\n三堂套組（$1,600／堂）', booking_url: 'https://agoodwayout.simplybook.asia/' }),
      A('a-5', 'social', '月底聚餐｜麻辣鍋之夜',         '出走社',       14, '18:30',       '東區・麻辣鍋', 680, '含服務費 $50', 12, 6, '月底一起吃鍋聊天！新朋友非常歡迎。'),
      A('a-8', 'host',   '陶藝體驗｜手捏小碗',         '陶藝老師 Ken', 4,  '10:00–12:00', '出走社社辦', 1200, '含燒製', 8, 4, '捏一個自己的小碗，燒好後寄給你。'),
      A('a-6', 'select', '植物染手帕工作坊',             '合作工作室 染日', 17, '13:30–16:30', '合作工作室・大稻埕', 1600, '含材料', 12, 6, '用洋蔥皮與薯榔染出暖色系手帕。'),
      // 一筆等待管理員審核的社員自揪
      A('a-7', 'member', '週日陽明山健行（擎天崗大草原）', '小美', 12, '09:00–14:00', '捷運劍潭站 2 號出口集合', 0, 'AA 制，公車自付', 8, 3,
        '輕鬆路線約 3 小時，適合第一次爬山的人。\n請穿好走的鞋、帶水和午餐。下雨就改期。',
        { status: 'pending', created_by: 'm-1', images: ['seed:hike', 'seed:hike2'], created_at: iso(90) }),
    ];
    const S = (activity_id, member_id, minsAgo, extra = {}) => ({ id: uid('s'), activity_id, member_id, created_at: iso(minsAgo), cancelled_at: null, option: null, note: null, paid: false, ...extra });
    const signups = [
      S('a-1', 'm-1', 3000), S('a-1', 'm-2', 2500, { note: '可能會晚 10 分鐘' }), S('a-1', 'm-3', 2000),   // 差 1 人成團：適合體驗「關鍵一票」＋成團通知
      S('a-2', 'm-4', 1500), S('a-2', 'm-1', 1200),                                                     // 差 1 人成團
      S('a-3', 'm-2', 900),  S('a-3', 'm-3', 800),
      S('a-4', 'm-1', 1000, { option: '單堂體驗（$1,800）', paid: true }), S('a-4', 'm-2', 950, { option: '三堂套組（$1,600／堂）' }),
      S('a-4', 'm-3', 900, { option: '單堂體驗（$1,800）' }), S('a-4', 'm-4', 850, { option: '單堂體驗（$1,800）' }),   // 已滿團，可排候補
      S('a-8', 'm-3', 1100),                                                                            // 4 天後、只有 1 人：每日排程會提醒「即將流標」
      S('a-5', 'm-1', 700),  S('a-5', 'm-2', 600), S('a-5', 'm-3', 500), S('a-5', 'm-4', 400), S('a-5', 'm-admin', 300),
    ];
    // 已經成團的活動視為「已通知過」
    activities.forEach((a) => {
      const n = signups.filter((s) => s.activity_id === a.id).length;
      if (n >= a.threshold) a.reached_notified_at = iso(300);
      if (n >= a.capacity) a.full_notified_at = iso(300);
    });
    const about = '## 關於出走社\n這是體驗模式的示範內容，正式網站的內容由管理員在後台編輯。\n\n## 社群規範\n- 接龍就是承諾，成團後請準時付款\n- 臨時不能參加，請私訊管理員';
    const notices = [{
      id: uid('n'), to: 'm-admin', at: iso(90),
      text: `🙋【自揪申請待審核】週日陽明山健行（擎天崗大草原）\n${when(activities[6])}\n申請人：小美\n請到後台「活動管理 → 待審核」審核\n${LIFF_URL}?page=review`,
    }];
    return { v: 2, members, activities, signups, about, notices };
  }

  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) { const db = JSON.parse(raw); if (db.v === 2) return db; } } catch (e) {}
    const db = seed();   // 沒有資料，或是舊版體驗模式的資料 → 重新建立
    save(db);
    return db;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }

  // ---------- 模擬 LINE 通知 ----------
  function when(a) {
    const [y, m, d] = a.event_date.split('-').map(Number);
    const wd = '日一二三四五六'[new Date(y, m - 1, d).getDay()];
    return `${m}/${d}（${wd}）${a.time_text ? ' ' + a.time_text : ''}`;
  }
  let cronRun = false;   // 「模擬每天早上 9:00」執行中：發出的訊息標成排程訊息
  function pushLine(db, memberIds, text) {
    const at = new Date().toISOString();
    [...new Set(memberIds.filter(Boolean))].forEach((to) => db.notices.push({ id: uid('n'), to, at, text, ...(cronRun ? { cron: true } : {}) }));
  }
  const adminIds = (db) => db.members.filter((m) => m.is_admin && m.status === 'approved').map((m) => m.id);
  const evLink = (id) => `${LIFF_URL}?ev=${id}`;
  // LINE 訊息裡的付款連結加 openExternalBrowser=1：在 LINE 裡點開會改用手機預設瀏覽器
  function extUrl(u){
    try{ const x = new URL(u); x.searchParams.set('openExternalBrowser', '1'); return x.toString(); }catch(e){ return u; }
  }
  function payText(a) {
    const price = a.price ? `$${Number(a.price).toLocaleString('en-US')}${a.price_note ? `（${a.price_note}）` : ''}` : '免費';
    const how = a.booking_url ? `請在活動前 7 天完成預約付款：\n${extUrl(a.booking_url)}`
      : a.category === 'member' ? '付款方式請留意揪團人在 LINE 社群的說明。'
      : '管理員會在 LINE 社群公告付款方式，請留意訊息。';
    return `費用：${price}\n${how}`;
  }
  const listOf = (db, id) => active(db).filter((s) => s.activity_id === id).sort((x, y) => x.created_at.localeCompare(y.created_at));
  function afterJoin(db, a, memberId) {
    const before = a.reached_notified_at;
    maybeNotifyReached(db, a);
    if (before) {   // 已經成團後才接龍：通知這個人付款
      const list = listOf(db, a.id), idx = list.findIndex((s) => s.member_id === memberId);
      if (idx >= 0 && idx < a.capacity) pushLine(db, [memberId], `🎉【接龍成功・請付款】${a.title}\n${when(a)}\n這場已經成團，你是正取第 ${idx + 1} 位。\n${payText(a)}\n\n活動頁：${evLink(a.id)}`);
    }
    const n = listOf(db, a.id).length;
    if (!a.full_notified_at && n >= a.capacity) {
      a.full_notified_at = new Date().toISOString();
      pushLine(db, adminIds(db), `📣【滿團】${a.title}\n${when(a)}\n名額 ${a.capacity} 人已滿${a.wait_max ? `，接下來開放候補 ${a.wait_max} 位` : '（沒有開放候補）'}。\n想參加的人多，可以考慮加開一場。\n${evLink(a.id)}`);
    }
  }
  function notifyCancelled(db, a, list, head, reasonLine) {
    const base = `${head}${a.title}\n${when(a)}\n${reasonLine}`;
    list.forEach((s, i) => pushLine(db, [s.member_id], i < a.capacity && s.paid
      ? `${base}\n\n你已付款的費用，管理員會另外聯繫你辦理退款。造成不便很抱歉。` : `${base}\n\n謝謝你的接龍，下次見！`));
  }
  // 每天早上 9:00：「即將流標」＋「待付款」合成一則「每日提醒」給管理員（對照正式後端 runDaily）
  function runDaily(db) {
    const today = todayTw(), limit = dayAfter(7);
    const acts = db.activities.filter((a) => a.status === 'open' && a.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date));
    let warned = 0, unpaid = 0; const flopLines = [], payBlocks = [];
    acts.forEach((a) => {
      const list = listOf(db, a.id);
      if (list.length < a.threshold) {
        if (a.flop_warned_at || a.event_date > limit) return;
        a.flop_warned_at = new Date().toISOString(); warned++;
        const days = Math.round((new Date(a.event_date) - new Date(today)) / 86400000);
        const line = `▸ ${when(a)} ${a.title}\n　${list.length}／${a.threshold} 人，還差 ${a.threshold - list.length} 人（還有 ${days} 天）`;
        flopLines.push(line);
        return;
      }
      const due = list.slice(0, a.capacity).filter((s) => !s.paid);
      if (!due.length) return;
      unpaid += due.length;
      payBlocks.push(`▸ ${when(a)} ${a.title}（${due.length} 人）\n` + due.map((s) => { const m = nickOf(db, s.member_id); return `　${m.nickname}${m.line_name ? `（LINE：${m.line_name}）` : ''}`; }).join('\n'));
    });
    if (!flopLines.length && !payBlocks.length) return { flopWarned: 0, unpaid: 0, sent: false };
    const [, m, d] = today.split('-').map(Number);
    const parts = [`☀️【出走社每日提醒】${m}/${d}`];
    if (flopLines.length) parts.push(`⚠️ 即將流標（${flopLines.length} 場）\n${flopLines.join('\n')}\n要流標請到後台打開那場按「流標」，會通知接龍的人；想再等等就不用動作。`);
    if (payBlocks.length) parts.push(`💰 待付款（共 ${unpaid} 人）\n${payBlocks.join('\n')}\n收到款項後，請到後台名單勾「已付款」。`);
    parts.push(`${LIFF_URL}?page=events`);
    pushLine(db, adminIds(db), parts.join('\n\n'));
    return { flopWarned: warned, unpaid, sent: true };
  }

  function maybeNotifyReached(db, a) {
    const list = active(db).filter((s) => s.activity_id === a.id).sort((x, y) => x.created_at.localeCompare(y.created_at));
    if (a.status !== 'open' || a.reached_notified_at || list.length < a.threshold) return;
    a.reached_notified_at = new Date().toISOString();
    const price = a.price ? `$${Number(a.price).toLocaleString('en-US')}${a.price_note ? `（${a.price_note}）` : ''}` : '免費';
    const pay = a.booking_url ? `請在活動前 7 天完成預約付款：\n${extUrl(a.booking_url)}`
      : a.category === 'member' ? '付款方式請留意揪團人在 LINE 社群的說明。'
      : '管理員會在 LINE 社群公告付款方式，請留意訊息。';
    pushLine(db, list.slice(0, a.capacity).map((s) => s.member_id),
      `🎉【成團通知】${a.title}\n${when(a)}\n已達 ${a.threshold} 人開班門檻，活動確定舉行！\n費用：${price}\n${pay}\n\n活動頁：${evLink(a.id)}`);
    pushLine(db, adminIds(db),
      `✅【成團】${a.title}\n${when(a)}・目前 ${list.length}／${a.capacity} 人（門檻 ${a.threshold} 人）\n` +
      (a.booking_url ? '團員已收到預約付款通知。' : '這場沒有預約付款連結，請到 LINE 社群公告付款方式。') + `\n每天早上 9:00 的「每日提醒」會列出還沒付款的人。\n${evLink(a.id)}`);
  }

  // ---------- 規則（對照 supabase/functions/api/index.ts） ----------
  class ApiError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
  const memberOut = (m) => ({ nickname: m.nickname, is_admin: m.is_admin, status: m.status });
  const active = (db) => db.signups.filter((s) => !s.cancelled_at);
  const nickOf = (db, id) => db.members.find((m) => m.id === id) || {};
  const todayTw = () => dayAfter(0);

  function requireMember(m) { if (!m) throw new ApiError(403, 'no_nickname'); return m; }
  function requireApproved(m) { requireMember(m); if (m.status !== 'approved') throw new ApiError(403, m.status); return m; }
  function requireAdmin(m) { requireApproved(m); if (!m.is_admin) throw new ApiError(403, 'not_admin'); return m; }

  function cleanOptions(v) {
    if (typeof v !== 'string') return null;
    const list = v.split(/\r?\n/).map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 10);
    return list.length ? list.join('\n') : null;
  }
  function cleanActivity(a) {
    const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const out = {
      category: str(a.category), title: str(a.title), host_name: str(a.host_name), event_date: str(a.event_date),
      time_text: str(a.time_text, 50) || null, place: str(a.place) || null, price: Number(a.price ?? 0),
      price_note: str(a.price_note) || null, capacity: Number(a.capacity), threshold: Number(a.threshold),
      description: str(a.description, 4000) || null, booking_url: str(a.booking_url, 500) || null,
      options: cleanOptions(a.options), wait_max: Number(a.wait_max ?? 0),
      images: Array.isArray(a.images) ? [...new Set(a.images.map(String))] : [],
    };
    if (out.images.length > 3) throw new ApiError(400, 'bad_images');
    if (out.booking_url && !/^https?:\/\//.test(out.booking_url)) throw new ApiError(400, 'bad_booking_url');
    if (!(out.wait_max >= 0 && out.wait_max <= 20)) throw new ApiError(400, 'bad_wait_max');
    if (!['host', 'select', 'member', 'social'].includes(out.category)) throw new ApiError(400, 'bad_category');
    if (!out.title || !out.host_name) throw new ApiError(400, 'missing_fields');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.event_date)) throw new ApiError(400, 'bad_date');
    if (!(out.price >= 0)) throw new ApiError(400, 'bad_price');
    if (!(out.capacity >= 1) || !(out.threshold >= 1)) throw new ApiError(400, 'bad_numbers');
    if (out.threshold > out.capacity) throw new ApiError(400, 'threshold_over_capacity');
    return out;
  }
  function cleanupImages(db, paths) {
    paths.forEach((p) => {
      if (!db.activities.some((a) => (a.images || []).includes(p))) { try { localStorage.removeItem(IMG_PREFIX + p); } catch (e) {} }
    });
  }
  function activityOut(db, a, viewer) {
    const own = a.created_by === viewer.id;
    const c = nickOf(db, a.created_by);
    const { reached_notified_at, full_notified_at, flop_warned_at, created_by, review_note, ...rest } = a;
    return {
      ...rest, mine_created: own,
      ...(viewer.is_admin || own ? { review_note } : { created_at: undefined }),
      ...(viewer.is_admin ? { proposer: c.nickname || null, proposer_line: c.line_name || null } : {}),
    };
  }

  function handle(body) {
    const persona = Object.values(PERSONAS).find((p) => 'demo-' + p.line === body.idToken);
    if (!persona) throw new ApiError(401, 'invalid_token');
    const db = load();
    let me = db.members.find((m) => m.line === persona.line);
    let changed = false;
    let result;

    switch (body.action) {
      case 'me':
        result = me ? { member: memberOut(me), mySignups: me.status === 'approved' ? active(db).filter((s) => s.member_id === me.id).map((s) => s.activity_id) : [] }
                    : { member: null, mySignups: [] };
        break;

      case 'data': {
        requireApproved(me);
        const st = me.is_admin ? ['open', 'cancelled', 'pending', 'rejected'] : ['open', 'cancelled'];
        const acts = db.activities.filter((a) => st.includes(a.status)).sort((a, b) => a.event_date.localeCompare(b.event_date) || a.created_at.localeCompare(b.created_at));
        const ids = new Set(acts.filter((a) => a.status === 'open' || a.status === 'cancelled').map((a) => a.id));
        result = {
          activities: acts.map((a) => activityOut(db, a, me)),
          myProposals: me.is_admin ? [] : db.activities.filter((a) => a.created_by === me.id && ['pending', 'rejected'].includes(a.status))
            .sort((a, b) => b.created_at.localeCompare(a.created_at)).map((a) => activityOut(db, a, me)),
          signups: active(db).filter((s) => ids.has(s.activity_id)).sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((s) => ({ activity_id: s.activity_id, nickname: nickOf(db, s.member_id).nickname, option: s.option })),
        };
        break;
      }

      case 'set_nickname': {
        const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
        if (!nickname || [...nickname].length > 12) throw new ApiError(400, 'bad_nickname');
        if (db.members.some((m) => m !== me && m.nickname.toLowerCase() === nickname.toLowerCase())) throw new ApiError(409, 'nickname_taken');
        if (me) me.nickname = nickname;
        else {
          me = { id: uid('m'), line: persona.line, line_name: persona.lineName, nickname, is_admin: false, status: 'pending', created_at: new Date().toISOString() };
          db.members.push(me);
        }
        changed = true;
        result = { member: memberOut(me) };
        break;
      }

      case 'join': {
        requireApproved(me);
        const a = db.activities.find((x) => x.id === body.activityId && x.status === 'open');
        if (!a) { result = { result: 'not_found' }; break; }
        const opts = a.options ? a.options.split('\n') : [];
        let option = typeof body.option === 'string' ? body.option.trim() : null;
        if (opts.length) { if (!option || !opts.includes(option)) throw new ApiError(400, 'bad_option'); } else option = null;
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 100) || null : null;
        const list = active(db).filter((s) => s.activity_id === a.id);
        if (list.some((s) => s.member_id === me.id)) { result = { result: 'already_joined' }; break; }
        if (list.length >= a.capacity + (a.wait_max || 0)) { result = { result: 'full' }; break; }
        db.signups.push({ id: uid('s'), activity_id: a.id, member_id: me.id, created_at: new Date().toISOString(), cancelled_at: null, option, note, paid: false });
        changed = true;
        if (list.length >= a.capacity) { result = { result: 'waitlist' }; break; }
        afterJoin(db, a, me.id);
        result = { result: list.length + 1 === a.threshold ? 'reached' : 'ok' };
        break;
      }

      case 'about':
        requireApproved(me);
        result = { body: db.about || '', updated_at: null };
        break;

      case 'upload_image': {
        requireApproved(me);
        const data = typeof body.data === 'string' ? body.data : '';
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(data)) throw new ApiError(400, 'bad_image');
        const path = uid('img');
        try { localStorage.setItem(IMG_PREFIX + path, data); }
        catch (e) { throw new ApiError(400, 'image_too_large'); }   // 瀏覽器空間滿了：按「重來一次」清掉
        result = { path };
        break;
      }

      case 'propose_activity': {
        requireApproved(me);
        const a = cleanActivity({ ...(body.activity || {}), category: 'member' });
        a.booking_url = null;
        if (a.event_date < todayTw()) throw new ApiError(400, 'date_passed');
        let notify = true;
        if (body.id) {
          const old = db.activities.find((x) => x.id === body.id);
          if (!old || old.created_by !== me.id || !['pending', 'rejected'].includes(old.status)) throw new ApiError(404, 'not_found');
          notify = old.status === 'rejected';
          const oldImgs = old.images || [];
          Object.assign(old, a, { status: 'pending', review_note: null });
          cleanupImages(db, oldImgs.filter((p) => !a.images.includes(p)));
        } else {
          if (db.activities.filter((x) => x.created_by === me.id && x.status === 'pending').length >= 5) throw new ApiError(400, 'too_many_pending');
          db.activities.push({ ...a, id: uid('a'), status: 'pending', created_by: me.id, review_note: null, reached_notified_at: null, created_at: new Date().toISOString() });
        }
        if (notify) pushLine(db, adminIds(db), `🙋【自揪申請待審核】${a.title}\n${when(a)}\n申請人：${me.nickname}\n請到後台「活動管理 → 待審核」審核\n${LIFF_URL}?page=review`);
        changed = true;
        result = { ok: true };
        break;
      }

      case 'withdraw_proposal': {
        requireApproved(me);
        const old = db.activities.find((x) => x.id === body.id);
        if (!old || old.created_by !== me.id || !['pending', 'rejected'].includes(old.status)) throw new ApiError(404, 'not_found');
        db.activities = db.activities.filter((x) => x !== old);
        cleanupImages(db, old.images || []);
        changed = true;
        result = { ok: true };
        break;
      }

      case 'admin_review_activity': {
        requireAdmin(me);
        const approve = body.decision === 'approve';
        if (!approve && body.decision !== 'reject') throw new ApiError(400, 'bad_decision');
        const a = db.activities.find((x) => x.id === body.id && x.status === 'pending');
        if (!a) throw new ApiError(409, 'not_pending');
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null;
        a.status = approve ? 'open' : 'rejected';
        a.review_note = approve ? null : note;
        pushLine(db, [a.created_by], approve
          ? `🎉【自揪審核通過】${a.title}\n${when(a)}\n已經上架，大家可以開始接龍囉！\n${evLink(a.id)}`
          : `↩️【自揪申請退回】${a.title}\n${when(a)}\n${note ? `原因：${note}\n` : ''}可以到網站「我的自揪」修改後重新送出。\n${LIFF_URL}?page=proposals`);
        changed = true;
        result = { ok: true };
        break;
      }

      case 'admin_export': {
        requireAdmin(me);
        const ids = new Set(Array.isArray(body.activityIds) ? body.activityIds : []);
        result = {
          signups: active(db).filter((s) => ids.has(s.activity_id)).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((s) => {
            const m = nickOf(db, s.member_id);
            return { activity_id: s.activity_id, created_at: s.created_at, nickname: m.nickname, line_name: m.line_name, option: s.option, note: s.note, paid: s.paid, promoted_at: s.promoted_at || null };
          }),
        };
        break;
      }

      case 'admin_save_activity': {
        requireAdmin(me);
        const a = cleanActivity(body.activity || {});
        if (body.id) {
          const old = db.activities.find((x) => x.id === body.id);
          if (!old) throw new ApiError(404, 'not_found');
          const oldImgs = old.images || [];
          Object.assign(old, a);
          cleanupImages(db, oldImgs.filter((p) => !a.images.includes(p)));
          maybeNotifyReached(db, old);
          result = { ok: true, created: 0 };
        } else {
          const dates = [...new Set([a.event_date, ...(Array.isArray(body.dates) ? body.dates.map(String) : [])])].slice(0, 20);
          dates.forEach((d) => db.activities.push({ ...a, event_date: d, id: uid('a'), status: 'open', created_by: me.id, review_note: null, reached_notified_at: null, created_at: new Date().toISOString() }));
          result = { ok: true, created: dates.length };
        }
        changed = true;
        break;
      }

      case 'admin_delete_activity': {
        requireAdmin(me);
        const old = db.activities.find((x) => x.id === body.id);
        if (!old) throw new ApiError(404, 'not_found');
        const list = listOf(db, old.id);
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
        const notify = list.length > 0 && old.event_date >= todayTw() && old.status === 'open';
        if (notify && !reason) throw new ApiError(400, 'reason_required');
        if (notify) notifyCancelled(db, old, list, '❌【活動取消】', `原因：${reason}`);
        db.activities = db.activities.filter((x) => x.id !== body.id);
        db.signups = db.signups.filter((s) => s.activity_id !== body.id);
        cleanupImages(db, old.images || []);
        changed = true;
        result = { ok: true, notified: notify ? list.length : 0 };
        break;
      }

      case 'admin_cancel_activity': {
        requireAdmin(me);
        const a = db.activities.find((x) => x.id === body.id && x.status === 'open');
        if (!a) throw new ApiError(409, 'not_open');
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) || null : null;
        Object.assign(a, { status: 'cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() });
        const list = listOf(db, a.id);
        notifyCancelled(db, a, list, '😢【活動流標】', `很可惜沒有達到 ${a.threshold} 人開班門檻，這次活動取消。${reason ? `\n說明：${reason}` : ''}`);
        changed = true;
        result = { ok: true, notified: list.length };
        break;
      }

      case 'cron_daily':
        requireAdmin(me);   // 體驗模式：管理員頁的「模擬每天早上 9:00」按鈕
        cronRun = true;
        try { result = runDaily(db); } finally { cronRun = false; }
        changed = true;
        break;

      case 'admin_roster':
        requireAdmin(me);
        result = {
          roster: active(db).filter((s) => s.activity_id === body.activityId).sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((s) => { const m = nickOf(db, s.member_id); return { id: s.id, created_at: s.created_at, nickname: m.nickname, line_name: m.line_name, option: s.option, note: s.note, paid: s.paid, promoted_at: s.promoted_at || null }; }),
        };
        break;

      case 'admin_remove_signup': {
        requireAdmin(me);
        const s = db.signups.find((x) => x.id === body.signupId && !x.cancelled_at);
        result = { ok: true };
        if (s) {
          const a = db.activities.find((x) => x.id === s.activity_id);
          const before = listOf(db, s.activity_id), idx = before.indexOf(s);
          s.cancelled_at = new Date().toISOString();
          if (a && a.status === 'open' && idx < a.capacity && before.length > a.capacity) {
            const promoted = before[a.capacity];
            promoted.promoted_at = new Date().toISOString();
            const reached = before.length - 1 >= a.threshold;
            const pm = nickOf(db, promoted.member_id), rm = nickOf(db, s.member_id);
            pushLine(db, [promoted.member_id], `🎉【候補遞補成功】${a.title}\n${when(a)}\n有人取消，你從候補遞補為正取！\n` + (reached ? `${payText(a)}\n\n活動頁：${evLink(a.id)}` : `成團後會再通知你付款。\n活動頁：${evLink(a.id)}`));
            pushLine(db, adminIds(db), `🔁【候補遞補】${a.title}\n${when(a)}\n${pm.nickname}${pm.line_name ? `（LINE：${pm.line_name}）` : ''} 從候補遞補為正取（補 ${rm.nickname} 的位置）。\n` + (reached ? '已通知本人付款，收到款項後請到名單勾「已付款」。' : '還沒成團，成團時會一起通知付款。') + `\n${evLink(a.id)}`);
            result = { ok: true, promoted: pm.nickname };
          }
        }
        changed = true;
        break;
      }

      case 'admin_set_paid': {
        requireAdmin(me);
        const s = db.signups.find((x) => x.id === body.signupId);
        if (s) s.paid = body.paid === true;
        changed = true;
        result = { ok: true };
        break;
      }

      case 'admin_save_about':
        requireAdmin(me);
        db.about = typeof body.body === 'string' ? body.body.slice(0, 20000) : '';
        changed = true;
        result = { ok: true };
        break;

      case 'admin_members': {
        requireAdmin(me);
        const count = {};
        active(db).forEach((s) => { count[s.member_id] = (count[s.member_id] || 0) + 1; });
        result = {
          members: [...db.members].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((m) => ({
            id: m.id, nickname: m.nickname, line_name: m.line_name, status: m.status, is_admin: m.is_admin,
            created_at: m.created_at, active_signups: count[m.id] || 0,
          })),
        };
        break;
      }

      case 'admin_update_member': {
        requireAdmin(me);
        const t = db.members.find((x) => x.id === body.memberId);
        if (!t) throw new ApiError(400, 'not_found');
        if (t.id === me.id && ((body.status && body.status !== 'approved') || body.is_admin === false)) throw new ApiError(400, 'cannot_change_self');
        if (body.status) t.status = body.status;
        if (body.is_admin !== undefined) t.is_admin = body.is_admin === true;
        changed = true;
        result = { ok: true };
        break;
      }

      default:
        throw new ApiError(400, 'unknown_action');
    }
    if (changed) save(db);
    return result;
  }

  // ---------- 攔截網頁對後端的呼叫 ----------
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    if (typeof url === 'string' && url.endsWith('/functions/v1/api')) {
      await new Promise((r) => setTimeout(r, 250)); // 模擬一點網路延遲
      let status = 200, body;
      try { body = handle(JSON.parse(opts && opts.body || '{}')); }
      catch (e) { status = e.status || 500; body = { error: e.code || 'server_error' }; if (!e.status) console.error(e); }
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, opts);
  };

  // ---------- 圖片網址 ----------
  // 存在瀏覽器裡的圖片轉成 blob: 網址（點圖片開新分頁看大圖時，瀏覽器不允許直接開 data: 網址）
  const blobCache = {};
  function imgUrl(path) {
    if (path.startsWith('seed:')) return seedSvg(path);
    if (blobCache[path]) return blobCache[path];
    let data = null;
    try { data = localStorage.getItem(IMG_PREFIX + path); } catch (e) {}
    if (!data) return seedSvg('missing');
    const [head, b64] = data.split(',');
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return (blobCache[path] = URL.createObjectURL(new Blob([bytes], { type: head.slice(5, head.indexOf(';')) })));
  }

  // ---------- 模擬 LINE 登入流程（只有社員頁） ----------
  // 正式網站：在 LINE 社群點連結 → 第一次會看到 LINE 的授權畫面 → 按「許可」→ 進網站。
  // 這裡用畫面模擬同樣的步驟；按過「許可」就記住，按「重來一次」會清掉。
  const LINE_OK = 'gwo-demo-line-ok';
  const lineOk = () => { try { return localStorage.getItem(LINE_OK) === '1'; } catch (e) { return true; } };

  function showLineLogin() {
    return new Promise((resolve) => {
      const css = document.createElement('style');
      css.textContent = `
        .dl-wrap{position:fixed;inset:0;z-index:500;background:rgba(20,35,48,.55);display:grid;place-items:center;padding:16px;overflow:auto}
        .dl-phone{width:min(380px,100%);background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit}
        .dl-top{background:#06c755;color:#fff;font-weight:700;padding:12px 16px;display:flex;align-items:center;gap:8px;font-size:15px}
        .dl-top small{margin-left:auto;font-weight:500;opacity:.85;font-size:12px}
        .dl-step{font-size:12px;color:#607789;padding:14px 20px 0}
        .dl-body{padding:12px 20px 20px}
        .dl-chat{background:#8ca6c4;border-radius:16px;padding:16px 12px;display:flex;gap:8px;align-items:flex-start}
        .dl-av{width:34px;height:34px;border-radius:50%;background:#2f6f7e;color:#fff;display:grid;place-items:center;font-weight:700;flex:none}
        .dl-name{font-size:12px;color:#fff;margin-bottom:4px}
        .dl-bubble{background:#fff;border-radius:4px 16px 16px 16px;padding:10px 12px;font-size:14px;line-height:1.5;color:#18364b}
        .dl-link{color:#2a6ad6;text-decoration:underline;cursor:pointer;word-break:break-all;border:0;background:none;padding:0;font:inherit;text-align:left}
        .dl-app{display:flex;gap:12px;align-items:center;margin:6px 0 16px}
        .dl-icon{width:48px;height:48px;border-radius:12px;background:#18364b;color:#fff;display:grid;place-items:center;font-weight:700;font-size:20px}
        .dl-sub{font-size:12px;color:#607789}
        .dl-title{font-weight:700;margin:0 0 8px;color:#18364b}
        .dl-list{list-style:none;margin:0 0 18px;padding:0;border:1px solid #e3e8ec;border-radius:12px}
        .dl-list li{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:10px 12px;border-bottom:1px solid #e3e8ec;font-size:14px;color:#18364b}
        .dl-list li:last-child{border-bottom:0}
        .dl-list span{grid-column:1;font-size:12px;color:#607789}
        .dl-list em{grid-row:1/3;grid-column:2;align-self:center;font-style:normal;font-size:12px;color:#06c755;font-weight:700}
        .dl-ok{width:100%;border:0;border-radius:12px;background:#06c755;color:#fff;font-weight:700;font-size:16px;padding:13px;cursor:pointer}
        .dl-cancel{width:100%;border:0;background:none;color:#607789;font-size:14px;padding:12px;cursor:pointer}
        .dl-note{background:#fff7e6;color:#6e4c12;font-size:12px;padding:10px 16px;line-height:1.5}
        .dl-center{text-align:center;color:#18364b}
        .dl-center p{color:#607789;font-size:14px}`;
      document.head.appendChild(css);
      const wrap = document.createElement('div');
      wrap.className = 'dl-wrap';
      document.body.appendChild(wrap);
      const frame = (step, body, note) => {
        wrap.innerHTML = `<div class="dl-phone" role="dialog" aria-label="LINE 登入（模擬）">
          <div class="dl-top">LINE<small>模擬畫面</small></div>
          <div class="dl-step">${step}</div><div class="dl-body">${body}</div>
          <div class="dl-note">${note}</div></div>`;
      };
      const chat = () => {
        frame('步驟 1／3　在 LINE 社群看到活動連結',
          `<div class="dl-chat"><div class="dl-av">出</div><div><div class="dl-name">女子出走社（LINE 社群）</div>
            <div class="dl-bubble">📣 這個月的活動接龍開跑囉！<br>看看誰報名、+1 接龍 👇<br>
            <button class="dl-link" data-dl="open">https://liff.line.me/2012620335-Hk2HkkYY</button></div></div></div>`,
          '點上面的藍色連結，繼續下一步');
      };
      const consent = () => {
        frame('步驟 2／3　LINE 詢問是否允許（只有第一次會出現）',
          `<div class="dl-app"><div class="dl-icon">出</div><div><b>出走社接龍</b><div class="dl-sub">由「出走社」提供</div></div></div>
           <p class="dl-title">此服務想取得以下權限</p>
           <ul class="dl-list">
             <li><b>你的個人檔案資訊</b><span>名稱、大頭貼</span><em>必要</em></li>
             <li><b>你的用戶識別碼</b><span>用來確認是你本人，不會公開</span><em>必要</em></li>
           </ul>
           <button class="dl-ok" data-dl="allow">許可</button>
           <button class="dl-cancel" data-dl="deny">取消</button>`,
          '正式網站在 LINE 裡打開時，第一次會看到 LINE 的這個授權畫面；之後就會自動登入');
      };
      const denied = () => {
        frame('步驟 2／3　你按了「取消」',
          `<div class="dl-center"><div style="font-size:36px">🙅</div><b>需要許可才能使用接龍</b>
           <p>網站要確認是你本人，才能讓你接龍、顯示在名單上。</p></div>
           <button class="dl-ok" data-dl="open">重新登入</button>`,
          '正式網站也是一樣：沒有按「許可」就無法使用');
      };
      wrap.addEventListener('click', (e) => {
        const t = e.target.closest('[data-dl]');
        if (!t) return;
        if (t.dataset.dl === 'open') consent();
        else if (t.dataset.dl === 'deny') denied();
        else if (t.dataset.dl === 'allow') {
          try { localStorage.setItem(LINE_OK, '1'); } catch (err) {}
          wrap.remove();
          resolve();   // 步驟 3／3：回到網站，開始設定暱稱
        }
      });
      chat();
    });
  }

  // ---------- 假的 LINE 登入 ----------
  window.liff = {
    init: async () => { if (ROLE === 'member' && !lineOk()) await showLineLogin(); },
    isLoggedIn: () => true,
    getIDToken: () => 'demo-' + PERSONAS[ROLE].line,
    isInClient: () => false,
    login: () => location.reload(),
    logout: () => {},
  };

  // ---------- 給頁面用的小工具 ----------
  window.DemoBackend = {
    KEY,
    ROLE,
    imgUrl,
    // 模擬 LINE 通知：mine＝寄給這一頁的人；all＝所有人（含示範社員）收到的
    notices() {
      const db = load();
      const me = db.members.find((m) => m.line === PERSONAS[ROLE].line);
      const list = [...db.notices].sort((a, b) => b.at.localeCompare(a.at))
        .map((n) => ({ ...n, toName: nickOf(db, n.to).nickname || '（已刪除）', mine: !!me && n.to === me.id }));
      return { mine: list.filter((n) => n.mine), all: list, meId: me?.id || null };
    },
    reset() {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('gwo-demo')).forEach((k) => localStorage.removeItem(k));
      } catch (e) {}
    },
  };
})();
