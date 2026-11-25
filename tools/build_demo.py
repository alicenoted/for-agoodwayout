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
"""

DEMO_SCRIPT = """<script>
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
