export const USER_SHELL_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>호이월드 이용자 포털</title>
  <link rel="stylesheet" href="/site/assets/user-shell.css">
</head>
<body>
  <a class="skip-link" href="#main-content">본문으로 바로가기</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="호이월드 이용자 포털 홈">
      <span class="brand-mark" aria-hidden="true">H</span>
      <span><strong>호이월드</strong><small>이용자 포털</small></span>
    </a>
    <div class="header-account-status">
      <div id="header-balance-summary" class="header-balance-summary" aria-label="현재 재화 잔액" aria-live="polite" hidden>
        <span id="header-point-balance" class="header-balance-item" hidden><strong>포인트</strong><b id="header-point-balance-value"></b></span>
        <span id="header-diamond-balance" class="header-balance-item" hidden><strong>다이아</strong><b id="header-diamond-balance-value"></b></span>
      </div>
      <p id="header-session" class="header-session" aria-live="polite">세션 확인 중</p>
    </div>
  </header>

  <main id="main-content" tabindex="-1">
    <section id="loading-view" class="state-view" aria-labelledby="loading-title">
      <span class="spinner" aria-hidden="true"></span>
      <h1 id="loading-title">세션을 확인하고 있습니다</h1>
      <p>안전한 연결 상태를 확인한 뒤 화면을 준비할게요.</p>
    </section>

    <section id="login-view" class="login-layout" hidden>
      <div class="login-intro" aria-labelledby="login-title">
        <p class="eyebrow">HOI WORLD PORTAL</p>
        <h1 id="login-title" tabindex="-1">호이월드 계정을<br>한곳에서 관리하세요.</h1>
        <p class="intro-copy">카카오톡에서 인증한 계정으로 로그인해 내 게임 프로필과 연결 상태를 확인할 수 있어요.</p>
        <ul class="trust-list" aria-label="포털 이용 안내">
          <li><span aria-hidden="true">01</span><div><strong>연결된 계정만 표시</strong><small>현재 로그인한 본인의 정보만 불러옵니다.</small></div></li>
          <li><span aria-hidden="true">02</span><div><strong>민감정보 저장 안 함</strong><small>비밀번호와 세션 정보는 브라우저 저장소에 남기지 않습니다.</small></div></li>
          <li><span aria-hidden="true">03</span><div><strong>카카오톡 인증 연동</strong><small>신규 가입은 기존 8자리 인증 흐름을 그대로 사용합니다.</small></div></li>
        </ul>
      </div>

      <div class="login-panel">
        <div class="panel-heading">
          <p class="eyebrow dark">ACCOUNT</p>
          <h2>로그인</h2>
          <p>가입할 때 만든 ID와 비밀번호를 입력해 주세요.</p>
        </div>
        <div id="login-session-notice" class="session-notice" role="status" tabindex="-1" hidden>
          <strong>로그인 상태가 변경됐어요.</strong>
          <p id="login-session-message"></p>
        </div>
        <div id="login-error-summary" class="error-summary" role="alert" tabindex="-1" hidden>
          <strong>로그인 정보를 확인해 주세요.</strong>
          <p id="login-error-message"></p>
        </div>
        <form id="login-form" aria-label="이용자 로그인" novalidate>
          <div class="field">
            <label for="login-id">로그인 ID</label>
            <input id="login-id" name="loginId" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="6" maxlength="20" pattern="[a-z0-9]{6,20}" required aria-describedby="login-id-error">
            <small id="login-id-error" class="field-error" hidden></small>
          </div>
          <div class="field">
            <label for="password">비밀번호</label>
            <input id="password" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="64" pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,64}" required aria-describedby="password-error">
            <small id="password-error" class="field-error" hidden></small>
          </div>
          <button id="login-button" class="primary-button" type="submit">로그인</button>
        </form>
        <div class="panel-footer">
          <span>아직 계정이 없나요?</span>
          <a href="/signup">회원가입하고 카카오톡 인증하기</a>
        </div>
      </div>
    </section>

    <section id="app-view" class="app-shell" hidden>
      <aside class="app-sidebar" aria-label="이용자 메뉴">
        <div class="sidebar-profile">
          <span class="sidebar-avatar" aria-hidden="true">H</span>
          <div>
          <p class="eyebrow">MY HOI WORLD</p>
          <h1 id="welcome-title" tabindex="-1">내 호이월드</h1>
          <p id="account-name" class="sidebar-copy"></p>
          </div>
        </div>
        <nav aria-label="내 정보">
          <a id="nav-home" class="nav-link active" href="/app" aria-current="page"><span>홈</span><small>요약</small></a>
          <a id="nav-account" class="nav-link" href="/account"><span>계정 연결</span><small>상세</small></a>
          <a id="nav-inventory" class="nav-link" href="/account/inventory"><span>가방</span><small>내 아이템</small></a>
          <a id="nav-currencies" class="nav-link" href="/account/currencies"><span>재화</span><small>내 잔액</small></a>
        </nav>
        <button id="logout-button" class="secondary-button" type="button">로그아웃</button>
      </aside>

      <div id="home-content" class="app-content">
        <div class="page-heading">
          <div>
            <p class="eyebrow dark">OVERVIEW</p>
            <h2>계정 요약</h2>
            <p>현재 연결된 계정과 게임 프로필을 확인할 수 있어요.</p>
          </div>
          <span id="connection-badge" class="status-badge">연결 확인됨</span>
        </div>

        <div id="app-error" class="inline-notice error" role="alert" hidden>
          <div><strong>정보를 불러오지 못했어요.</strong><p id="app-error-message"></p></div>
          <button id="retry-button" class="text-button" type="button">다시 시도</button>
        </div>

        <section class="summary-grid" aria-label="계정 요약 정보">
          <article class="summary-card">
            <p class="card-label">웹 계정</p>
            <strong id="account-login-id">—</strong>
            <small id="account-id">연결 정보를 확인 중입니다.</small>
          </article>
          <article class="summary-card">
            <p class="card-label">시스템 계정</p>
            <strong id="system-account-name">—</strong>
            <small id="player-id">게임계정 정보를 확인 중입니다.</small>
          </article>
          <article class="summary-card status-summary">
            <p class="card-label">보안 상태</p>
            <strong><span class="status-dot" aria-hidden="true"></span>안전하게 연결됨</strong>
            <small>현재 브라우저에 비밀번호를 별도로 저장하지 않습니다.</small>
          </article>
        </section>

        <div class="dashboard-grid">
          <section class="profile-card" aria-labelledby="profile-title">
            <div class="profile-heading">
              <div>
                <p class="card-label">CURRENT PLAYER</p>
                <h2 id="profile-title">내 게임 프로필</h2>
              </div>
              <span id="profile-state" class="status-text">조회 중</span>
            </div>
            <dl id="profile-list" class="profile-list" hidden></dl>
            <div id="profile-empty" class="empty-state" hidden>
              <strong>표시할 프로필이 아직 없어요.</strong>
              <p>카카오톡 인증이 완료됐는지 확인하거나 잠시 후 다시 시도해 주세요.</p>
              <a href="/signup">가입·인증 상태 확인</a>
            </div>
          </section>

          <aside class="guide-card" aria-labelledby="guide-title">
            <p class="card-label">QUICK GUIDE</p>
            <h2 id="guide-title">이용 안내</h2>
            <ul class="guide-list">
              <li><span aria-hidden="true">1</span><div><strong>계정 확인</strong><small>웹 계정과 게임 계정의 연결 상태를 확인하세요.</small></div></li>
              <li><span aria-hidden="true">2</span><div><strong>프로필 확인</strong><small>연결된 캐릭터의 주요 정보를 확인하세요.</small></div></li>
              <li><span aria-hidden="true">3</span><div><strong>가방·재화 확인</strong><small>가방의 아이템과 현재 보유 재화를 메뉴에서 확인하세요.</small></div></li>
            </ul>
            <a class="guide-link" href="/signup">가입·인증 상태 확인</a>
          </aside>
        </div>
      </div>

      <div id="account-content" class="app-content" hidden>
        <div class="page-heading">
          <div>
            <p class="eyebrow dark">ACCOUNT CONNECTION</p>
            <h2 id="account-title" tabindex="-1">계정 연결</h2>
            <p>현재 로그인한 웹 계정과 연결된 게임 프로필을 확인할 수 있어요.</p>
          </div>
          <span class="status-badge">연결 확인됨</span>
        </div>

        <section class="account-link-card" aria-labelledby="linked-account-title">
          <div class="account-link-heading">
            <div>
              <p class="card-label">CONNECTED ACCOUNT</p>
              <h2 id="linked-account-title">연결된 계정</h2>
            </div>
            <span class="status-badge compact"><span class="status-dot" aria-hidden="true"></span>사용 중</span>
          </div>
          <dl class="account-detail-list">
            <div><dt>웹 로그인 ID</dt><dd id="link-login-id">—</dd></div>
            <div><dt>시스템 계정</dt><dd id="link-system-account">—</dd></div>
            <div><dt>현재 게임 프로필</dt><dd id="link-player-name">—</dd></div>
            <div><dt>서버</dt><dd id="link-player-server">—</dd></div>
          </dl>
        </section>

        <div class="account-help-grid">
          <section class="account-help-card">
            <p class="card-label">PRIVACY</p>
            <h2>표시 정보 안내</h2>
            <p>웹에서는 로그인 ID를 일부 가리고, 내부 계정 식별자는 표시하지 않습니다.</p>
          </section>
          <section class="account-help-card">
            <p class="card-label">VERIFICATION</p>
            <h2>연결 상태가 다른가요?</h2>
            <p>카카오톡 인증 상태를 다시 확인하면 현재 계정의 연결 절차를 확인할 수 있어요.</p>
            <a href="/signup">가입·인증 상태 확인</a>
          </section>
        </div>
        <p class="account-footnote">연결 해제와 계정 전환 기능은 준비 중입니다.</p>
      </div>

      <div id="inventory-content" class="app-content" hidden>
        <div class="page-heading">
          <div>
            <p class="eyebrow dark">MY INVENTORY</p>
            <h2 id="inventory-title" tabindex="-1">가방</h2>
            <p>현재 연결된 게임 계정의 아이템을 최신 순서로 확인할 수 있어요.</p>
          </div>
          <span id="inventory-count" class="status-badge">조회 준비 중</span>
        </div>

        <section class="inventory-card" aria-labelledby="inventory-list-title" aria-busy="true">
          <div class="inventory-heading">
            <div>
              <p class="card-label">CURRENT PLAYER BAG</p>
              <h2 id="inventory-list-title">내 아이템</h2>
              <p id="inventory-owner" class="inventory-owner"></p>
            </div>
            <span id="inventory-state" class="status-text">조회 중</span>
          </div>
          <div id="inventory-loading" class="inventory-state" role="status"><span class="spinner small" aria-hidden="true"></span><p>가방을 불러오고 있어요.</p></div>
          <div id="inventory-empty" class="empty-state" hidden><strong>가방에 표시할 아이템이 없어요.</strong><p>아이템을 획득하면 이곳에서 수량을 확인할 수 있어요.</p></div>
          <div id="inventory-error" class="inline-notice error" role="alert" hidden><div><strong>가방을 불러오지 못했어요.</strong><p id="inventory-error-message"></p></div><button id="inventory-retry-button" class="text-button" type="button">다시 시도</button></div>
          <ul id="inventory-list" class="inventory-list" aria-label="가방 아이템" tabindex="-1" hidden></ul>
          <div id="inventory-pagination" class="inventory-pagination" hidden>
            <button id="inventory-prev-button" class="secondary-button" type="button">이전 페이지</button>
            <p id="inventory-page-status" role="status" aria-live="polite"></p>
            <button id="inventory-next-button" class="secondary-button" type="button">다음 페이지</button>
          </div>
        </section>
      </div>

      <div id="currencies-content" class="app-content" hidden>
        <div class="page-heading">
          <div>
            <p class="eyebrow dark">MY CURRENCIES</p>
            <h2 id="currencies-title" tabindex="-1">재화</h2>
            <p>현재 연결된 게임 계정의 보유 재화를 확인할 수 있어요.</p>
          </div>
          <span id="currencies-count" class="status-badge">조회 준비 중</span>
        </div>

        <section class="currencies-card" aria-labelledby="currencies-list-title" aria-busy="true">
          <div class="currencies-heading">
            <div>
              <p class="card-label">CURRENT PLAYER CURRENCIES</p>
              <h2 id="currencies-list-title">내 재화</h2>
              <p class="currencies-description">잔액은 게임 데이터에 저장된 값 그대로 표시합니다.</p>
            </div>
            <span id="currencies-state" class="status-text" aria-live="polite">조회 중</span>
          </div>
          <div id="currencies-loading" class="currencies-state" role="status"><span class="spinner small" aria-hidden="true"></span><p>재화를 불러오고 있어요.</p></div>
          <div id="currencies-empty" class="empty-state" hidden><strong>표시할 재화가 없어요.</strong><p>현재 계정에 생성된 재화가 없거나 아직 표시할 정보가 없어요.</p></div>
          <div id="currencies-error" class="inline-notice error" role="alert" hidden><div><strong>재화를 불러오지 못했어요.</strong><p id="currencies-error-message"></p></div></div>
          <ul id="currencies-list" class="currencies-list" aria-label="보유 재화" tabindex="-1" hidden></ul>
        </section>
      </div>
    </section>
  </main>

  <div id="live-status" class="sr-only" role="status" aria-live="polite"></div>
  <footer class="site-footer"><p>호이월드 계정과 게임 정보는 검증된 연결을 통해서만 표시됩니다.</p></footer>
  <script src="/site/assets/user-shell.js" defer></script>
</body>
</html>`;

export const USER_SHELL_STYLES = String.raw`
:root {
  color: #020617;
  background: #f4f7fb;
  font-family: system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
  font-synthesis: none;
  --ink: #020617;
  --navy: #0f172a;
  --blue: #1e3a8a;
  --blue-dark: #172e6d;
  --gold: #a16207;
  --muted: #475569;
  --line: #dbe3ec;
  --surface: #ffffff;
  --canvas: #f4f7fb;
  --soft-blue: #eef4ff;
  --danger: #b42318;
  --danger-bg: #fff1f0;
  --success: #166534;
  --success-bg: #effcf2;
  --focus: #2563eb;
  --focus-dark: #fbbf24;
}
* { box-sizing: border-box; }
html { min-width: 320px; background: var(--canvas); }
body { min-height: 100vh; margin: 0; background: var(--canvas); color: var(--ink); }
button, input { font: inherit; }
button, a { -webkit-tap-highlight-color: transparent; }
button { cursor: pointer; }
[hidden] { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.skip-link { position: fixed; top: 8px; left: 8px; z-index: 20; transform: translateY(-160%); padding: 11px 15px; color: var(--navy); background: #fff; border: 2px solid var(--blue); border-radius: 8px; font-weight: 700; }
.skip-link:focus { transform: translateY(0); }
a:focus-visible, button:focus-visible, input:focus-visible, [tabindex="-1"]:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.site-header a:focus-visible, .login-intro [tabindex="-1"]:focus-visible, .app-sidebar a:focus-visible, .app-sidebar button:focus-visible, .app-sidebar [tabindex="-1"]:focus-visible { outline-color: var(--focus-dark); }
.site-header { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px clamp(18px, 4vw, 48px); color: #fff; background: var(--navy); border-bottom: 1px solid #23304a; }
.brand { min-height: 44px; display: inline-flex; align-items: center; gap: 11px; color: #fff; text-decoration: none; }
.brand-mark { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; background: var(--gold); font-weight: 900; }
.brand > span:last-child { display: grid; gap: 1px; }
.brand strong { font-size: 15px; letter-spacing: -.01em; }
.brand small { color: #cbd5e1; font-size: 11px; }
.header-account-status { min-width: 0; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px 12px; }
.header-session { margin: 0; color: #cbd5e1; font-size: 12px; }
.header-balance-summary { min-width: 0; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.header-balance-item { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; padding: 5px 8px; color: #e2e8f0; background: #1e293b; border: 1px solid #334155; border-radius: 999px; font-size: 11px; line-height: 1.35; }
.header-balance-item strong { color: #cbd5e1; font-size: 10px; white-space: nowrap; }
.header-balance-item b { min-width: 0; color: #fff; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
main { min-height: calc(100vh - 112px); }
.state-view { min-height: calc(100vh - 112px); display: grid; place-content: center; justify-items: center; gap: 10px; padding: 32px 20px; text-align: center; }
.state-view h1 { margin: 4px 0 0; font-size: clamp(24px, 6vw, 34px); letter-spacing: -.04em; }
.state-view p { max-width: 34rem; margin: 0; color: var(--muted); line-height: 1.65; }
.spinner { width: 28px; height: 28px; border: 3px solid #dbe3ec; border-top-color: var(--blue); border-radius: 50%; animation: spin .8s linear infinite; }
.login-layout { width: min(960px, calc(100% - 32px)); margin: 32px auto 48px; overflow: hidden; background: var(--surface); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 20px 60px rgba(15,23,42,.10); }
.login-intro { padding: 38px 24px 34px; color: #fff; background: linear-gradient(145deg, var(--navy), #17346d); }
.eyebrow { margin: 0 0 12px; color: #d8c89b; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
.eyebrow.dark { color: var(--gold); }
.login-intro h1 { max-width: 520px; margin: 0; font-size: clamp(32px, 7vw, 48px); line-height: 1.13; letter-spacing: -.05em; word-break: keep-all; text-wrap: balance; }
.intro-copy { max-width: 510px; margin: 18px 0 26px; color: #dbe6ff; line-height: 1.65; }
.trust-list { display: grid; gap: 13px; max-width: 600px; margin: 0; padding: 0; list-style: none; }
.trust-list li { display: grid; grid-template-columns: 36px 1fr; gap: 12px; align-items: start; }
.trust-list li > span { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.32); border-radius: 50%; font-size: 10px; font-weight: 800; }
.trust-list div { display: grid; gap: 3px; }
.trust-list strong { font-size: 14px; }
.trust-list small { color: #bdcbed; line-height: 1.5; }
.login-panel { width: min(100%, 34rem); margin: 0 auto; padding: 34px 24px 40px; }
.panel-heading h2, .page-heading h2, .profile-heading h2 { margin: 0; letter-spacing: -.035em; }
.panel-heading h2 { font-size: 29px; }
.panel-heading > p:last-child, .page-heading p { margin: 8px 0 26px; color: var(--muted); line-height: 1.6; }
#login-form { display: grid; gap: 20px; }
.field { display: grid; gap: 8px; }
.field label { font-size: 14px; font-weight: 750; }
.field input { width: 100%; min-height: 48px; padding: 11px 13px; color: var(--ink); background: #fff; border: 1px solid #aebccc; border-radius: 9px; outline: none; }
.field input[aria-invalid="true"] { border-color: var(--danger); }
.field-error { color: var(--danger); font-size: 12px; line-height: 1.45; }
.primary-button, .secondary-button, .text-button { min-height: 46px; border-radius: 9px; font-weight: 800; }
.primary-button { padding: 0 18px; color: #fff; background: var(--blue); border: 1px solid var(--blue); }
.primary-button:hover { background: var(--blue-dark); }
.secondary-button { padding: 0 16px; color: var(--blue); background: #fff; border: 1px solid #9fb0c5; }
.secondary-button:hover, .text-button:hover { background: var(--soft-blue); }
.text-button { padding: 0 12px; color: var(--blue); background: #fff; border: 1px solid #9fb0c5; white-space: nowrap; }
button:disabled { opacity: .58; cursor: wait; }
.panel-footer { display: grid; gap: 6px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
.panel-footer a, .empty-state a { min-height: 44px; display: inline-flex; align-items: center; color: var(--blue); font-weight: 800; text-underline-offset: 3px; }
.session-notice { margin-bottom: 20px; padding: 14px 15px; color: #854d0e; background: #fffbeb; border-left: 4px solid #d97706; border-radius: 8px; }
.session-notice strong { font-size: 14px; }
.session-notice p { margin: 5px 0 0; color: #713f12; font-size: 13px; line-height: 1.55; }
.error-summary, .inline-notice { margin-bottom: 20px; padding: 14px 15px; color: var(--danger); background: var(--danger-bg); border-left: 4px solid var(--danger); border-radius: 8px; }
.error-summary strong, .inline-notice strong { font-size: 14px; }
.error-summary p, .inline-notice p { margin: 5px 0 0; font-size: 13px; line-height: 1.55; }
.app-shell { width: min(1240px, calc(100% - 32px)); margin: 24px auto 48px; }
.app-sidebar { display: grid; align-content: start; gap: 18px; padding: 22px 18px; color: #fff; background: var(--navy); border-radius: 16px; }
.sidebar-profile { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; align-items: start; }
.sidebar-avatar { width: 42px; height: 42px; display: grid; place-items: center; color: #fff; background: var(--gold); border-radius: 12px; font-weight: 900; }
.app-sidebar h1 { margin: 0; font-size: 22px; letter-spacing: -.04em; }
.app-sidebar .eyebrow { margin-bottom: 4px; font-size: 9px; }
.sidebar-copy { margin: 5px 0 0; color: #cbd5e1; font-size: 12px; line-height: 1.45; }
.app-sidebar nav { display: grid; align-content: start; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.nav-link { min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 13px; color: #e2e8f0; border: 1px solid #334155; border-radius: 9px; text-decoration: none; font-size: 13px; font-weight: 700; }
.nav-link.active { color: #fff; background: var(--blue); border-color: #4165bd; }
.nav-link.disabled { color: #a8b5c7; cursor: default; }
.nav-link small { font-size: 10px; font-weight: 500; }
.app-sidebar .secondary-button { width: 100%; color: #fff; background: transparent; border-color: #64748b; }
.app-content { min-width: 0; padding: 28px 2px 0; }
.page-heading { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 20px; }
.page-heading h2 { font-size: clamp(28px, 5vw, 36px); }
.page-heading p { margin-bottom: 0; }
.status-badge { display: inline-flex; align-items: center; min-height: 32px; padding: 0 11px; color: var(--success); background: var(--success-bg); border: 1px solid #a7d7b5; border-radius: 999px; font-size: 12px; font-weight: 800; }
.inline-notice { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.summary-grid { display: grid; gap: 12px; margin-bottom: 14px; }
.summary-card, .profile-card, .guide-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 6px 20px rgba(15,23,42,.05); }
.summary-card { min-height: 116px; display: grid; align-content: center; gap: 6px; padding: 18px; }
.summary-card strong { font-size: 19px; overflow-wrap: anywhere; }
.summary-card small { color: var(--muted); line-height: 1.5; }
.status-summary strong { display: flex; align-items: center; gap: 8px; font-size: 16px; }
.status-dot { width: 9px; height: 9px; flex: 0 0 auto; background: #22c55e; border: 2px solid #dcfce7; border-radius: 50%; box-shadow: 0 0 0 2px #86efac; }
.card-label { margin: 0; color: var(--gold); font-size: 11px; font-weight: 850; letter-spacing: .1em; }
.dashboard-grid { display: grid; gap: 14px; }
.profile-card, .guide-card { padding: 20px; }
.profile-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.profile-heading h2 { margin-top: 6px; font-size: 24px; }
.status-text { color: var(--muted); font-size: 12px; font-weight: 700; white-space: nowrap; }
.profile-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; margin: 0; padding-top: 20px; }
.profile-list div { min-width: 0; }
.profile-list dt { color: var(--muted); font-size: 12px; }
.profile-list dd { margin: 5px 0 0; font-weight: 800; overflow-wrap: anywhere; }
.guide-card h2 { margin: 6px 0 18px; font-size: 21px; letter-spacing: -.03em; }
.guide-list { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.guide-list li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: start; }
.guide-list li > span { width: 28px; height: 28px; display: grid; place-items: center; color: var(--blue); background: var(--soft-blue); border-radius: 8px; font-size: 11px; font-weight: 900; }
.guide-list div { display: grid; gap: 3px; }
.guide-list strong { font-size: 13px; }
.guide-list small { color: var(--muted); line-height: 1.45; }
.guide-link { min-height: 44px; display: inline-flex; align-items: center; margin-top: 18px; color: var(--blue); font-size: 13px; font-weight: 800; text-underline-offset: 3px; }
.account-link-card, .account-help-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 6px 20px rgba(15,23,42,.05); }
.account-link-card { padding: 20px; }
.account-link-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.account-link-heading h2, .account-help-card h2 { margin: 6px 0 0; letter-spacing: -.03em; }
.account-link-heading h2 { font-size: 24px; }
.status-badge.compact { min-height: 28px; gap: 8px; }
.account-detail-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 14px; margin: 0; padding-top: 20px; }
.account-detail-list div { min-width: 0; }
.account-detail-list dt { color: var(--muted); font-size: 12px; }
.account-detail-list dd { margin: 5px 0 0; font-weight: 800; overflow-wrap: anywhere; }
.account-help-grid { display: grid; gap: 12px; margin-top: 14px; }
.account-help-card { padding: 18px; }
.account-help-card h2 { font-size: 18px; }
.account-help-card p:not(.card-label), .account-footnote { color: var(--muted); font-size: 13px; line-height: 1.6; }
.account-help-card a { min-height: 44px; display: inline-flex; align-items: center; color: var(--blue); font-size: 13px; font-weight: 800; text-underline-offset: 3px; }
.account-footnote { margin: 14px 2px 0; }
.empty-state { padding: 28px 0 4px; text-align: left; }
.empty-state p { margin: 7px 0 10px; color: var(--muted); line-height: 1.6; }
.inventory-card { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 6px 20px rgba(15,23,42,.05); padding: 20px; }
.inventory-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.inventory-heading h2 { margin: 6px 0 0; font-size: 24px; letter-spacing: -.03em; }
.inventory-owner { margin: 7px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.inventory-state { min-height: 156px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--muted); text-align: center; }
.inventory-state p { margin: 0; line-height: 1.6; }
.spinner.small { width: 24px; height: 24px; }
.inventory-list { display: grid; gap: 10px; margin: 0; padding: 20px 0 0; list-style: none; }
.inventory-item { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 16px; background: var(--soft-blue); border: 1px solid #d5e3fb; border-radius: 10px; }
.inventory-item-name { min-width: 0; color: var(--ink); font-weight: 800; line-height: 1.5; overflow-wrap: anywhere; }
.inventory-item-quantity { flex: 0 0 auto; color: var(--blue); font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 850; white-space: nowrap; }
.inventory-pagination { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--line); }
.inventory-pagination .secondary-button { min-width: 0; min-height: 44px; padding: 0 12px; }
.inventory-pagination p { margin: 0; color: var(--muted); font-size: 13px; font-weight: 700; text-align: center; }
.inventory-pagination #inventory-next-button { justify-self: end; }
.currencies-card { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 6px 20px rgba(15,23,42,.05); padding: 20px; }
.currencies-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.currencies-heading h2 { margin: 6px 0 0; font-size: 24px; letter-spacing: -.03em; }
.currencies-description { margin: 7px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.currencies-state { min-height: 156px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--muted); text-align: center; }
.currencies-state p { margin: 0; line-height: 1.6; }
.currencies-list { display: grid; gap: 10px; margin: 0; padding: 20px 0 0; list-style: none; }
.currency-item { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; padding: 16px; background: var(--soft-blue); border: 1px solid #d5e3fb; border-radius: 10px; }
.currency-name { min-width: 0; color: var(--ink); font-weight: 850; line-height: 1.5; overflow-wrap: anywhere; }
.currency-code { margin-top: 3px; color: var(--muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.currency-balance { min-width: 0; display: grid; align-content: center; justify-items: end; gap: 3px; color: var(--blue); font-variant-numeric: tabular-nums; font-weight: 850; text-align: right; }
.currency-balance strong { max-width: 100%; font-size: clamp(17px, 4vw, 24px); overflow-wrap: anywhere; }
.currency-balance small { color: var(--muted); font-size: 12px; font-weight: 700; }
.site-footer { min-height: 48px; display: grid; place-items: center; padding: 10px 20px; color: var(--muted); background: var(--canvas); border-top: 1px solid var(--line); text-align: center; font-size: 11px; }
.site-footer p { margin: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (min-width: 620px) {
  .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .account-help-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .page-heading { flex-direction: row; align-items: flex-start; justify-content: space-between; }
}
@media (min-width: 820px) {
  .login-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(390px, .82fr); margin-top: 48px; }
  .login-intro { display: flex; flex-direction: column; justify-content: center; padding: 50px; }
  .login-panel { display: flex; flex-direction: column; justify-content: center; padding: 46px 42px; }
  .app-shell { display: grid; grid-template-columns: 224px minmax(0, 1fr); align-items: start; gap: 26px; }
  .app-sidebar { position: sticky; top: 88px; align-self: start; grid-template-rows: auto auto auto; padding: 22px 16px; }
  .app-sidebar nav { grid-template-columns: 1fr; }
  .app-content { padding: 14px 0 36px; }
  .dashboard-grid { grid-template-columns: minmax(0, 1.75fr) minmax(250px, .75fr); align-items: start; }
  .profile-list { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 619px) {
  .site-header { align-items: flex-start; }
  .header-account-status { max-width: 58%; gap: 5px; }
  .header-balance-summary { justify-content: flex-end; }
  .header-balance-item { max-width: 100%; white-space: normal; }
  .app-shell { width: min(calc(100% - 24px), 720px); margin-top: 12px; }
  .app-sidebar { border-radius: 14px; }
  .nav-link { padding-inline: 11px; }
  .nav-link small { display: none; }
  .account-detail-list { grid-template-columns: 1fr; }
  .page-heading { margin-top: 24px; }
  .inventory-card { padding: 18px 14px; }
  .inventory-item { align-items: flex-start; flex-direction: column; gap: 6px; }
  .inventory-pagination { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .inventory-pagination p { grid-column: 1 / -1; grid-row: 1; }
  .inventory-pagination #inventory-prev-button { grid-column: 1; grid-row: 2; }
  .inventory-pagination #inventory-next-button { grid-column: 2; grid-row: 2; }
  .currencies-card { padding: 18px 14px; }
  .currency-item { grid-template-columns: 1fr; gap: 8px; }
  .currency-balance { justify-items: start; text-align: left; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
}
`;

export const USER_SHELL_CLIENT = String.raw`
(function () {
  "use strict";

  var state = { csrfToken: "", session: null, profile: null, inventoryOffset: 0, inventoryLimit: 20, inventory: null };
  var loadingView = document.getElementById("loading-view");
  var loginView = document.getElementById("login-view");
  var appView = document.getElementById("app-view");
  var homeContent = document.getElementById("home-content");
  var accountContent = document.getElementById("account-content");
  var inventoryContent = document.getElementById("inventory-content");
  var currenciesContent = document.getElementById("currencies-content");
  var navHome = document.getElementById("nav-home");
  var navAccount = document.getElementById("nav-account");
  var navInventory = document.getElementById("nav-inventory");
  var navCurrencies = document.getElementById("nav-currencies");
  var requestedPath = window.location && window.location.pathname ? window.location.pathname : "/app";
  var loginForm = document.getElementById("login-form");
  var loginButton = document.getElementById("login-button");
  var loginIdInput = document.getElementById("login-id");
  var passwordInput = document.getElementById("password");
  var errorSummary = document.getElementById("login-error-summary");
  var errorMessage = document.getElementById("login-error-message");
  var sessionNotice = document.getElementById("login-session-notice");
  var sessionMessage = document.getElementById("login-session-message");
  var appError = document.getElementById("app-error");
  var appErrorMessage = document.getElementById("app-error-message");
  var logoutButton = document.getElementById("logout-button");
  var retryButton = document.getElementById("retry-button");
  var inventoryRetryButton = document.getElementById("inventory-retry-button");
  var inventoryPrevButton = document.getElementById("inventory-prev-button");
  var inventoryNextButton = document.getElementById("inventory-next-button");
  var liveStatus = document.getElementById("live-status");

  function text(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = value == null || value === "" ? "—" : String(value);
  }

  function announce(message) {
    liveStatus.textContent = "";
    window.setTimeout(function () { liveStatus.textContent = message; }, 10);
  }

  function setView(name) {
    loadingView.hidden = name !== "loading";
    loginView.hidden = name !== "login";
    appView.hidden = name !== "app";
    text("header-session", name === "app" ? "로그인됨" : name === "loading" ? "세션 확인 중" : "로그인 필요");
  }

  function setAppSection(name) {
    var account = name === "account";
    var inventory = name === "inventory";
    var currencies = name === "currencies";
    homeContent.hidden = account || inventory || currencies;
    accountContent.hidden = !account;
    inventoryContent.hidden = !inventory;
    currenciesContent.hidden = !currencies;
    [[navHome, !account && !inventory && !currencies], [navAccount, account], [navInventory, inventory], [navCurrencies, currencies]].forEach(function (entry) {
      entry[0].setAttribute("class", entry[1] ? "nav-link active" : "nav-link");
      if (entry[1]) entry[0].setAttribute("aria-current", "page");
      else entry[0].removeAttribute("aria-current");
    });
  }

  function setBusy(button, busy, busyText, normalText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : normalText;
  }

  function clearLoginErrors() {
    errorSummary.hidden = true;
    [loginIdInput, passwordInput].forEach(function (input) { input.removeAttribute("aria-invalid"); });
    ["login-id-error", "password-error"].forEach(function (id) {
      var error = document.getElementById(id);
      error.hidden = true;
      error.textContent = "";
    });
  }

  function hideSessionNotice() {
    sessionNotice.hidden = true;
    sessionMessage.textContent = "";
  }

  function showSessionNotice(message) {
    sessionMessage.textContent = message;
    sessionNotice.hidden = false;
    sessionNotice.focus();
  }

  function showFieldError(input, errorId, message) {
    input.setAttribute("aria-invalid", "true");
    var error = document.getElementById(errorId);
    error.textContent = message;
    error.hidden = false;
  }

  function showLoginError(message) {
    errorMessage.textContent = message;
    errorSummary.hidden = false;
    errorSummary.focus();
  }

  function readApiError(response, payload) {
    var error = payload && payload.error ? payload.error : {};
    var code = String(error.code || payload.code || "");
    var messages = {
      KAKAO_LINK_REQUIRED: "카카오톡 인증이 필요해요. 회원가입 화면에서 인증 상태를 확인해 주세요.",
      ACCOUNT_DELETION_GRACE: "탈퇴 유예 중인 계정이에요. 복구 절차를 확인해 주세요.",
      ACCOUNT_DELETION_PENDING: "탈퇴 유예 중인 계정이에요. 복구 절차를 확인해 주세요.",
      ACCOUNT_TEMPORARILY_LOCKED: "로그인 시도가 잠겼어요. 15분 뒤 다시 시도해 주세요.",
      ACCOUNT_LOCKED: "로그인 시도가 잠겼어요. 15분 뒤 다시 시도해 주세요.",
      RATE_LIMITED: "요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요."
    };
    if (messages[code]) return messages[code];
    if (response.status === 401) return "ID 또는 비밀번호를 확인해 주세요.";
    if (response.status === 423) return "로그인 시도가 잠겼어요. 15분 뒤 다시 시도해 주세요.";
    if (response.status === 429) return "요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.";
    return "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  async function api(url, options) {
    var response = await fetch(url, Object.assign({ credentials: "same-origin" }, options || {}));
    var payload = response.status === 204 ? {} : await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(readApiError(response, payload));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function profileDisplayName(profile) {
    return profile && (profile.displayName || profile.nickname || profile.name || profile.playerName);
  }

  function profileServerName(profile) {
    if (!profile) return null;
    if (profile.server && typeof profile.server === "object") return profile.server.displayName || profile.server.code;
    return profile.serverName || profile.server;
  }

  function profileEntries(profile) {
    if (!profile || typeof profile !== "object") return [];
    var candidates = [
      ["닉네임", profileDisplayName(profile)],
      ["레벨", profile.level],
      ["누적 레벨", profile.accumulatedLevel],
      ["서버", profileServerName(profile)]
    ];
    return candidates.filter(function (entry) { return entry[1] !== undefined && entry[1] !== null && entry[1] !== ""; });
  }

  function maskLoginId(loginId) {
    var value = String(loginId || "");
    if (value.length <= 3) return value ? value.charAt(0) + "**" : "—";
    return value.slice(0, 3) + "*".repeat(Math.min(5, value.length - 3));
  }

  function clearSensitiveView() {
    state.inventory = null;
    state.inventoryOffset = 0;
    state.inventoryLimit = 20;
    ["account-login-id", "account-id", "system-account-name", "player-id", "account-name", "link-login-id", "link-system-account", "link-player-name", "link-player-server"].forEach(function (id) { text(id, "—"); });
    var list = document.getElementById("profile-list");
    list.replaceChildren();
    list.hidden = true;
    document.getElementById("profile-empty").hidden = true;
    document.getElementById("inventory-list").replaceChildren();
    document.getElementById("inventory-list").hidden = true;
    document.getElementById("inventory-empty").hidden = true;
    document.getElementById("inventory-error").hidden = true;
    document.getElementById("inventory-pagination").hidden = true;
    text("inventory-owner", "");
    text("inventory-count", "조회 준비 중");
    text("inventory-state", "조회 중");
    document.getElementById("currencies-list").replaceChildren();
    document.getElementById("currencies-list").hidden = true;
    document.getElementById("currencies-empty").hidden = true;
    document.getElementById("currencies-error").hidden = true;
    document.getElementById("currencies-loading").hidden = true;
    text("currencies-count", "조회 준비 중");
    text("currencies-state", "조회 중");
    renderHeaderBalances(null);
    appError.hidden = true;
  }

  function renderInventory(payload) {
    var list = document.getElementById("inventory-list");
    var empty = document.getElementById("inventory-empty");
    var pagination = payload && payload.pagination ? payload.pagination : {};
    var items = payload && Array.isArray(payload.items) ? payload.items : [];
    var total = Number(pagination.total || 0);
    text("inventory-owner", payload && payload.ownerLabel ? payload.ownerLabel + "의 가방" : "현재 연결된 계정의 가방");
    text("inventory-count", total + "개 항목");
    text("inventory-state", "조회 완료");
    state.inventoryLimit = Number(pagination.limit) > 0 ? Number(pagination.limit) : 20;
    text("inventory-page-status", total ? Math.floor(Number(pagination.offset || 0) / state.inventoryLimit) + 1 + " 페이지 / " + total + "개" : "가방이 비어 있어요");
    list.replaceChildren();
    items.forEach(function (item) {
      var row = document.createElement("li");
      var name = document.createElement("span");
      var quantity = document.createElement("span");
      row.setAttribute("class", "inventory-item");
      name.setAttribute("class", "inventory-item-name");
      quantity.setAttribute("class", "inventory-item-quantity");
      name.textContent = String(item && item.displayName || "이름 없는 아이템");
      quantity.textContent = "수량 " + String(item && item.quantity || "0");
      row.append(name, quantity);
      list.append(row);
    });
    empty.hidden = items.length > 0;
    list.hidden = items.length === 0;
    pagination = payload && payload.pagination ? payload.pagination : {};
    document.getElementById("inventory-pagination").hidden = total === 0;
    inventoryPrevButton.disabled = Number(pagination.offset || 0) <= 0;
    inventoryNextButton.disabled = !pagination.hasMore;
    inventoryPrevButton.setAttribute("aria-disabled", inventoryPrevButton.disabled ? "true" : "false");
    inventoryNextButton.setAttribute("aria-disabled", inventoryNextButton.disabled ? "true" : "false");
  }

  function currencyLabel(code) {
    var labels = { point: "포인트", diamond: "다이아" };
    var value = String(code == null ? "" : code);
    return labels[value] || value || "알 수 없는 재화";
  }

  function renderHeaderBalances(profile) {
    var summary = document.getElementById("header-balance-summary");
    var accounts = profile && Array.isArray(profile.currencyAccounts) ? profile.currencyAccounts : [];
    var accountByCode = {};
    accounts.forEach(function (account) {
      if (account && (account.code === "point" || account.code === "diamond")) accountByCode[account.code] = account;
    });
    ["point", "diamond"].forEach(function (code) {
      var item = document.getElementById("header-" + code + "-balance");
      var value = document.getElementById("header-" + code + "-balance-value");
      var account = accountByCode[code];
      if (value) value.textContent = account && account.balance != null ? String(account.balance) : "";
      if (item) item.hidden = !account;
    });
    summary.hidden = !accountByCode.point && !accountByCode.diamond;
  }

  function renderCurrencies(profile, failed) {
    var card = document.querySelector ? document.querySelector(".currencies-card") : null;
    var loading = document.getElementById("currencies-loading");
    var list = document.getElementById("currencies-list");
    var empty = document.getElementById("currencies-empty");
    var errorView = document.getElementById("currencies-error");
    var accounts = profile && Array.isArray(profile.currencyAccounts) ? profile.currencyAccounts : [];
    loading.hidden = true;
    list.replaceChildren();
    empty.hidden = true;
    errorView.hidden = true;
    if (card) card.setAttribute("aria-busy", "false");
    if (failed) {
      text("currencies-count", "조회 실패");
      text("currencies-state", "조회 실패");
      document.getElementById("currencies-error-message").textContent = "프로필 정보를 불러오지 못해 재화를 표시할 수 없어요. 잠시 후 다시 시도해 주세요.";
      errorView.hidden = false;
      return;
    }
    if (!profile) {
      text("currencies-count", "정보 없음");
      text("currencies-state", "정보 없음");
      empty.hidden = false;
      return;
    }
    accounts.forEach(function (account) {
      var row = document.createElement("li");
      var identity = document.createElement("div");
      var name = document.createElement("strong");
      var code = document.createElement("small");
      var balance = document.createElement("div");
      var value = document.createElement("strong");
      var label = document.createElement("small");
      var currencyCode = account && account.code;
      row.setAttribute("class", "currency-item");
      name.setAttribute("class", "currency-name");
      code.setAttribute("class", "currency-code");
      balance.setAttribute("class", "currency-balance");
      name.textContent = currencyLabel(currencyCode);
      code.textContent = String(currencyCode == null || currencyCode === "" ? "unknown" : currencyCode);
      value.textContent = String(account && account.balance != null ? account.balance : "0");
      label.textContent = "현재 잔액";
      identity.append(name, code);
      balance.append(value, label);
      row.append(identity, balance);
      list.append(row);
    });
    text("currencies-count", accounts.length + "종");
    text("currencies-state", accounts.length ? "조회 완료" : "정보 없음");
    empty.hidden = accounts.length !== 0;
    list.hidden = accounts.length === 0;
  }

  async function loadInventory() {
    var card = document.querySelector ? document.querySelector(".inventory-card") : null;
    var loading = document.getElementById("inventory-loading");
    var errorView = document.getElementById("inventory-error");
    loading.hidden = false;
    errorView.hidden = true;
    document.getElementById("inventory-empty").hidden = true;
    document.getElementById("inventory-list").hidden = true;
    if (card) card.setAttribute("aria-busy", "true");
    text("inventory-state", "조회 중");
    try {
      var payload = await api("/api/v1/inventory/current?limit=" + state.inventoryLimit + "&offset=" + state.inventoryOffset);
      state.inventory = payload;
      renderInventory(payload);
      announce(Number(payload.pagination && payload.pagination.total || 0) ? "가방 항목 " + Number(payload.pagination && payload.pagination.total || 0) + "개를 표시합니다." : "가방이 비어 있어요.");
    } catch (error) {
      if (error.status === 401) {
        showLogin("세션이 만료됐어요. 계속 이용하려면 다시 로그인해 주세요.", true);
        return false;
      }
      state.inventory = null;
      text("inventory-state", "조회 실패");
      document.getElementById("inventory-error-message").textContent = error.message || "가방을 불러오지 못했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.";
      errorView.hidden = false;
      announce("가방을 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      loading.hidden = true;
      if (card) card.setAttribute("aria-busy", "false");
    }
  }

  function renderProfile(profile) {
    var list = document.getElementById("profile-list");
    var empty = document.getElementById("profile-empty");
    var entries = profileEntries(profile);
    text("link-player-name", profileDisplayName(profile));
    text("link-player-server", profileServerName(profile));
    list.replaceChildren();
    if (!entries.length) {
      list.hidden = true;
      empty.hidden = false;
      text("profile-state", "정보 없음");
      return;
    }
    entries.forEach(function (entry) {
      var wrapper = document.createElement("div");
      var term = document.createElement("dt");
      var value = document.createElement("dd");
      term.textContent = entry[0];
      value.textContent = String(entry[1]);
      wrapper.append(term, value);
      list.append(wrapper);
    });
    empty.hidden = true;
    list.hidden = false;
    text("profile-state", "조회 완료");
  }

  function renderSession() {
    var session = state.session || {};
    text("account-login-id", maskLoginId(session.loginId));
    text("account-id", "웹 계정 연결 확인됨");
    text("system-account-name", session.systemAccountName);
    text("player-id", session.playerId ? "게임계정 연결 확인됨" : "게임계정 연결 확인 필요");
    text("account-name", session.systemAccountName ? session.systemAccountName + " 계정으로 로그인했어요." : "로그인한 계정 정보를 확인하세요.");
    text("link-login-id", maskLoginId(session.loginId));
    text("link-system-account", session.systemAccountName);
    renderProfile(state.profile);
    renderCurrencies(state.profile, false);
    renderHeaderBalances(state.profile);
  }

  async function loadProfile() {
    appError.hidden = true;
    text("profile-state", "조회 중");
    text("currencies-state", "조회 중");
    document.getElementById("currencies-loading").hidden = false;
    var currenciesCard = document.querySelector ? document.querySelector(".currencies-card") : null;
    if (currenciesCard) currenciesCard.setAttribute("aria-busy", "true");
    var profileError = null;
    try {
      var payload = await api("/api/v1/player-profiles/current");
      state.profile = payload.profile;
      renderProfile(state.profile);
    } catch (error) {
      if (error.status === 401) {
        showLogin("세션이 만료됐어요. 계속 이용하려면 다시 로그인해 주세요.", true);
        return false;
      }
      state.profile = null;
      renderProfile(null);
      renderCurrencies(null, error.status !== 404);
      if (error.status !== 404) profileError = error;
    }

    try {
      var refreshed = await api("/api/v1/sessions/current");
      state.session = refreshed.session;
      state.csrfToken = refreshed.csrfToken || "";
      renderSession();
    } catch (error) {
      if (error.status === 401) {
        showLogin("세션이 만료됐어요. 계속 이용하려면 다시 로그인해 주세요.", true);
        return;
      }
      profileError = error;
    }

    if (profileError) {
      appErrorMessage.textContent = profileError.message;
      appError.hidden = false;
    }
    return true;
  }

  async function showAuthenticated(sessionPayload) {
    state.session = sessionPayload.session;
    state.csrfToken = sessionPayload.csrfToken || "";
    state.profile = null;
    setView("app");
    var accountRoute = /^\/account(?:\/links)?\/?$/.test(requestedPath);
    var inventoryRoute = /^\/account\/inventory\/?$/.test(requestedPath);
    var currenciesRoute = /^\/account\/currencies\/?$/.test(requestedPath);
    setAppSection(currenciesRoute ? "currencies" : inventoryRoute ? "inventory" : accountRoute ? "account" : "home");
    renderSession();
    window.history.replaceState({}, "", currenciesRoute ? "/account/currencies" : inventoryRoute ? "/account/inventory" : accountRoute ? "/account" : "/app");
    document.getElementById(currenciesRoute ? "currencies-title" : inventoryRoute ? "inventory-title" : accountRoute ? "account-title" : "welcome-title").focus();
    var profileLoaded = await loadProfile();
    if (inventoryRoute && profileLoaded) await loadInventory();
    if (!inventoryRoute) announce(currenciesRoute ? "현재 보유 재화를 표시합니다." : accountRoute ? "연결된 계정 정보를 표시합니다." : "로그인했습니다. 계정 요약을 표시합니다.");
  }

  function showLogin(message, visibleNotice) {
    state.csrfToken = "";
    state.session = null;
    state.profile = null;
    clearSensitiveView();
    setView("login");
    window.history.replaceState({}, "", "/login");
    document.getElementById("login-title").focus();
    hideSessionNotice();
    if (visibleNotice && message) showSessionNotice(message);
    if (message) announce(message);
  }

  async function restoreSession() {
    setView("loading");
    try {
      var payload = await api("/api/v1/sessions/current");
      await showAuthenticated(payload);
    } catch (error) {
      if (error.status === 401) showLogin("로그인이 필요합니다.");
      else {
        showLogin();
        showLoginError("세션을 확인하지 못했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.");
      }
    }
  }

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    hideSessionNotice();
    clearLoginErrors();
    var loginId = loginIdInput.value.trim();
    var password = passwordInput.value;
    var invalid = false;
    if (!/^[a-z0-9]{6,20}$/.test(loginId)) { showFieldError(loginIdInput, "login-id-error", "영문 소문자와 숫자 6~20자로 입력해 주세요."); invalid = true; }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) { showFieldError(passwordInput, "password-error", "영문과 숫자를 포함해 8자 이상 입력해 주세요."); invalid = true; }
    if (invalid) { showLoginError("입력하지 않았거나 형식이 맞지 않는 항목이 있어요."); return; }

    setBusy(loginButton, true, "로그인 중…", "로그인");
    try {
      var payload = await api("/api/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId: loginId, password: password })
      });
      passwordInput.value = "";
      await showAuthenticated(payload);
    } catch (error) {
      passwordInput.value = "";
      showLoginError(error.message || "로그인하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(loginButton, false, "로그인 중…", "로그인");
    }
  });

  logoutButton.addEventListener("click", async function () {
    appError.hidden = true;
    setBusy(logoutButton, true, "로그아웃 중…", "로그아웃");
    try {
      try {
        await api("/api/v1/sessions/current", { method: "DELETE", headers: { "x-csrf-token": state.csrfToken } });
      } catch (error) {
        if (error.status === 401) { showLogin("세션이 이미 만료됐어요. 계속 이용하려면 다시 로그인해 주세요.", true); return; }
        if (error.status !== 403) throw error;
        var refreshed = await api("/api/v1/sessions/current");
        state.csrfToken = refreshed.csrfToken || "";
        await api("/api/v1/sessions/current", { method: "DELETE", headers: { "x-csrf-token": state.csrfToken } });
      }
      showLogin("안전하게 로그아웃했어요.", true);
    } catch (error) {
      if (error.status === 401) {
        showLogin("세션이 이미 만료됐어요. 계속 이용하려면 다시 로그인해 주세요.", true);
        return;
      }
      appErrorMessage.textContent = error.message || "로그아웃하지 못했어요. 다시 시도해 주세요.";
      appError.hidden = false;
      announce("로그아웃하지 못했습니다.");
    } finally {
      setBusy(logoutButton, false, "로그아웃 중…", "로그아웃");
    }
  });

  retryButton.addEventListener("click", loadProfile);
  inventoryRetryButton.addEventListener("click", loadInventory);
  inventoryPrevButton.addEventListener("click", function () {
    state.inventoryOffset = Math.max(0, state.inventoryOffset - state.inventoryLimit);
    loadInventory();
  });
  inventoryNextButton.addEventListener("click", function () {
    state.inventoryOffset += state.inventoryLimit;
    loadInventory();
  });
  restoreSession();
}());
`;
