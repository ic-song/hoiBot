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
    <p id="header-session" class="header-session" aria-live="polite">세션 확인 중</p>
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
        <h1 id="login-title" tabindex="-1">내 호이월드를<br>한곳에서 확인하세요.</h1>
        <p class="intro-copy">카카오톡에서 연결한 계정으로 게임 정보와 연결 상태를 안전하게 확인할 수 있어요.</p>
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
        <div>
          <p class="eyebrow">MY HOI WORLD</p>
          <h1 id="welcome-title" tabindex="-1">내 호이월드</h1>
          <p id="account-name" class="sidebar-copy"></p>
        </div>
        <nav aria-label="내 정보">
          <a class="nav-link active" href="/app" aria-current="page">홈</a>
          <span class="nav-link disabled" aria-disabled="true">계정 연결 <small>준비 중</small></span>
          <span class="nav-link disabled" aria-disabled="true">가방 <small>준비 중</small></span>
          <span class="nav-link disabled" aria-disabled="true">재화 <small>준비 중</small></span>
        </nav>
        <button id="logout-button" class="secondary-button" type="button">로그아웃</button>
      </aside>

      <div class="app-content">
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
        </section>

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
  background: #f8fafc;
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
  --canvas: #f8fafc;
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
.site-header { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px clamp(18px, 4vw, 48px); color: #fff; background: var(--navy); }
.brand { min-height: 44px; display: inline-flex; align-items: center; gap: 11px; color: #fff; text-decoration: none; }
.brand-mark { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; background: var(--gold); font-weight: 900; }
.brand > span:last-child { display: grid; gap: 1px; }
.brand strong { font-size: 15px; letter-spacing: -.01em; }
.brand small { color: #cbd5e1; font-size: 11px; }
.header-session { margin: 0; color: #cbd5e1; font-size: 12px; }
main { min-height: calc(100vh - 116px); }
.state-view { min-height: calc(100vh - 116px); display: grid; place-content: center; justify-items: center; gap: 10px; padding: 32px 20px; text-align: center; }
.state-view h1 { margin: 4px 0 0; font-size: clamp(24px, 6vw, 34px); letter-spacing: -.04em; }
.state-view p { max-width: 34rem; margin: 0; color: var(--muted); line-height: 1.65; }
.spinner { width: 28px; height: 28px; border: 3px solid #dbe3ec; border-top-color: var(--blue); border-radius: 50%; animation: spin .8s linear infinite; }
.login-layout { min-height: calc(100vh - 116px); background: var(--surface); }
.login-intro { padding: 48px 22px 38px; color: #fff; background: linear-gradient(145deg, var(--navy), #162b59); }
.eyebrow { margin: 0 0 12px; color: #d8c89b; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
.eyebrow.dark { color: var(--gold); }
.login-intro h1 { max-width: 640px; margin: 0; font-size: clamp(36px, 10vw, 62px); line-height: 1.08; letter-spacing: -.055em; }
.intro-copy { max-width: 570px; margin: 22px 0 30px; color: #dbe6ff; line-height: 1.7; }
.trust-list { display: grid; gap: 13px; max-width: 600px; margin: 0; padding: 0; list-style: none; }
.trust-list li { display: grid; grid-template-columns: 36px 1fr; gap: 12px; align-items: start; }
.trust-list li > span { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.32); border-radius: 50%; font-size: 10px; font-weight: 800; }
.trust-list div { display: grid; gap: 3px; }
.trust-list strong { font-size: 14px; }
.trust-list small { color: #bdcbed; line-height: 1.5; }
.login-panel { width: min(100%, 34rem); margin: 0 auto; padding: 38px 22px 48px; }
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
.error-summary, .inline-notice { margin-bottom: 20px; padding: 14px 15px; color: var(--danger); background: var(--danger-bg); border-left: 4px solid var(--danger); border-radius: 8px; }
.error-summary strong, .inline-notice strong { font-size: 14px; }
.error-summary p, .inline-notice p { margin: 5px 0 0; font-size: 13px; line-height: 1.55; }
.app-shell { width: min(1180px, 100%); margin: 0 auto; background: var(--canvas); }
.app-sidebar { display: grid; gap: 22px; padding: 28px 20px; color: #fff; background: var(--navy); }
.app-sidebar h1 { margin: 0; font-size: 30px; letter-spacing: -.04em; }
.sidebar-copy { margin: 8px 0 0; color: #cbd5e1; font-size: 14px; line-height: 1.5; }
.app-sidebar nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.nav-link { min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 13px; color: #e2e8f0; border: 1px solid #334155; border-radius: 9px; text-decoration: none; font-size: 13px; font-weight: 700; }
.nav-link.active { color: #fff; background: var(--blue); border-color: #3154a9; }
.nav-link.disabled { color: #94a3b8; cursor: default; }
.nav-link small { font-size: 10px; font-weight: 500; }
.app-sidebar .secondary-button { width: 100%; color: #fff; background: transparent; border-color: #64748b; }
.app-content { padding: 30px 20px 52px; }
.page-heading { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 22px; }
.page-heading h2 { font-size: clamp(28px, 6vw, 40px); }
.page-heading p { margin-bottom: 0; }
.status-badge { display: inline-flex; align-items: center; min-height: 32px; padding: 0 11px; color: var(--success); background: var(--success-bg); border: 1px solid #a7d7b5; border-radius: 999px; font-size: 12px; font-weight: 800; }
.inline-notice { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.summary-grid { display: grid; gap: 12px; margin-bottom: 14px; }
.summary-card, .profile-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 7px 24px rgba(15,23,42,.06); }
.summary-card { min-height: 132px; display: grid; align-content: center; gap: 7px; padding: 22px; }
.summary-card strong { font-size: 22px; overflow-wrap: anywhere; }
.summary-card small { color: var(--muted); line-height: 1.5; }
.card-label { margin: 0; color: var(--gold); font-size: 11px; font-weight: 850; letter-spacing: .1em; }
.profile-card { padding: 22px; }
.profile-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.profile-heading h2 { margin-top: 6px; font-size: 24px; }
.status-text { color: var(--muted); font-size: 12px; font-weight: 700; white-space: nowrap; }
.profile-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; margin: 0; padding-top: 20px; }
.profile-list div { min-width: 0; }
.profile-list dt { color: var(--muted); font-size: 12px; }
.profile-list dd { margin: 5px 0 0; font-weight: 800; overflow-wrap: anywhere; }
.empty-state { padding: 28px 0 4px; text-align: left; }
.empty-state p { margin: 7px 0 10px; color: var(--muted); line-height: 1.6; }
.site-footer { min-height: 48px; display: grid; place-items: center; padding: 10px 20px; color: var(--muted); background: var(--canvas); border-top: 1px solid var(--line); text-align: center; font-size: 11px; }
.site-footer p { margin: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (min-width: 620px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .page-heading { flex-direction: row; align-items: flex-start; justify-content: space-between; }
}
@media (min-width: 820px) {
  .login-layout { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(420px, .92fr); }
  .login-intro { display: flex; flex-direction: column; justify-content: center; padding: clamp(56px, 7vw, 96px); }
  .login-panel { display: flex; flex-direction: column; justify-content: center; padding: 54px clamp(42px, 5vw, 72px); }
  .app-shell { min-height: calc(100vh - 116px); display: grid; grid-template-columns: 260px minmax(0, 1fr); }
  .app-sidebar { align-content: start; grid-template-rows: auto 1fr auto; padding: 42px 22px 28px; }
  .app-sidebar nav { grid-template-columns: 1fr; }
  .app-content { padding: 48px clamp(34px, 5vw, 68px) 72px; }
  .profile-list { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
}
`;

export const USER_SHELL_CLIENT = String.raw`
(function () {
  "use strict";

  var state = { csrfToken: "", session: null, profile: null };
  var loadingView = document.getElementById("loading-view");
  var loginView = document.getElementById("login-view");
  var appView = document.getElementById("app-view");
  var loginForm = document.getElementById("login-form");
  var loginButton = document.getElementById("login-button");
  var loginIdInput = document.getElementById("login-id");
  var passwordInput = document.getElementById("password");
  var errorSummary = document.getElementById("login-error-summary");
  var errorMessage = document.getElementById("login-error-message");
  var appError = document.getElementById("app-error");
  var appErrorMessage = document.getElementById("app-error-message");
  var logoutButton = document.getElementById("logout-button");
  var retryButton = document.getElementById("retry-button");
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

  function profileEntries(profile) {
    if (!profile || typeof profile !== "object") return [];
    var candidates = [
      ["닉네임", profile.nickname || profile.name || profile.playerName],
      ["레벨", profile.level],
      ["티어", profile.tier || profile.rank],
      ["서버", profile.serverName || profile.server]
    ];
    return candidates.filter(function (entry) { return entry[1] !== undefined && entry[1] !== null && entry[1] !== ""; });
  }

  function maskLoginId(loginId) {
    var value = String(loginId || "");
    if (value.length <= 3) return value ? value.charAt(0) + "**" : "—";
    return value.slice(0, 3) + "*".repeat(Math.min(5, value.length - 3));
  }

  function clearSensitiveView() {
    ["account-login-id", "account-id", "system-account-name", "player-id", "account-name"].forEach(function (id) { text(id, "—"); });
    var list = document.getElementById("profile-list");
    list.replaceChildren();
    list.hidden = true;
    document.getElementById("profile-empty").hidden = true;
    appError.hidden = true;
  }

  function renderProfile(profile) {
    var list = document.getElementById("profile-list");
    var empty = document.getElementById("profile-empty");
    var entries = profileEntries(profile);
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
    renderProfile(state.profile);
  }

  async function loadProfile() {
    appError.hidden = true;
    text("profile-state", "조회 중");
    var profileError = null;
    try {
      var payload = await api("/api/v1/player-profiles/current");
      state.profile = payload.profile;
      renderProfile(state.profile);
    } catch (error) {
      if (error.status === 401) {
        showLogin("세션이 만료됐어요. 다시 로그인해 주세요.");
        return;
      }
      state.profile = null;
      renderProfile(null);
      if (error.status !== 404) profileError = error;
    }

    try {
      var refreshed = await api("/api/v1/sessions/current");
      state.session = refreshed.session;
      state.csrfToken = refreshed.csrfToken || "";
      renderSession();
    } catch (error) {
      if (error.status === 401) {
        showLogin("세션이 만료됐어요. 다시 로그인해 주세요.");
        return;
      }
      profileError = error;
    }

    if (profileError) {
      appErrorMessage.textContent = profileError.message;
      appError.hidden = false;
    }
  }

  async function showAuthenticated(sessionPayload) {
    state.session = sessionPayload.session;
    state.csrfToken = sessionPayload.csrfToken || "";
    state.profile = null;
    setView("app");
    renderSession();
    window.history.replaceState({}, "", "/app");
    document.getElementById("welcome-title").focus();
    await loadProfile();
    announce("로그인했습니다. 계정 요약을 표시합니다.");
  }

  function showLogin(message) {
    state.csrfToken = "";
    state.session = null;
    state.profile = null;
    clearSensitiveView();
    setView("login");
    window.history.replaceState({}, "", "/login");
    document.getElementById("login-title").focus();
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
        if (error.status === 401) { showLogin("세션이 이미 만료됐어요."); return; }
        if (error.status !== 403) throw error;
        var refreshed = await api("/api/v1/sessions/current");
        state.csrfToken = refreshed.csrfToken || "";
        await api("/api/v1/sessions/current", { method: "DELETE", headers: { "x-csrf-token": state.csrfToken } });
      }
      showLogin("로그아웃했습니다.");
    } catch (error) {
      if (error.status === 401) {
        showLogin("세션이 이미 만료됐어요.");
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
  restoreSession();
}());
`;
