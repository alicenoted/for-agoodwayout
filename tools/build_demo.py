"""從正式網頁 app/index.html 產生體驗模式的兩個頁面。

    python3 tools/build_demo.py

產生：
  demo/member/index.html  社員體驗頁
  demo/admin/index.html   管理員體驗頁
兩頁都載入 demo/demo-backend.js（假後端），資料存在瀏覽器 localStorage，彼此即時同步。
正式網頁改版後重新執行一次即可。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "app" / "index.html").read_text(encoding="utf-8")

LIFF_TAG = '<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>'

DEMO_CSS = """
  /* ---------- 體驗模式 ---------- */
  .demo-banner{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 16px;background:#fff4d6;border-bottom:1px solid #ecd9a8;font-size:13px;color:#6e4c12}
  .demo-tag{background:#a67c35;color:#fff;font-weight:700;border-radius:999px;padding:2px 10px}
  .demo-banner b{font-size:14px;color:#18364b}
  .demo-link{color:#2f6f7e;font-weight:700;text-decoration:none;border:1.5px solid #9ec5ce;background:#fff;border-radius:999px;padding:3px 10px}
  .demo-btn{border:1.5px solid #e0c58e;background:#fff;color:#6e4c12;border-radius:999px;padding:3px 10px;font-size:13px;font-weight:700}
  .demo-inbox{border-color:#06c755;color:#058a3c;display:inline-flex;align-items:center;gap:4px}
  .demo-inbox .count-badge{background:#06c755}
  /* 模擬 LINE 通知收件匣 */
  .ln-head{background:#06c755;color:#fff}
  .ln-head h2{color:#fff}
  .ln-head .sub{color:rgba(255,255,255,.9)}
  .ln-tabs{display:flex;gap:6px;margin-top:10px}
  .ln-tabs button{border:0;border-radius:999px;padding:5px 12px;font-size:13px;background:rgba(255,255,255,.25);color:#fff}
  .ln-tabs button.on{background:#fff;color:#058a3c;font-weight:700}
  .ln-body{background:#8ca6c4;padding:16px 14px;min-height:240px}
  .ln-msg{display:flex;gap:8px;align-items:flex-start;margin-bottom:14px}
  .ln-av{width:34px;height:34px;border-radius:50%;background:#18364b;color:#fff;display:grid;place-items:center;font-weight:700;flex:none;font-size:14px}
  .ln-meta{font-size:12px;color:#fff;margin-bottom:3px}
  .ln-bubble{background:#fff;border-radius:4px 16px 16px 16px;padding:10px 12px;font-size:14px;line-height:1.55;color:#18364b;white-space:pre-line;word-break:break-word;max-width:420px}
  .ln-bubble a{color:#2a6ad6}
  .ln-new{display:inline-block;background:#e5483a;color:#fff;font-size:11px;border-radius:999px;padding:0 6px;margin-left:4px}
  .ln-empty{color:#fff;text-align:center;padding:40px 0;font-size:14px}
"""

def banner(role):
    if role == "member":
        name, link = "社員頁", '<a class="demo-link" href="../admin/" target="gwo-demo-admin">開啟管理員頁 ↗</a>'
    else:
        name, link = "管理員頁", '<a class="demo-link" href="../member/" target="gwo-demo-member">開啟社員頁 ↗</a>'
    return f"""<div class="demo-banner">
  <span class="demo-tag">體驗模式</span><b>{name}</b>
  <span>假資料只存在這台電腦，不會影響正式網站</span>
  <span class="spacer"></span>
  {link}
  <button class="demo-btn demo-inbox" id="demoInbox" title="正式網站會用出走社官方帳號傳 LINE 訊息；體驗模式改放在這裡">📩 LINE 通知<span class="count-badge hidden" id="demoInboxN"></span></button>
  <button class="demo-btn" id="demoReset">重來一次</button>
</div>
"""

DEMO_SCRIPT = r"""<script>
/* ---------- 體驗模式：兩頁同步、重來一次 ---------- */
(function(){
  const ROLE = DemoBackend.ROLE, KEY = DemoBackend.KEY;
  if(ROLE === 'admin' && !location.hash) history.replaceState(null, '', '#events');   // 管理員頁預設進「活動管理」

  document.getElementById('demoReset').onclick = ()=>{
    if(!confirm('清空所有體驗資料，從頭開始？社員頁和管理員頁會一起重來。')) return;
    DemoBackend.reset();
    location.reload();
  };

  async function refresh(){
    const was = state.me && state.me.status;
    await loadMe();
    if(isApproved()){
      await loadData();
      if(was === 'pending') toast('審核通過，歡迎！');
    }
    if(ROLE === 'admin' && isApproved()) await loadMembers();
    if(!document.getElementById('modalRoot').innerHTML) render();
  }

  // ---------- 模擬 LINE 通知收件匣 ----------
  const SEEN = 'gwo-demo-seen-' + ROLE;
  const LIFF = 'https://liff.line.me/2012620335-Hk2HkkYY';
  let seen = 0, lastMine = null, tab = 'mine';
  try{ seen = Number(localStorage.getItem(SEEN) || 0); }catch(e){}
  // 訊息裡的網站連結改成打開這個體驗頁（正式網站會打開 LINE 裡的接龍網站）
  function msgHtml(text, mine){
    return esc(text).replace(/(https?:\/\/[^\s<]+)/g, (u)=>{
      if(u.startsWith(LIFF)) return mine ? `<a href="./${u.slice(LIFF.length)}">👉 打開網站</a>` : '<span class="sub">（網站連結）</span>';
      return `<a href="${u}" target="_blank" rel="noopener">${u}</a>`;
    });
  }
  function inboxHtml(){
    const { mine, all } = DemoBackend.notices();
    const list = tab === 'mine' ? mine : all;
    const body = list.length ? list.map(n=>`<div class="ln-msg"><div class="ln-av">出</div><div>
        <div class="ln-meta">出走社官方帳號 → <b>${esc(n.toName)}</b>${n.mine ? '（你）' : ''}・${fmtTime(n.at)}${n.mine && Date.parse(n.at) > seen ? '<span class="ln-new">新</span>' : ''}</div>
        <div class="ln-bubble">${msgHtml(n.text, n.mine)}</div></div></div>`).join('')
      : `<div class="ln-empty">${tab === 'mine' ? '你還沒有收到通知' : '還沒有任何人收到通知'}</div>`;
    return `<div class="sheet-head ln-head"><h2>📩 LINE 通知（模擬）</h2><button class="close" data-close aria-label="關閉">×</button>
        <div class="sub">正式網站會由出走社官方帳號傳到 LINE（要先加好友才收得到）。</div>
        <div class="ln-tabs"><button data-lntab="mine" class="${tab==='mine'?'on':''}">寄給我（${mine.length}）</button><button data-lntab="all" class="${tab==='all'?'on':''}">所有人收到的（${all.length}）</button></div></div>
      <div class="ln-body">${body}</div>`;
  }
  function openInbox(){
    openModal(inboxHtml());
    seen = Date.now(); try{ localStorage.setItem(SEEN, String(seen)); }catch(e){}
    checkInbox(true);
  }
  function checkInbox(silent){
    const { mine } = DemoBackend.notices();
    const unread = mine.filter(n=>Date.parse(n.at) > seen).length;
    const b = document.getElementById('demoInboxN');
    b.textContent = unread; b.classList.toggle('hidden', !unread);
    if(lastMine !== null && mine.length > lastMine && !silent) toast('📩 你收到一則 LINE 通知（模擬），點上方「LINE 通知」查看');
    lastMine = mine.length;
  }
  document.getElementById('demoInbox').onclick = openInbox;
  document.addEventListener('click', e=>{
    const t = e.target.closest('[data-lntab]'); if(!t) return;
    tab = t.dataset.lntab; openModal(inboxHtml());
  });
  checkInbox(true);
  setInterval(()=>checkInbox(false), 1500);

  // 另一個頁面改了資料 → 這個頁面跟著更新
  window.addEventListener('storage', async e=>{
    if(e.key !== KEY) return;
    if(e.newValue === null){ location.reload(); return; }   // 另一頁按了「重來一次」
    try{ await refresh(); }catch(err){ console.error(err); }
  });
})();
</script>
"""

def build(role):
    s = SRC
    assert s.count(LIFF_TAG) == 1
    s = s.replace(LIFF_TAG, f"<script>window.DEMO_ROLE = '{role}';</script>\n<script src=\"../demo-backend.js\"></script>")
    # 圖片存在瀏覽器裡，不是 Supabase Storage；縮小一點，瀏覽器空間才放得下十幾張
    img = "const imgUrl = (path)=>`${CONFIG.supabaseUrl}/storage/v1/object/public/${CONFIG.imageBucket}/${path}`;"
    assert s.count(img) == 1
    s = s.replace(img, "const imgUrl = (path)=>DemoBackend.imgUrl(path);")
    shrink = "Math.min(1, 1600 / Math.max("
    assert s.count(shrink) == 1
    s = s.replace(shrink, "Math.min(1, 1000 / Math.max(")
    title = "出走社活動接龍（體驗・社員）" if role == "member" else "出走社管理員後台（體驗）"
    assert s.count("<title>出走社活動接龍</title>") == 1
    s = s.replace("<title>出走社活動接龍</title>", f"<title>{title}</title>")
    css = DEMO_CSS + ("  #modeSwitch{display:none!important}\n" if role == "admin" else "")
    assert s.count("</style>") == 1
    s = s.replace("</style>", css + "</style>")
    assert s.count("<body>\n") == 1
    s = s.replace("<body>\n", "<body>\n" + banner(role))
    assert s.count("</body>") == 1
    s = s.replace("</body>", DEMO_SCRIPT + "</body>")
    assert s.startswith("<!doctype html>\n")
    s = s.replace("<!doctype html>\n", "<!doctype html>\n<!-- 這個檔案由 tools/build_demo.py 從 app/index.html 自動產生，請勿直接修改 -->\n", 1)
    out = ROOT / "demo" / role / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(s, encoding="utf-8")
    print("wrote", out.relative_to(ROOT))

for r in ("member", "admin"):
    build(r)
