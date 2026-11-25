/*
 * 出走社活動接龍：體驗模式的「假後端」
 *
 * 讓 app/index.html 不用 LINE、不用 Supabase 也能完整操作：
 *  - 假的 LIFF：社員頁第一次打開會走一次模擬的 LINE 登入流程（點連結 → 授權 → 進網站）
 *  - 攔截對後端 API 的呼叫，改用存在瀏覽器 localStorage 的假資料回應
 *  - 規則和正式後端（supabase/functions/api）一樣：審核、名額、成團、管理員權限
 *  - 正式後端會傳 LINE 通知給管理員；體驗模式不傳通知（管理員看側邊欄的待審核數字即可）
 *
 * 社員頁和管理員頁在同一個網站底下，共用同一份 localStorage，所以一邊操作另一邊會即時更新。
 * 每個頁面在載入本檔前要先設定 window.DEMO_ROLE = 'member' 或 'admin'。
 */
(function () {
  const KEY = 'gwo-demo-db';
  const ROLE = window.DEMO_ROLE === 'admin' ? 'admin' : 'member';
  const PERSONAS = {
    member: { line: 'U-demo-member', lineName: '體驗用 LINE 帳號' },
    admin:  { line: 'U-demo-admin',  lineName: '管理員（你）' },
  };

  // ---------- 假資料 ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dayAfter = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  let seq = 0;
  const uid = (p) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

  function seed() {
    const members = [
      { id: 'm-admin', line: PERSONAS.admin.line, line_name: PERSONAS.admin.lineName, nickname: '出走社管理員', is_admin: true,  status: 'approved', created_at: iso(60 * 24 * 30) },
      { id: 'm-1', line: 'U-1', line_name: 'Mei Chen',   nickname: '小美', is_admin: false, status: 'approved', created_at: iso(60 * 24 * 20) },
      { id: 'm-2', line: 'U-2', line_name: '芋圓好好吃', nickname: '芋圓', is_admin: false, status: 'approved', created_at: iso(60 * 24 * 18) },
      { id: 'm-3', line: 'U-3', line_name: 'Yuki',       nickname: 'Yuki', is_admin: false, status: 'approved', created_at: iso(60 * 24 * 12) },
      { id: 'm-4', line: 'U-4', line_name: '阿哲',       nickname: '阿哲', is_admin: false, status: 'approved', created_at: iso(60 * 24 * 6) },
    ];
    const A = (id, category, title, host_name, d, time_text, place, price, price_note, capacity, threshold, description) =>
      ({ id, category, title, host_name, event_date: dayAfter(d), time_text, place, price, price_note, capacity, threshold, description, status: 'open', created_at: iso(60 * 24 * 10) });
    const activities = [
      A('a-1', 'host',   '秋冬香氛調香課｜木質調擴香石', '香氛老師 Yen', 3,  '14:00–16:30', '出走社社辦', 1500, '含材料', 8, 4, '用雪松、檀香與一點橙花，調出屬於自己的秋冬氣味。\n每人完成一顆擴香石＋10ml 精油瓶。'),
      A('a-2', 'member', '週五電影夜',                   '社員 阿哲 揪', 5,  '19:30',       '信義區影城', 0,    '票價自付', 6, 3, '看完找間咖啡廳聊聊心得，想來就 +1。'),
      A('a-3', 'select', '旅行寫作講座：把出走寫成故事', '合作講者 林小路', 8, '14:00–16:00', '合作場地・中山區', 1200, '含一杯飲品', 20, 10, '講者分享十年旅行寫作經驗。'),
      A('a-4', 'host',   '編織課｜冬日圍巾起針班',       '編織老師 Rita', 10, '14:00–17:00', '出走社社辦', 1800, '含毛線、棒針', 8, 4, '從起針到收針，三小時織出圍巾的第一段。'),
      A('a-5', 'social', '月底聚餐｜麻辣鍋之夜',         '出走社',       14, '18:30',       '東區・麻辣鍋', 680, '含服務費 $50', 12, 6, '月底一起吃鍋聊天！新朋友非常歡迎。'),
      A('a-6', 'select', '植物染手帕工作坊',             '合作工作室 染日', 17, '13:30–16:30', '合作工作室・大稻埕', 1600, '含材料', 12, 6, '用洋蔥皮與薯榔染出暖色系手帕。'),
    ];
    const S = (activity_id, member_id, minsAgo) => ({ id: uid('s'), activity_id, member_id, created_at: iso(minsAgo), cancelled_at: null });
    const signups = [
      S('a-1', 'm-1', 3000), S('a-1', 'm-2', 2500), S('a-1', 'm-3', 2000),   // 差 1 人成團：適合體驗「關鍵一票」
      S('a-2', 'm-4', 1500), S('a-2', 'm-1', 1200),                         // 差 1 人成團
      S('a-3', 'm-2', 900),  S('a-3', 'm-3', 800),
      S('a-5', 'm-1', 700),  S('a-5', 'm-2', 600), S('a-5', 'm-3', 500), S('a-5', 'm-4', 400), S('a-5', 'm-admin', 300),
    ];
    return { members, activities, signups };
  }

  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    const db = seed();
    save(db);
    return db;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }

  // ---------- 規則（對照 supabase/functions/api/index.ts） ----------
  class ApiError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
  const memberOut = (m) => ({ nickname: m.nickname, is_admin: m.is_admin, status: m.status });
  const active = (db) => db.signups.filter((s) => !s.cancelled_at);

  function requireMember(m) { if (!m) throw new ApiError(403, 'no_nickname'); return m; }
  function requireApproved(m) { requireMember(m); if (m.status !== 'approved') throw new ApiError(403, m.status); return m; }
  function requireAdmin(m) { requireApproved(m); if (!m.is_admin) throw new ApiError(403, 'not_admin'); return m; }

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
        const acts = db.activities.filter((a) => a.status === 'open').sort((a, b) => a.event_date.localeCompare(b.event_date) || a.created_at.localeCompare(b.created_at));
        const ids = new Set(acts.map((a) => a.id));
        result = {
          activities: acts,
          signups: active(db).filter((s) => ids.has(s.activity_id)).sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((s) => ({ activity_id: s.activity_id, nickname: db.members.find((m) => m.id === s.member_id)?.nickname })),
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
        const list = active(db).filter((s) => s.activity_id === a.id);
        if (list.some((s) => s.member_id === me.id)) { result = { result: 'already_joined' }; break; }
        if (list.length >= a.capacity) { result = { result: 'full' }; break; }
        db.signups.push({ id: uid('s'), activity_id: a.id, member_id: me.id, created_at: new Date().toISOString(), cancelled_at: null });
        const reached = list.length + 1 === a.threshold;
        changed = true;
        result = { result: reached ? 'reached' : 'ok' };
        break;
      }

      case 'admin_save_activity': {
        requireAdmin(me);
        const a = body.activity || {};
        const clean = {
          category: a.category, title: String(a.title || '').trim(), host_name: String(a.host_name || '').trim(),
          event_date: a.event_date, time_text: a.time_text || null, place: a.place || null,
          price: Number(a.price) || 0, price_note: a.price_note || null,
          capacity: Number(a.capacity), threshold: Number(a.threshold), description: a.description || null,
        };
        if (!clean.title || !clean.host_name) throw new ApiError(400, 'missing_fields');
        if (!(clean.capacity >= 1) || !(clean.threshold >= 1)) throw new ApiError(400, 'bad_numbers');
        if (clean.threshold > clean.capacity) throw new ApiError(400, 'threshold_over_capacity');
        if (body.id) Object.assign(db.activities.find((x) => x.id === body.id) || {}, clean);
        else db.activities.push({ ...clean, id: uid('a'), status: 'open', created_at: new Date().toISOString() });
        changed = true;
        result = { ok: true };
        break;
      }

      case 'admin_delete_activity':
        requireAdmin(me);
        db.activities = db.activities.filter((x) => x.id !== body.id);
        db.signups = db.signups.filter((s) => s.activity_id !== body.id);
        changed = true;
        result = { ok: true };
        break;

      case 'admin_roster':
        requireAdmin(me);
        result = {
          roster: active(db).filter((s) => s.activity_id === body.activityId).sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((s) => { const m = db.members.find((x) => x.id === s.member_id) || {}; return { id: s.id, created_at: s.created_at, nickname: m.nickname, line_name: m.line_name }; }),
        };
        break;

      case 'admin_remove_signup': {
        requireAdmin(me);
        const s = db.signups.find((x) => x.id === body.signupId && !x.cancelled_at);
        if (s) s.cancelled_at = new Date().toISOString();
        changed = true;
        result = { ok: true };
        break;
      }

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
    reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(LINE_OK); } catch (e) {} },
  };
})();
