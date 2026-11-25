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
  .demo-notices{position:fixed;bottom:16px;right:16px;z-index:400;display:flex;flex-direction:column;gap:10px;width:min(340px,calc(100% - 24px))}
  .demo-notice{background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px 14px;border-left:5px solid #06c755;animation:up .25s}
  .demo-notice .h{display:flex;align-items:center;gap:8px;font-size:12px;color:#607789;margin-bottom:6px}
  .demo-notice .ic{height:20px;padding:0 6px;border-radius:6px;background:#06c755;color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center}
  .demo-notice .x{margin-left:auto;border:0;background:none;font-size:18px;color:#8a9aa6;line-height:1}
  .demo-notice .t{white-space:pre-line;font-size:14px;color:#18364b}
  .demo-notice .f{font-size:11px;color:#8a9aa6;margin-top:8px}
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
  <button class="demo-btn" id="demoReset">重來一次</button>
</div>
<div class="demo-notices" id="demoNotices"></div>
"""

DEMO_SCRIPT = """<script>
/* ---------- 體驗模式：兩頁同步、模擬通知、重來一次 ---------- */
(function(){
  const ROLE = DemoBackend.ROLE, KEY = DemoBackend.KEY, SEEN = 'gwo-demo-seen';
  if(ROLE === 'admin' && !location.hash) history.replaceState(null, '', '#events');   // 管理員頁預設進「活動管理」

  document.getElementById('demoReset').onclick = ()=>{
    if(!confirm('清空所有體驗資料，從頭開始？社員頁和管理員頁會一起重來。')) return;
    DemoBackend.reset();
    try{ sessionStorage.removeItem(SEEN); }catch(e){}
    location.reload();
  };

  // 模擬「官方帳號傳給管理員的 LINE 訊息」
  const seen = ()=>{ try{ return JSON.parse(sessionStorage.getItem(SEEN) || '[]'); }catch(e){ return []; } };
  function showNotices(){
    if(ROLE !== 'admin') return;
    const s = seen(), all = DemoBackend.notices();
    all.filter(n=>!s.includes(n.id)).forEach(n=>{
      const el = document.createElement('div');
      el.className = 'demo-notice';
      el.innerHTML = `<div class="h"><span class="ic">LINE</span>出走社 官方帳號（模擬）<button class="x" aria-label="關閉">×</button></div>
        <div class="t"></div><div class="f">正式上線後，這則會用 LINE 訊息傳到你的手機</div>`;
      el.querySelector('.t').textContent = n.text;
      el.querySelector('.x').onclick = ()=>el.remove();
      document.getElementById('demoNotices').append(el);
    });
    try{ sessionStorage.setItem(SEEN, JSON.stringify(all.map(n=>n.id))); }catch(e){}
  }

  async function refresh(){
    const was = state.me && state.me.status;
    await loadMe();
    if(isApproved()){
      await loadData();
      if(was === 'pending') toast('審核通過，歡迎！');
    }
    if(ROLE === 'admin' && isApproved()) await loadMembers();
    if(!document.getElementById('modalRoot').innerHTML) render();
    showNotices();
  }

  // 等正式網頁的啟動流程跑完，再做體驗模式的初始化
  (async ()=>{
    for(let i = 0; i < 80 && !state.me && !document.getElementById('nickInput'); i++) await new Promise(r=>setTimeout(r, 100));
    showNotices();
  })();

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
