export const ADMIN_WEB_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>hoiBot 운영 관리</title>
  <link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body>
  <a class="skip-link" href="#main-content">본문으로 바로가기</a>
  <div id="boot-screen" class="boot-screen" role="status" aria-live="polite">
    <div class="boot-mark" aria-hidden="true">H</div>
    <p>관리 환경을 확인하고 있어요.</p>
  </div>

  <main id="login-view" class="login-view" hidden>
    <section class="login-copy" aria-labelledby="login-title">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">H</span>
        <span>hoiBot Operations</span>
      </div>
      <p class="eyebrow">PERMISSIONED CONTROL SURFACE</p>
      <h1 id="login-title">운영 판단과 계정 조치를<br>한 흐름에서 처리하세요.</h1>
      <p class="login-description">회원, 감사 기록, 채널 활동과 모니터링 이벤트를 조회하고, 허용된 운영자는 사유와 확인 절차를 거쳐 계정과 재화 조치를 처리합니다.</p>
      <dl class="login-principles">
        <div><dt>권한 우선</dt><dd>허용된 메뉴만 표시</dd></div>
        <div><dt>변경 통제</dt><dd>사유·재확인·멱등 처리</dd></div>
        <div><dt>감사 기반</dt><dd>조치와 요청 ID를 보존</dd></div>
      </dl>
    </section>
    <section class="login-panel" aria-label="관리자 로그인">
      <div class="login-panel-heading">
        <p class="eyebrow">ADMIN ACCESS</p>
        <h2>관리자 로그인</h2>
        <p>발급받은 운영자 계정으로 로그인하세요.</p>
      </div>
      <form id="login-form" novalidate>
        <label for="login-id">로그인 ID</label>
        <input id="login-id" name="loginId" autocomplete="username" required placeholder="운영자 ID">
        <label for="login-password">비밀번호</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="비밀번호">
        <p id="login-error" class="form-error" role="alert" hidden></p>
        <button id="login-button" class="primary-button" type="submit">로그인</button>
      </form>
      <p class="security-note"><span aria-hidden="true">●</span> 세션은 이 브라우저의 보안 쿠키로 유지됩니다.</p>
    </section>
  </main>

  <div id="app-shell" class="app-shell" hidden>
    <aside class="sidebar" aria-label="관리 메뉴">
      <div class="sidebar-brand">
        <span class="brand-mark" aria-hidden="true">H</span>
        <div><strong>hoiBot</strong><span>Operations</span></div>
      </div>
      <div id="operator-summary" class="operator-summary"></div>
      <nav id="primary-nav" class="primary-nav"></nav>
      <div class="sidebar-foot">
        <span class="read-only-indicator"><i aria-hidden="true"></i> 권한 통제 모드</span>
        <span>Gate 8 전환 전</span>
      </div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div>
          <button id="mobile-menu-button" class="icon-button mobile-menu-button" type="button" aria-label="메뉴 열기" aria-expanded="false">☰</button>
          <p id="page-kicker" class="page-kicker">OPERATIONS</p>
          <h1 id="page-title">운영 대시보드</h1>
        </div>
        <div class="topbar-actions">
          <span id="last-updated" class="last-updated"></span>
          <button id="refresh-button" class="secondary-button" type="button">새로고침</button>
          <button id="logout-button" class="text-button" type="button">로그아웃</button>
        </div>
      </header>
      <main id="main-content" class="main-content" tabindex="-1"></main>
    </div>
  </div>

  <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="true"></div>
  <script src="/admin/assets/admin.js" defer></script>
</body>
</html>`;

export const ADMIN_WEB_STYLES = String.raw`
:root {
  color: #15202b;
  background: #eef1f4;
  font-family: Inter, Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", system-ui, sans-serif;
  font-synthesis: none;
  --ink: #15202b;
  --muted: #647180;
  --line: #d8dee5;
  --surface: #ffffff;
  --canvas: #f4f6f8;
  --nav: #10263c;
  --nav-deep: #0b1c2d;
  --nav-muted: #9eb0c0;
  --accent: #18766d;
  --accent-dark: #105c55;
  --accent-soft: #e7f3f1;
  --danger: #b33b32;
  --warning: #9b6400;
  --shadow: 0 8px 30px rgba(26, 39, 52, .08);
}

* { box-sizing: border-box; }
html, body { min-height: 100%; }
body { margin: 0; background: var(--canvas); color: var(--ink); }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }

.skip-link {
  position: fixed; top: 8px; left: 8px; z-index: 100;
  transform: translateY(-150%); padding: 10px 14px; background: #fff; color: var(--ink);
  border: 2px solid var(--accent); border-radius: 6px;
}
.skip-link:focus { transform: translateY(0); }

.boot-screen { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 14px; color: var(--muted); }
.boot-mark, .brand-mark {
  display: inline-grid; place-items: center; width: 40px; height: 40px;
  background: var(--accent); color: #fff; font-weight: 800; letter-spacing: -.04em; border-radius: 8px;
}
.boot-mark { width: 48px; height: 48px; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .55; transform: scale(.96); } }

.login-view { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(400px, .8fr); }
.login-copy {
  display: flex; flex-direction: column; justify-content: center; padding: clamp(48px, 8vw, 128px);
  background: var(--nav); color: #fff; position: relative; overflow: hidden;
}
.login-copy::after {
  content: ""; position: absolute; width: 420px; height: 420px; right: -240px; bottom: -190px;
  border: 70px solid rgba(255,255,255,.04); border-radius: 50%;
}
.brand-lockup { display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; letter-spacing: .04em; margin-bottom: 90px; }
.eyebrow, .page-kicker { margin: 0 0 12px; color: #4fa59c; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
.login-copy h1 { max-width: 720px; margin: 0; font-size: clamp(36px, 5vw, 68px); line-height: 1.12; letter-spacing: -.045em; }
.login-description { max-width: 650px; margin: 30px 0 42px; color: #c5d0da; line-height: 1.8; font-size: 16px; }
.login-principles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; max-width: 700px; margin: 0; }
.login-principles div { border-top: 1px solid rgba(255,255,255,.18); padding-top: 14px; }
.login-principles dt { font-size: 13px; font-weight: 700; }
.login-principles dd { margin: 6px 0 0; color: var(--nav-muted); font-size: 12px; }

.login-panel { display: flex; flex-direction: column; justify-content: center; padding: clamp(44px, 7vw, 100px); background: #fff; }
.login-panel-heading h2 { margin: 0; font-size: 30px; letter-spacing: -.03em; }
.login-panel-heading > p:last-child { color: var(--muted); margin: 10px 0 34px; }
.login-panel form { display: grid; gap: 10px; }
.login-panel label { margin-top: 10px; font-size: 13px; font-weight: 700; }
input, select, textarea {
  width: 100%; min-height: 46px; padding: 11px 13px; color: var(--ink); background: #fff;
  border: 1px solid #cbd3dc; border-radius: 7px; outline: none;
}
textarea { min-height: 76px; resize: vertical; }
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(24,118,109,.14); }
.form-error { margin: 7px 0 0; padding: 10px 12px; color: var(--danger); background: #fff2f0; border-left: 3px solid var(--danger); font-size: 13px; }
.primary-button, .secondary-button, .text-button, .icon-button {
  min-height: 40px; border-radius: 7px; border: 1px solid transparent; font-weight: 700;
}
.primary-button { margin-top: 18px; min-height: 48px; background: var(--accent); color: #fff; }
.primary-button:hover { background: var(--accent-dark); }
.primary-button:disabled { opacity: .58; cursor: wait; }
.secondary-button { padding: 0 14px; background: #fff; border-color: var(--line); color: var(--ink); }
.secondary-button:hover { border-color: #9aa6b2; background: #f8f9fa; }
.text-button { padding: 0 8px; background: transparent; color: var(--muted); }
.text-button:hover { color: var(--ink); }
.security-note { margin: 28px 0 0; color: var(--muted); font-size: 12px; }
.security-note span { color: var(--accent); font-size: 9px; margin-right: 5px; }

.app-shell { min-height: 100vh; display: grid; grid-template-columns: 240px minmax(0, 1fr); }
.sidebar { position: fixed; inset: 0 auto 0 0; width: 240px; display: flex; flex-direction: column; background: var(--nav); color: #fff; z-index: 20; }
.sidebar-brand { height: 76px; display: flex; align-items: center; gap: 12px; padding: 0 22px; border-bottom: 1px solid rgba(255,255,255,.09); }
.sidebar-brand div { display: grid; }
.sidebar-brand strong { font-size: 15px; }
.sidebar-brand span:last-child { color: var(--nav-muted); font-size: 11px; }
.operator-summary { margin: 18px 14px 10px; padding: 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.07); border-radius: 8px; }
.operator-summary strong { display: block; font-size: 13px; }
.operator-summary span { display: block; margin-top: 4px; color: var(--nav-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.role-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 9px; }
.role-tag { padding: 3px 6px; border: 1px solid rgba(255,255,255,.16); border-radius: 4px; color: #dce5ec; font-size: 10px; }
.primary-nav { display: grid; gap: 3px; padding: 10px; overflow-y: auto; }
.nav-label { padding: 14px 10px 6px; color: #6f879b; font-size: 10px; font-weight: 800; letter-spacing: .12em; }
.nav-button { display: flex; align-items: center; gap: 11px; width: 100%; padding: 10px 12px; color: #c7d2dc; background: transparent; border: 0; border-radius: 6px; text-align: left; font-size: 13px; }
.nav-button:hover { background: rgba(255,255,255,.07); color: #fff; }
.nav-button[aria-current="page"] { background: #fff; color: var(--nav); font-weight: 800; }
.nav-icon { width: 20px; text-align: center; font-size: 14px; }
.sidebar-foot { margin-top: auto; display: grid; gap: 6px; padding: 18px 22px; color: #6f879b; font-size: 10px; border-top: 1px solid rgba(255,255,255,.08); }
.read-only-indicator { color: #b9c7d2; }
.read-only-indicator i { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: #56b9ad; }

.workspace { grid-column: 2; min-width: 0; }
.topbar { position: sticky; top: 0; z-index: 10; min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 28px; background: rgba(255,255,255,.96); border-bottom: 1px solid var(--line); }
.topbar > div:first-child { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 10px; }
.topbar .page-kicker, .topbar h1 { grid-column: 2; }
.page-kicker { margin: 0 0 2px; font-size: 9px; }
.topbar h1 { margin: 0; font-size: 20px; letter-spacing: -.025em; }
.topbar-actions { display: flex; align-items: center; gap: 8px; }
.last-updated { color: var(--muted); font-size: 11px; }
.mobile-menu-button { display: none; grid-row: 1 / 3; grid-column: 1; width: 38px; background: #fff; border-color: var(--line); }
.main-content { min-height: calc(100vh - 76px); padding: 26px 28px 56px; outline: none; }

.view-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.view-intro h2 { margin: 0; font-size: 17px; }
.view-intro p { margin: 7px 0 0; color: var(--muted); font-size: 12px; }
.section-meta { color: var(--muted); font-size: 11px; }
.metric-grid { display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); border: 1px solid var(--line); background: var(--surface); box-shadow: var(--shadow); }
.metric { min-height: 122px; padding: 20px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.metric:nth-child(3n) { border-right: 0; }
.metric:nth-last-child(-n+3) { border-bottom: 0; }
.metric-label { color: var(--muted); font-size: 12px; }
.metric-value { display: block; margin-top: 15px; font-size: 30px; font-weight: 800; letter-spacing: -.04em; }
.metric-note { display: block; margin-top: 5px; color: var(--muted); font-size: 10px; }

.panel { background: var(--surface); border: 1px solid var(--line); box-shadow: 0 4px 18px rgba(26,39,52,.045); }
.panel + .panel { margin-top: 18px; }
.panel-heading { min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.panel-heading h3 { margin: 0; font-size: 14px; }
.panel-heading p { margin: 4px 0 0; color: var(--muted); font-size: 11px; }
.toolbar { display: flex; gap: 8px; align-items: center; }
.toolbar input { width: min(360px, 48vw); min-height: 40px; }
.search-form { display: flex; align-items: center; gap: 8px; }
.search-form .primary-button { min-height: 40px; margin: 0; padding: 0 18px; }
.content-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .75fr); gap: 18px; align-items: start; }

.table-wrap { width: 100%; overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th { height: 40px; padding: 8px 12px; color: var(--muted); background: #f7f8fa; border-bottom: 1px solid var(--line); text-align: left; font-size: 10px; letter-spacing: .03em; white-space: nowrap; }
.data-table td { padding: 11px 12px; border-bottom: 1px solid #e8ecf0; vertical-align: middle; }
.data-table tbody tr:last-child td { border-bottom: 0; }
.data-table tbody tr:hover { background: #f8fafb; }
.row-button { width: 100%; padding: 0; color: var(--ink); background: none; border: 0; text-align: left; font-weight: 700; }
.row-button:hover { color: var(--accent); text-decoration: underline; }
.mono { font-family: "SFMono-Regular", Consolas, monospace; font-size: 11px; }
.muted { color: var(--muted); }
.status-text { font-weight: 700; }
.status-text.success { color: var(--accent); }
.status-text.warning { color: var(--warning); }
.status-text.danger { color: var(--danger); }

.detail-empty, .empty-state, .error-state, .loading-state { display: grid; place-items: center; min-height: 220px; padding: 32px; text-align: center; color: var(--muted); }
.empty-state strong, .error-state strong { display: block; margin-bottom: 7px; color: var(--ink); }
.error-state { color: var(--danger); }
.error-state .secondary-button { margin-top: 14px; }
.loading-line { width: 110px; height: 3px; overflow: hidden; background: #e1e6ea; }
.loading-line::after { content: ""; display: block; width: 45%; height: 100%; background: var(--accent); animation: slide 1s ease-in-out infinite alternate; }
@keyframes slide { to { transform: translateX(120%); } }
.detail-body { padding: 16px; }
.detail-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
.detail-title h3 { margin: 0; font-size: 18px; }
.detail-title span { color: var(--muted); font-size: 10px; }
.detail-list { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 0; border-top: 1px solid var(--line); }
.detail-list div { padding: 11px 4px; border-bottom: 1px solid var(--line); }
.detail-list dt { color: var(--muted); font-size: 10px; }
.detail-list dd { margin: 4px 0 0; font-size: 12px; overflow-wrap: anywhere; }
.detail-section { margin-top: 20px; }
.detail-section h4 { margin: 0 0 8px; font-size: 12px; }
.key-value-list { display: grid; gap: 6px; }
.key-value-list div { display: flex; justify-content: space-between; gap: 12px; padding: 7px 9px; background: #f7f9fa; font-size: 11px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 5px; }
.tag { padding: 4px 7px; background: var(--accent-soft); color: var(--accent-dark); border-radius: 4px; font-size: 10px; font-weight: 700; }
.account-actions { margin: 20px -16px -16px; padding: 18px 16px; border-top: 1px solid var(--line); background: #fbfcfd; }
.account-actions > h4 { margin: 0; font-size: 13px; }
.account-actions > p { margin: 6px 0 14px; color: var(--muted); font-size: 11px; line-height: 1.6; }
.restriction-list { display: grid; gap: 8px; margin-bottom: 16px; }
.restriction-card { padding: 11px; background: #fff; border: 1px solid var(--line); border-left: 3px solid #9aa6b2; }
.restriction-card.active { border-left-color: var(--danger); }
.restriction-heading { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.restriction-heading > div { display: flex; align-items: center; gap: 5px; }
.restriction-heading strong { font-size: 11px; }
.restriction-heading span { font-size: 10px; }
.restriction-meta { display: flex; flex-wrap: wrap; gap: 3px 10px; margin: 6px 0 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
.currency-list { display: grid; gap: 8px; margin-top: 10px; }
.currency-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 11px; border: 1px solid var(--line); background: #fff; }
.currency-card strong { display: block; font-size: 12px; }
.currency-card span { color: var(--muted); font-size: 10px; }
.currency-balance { text-align: right; }
.currency-balance b { display: block; font-size: 14px; font-variant-numeric: tabular-nums; }
.currency-action-form { display: grid; gap: 9px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); grid-column: 1 / -1; }
.currency-action-form label:not(.confirm-row) { color: var(--muted); font-size: 10px; font-weight: 700; }
.currency-action-form input, .currency-action-form select, .currency-action-form textarea { min-height: 40px; font-size: 11px; }
.currency-action-grid { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px; }
.currency-action-note { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.55; }
.account-action-form { display: grid; gap: 9px; padding: 12px; background: #fff; border: 1px solid var(--line); }
.account-action-form + .account-action-form { margin-top: 8px; }
.account-action-form h5 { margin: 0 0 3px; font-size: 11px; }
.account-action-form label:not(.confirm-row) { color: var(--muted); font-size: 10px; font-weight: 700; }
.account-action-form input, .account-action-form select, .account-action-form textarea { min-height: 40px; font-size: 11px; }
.account-action-form textarea { min-height: 64px; }
.confirm-row { display: flex; align-items: flex-start; gap: 8px; color: var(--ink); font-size: 10px; line-height: 1.45; }
.confirm-row input { width: 16px; min-height: 16px; margin: 0; accent-color: var(--danger); }
.danger-button { min-height: 40px; padding: 0 14px; color: #fff; background: var(--danger); border: 1px solid var(--danger); border-radius: 7px; font-weight: 800; }
.danger-button:hover { background: #922f28; }
.danger-button:disabled { opacity: .58; cursor: wait; }
.inline-error { margin: 0; padding: 8px 10px; color: var(--danger); background: #fff2f0; border-left: 3px solid var(--danger); font-size: 10px; }
.action-gap-note { margin: 10px 0 0; padding: 9px 10px; color: var(--warning); background: #fff8e8; border-left: 3px solid #d49a25; font-size: 10px; line-height: 1.5; }

.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--line); }
.pagination span { color: var(--muted); font-size: 11px; }
.pagination button { min-width: 34px; min-height: 32px; padding: 0 9px; background: #fff; border: 1px solid var(--line); border-radius: 5px; }
.pagination button:disabled { opacity: .4; cursor: default; }
.tab-list { display: flex; gap: 2px; padding: 0 16px; border-bottom: 1px solid var(--line); background: #fff; overflow-x: auto; }
.tab-button { min-height: 44px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font-size: 12px; font-weight: 700; white-space: nowrap; }
.tab-button[aria-selected="true"] { color: var(--accent-dark); border-bottom-color: var(--accent); }

.toast-region { position: fixed; right: 20px; bottom: 20px; z-index: 100; display: grid; gap: 8px; }
.toast { min-width: 260px; max-width: 420px; padding: 12px 14px; background: var(--nav-deep); color: #fff; border-left: 3px solid #56b9ad; box-shadow: var(--shadow); font-size: 12px; }
.toast.error { border-left-color: #e9746d; }

@media (max-width: 980px) {
  .login-view { grid-template-columns: 1fr; }
  .login-copy { min-height: 48vh; padding: 48px; }
  .brand-lockup { margin-bottom: 44px; }
  .login-principles { display: none; }
  .login-panel { padding: 48px; }
  .sidebar { transform: translateX(-100%); transition: transform .2s ease; box-shadow: var(--shadow); }
  .sidebar.open { transform: translateX(0); }
  .app-shell { grid-template-columns: 1fr; }
  .workspace { grid-column: 1; }
  .mobile-menu-button { display: inline-grid; place-items: center; }
  .metric-grid { grid-template-columns: repeat(2, 1fr); }
  .metric:nth-child(3n) { border-right: 1px solid var(--line); }
  .metric:nth-child(2n) { border-right: 0; }
  .metric:nth-last-child(-n+3) { border-bottom: 1px solid var(--line); }
  .metric:nth-last-child(-n+2) { border-bottom: 0; }
  .content-grid { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .login-copy { min-height: 44vh; padding: 32px 24px; }
  .login-copy h1 { font-size: 34px; }
  .login-description { margin: 20px 0 0; font-size: 14px; }
  .login-panel { padding: 38px 24px; }
  .topbar { align-items: flex-start; padding: 12px 16px; }
  .topbar-actions { align-items: flex-end; flex-wrap: wrap; justify-content: flex-end; }
  .last-updated { width: 100%; text-align: right; }
  .main-content { padding: 20px 14px 40px; }
  .view-intro { align-items: flex-start; flex-direction: column; }
  .metric-grid { grid-template-columns: 1fr; }
  .metric, .metric:nth-child(3n), .metric:nth-child(2n), .metric:nth-last-child(-n+2) { border-right: 0; border-bottom: 1px solid var(--line); }
  .metric:last-child { border-bottom: 0; }
  .panel-heading { align-items: flex-start; flex-direction: column; }
  .toolbar, .search-form { width: 100%; }
  .toolbar input, .search-form input { width: 100%; }
  .detail-list { grid-template-columns: 1fr; }
  .currency-action-grid { grid-template-columns: 1fr; }
}`;

export const ADMIN_WEB_CLIENT = String.raw`(function () {
  "use strict";

  var CSRF_KEY = "hoibot.admin.csrf";
  var PAGE_SIZE = 25;
  var state = {
    session: null,
    csrfToken: sessionStorage.getItem(CSRF_KEY),
    activeView: "dashboard",
    refresh: null,
    playerSearch: "",
    monitoringTab: "events",
    mutationKeys: {}
  };

  var NAV_ITEMS = [
    { id: "dashboard", label: "운영 대시보드", icon: "▦", permission: "overview.read", group: "운영 현황", kicker: "OPERATIONS" },
    { id: "players", label: "회원 조회", icon: "○", permission: "player.read", group: "회원", kicker: "PLAYER DIRECTORY" },
    { id: "audit", label: "감사 기록", icon: "≡", permission: "audit.read", group: "감사·모니터링", kicker: "AUDIT TRAIL" },
    { id: "activity", label: "채널 활동", icon: "⌁", permission: "activity.read", group: "감사·모니터링", kicker: "CHANNEL ACTIVITY" },
    { id: "incidents", label: "운영 이슈", icon: "!", permission: "incident.read", group: "감사·모니터링", kicker: "MODERATION INCIDENTS" },
    { id: "monitoring", label: "이벤트 모니터링", icon: "◇", permission: "monitoring.read", group: "감사·모니터링", kicker: "EVENT MONITORING" }
  ];

  var METRICS = [
    { key: "activePlayers", label: "활성 회원", note: "현재 active 상태" },
    { key: "activeRestrictions", label: "활성 제재", note: "종료되지 않은 제한" },
    { key: "deletionGrace", label: "탈퇴 유예", note: "grace period 요청" },
    { key: "identityCandidates", label: "연결 검토", note: "candidate 외부 계정" },
    { key: "outboxFailures", label: "전송 실패", note: "failed · dead letter" },
    { key: "activeOperators", label: "활성 운영자", note: "로그인 가능한 계정" }
  ];

  // 고정 DOM 요소를 ID로 조회합니다.
  function byId(id) { return document.getElementById(id); }

  // API 값을 안전한 HTML 텍스트로 변환합니다.
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // 정수형 운영 수치를 한국어 구분 형식으로 표시합니다.
  function formatNumber(value) {
    if (value == null || value === "") return "-";
    var number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat("ko-KR").format(number) : String(value);
  }

  // API 시각을 한국어 날짜 또는 날짜·시각으로 표시합니다.
  function formatDate(value, dateOnly) {
    if (!value) return "-";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ko-KR", dateOnly
      ? { year: "numeric", month: "2-digit", day: "2-digit" }
      : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    ).format(date);
  }

  // 알 수 없는 오류를 사용자용 문장으로 정규화합니다.
  function errorMessage(error) {
    return error && typeof error.message === "string" ? error.message : "요청을 처리하지 못했습니다.";
  }

  // 현재 세션에 지정 조회 권한이 있는지 확인합니다.
  function hasPermission(permission) {
    return Boolean(state.session && state.session.permissions.includes(permission));
  }

  // 동일 출처 관리자 API를 호출하고 공통 오류 계약을 적용합니다.
  async function api(path, options) {
    var settings = Object.assign({ method: "GET", credentials: "same-origin" }, options || {});
    settings.headers = Object.assign({ accept: "application/json" }, settings.headers || {});
    if (settings.body && !settings.headers["content-type"]) settings.headers["content-type"] = "application/json";
    var response = await fetch(path, settings);
    var payload = response.status === 204 ? null : await response.json().catch(function () { return null; });
    if (!response.ok) {
      var message = payload && payload.error && payload.error.message ? payload.error.message : "요청을 처리하지 못했습니다.";
      var error = new Error(message);
      error.status = response.status;
      error.code = payload && payload.error ? payload.error.code : "HTTP_ERROR";
      error.requestId = payload ? payload.requestId : null;
      if (response.status === 401 && path !== "/api/v1/admin/sessions") showLogin("세션이 만료됐습니다. 다시 로그인해 주세요.");
      throw error;
    }
    return payload;
  }

  // 같은 조치 입력을 재시도할 때 재사용할 idempotency key를 반환합니다.
  function mutationKey(scope) {
    if (!state.mutationKeys[scope]) {
      state.mutationKeys[scope] = window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : "admin-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }
    return state.mutationKeys[scope];
  }

  // 성공한 조치 입력의 idempotency key를 폐기합니다.
  function clearMutationKey(scope) {
    delete state.mutationKeys[scope];
  }

  // CSRF와 idempotency 계약을 포함해 계정 조치 API를 호출합니다.
  async function mutateAccount(path, method, body, scope) {
    if (!state.csrfToken) throw new Error("CSRF 토큰이 없습니다. 다시 로그인해 주세요.");
    var payload = await api(path, {
      method: method,
      headers: { "x-csrf-token": state.csrfToken, "idempotency-key": mutationKey(scope) },
      body: JSON.stringify(body)
    });
    clearMutationKey(scope);
    return payload;
  }

  // 짧은 작업 결과를 토스트 알림으로 표시합니다.
  function showToast(message, isError) {
    var toast = document.createElement("div");
    toast.className = "toast" + (isError ? " error" : "");
    toast.textContent = message;
    byId("toast-region").appendChild(toast);
    window.setTimeout(function () { toast.remove(); }, 3600);
  }

  // 앱 셸을 닫고 관리자 로그인 화면을 표시합니다.
  function showLogin(message) {
    state.session = null;
    state.refresh = null;
    byId("boot-screen").hidden = true;
    byId("app-shell").hidden = true;
    byId("login-view").hidden = false;
    var error = byId("login-error");
    error.hidden = !message;
    error.textContent = message || "";
    window.setTimeout(function () { byId("login-id").focus(); }, 0);
  }

  // 인증된 운영자 정보와 권한별 앱 셸을 표시합니다.
  function showApp(session) {
    state.session = session;
    byId("boot-screen").hidden = true;
    byId("login-view").hidden = true;
    byId("app-shell").hidden = false;
    byId("operator-summary").innerHTML =
      "<strong>" + escapeHtml(session.displayName) + "</strong>" +
      "<span>" + escapeHtml(session.loginId) + "</span>" +
      "<div class=\"role-list\">" + session.roleCodes.map(function (role) {
        return "<span class=\"role-tag\">" + escapeHtml(role) + "</span>";
      }).join("") + "</div>";
    renderNavigation();
    var allowed = NAV_ITEMS.filter(function (item) { return hasPermission(item.permission); });
    if (!allowed.some(function (item) { return item.id === state.activeView; })) {
      state.activeView = allowed.length ? allowed[0].id : "none";
    }
    renderActiveView();
  }

  // 현재 권한으로 접근 가능한 관리 메뉴만 구성합니다.
  function renderNavigation() {
    var allowed = NAV_ITEMS.filter(function (item) { return hasPermission(item.permission); });
    var lastGroup = "";
    var html = "";
    allowed.forEach(function (item) {
      if (item.group !== lastGroup) {
        html += "<div class=\"nav-label\">" + escapeHtml(item.group) + "</div>";
        lastGroup = item.group;
      }
      html += "<button class=\"nav-button\" type=\"button\" data-view=\"" + item.id + "\"" +
        (item.id === state.activeView ? " aria-current=\"page\"" : "") + ">" +
        "<span class=\"nav-icon\" aria-hidden=\"true\">" + item.icon + "</span>" + escapeHtml(item.label) + "</button>";
    });
    if (!html) html = "<div class=\"empty-state\"><div><strong>조회 권한 없음</strong><span>운영자 권한을 확인해 주세요.</span></div></div>";
    byId("primary-nav").innerHTML = html;
    byId("primary-nav").querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () { activateView(button.dataset.view); });
    });
  }

  // 메뉴 선택을 현재 뷰로 전환합니다.
  function activateView(view) {
    state.activeView = view;
    document.querySelector(".sidebar").classList.remove("open");
    byId("mobile-menu-button").setAttribute("aria-expanded", "false");
    renderNavigation();
    renderActiveView();
  }

  // 상단 제목과 영문 분류 문구를 갱신합니다.
  function setPageHeading(title, kicker) {
    byId("page-title").textContent = title;
    byId("page-kicker").textContent = kicker;
    byId("last-updated").textContent = "";
  }

  // 마지막 조회 완료 시각을 상단에 표시합니다.
  function markUpdated() {
    byId("last-updated").textContent = "업데이트 " + new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  }

  // 비동기 조회 중 표시할 로딩 상태를 생성합니다.
  function loadingState(label) {
    return "<div class=\"loading-state\" role=\"status\"><div><div class=\"loading-line\"></div><p>" + escapeHtml(label || "불러오는 중") + "</p></div></div>";
  }

  // 조회 결과가 없을 때의 빈 상태를 생성합니다.
  function emptyState(title, body) {
    return "<div class=\"empty-state\"><div><strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(body) + "</span></div></div>";
  }

  // API 실패와 재시도 버튼이 포함된 오류 상태를 생성합니다.
  function errorState(error, retryAction) {
    var request = error && error.requestId ? "<p class=\"mono\">요청 ID: " + escapeHtml(error.requestId) + "</p>" : "";
    return "<div class=\"error-state\"><div><strong>정보를 불러오지 못했습니다.</strong><span>" + escapeHtml(errorMessage(error)) + "</span>" + request +
      "<button class=\"secondary-button\" type=\"button\" data-retry=\"" + escapeHtml(retryAction || "refresh") + "\">다시 시도</button></div></div>";
  }

  // 현재 오류 상태의 재시도 버튼을 뷰 새로고침에 연결합니다.
  function attachRetry(container) {
    var button = container.querySelector("[data-retry]");
    if (button) button.addEventListener("click", function () { if (state.refresh) state.refresh(); });
  }

  // 각 관리 화면의 공통 소개 영역을 생성합니다.
  function renderViewIntro(title, description, meta) {
    return "<div class=\"view-intro\"><div><h2>" + escapeHtml(title) + "</h2><p>" + escapeHtml(description) + "</p></div>" +
      (meta ? "<span class=\"section-meta\">" + escapeHtml(meta) + "</span>" : "") + "</div>";
  }

  // 현재 선택 메뉴에 대응하는 조회 화면을 불러옵니다.
  function renderActiveView() {
    var item = NAV_ITEMS.find(function (candidate) { return candidate.id === state.activeView; });
    if (!item) {
      setPageHeading("조회 권한이 없습니다", "ACCESS CONTROL");
      byId("main-content").innerHTML = emptyState("표시할 메뉴가 없습니다.", "운영자 계정의 조회 권한을 확인해 주세요.");
      return;
    }
    setPageHeading(item.label, item.kicker);
    if (item.id === "dashboard") loadDashboard();
    else if (item.id === "players") loadPlayersView(1);
    else if (item.id === "audit") loadAudit(1);
    else if (item.id === "activity") loadActivity(1);
    else if (item.id === "incidents") loadIncidents(1);
    else loadMonitoring(1);
    window.setTimeout(function () { byId("main-content").focus(); }, 0);
  }

  // 기존 overview API로 운영 지표 화면을 불러옵니다.
  async function loadDashboard() {
    state.refresh = loadDashboard;
    var main = byId("main-content");
    main.innerHTML = renderViewIntro("오늘의 운영 상태", "회원과 운영 위험 신호를 변경 없이 확인합니다.") + loadingState("운영 지표를 불러오는 중");
    try {
      var payload = await api("/api/v1/admin/overview");
      var metrics = METRICS.map(function (metric) {
        return "<div class=\"metric\"><span class=\"metric-label\">" + escapeHtml(metric.label) + "</span>" +
          "<strong class=\"metric-value\">" + escapeHtml(formatNumber(payload.overview[metric.key])) + "</strong>" +
          "<span class=\"metric-note\">" + escapeHtml(metric.note) + "</span></div>";
      }).join("");
      main.innerHTML = renderViewIntro("오늘의 운영 상태", "회원과 운영 위험 신호를 변경 없이 확인합니다.", "기존 overview API") +
        "<section class=\"metric-grid\" aria-label=\"운영 지표\">" + metrics + "</section>" +
        "<section class=\"panel\"><div class=\"panel-heading\"><div><h3>판단 기준</h3><p>수치 확인 후 실제 조치는 승인된 별도 슬라이스에서 수행합니다.</p></div><span class=\"read-only-indicator\"><i aria-hidden=\"true\"></i>READ ONLY</span></div>" +
        "<div class=\"detail-body\"><p class=\"muted\">이 화면은 운영 현황을 요약하며 계정, 재화, 보상, 카탈로그, 백업 데이터를 변경하지 않습니다.</p></div></section>";
      markUpdated();
    } catch (error) {
      main.innerHTML = renderViewIntro("오늘의 운영 상태", "회원과 운영 위험 신호를 변경 없이 확인합니다.") + errorState(error, "dashboard");
      attachRetry(main);
    }
  }

  // 회원 검색 결과를 읽기 전용 표로 생성합니다.
  function playerTable(items) {
    if (!items.length) return emptyState("검색 결과가 없습니다.", "이름이나 회원 ID를 다시 확인해 주세요.");
    return "<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr><th>회원</th><th>서버</th><th>레벨</th><th>길드</th><th>가입일</th></tr></thead><tbody>" +
      items.map(function (player) {
        return "<tr><td><button class=\"row-button\" type=\"button\" data-player-id=\"" + escapeHtml(player.playerId) + "\">" + escapeHtml(player.displayName) + "</button><span class=\"mono muted\">#" + escapeHtml(player.playerId) + "</span></td>" +
          "<td>" + escapeHtml(player.server ? player.server.displayName : "미지정") + "</td>" +
          "<td>Lv. " + escapeHtml(formatNumber(player.level)) + "</td>" +
          "<td>" + escapeHtml(player.guild ? player.guild.name : "-") + "</td>" +
          "<td>" + escapeHtml(formatDate(player.joinedAt, true)) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  // 조회 목록의 이전·다음 페이지 이동 영역을 생성합니다.
  function pagination(page, total, action) {
    var totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    var unit = action === "players" ? "명" : "건";
    return "<div class=\"pagination\"><span>총 " + escapeHtml(formatNumber(total)) + unit + " · " + page + " / " + totalPages + "</span>" +
      "<button type=\"button\" data-page=\"" + (page - 1) + "\" data-page-action=\"" + action + "\"" + (page <= 1 ? " disabled" : "") + ">이전</button>" +
      "<button type=\"button\" data-page=\"" + (page + 1) + "\" data-page-action=\"" + action + "\"" + (page >= totalPages ? " disabled" : "") + ">다음</button></div>";
  }

  // 페이지 이동 버튼을 지정 목록 조회 함수에 연결합니다.
  function attachPageButtons(container, callback) {
    container.querySelectorAll("[data-page]").forEach(function (button) {
      button.addEventListener("click", function () { callback(Number(button.dataset.page)); });
    });
  }

  // 검색 조건과 페이지를 유지하며 회원 목록을 불러옵니다.
  async function loadPlayersView(page) {
    state.refresh = function () { return loadPlayersView(page); };
    var main = byId("main-content");
    main.innerHTML = renderViewIntro("회원 검색", "회원 이름이나 내부 ID로 조회하고 상세 상태를 확인합니다.") +
      "<div class=\"content-grid\"><section class=\"panel\"><div class=\"panel-heading\"><form id=\"player-search-form\" class=\"search-form\"><label class=\"skip-link\" for=\"player-search\">회원 검색</label><input id=\"player-search\" name=\"search\" value=\"" + escapeHtml(state.playerSearch) + "\" placeholder=\"이름 또는 회원 ID\"><button class=\"primary-button\" type=\"submit\">검색</button></form></div><div id=\"player-results\">" + loadingState("회원을 불러오는 중") + "</div></section>" +
      "<aside id=\"player-detail\" class=\"panel\" aria-label=\"회원 상세\"><div class=\"detail-empty\"><div><strong>회원을 선택하세요.</strong><p>목록에서 이름을 누르면 상세 정보가 표시됩니다.</p></div></div></aside></div>";
    byId("player-search-form").addEventListener("submit", function (event) {
      event.preventDefault();
      state.playerSearch = new FormData(event.currentTarget).get("search").toString().trim();
      loadPlayersView(1);
    });
    var query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (state.playerSearch) query.set("search", state.playerSearch);
    var results = byId("player-results");
    try {
      var payload = await api("/api/v1/admin/players?" + query.toString());
      results.innerHTML = playerTable(payload.items) + pagination(payload.page, payload.total, "players");
      results.querySelectorAll("[data-player-id]").forEach(function (button) {
        button.addEventListener("click", function () { loadPlayerDetail(button.dataset.playerId); });
      });
      attachPageButtons(results, loadPlayersView);
      markUpdated();
    } catch (error) {
      results.innerHTML = errorState(error, "players");
      attachRetry(results);
    }
  }

  // 객체형 수치를 키·값 읽기 목록으로 생성합니다.
  function keyValueRows(values) {
    var entries = Object.entries(values || {});
    if (!entries.length) return "<p class=\"muted\">표시할 정보가 없습니다.</p>";
    return "<div class=\"key-value-list\">" + entries.map(function (entry) {
      return "<div><span>" + escapeHtml(entry[0]) + "</span><strong>" + escapeHtml(formatNumber(entry[1])) + "</strong></div>";
    }).join("") + "</div>";
  }

  // 제재 유형을 운영자용 한국어 문구로 표시합니다.
  function restrictionTypeLabel(type) {
    return type === "temporary_suspension" ? "기간 정지" : "영구 정지";
  }

  // 제재 상태를 운영자용 한국어 문구로 표시합니다.
  function restrictionStatusLabel(status) {
    if (status === "active") return "적용 중";
    if (status === "revoked") return "해제됨";
    return status === "expired" ? "만료됨" : status;
  }

  // 현재 재화 잔액과 version을 권한별 조정 폼과 함께 표시합니다.
  function renderCurrencyAccounts(player) {
    var accounts = player.currencyAccounts || Object.keys(player.currencies || {}).map(function (code) {
      return { code: code, balance: player.currencies[code], version: null };
    });
    if (!accounts.length) return emptyState("재화 계정이 없습니다.", "현재 회원에게 생성된 재화 계정이 없습니다.");
    return "<div class=\"currency-list\">" + accounts.map(function (account) {
      var canAdjust = hasPermission("game.currency.change") && account.version != null;
      return "<article class=\"currency-card\"><div><strong>" + escapeHtml(account.code) + "</strong><span>version " + escapeHtml(account.version == null ? "조회 불가" : account.version) + "</span></div>" +
        "<div class=\"currency-balance\"><b>" + escapeHtml(formatNumber(account.balance)) + "</b><span>현재 잔액</span></div>" +
        (canAdjust ? "<form class=\"currency-action-form\" data-currency-code=\"" + escapeHtml(account.code) + "\" data-currency-version=\"" + escapeHtml(account.version) + "\"><p class=\"currency-action-note\">원장·감사·내부 outbox가 한 트랜잭션으로 기록됩니다.</p><div class=\"currency-action-grid\"><label>조정 방향<select name=\"direction\"><option value=\"add\">증가</option><option value=\"subtract\">차감</option></select></label><label>수량<input name=\"amount\" inputmode=\"decimal\" required placeholder=\"예: 1000\"></label></div><label>조정 사유<textarea name=\"reason\" rows=\"2\" required placeholder=\"재화 정정의 운영 근거를 입력하세요.\"></textarea></label><label class=\"confirm-row\"><input type=\"checkbox\" name=\"confirmed\" required> 현재 잔액과 version을 확인했으며 이 재화 변경을 실행합니다.</label><p class=\"inline-error\" data-action-error hidden></p><button class=\"primary-button\" type=\"submit\">재화 조정</button></form>" : "") + "</article>";
    }).join("") + "</div>";
  }

  // 회원 상세에 현재와 과거 계정 제재를 표시합니다.
  function renderRestrictions(restrictions) {
    if (!restrictions || !restrictions.length) return emptyState("계정 제재 이력이 없습니다.", "필요한 경우 아래에서 새 조치를 등록할 수 있습니다.");
    return "<div class=\"restriction-list\">" + restrictions.map(function (restriction) {
      return "<article class=\"restriction-card " + escapeHtml(restriction.status) + "\"><div class=\"restriction-heading\"><div><strong>" + escapeHtml(restrictionTypeLabel(restriction.restrictionType)) + "</strong><span class=\"mono\">#" + escapeHtml(restriction.id) + "</span></div>" +
        "<span class=\"status-pill\">" + escapeHtml(restrictionStatusLabel(restriction.status)) + "</span></div>" +
        "<p>" + escapeHtml(restriction.reason) + "</p><div class=\"restriction-meta\"><span>시작 " + escapeHtml(formatDate(restriction.startsAt)) + "</span><span>종료 " + escapeHtml(formatDate(restriction.endsAt)) + "</span></div>" +
        (restriction.status === "active" && hasPermission("account.restrict")
          ? "<form class=\"account-action-form\" data-revoke-id=\"" + escapeHtml(restriction.id) + "\"><label>해제 사유<textarea name=\"reason\" rows=\"2\" required placeholder=\"해제가 필요한 운영 근거를 입력하세요.\"></textarea></label><label class=\"confirm-row\"><input type=\"checkbox\" name=\"confirmed\" required> 이 계정 제재를 해제합니다.</label><p class=\"inline-error\" data-action-error hidden></p><button class=\"danger-button\" type=\"submit\">제재 해제</button></form>"
          : "") + "</article>";
    }).join("") + "</div>";
  }

  // account.restrict 권한이 있는 운영자에게 새 계정 조치 폼을 표시합니다.
  function renderAccountActions(player) {
    if (!hasPermission("account.restrict")) return "";
    return "<section class=\"detail-section account-actions\"><h4>계정 조치</h4><p class=\"action-gap-note\">이 조치는 감사 기록에 남지만 별도 알림은 발송하지 않습니다.</p>" +
      "<form id=\"restriction-create-form\" class=\"account-action-form\"><label>조치 유형<select name=\"restrictionType\"><option value=\"temporary_suspension\">기간 정지</option><option value=\"permanent_suspension\">영구 정지</option></select></label>" +
      "<label data-ends-at-field>종료 시각<input type=\"datetime-local\" name=\"endsAt\" required></label><label>조치 사유<textarea name=\"reason\" rows=\"3\" required placeholder=\"정지가 필요한 운영 근거를 입력하세요.\"></textarea></label>" +
      "<label class=\"confirm-row\"><input type=\"checkbox\" name=\"confirmed\" required> 회원 계정 상태와 세션에 영향을 주는 조치임을 확인했습니다.</label><p class=\"inline-error\" data-action-error hidden></p><button class=\"danger-button\" type=\"submit\">계정 정지 적용</button></form></section>" +
      "<section class=\"detail-section\"><h4>계정 제재 이력</h4>" + renderRestrictions(player.restrictions) + "</section>";
  }

  // 계정 조치 폼의 오류 문구와 제출 상태를 갱신합니다.
  function setActionState(form, error, submitting) {
    var errorNode = form.querySelector("[data-action-error]");
    var button = form.querySelector("button[type=submit]");
    errorNode.hidden = !error;
    errorNode.textContent = error || "";
    button.disabled = submitting;
    button.textContent = submitting ? "처리 중..." : button.dataset.label;
  }

  // 회원 상세의 신규 정지와 기존 제재 해제 폼을 API에 연결합니다.
  function attachAccountActions(player) {
    var createForm = byId("restriction-create-form");
    if (createForm) {
      var type = createForm.elements.restrictionType;
      var endsAtField = createForm.querySelector("[data-ends-at-field]");
      var endsAt = createForm.elements.endsAt;
      var syncEndsAt = function () {
        var temporary = type.value === "temporary_suspension";
        endsAtField.hidden = !temporary;
        endsAt.required = temporary;
      };
      type.addEventListener("change", syncEndsAt);
      syncEndsAt();
      createForm.querySelector("button[type=submit]").dataset.label = "계정 정지 적용";
      createForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var data = new FormData(createForm);
        var restrictionType = data.get("restrictionType").toString();
        var reason = data.get("reason").toString().trim();
        var rawEndsAt = data.get("endsAt").toString();
        if (!reason || !data.get("confirmed") || (restrictionType === "temporary_suspension" && !rawEndsAt)) {
          setActionState(createForm, "조치 유형, 사유, 확인 항목을 모두 입력해 주세요.", false);
          return;
        }
        var body = { restrictionType: restrictionType, reason: reason, confirmed: true };
        if (restrictionType === "temporary_suspension") body.endsAt = new Date(rawEndsAt).toISOString();
        var scope = "restriction.create:" + player.playerId + ":" + restrictionType + ":" + (body.endsAt || "permanent") + ":" + reason;
        setActionState(createForm, "", true);
        try {
          await mutateAccount("/api/v1/admin/players/" + encodeURIComponent(player.playerId) + "/restrictions", "POST", body, scope);
          showToast(restrictionTypeLabel(restrictionType) + " 조치를 적용했습니다.");
          await loadPlayerDetail(player.playerId);
        } catch (error) {
          setActionState(createForm, errorMessage(error), false);
        }
      });
    }
    document.querySelectorAll("[data-revoke-id]").forEach(function (form) {
      form.querySelector("button[type=submit]").dataset.label = "제재 해제";
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var data = new FormData(form);
        var reason = data.get("reason").toString().trim();
        if (!reason || !data.get("confirmed")) {
          setActionState(form, "해제 사유와 확인 항목을 입력해 주세요.", false);
          return;
        }
        var restrictionId = form.dataset.revokeId;
        var scope = "restriction.revoke:" + restrictionId + ":" + reason;
        setActionState(form, "", true);
        try {
          await mutateAccount("/api/v1/admin/restrictions/" + encodeURIComponent(restrictionId), "PATCH", { status: "revoked", reason: reason, confirmed: true }, scope);
          showToast("계정 제재를 해제했습니다.");
          await loadPlayerDetail(player.playerId);
        } catch (error) {
          setActionState(form, errorMessage(error), false);
        }
      });
    });
  }

  // 재화 조정 폼을 version 기반 증감 REST API에 연결합니다.
  function attachCurrencyActions(player) {
    document.querySelectorAll("[data-currency-code]").forEach(function (form) {
      form.querySelector("button[type=submit]").dataset.label = "재화 조정";
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        var data = new FormData(form);
        var amount = data.get("amount").toString().trim();
        var reason = data.get("reason").toString().trim();
        var direction = data.get("direction").toString();
        if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(amount) || Number(amount) <= 0 || !reason || !data.get("confirmed")) {
          setActionState(form, "0보다 큰 수량, 사유, 확인 항목을 모두 입력해 주세요.", false);
          return;
        }
        var currencyCode = form.dataset.currencyCode;
        var expectedVersion = form.dataset.currencyVersion;
        var delta = direction === "subtract" ? "-" + amount : amount;
        var scope = "currency.adjust:" + player.playerId + ":" + currencyCode + ":" + expectedVersion + ":" + delta + ":" + reason;
        setActionState(form, "", true);
        try {
          await mutateAccount("/api/v1/admin/players/" + encodeURIComponent(player.playerId) + "/currencies/" + encodeURIComponent(currencyCode) + "/adjustments", "POST", { delta: delta, expectedVersion: expectedVersion, reason: reason, confirmed: true }, scope);
          showToast(currencyCode + " 재화를 조정했습니다.");
          await loadPlayerDetail(player.playerId);
        } catch (error) {
          setActionState(form, errorMessage(error), false);
        }
      });
    });
  }

  // 선택한 회원의 프로필과 권한별 계정 조치 화면을 표시합니다.
  async function loadPlayerDetail(playerId) {
    var detail = byId("player-detail");
    detail.innerHTML = loadingState("회원 상세를 불러오는 중");
    try {
      var payload = await api("/api/v1/admin/players/" + encodeURIComponent(playerId));
      var player = payload.player;
      detail.innerHTML = "<div class=\"detail-body\"><div class=\"detail-title\"><div><h3>" + escapeHtml(player.displayName) + "</h3><span class=\"mono\">PLAYER #" + escapeHtml(player.playerId) + "</span></div><span>v" + escapeHtml(player.profileVersion) + "</span></div>" +
        "<dl class=\"detail-list\"><div><dt>서버</dt><dd>" + escapeHtml(player.server ? player.server.displayName : "미지정") + "</dd></div><div><dt>가입일</dt><dd>" + escapeHtml(formatDate(player.joinedAt, true)) + "</dd></div>" +
        "<div><dt>레벨</dt><dd>" + escapeHtml(formatNumber(player.level)) + "</dd></div><div><dt>누적 레벨</dt><dd>" + escapeHtml(formatNumber(player.accumulatedLevel)) + "</dd></div>" +
        "<div><dt>환생</dt><dd>" + escapeHtml(formatNumber(player.rebirthCount)) + "회</dd></div><div><dt>길드</dt><dd>" + escapeHtml(player.guild ? player.guild.name + " · " + player.guild.roleCode : "-") + "</dd></div>" +
        "<div><dt>펫</dt><dd>" + escapeHtml(player.pet && player.pet.name ? player.pet.name : "-") + "</dd></div><div><dt>홈</dt><dd>" + escapeHtml(player.home && player.home.name ? player.home.name : "-") + "</dd></div></dl>" +
        "<section class=\"detail-section\"><h4>재화 현황</h4>" + renderCurrencyAccounts(player) + "</section>" +
        "<section class=\"detail-section\"><h4>주요 카운터</h4>" + keyValueRows(player.counters) + "</section>" +
        "<section class=\"detail-section\"><h4>보유 배지</h4><div class=\"tag-list\">" + (player.badges.length ? player.badges.map(function (badge) { return "<span class=\"tag\">" + escapeHtml(badge) + "</span>"; }).join("") : "<span class=\"muted\">없음</span>") + "</div></section>" + renderAccountActions(player) + "</div>";
      attachAccountActions(player);
      attachCurrencyActions(player);
    } catch (error) {
      detail.innerHTML = errorState(error, "players");
      attachRetry(detail);
    }
  }

  // 지정 열 정의로 공통 조회 테이블을 생성합니다.
  function renderTable(items, columns) {
    if (!items.length) return emptyState("표시할 기록이 없습니다.", "현재 조건에 해당하는 데이터가 없습니다.");
    return "<div class=\"table-wrap\"><table class=\"data-table\"><thead><tr>" + columns.map(function (column) { return "<th>" + escapeHtml(column.label) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      items.map(function (item) {
        return "<tr>" + columns.map(function (column) {
          var raw = typeof column.value === "function" ? column.value(item) : item[column.value];
          return "<td" + (column.className ? " class=\"" + column.className + "\"" : "") + ">" + escapeHtml(raw == null || raw === "" ? "-" : raw) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  // 감사·활동·이슈 목록의 공통 페이지 조회를 수행합니다.
  async function loadPagedCollection(config, page) {
    state.refresh = function () { return config.load(page); };
    var main = byId("main-content");
    main.innerHTML = renderViewIntro(config.title, config.description) + "<section class=\"panel\"><div class=\"panel-heading\"><div><h3>" + escapeHtml(config.panelTitle) + "</h3><p>최신 기록부터 표시합니다.</p></div></div><div id=\"collection-results\">" + loadingState(config.loading) + "</div></section>";
    var results = byId("collection-results");
    try {
      var payload = await api(config.path + "?page=" + page + "&limit=" + PAGE_SIZE);
      results.innerHTML = renderTable(payload.items, config.columns) + pagination(payload.page, payload.total, config.id);
      attachPageButtons(results, config.load);
      markUpdated();
    } catch (error) {
      results.innerHTML = errorState(error, config.id);
      attachRetry(results);
    }
  }

  // 감사 기록 페이지를 불러옵니다.
  function loadAudit(page) {
    return loadPagedCollection({ id: "audit", load: loadAudit, title: "감사 기록", description: "운영 명령과 조치의 결과·사유를 시간순으로 조회합니다.", panelTitle: "Command audit", loading: "감사 기록을 불러오는 중", path: "/api/v1/admin/audit-entries", columns: [
      { label: "시각", value: function (row) { return formatDate(row.createdAt); } },
      { label: "작업", value: "actionCode", className: "mono" },
      { label: "결과", value: "resultCode", className: "status-text" },
      { label: "수행자", value: function (row) { return row.actorType + (row.actorId ? " #" + row.actorId : ""); } },
      { label: "대상", value: function (row) { return row.targetType ? row.targetType + (row.targetId ? " #" + row.targetId : "") : "-"; } },
      { label: "사유", value: "reason" }
    ] }, page);
  }

  // 채널 활동 집계 페이지를 불러옵니다.
  function loadActivity(page) {
    return loadPagedCollection({ id: "activity", load: loadActivity, title: "채널 활동", description: "채널별 사용자 활동량과 마지막 이벤트 시각을 확인합니다.", panelTitle: "Daily channel activity", loading: "채널 활동을 불러오는 중", path: "/api/v1/admin/channel-activity", columns: [
      { label: "날짜", value: "activityDate" },
      { label: "채널", value: "externalChannelId", className: "mono" },
      { label: "표시 이름", value: function (row) { return row.verifiedDisplayName || row.observedDisplayName || "-"; } },
      { label: "메시지", value: function (row) { return formatNumber(row.messageCount); } },
      { label: "미디어", value: function (row) { return formatNumber(row.mediaCount); } },
      { label: "이벤트", value: function (row) { return formatNumber(row.eventCount); } },
      { label: "마지막 활동", value: function (row) { return formatDate(row.lastEventAt); } }
    ] }, page);
  }

  // 운영 이슈 감지 페이지를 불러옵니다.
  function loadIncidents(page) {
    return loadPagedCollection({ id: "incidents", load: loadIncidents, title: "운영 이슈", description: "삭제·수정·숨김으로 감지된 메시지 이벤트를 조회합니다.", panelTitle: "Moderation incidents", loading: "운영 이슈를 불러오는 중", path: "/api/v1/admin/moderation-incidents", columns: [
      { label: "발생 시각", value: function (row) { return formatDate(row.occurredAt); } },
      { label: "유형", value: "incidentType", className: "mono" },
      { label: "상태", value: "status", className: "status-text" },
      { label: "채널", value: function (row) { return row.channelName || row.externalChannelId || "-"; } },
      { label: "사용자", value: function (row) { return row.verifiedDisplayName || (row.externalIdentityId ? "#" + row.externalIdentityId : "-"); } },
      { label: "이벤트 ID", value: "eventId", className: "mono" }
    ] }, page);
  }

  // 선택한 모니터링 탭의 표 열 정의를 반환합니다.
  function monitoringColumns(tab) {
    if (tab === "failures") return [
      { label: "발생 시각", value: function (row) { return formatDate(row.createdAt); } },
      { label: "Provider", value: "providerCode" },
      { label: "상태", value: "status", className: "status-text danger" },
      { label: "시도", value: function (row) { return formatNumber(row.attemptCount); } },
      { label: "오류 코드", value: "errorCode", className: "mono" },
      { label: "ID", value: "id", className: "mono" }
    ];
    return [
      { label: "수집 시각", value: function (row) { return formatDate(row.createdAt); } },
      { label: "이벤트", value: "eventCode", className: "mono" },
      { label: "그룹", value: "monitoringGroup" },
      { label: "채널", value: function (row) { return row.channelName || row.externalChannelId || "-"; } },
      { label: "사용자", value: function (row) { return row.verifiedDisplayName || row.externalUserId || "-"; } },
      { label: "Event ID", value: "eventId", className: "mono" }
    ];
  }

  // 이벤트 또는 전송 실패 모니터링 페이지를 불러옵니다.
  async function loadMonitoring(page) {
    state.refresh = function () { return loadMonitoring(page); };
    var main = byId("main-content");
    var tabs = [{ id: "events", label: "이벤트" }, { id: "failures", label: "전송 실패" }];
    main.innerHTML = renderViewIntro("이벤트 모니터링", "운영 관찰 이벤트와 전송 실패를 변경 없이 조회합니다.") +
      "<section class=\"panel\"><div class=\"tab-list\" role=\"tablist\" aria-label=\"모니터링 유형\">" + tabs.map(function (tab) {
        return "<button class=\"tab-button\" type=\"button\" role=\"tab\" data-monitoring-tab=\"" + tab.id + "\" aria-selected=\"" + (tab.id === state.monitoringTab) + "\">" + tab.label + "</button>";
      }).join("") + "</div><div id=\"monitoring-results\">" + loadingState("모니터링 정보를 불러오는 중") + "</div></section>";
    main.querySelectorAll("[data-monitoring-tab]").forEach(function (button) {
      button.addEventListener("click", function () { state.monitoringTab = button.dataset.monitoringTab; loadMonitoring(1); });
    });
    var results = byId("monitoring-results");
    var path = state.monitoringTab === "failures" ? "/api/v1/admin/delivery-failures" : "/api/v1/admin/monitoring-events";
    try {
      var payload = await api(path + "?page=" + page + "&limit=" + PAGE_SIZE);
      results.innerHTML = renderTable(payload.items, monitoringColumns(state.monitoringTab)) + pagination(payload.page, payload.total, "monitoring");
      attachPageButtons(results, loadMonitoring);
      markUpdated();
    } catch (error) {
      results.innerHTML = errorState(error, "monitoring");
      attachRetry(results);
    }
  }

  byId("login-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var data = new FormData(form);
    var loginId = data.get("loginId").toString().trim();
    var password = data.get("password").toString();
    var button = byId("login-button");
    var error = byId("login-error");
    if (!loginId || !password) {
      error.textContent = "로그인 ID와 비밀번호를 모두 입력해 주세요.";
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "확인 중…";
    error.hidden = true;
    try {
      var payload = await api("/api/v1/admin/sessions", { method: "POST", body: JSON.stringify({ loginId: loginId, password: password }) });
      state.csrfToken = payload.csrfToken;
      sessionStorage.setItem(CSRF_KEY, payload.csrfToken);
      form.reset();
      showApp(payload.session);
    } catch (caught) {
      error.textContent = errorMessage(caught);
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "로그인";
    }
  });

  byId("refresh-button").addEventListener("click", function () { if (state.refresh) state.refresh(); });
  byId("logout-button").addEventListener("click", async function () {
    if (!state.csrfToken) {
      showToast("보안 토큰이 없어 현재 탭에서 로그아웃할 수 없습니다. 다시 로그인해 세션을 갱신해 주세요.", true);
      return;
    }
    try {
      await api("/api/v1/admin/sessions/current", { method: "DELETE", headers: { "x-csrf-token": state.csrfToken } });
      sessionStorage.removeItem(CSRF_KEY);
      state.csrfToken = null;
      showLogin();
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  });
  byId("mobile-menu-button").addEventListener("click", function () {
    var sidebar = document.querySelector(".sidebar");
    var open = sidebar.classList.toggle("open");
    byId("mobile-menu-button").setAttribute("aria-expanded", String(open));
  });

  api("/api/v1/admin/sessions/current")
    .then(function (payload) { showApp(payload.session); })
    .catch(function (error) {
      if (error.status === 401 || error.status === 404) showLogin();
      else showLogin(errorMessage(error));
    });
})();`;
