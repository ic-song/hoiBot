export const SITE_SIGNUP_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>호이월드 회원가입</title>
  <link rel="stylesheet" href="/signup/assets/signup.css">
</head>
<body>
  <a class="skip-link" href="#signup-main">본문으로 바로가기</a>
  <header class="site-header" aria-label="호이월드">
    <a class="brand" href="/signup" aria-label="호이월드 회원가입 홈"><span aria-hidden="true">H</span>호이월드</a>
  </header>

  <main id="signup-main" class="signup-layout">
    <section class="intro" aria-labelledby="signup-title">
      <p class="eyebrow">HOI WORLD ACCOUNT</p>
      <h1 id="signup-title">웹에서 가입하고<br>카카오톡에서 인증하세요.</h1>
      <p class="intro-copy">계정 생성 후 표시되는 8자리 코드를 호이봇이 있는 카카오톡 채팅방에 입력하면 가입이 완료됩니다.</p>
      <ol class="steps" aria-label="가입 순서">
        <li><span>1</span><div><strong>웹 계정 만들기</strong><small>로그인 정보와 시스템 계정 이름 입력</small></div></li>
        <li><span>2</span><div><strong>인증 코드 받기</strong><small>30분 동안 사용할 수 있는 8자리 코드</small></div></li>
        <li><span>3</span><div><strong>카카오톡 인증</strong><small><code>/인증 ABCD2345</code> 형식으로 전송</small></div></li>
      </ol>
    </section>

    <section class="signup-card" aria-labelledby="form-title">
      <div id="form-view">
        <p class="card-kicker">STEP 1</p>
        <h2 id="form-title">호이월드 계정 만들기</h2>
        <p class="card-copy">모든 항목을 입력해 주세요.</p>
        <form id="signup-form" novalidate>
          <div class="field">
            <label for="login-id">로그인 ID</label>
            <input id="login-id" name="loginId" autocomplete="username" inputmode="latin" autocapitalize="none" spellcheck="false" minlength="6" maxlength="20" required aria-describedby="login-help">
            <small id="login-help">영문 소문자와 숫자 6~20자</small>
          </div>
          <div class="field">
            <label for="password">비밀번호</label>
            <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="64" required aria-describedby="password-help">
            <small id="password-help">영문과 숫자를 포함한 8~64자</small>
          </div>
          <div class="field">
            <label for="account-name">시스템 계정 이름</label>
            <input id="account-name" name="systemAccountName" autocomplete="nickname" placeholder="예: 호이 남" required aria-describedby="account-help">
            <small id="account-help">한글 두 글자, 공백, 남 또는 여 형식</small>
          </div>
          <label class="terms" for="accept-terms">
            <input id="accept-terms" name="acceptTerms" type="checkbox" required>
            <span>호이월드 이용약관과 계정 운영 정책에 동의합니다.</span>
          </label>
          <p id="form-error" class="message error" role="alert" hidden></p>
          <button id="submit-button" class="primary-button" type="submit">인증 코드 받기</button>
        </form>
      </div>

      <div id="verification-view" class="verification-view" hidden>
        <p class="card-kicker">STEP 2</p>
        <h2 tabindex="-1">카카오톡에서 인증해 주세요</h2>
        <p class="card-copy"><strong id="account-name-summary"></strong> 계정의 인증 코드입니다.</p>
        <div class="code-box" aria-label="카카오톡 인증 코드">
          <span id="verification-code"></span>
          <button id="copy-button" class="secondary-button" type="button">코드 복사</button>
        </div>
        <div class="command-box"><span>카카오톡에 입력</span><code id="verification-command"></code></div>
        <p id="expires-at" class="expires"></p>
        <p id="verification-status" class="message status" role="status" aria-live="polite">카카오톡 인증을 기다리고 있어요.</p>
        <div class="actions">
          <button id="check-button" class="primary-button" type="button">인증 상태 확인</button>
          <button id="reissue-button" class="secondary-button" type="button">새 코드 발급</button>
        </div>
      </div>
    </section>
  </main>
  <script src="/signup/assets/signup.js" defer></script>
</body>
</html>`;

export const SITE_SIGNUP_STYLES = String.raw`
:root {
  color: #0f172a;
  background: #f8fafc;
  font-family: Pretendard, "Apple SD Gothic Neo", system-ui, sans-serif;
  font-synthesis: none;
  --ink: #0f172a;
  --muted: #64748b;
  --line: #dbe3ec;
  --surface: #ffffff;
  --primary: #1e3a8a;
  --primary-dark: #172e6d;
  --accent: #a16207;
  --soft: #eef4ff;
  --danger: #b42318;
  --success: #166534;
}
* { box-sizing: border-box; }
html { min-width: 320px; }
body { min-height: 100vh; margin: 0; background: var(--surface); color: var(--ink); }
button, input { font: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }
.skip-link { position: fixed; top: 8px; left: 8px; z-index: 10; transform: translateY(-150%); padding: 10px 14px; background: #fff; color: var(--ink); border: 2px solid var(--primary); border-radius: 8px; }
.skip-link:focus { transform: translateY(0); }
.site-header { height: 64px; display: flex; align-items: center; padding: 0 20px; border-bottom: 1px solid var(--line); }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); font-weight: 800; text-decoration: none; }
.brand span { display: grid; place-items: center; width: 34px; height: 34px; color: #fff; background: var(--primary); border-radius: 9px; }
.signup-layout { width: min(1120px, 100%); margin: 0 auto; }
.intro { padding: 48px 24px 34px; background: var(--primary); color: #fff; }
.eyebrow, .card-kicker { margin: 0 0 12px; color: #d5dfcf; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
.intro h1 { margin: 0; font-size: clamp(34px, 9vw, 56px); line-height: 1.12; letter-spacing: -.045em; }
.intro-copy { margin: 22px 0 30px; color: #dbe6ff; line-height: 1.7; }
.steps { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.steps li { display: flex; gap: 12px; align-items: center; }
.steps li > span { flex: 0 0 32px; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid rgba(255,255,255,.35); border-radius: 50%; font-size: 12px; font-weight: 800; }
.steps div { display: grid; gap: 3px; }
.steps strong { font-size: 14px; }
.steps small { color: #bdcbed; line-height: 1.45; }
.steps code { color: #fff; font-family: ui-monospace, monospace; }
.signup-card { padding: 34px 24px 48px; background: var(--surface); }
.card-kicker { color: var(--accent); }
.signup-card h2 { margin: 0; font-size: 27px; letter-spacing: -.035em; }
.card-copy { margin: 9px 0 26px; color: var(--muted); line-height: 1.6; }
form { display: grid; gap: 20px; }
.field { display: grid; gap: 8px; }
.field label { font-size: 14px; font-weight: 750; }
.field small { color: var(--muted); font-size: 12px; }
input { width: 100%; min-height: 48px; padding: 11px 13px; color: var(--ink); background: #fff; border: 1px solid #b9c5d3; border-radius: 9px; outline: none; }
input:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid rgba(30,58,138,.24); outline-offset: 2px; border-color: var(--primary); }
.terms { display: grid; grid-template-columns: 24px 1fr; gap: 10px; align-items: start; color: #334155; font-size: 13px; line-height: 1.5; }
.terms input { width: 22px; min-height: 22px; margin: 0; accent-color: var(--primary); }
.primary-button, .secondary-button { min-height: 48px; padding: 0 16px; border-radius: 9px; border: 1px solid transparent; font-weight: 800; }
.primary-button { color: #fff; background: var(--primary); }
.primary-button:hover { background: var(--primary-dark); }
.secondary-button { color: var(--primary); background: #fff; border-color: #9fb0c5; }
button:disabled { opacity: .58; cursor: wait; }
.message { margin: 0; padding: 12px 14px; border-radius: 8px; font-size: 13px; line-height: 1.55; }
.error { color: var(--danger); background: #fff1f0; border-left: 4px solid var(--danger); }
.status { color: #334155; background: var(--soft); }
.status.success { color: var(--success); background: #effcf2; }
.verification-view { display: grid; }
.code-box { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 14px; background: #f1f5f9; border: 1px solid var(--line); border-radius: 10px; }
.code-box > span { overflow-wrap: anywhere; font: 800 clamp(24px, 8vw, 34px)/1 ui-monospace, monospace; letter-spacing: .08em; }
.command-box { display: grid; gap: 7px; margin-top: 16px; padding: 14px; border: 1px solid var(--line); border-radius: 10px; }
.command-box span { color: var(--muted); font-size: 12px; }
.command-box code { color: var(--primary); font: 750 16px/1.5 ui-monospace, monospace; overflow-wrap: anywhere; }
.expires { margin: 12px 0 18px; color: var(--muted); font-size: 12px; }
.actions { display: grid; gap: 10px; margin-top: 18px; }
@media (min-width: 820px) {
  body { background: #f1f5f9; }
  .site-header { max-width: 1120px; margin: 0 auto; background: var(--surface); }
  .signup-layout { min-height: calc(100vh - 64px); display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(420px, .95fr); box-shadow: 0 18px 60px rgba(15,23,42,.1); }
  .intro { display: flex; flex-direction: column; justify-content: center; padding: clamp(56px, 7vw, 96px); }
  .signup-card { display: flex; flex-direction: column; justify-content: center; padding: clamp(48px, 6vw, 76px); }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
`;

export const SITE_SIGNUP_CLIENT = String.raw`
(function () {
  "use strict";
  var form = document.getElementById("signup-form");
  var formView = document.getElementById("form-view");
  var verificationView = document.getElementById("verification-view");
  var submitButton = document.getElementById("submit-button");
  var formError = document.getElementById("form-error");
  var statusMessage = document.getElementById("verification-status");
  var checkButton = document.getElementById("check-button");
  var reissueButton = document.getElementById("reissue-button");
  var copyButton = document.getElementById("copy-button");
  var current = { loginId: "", password: "", challengeId: "", code: "" };
  var pollTimer = null;

  function setBusy(button, busy, busyText, normalText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : normalText;
  }

  function readError(payload, fallback) {
    return payload && payload.error && payload.error.message ? payload.error.message : fallback;
  }

  async function request(url, options) {
    var response = await fetch(url, options);
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(readError(payload, "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    return payload;
  }

  function showCode(signup) {
    current.challengeId = signup.challengeId;
    current.code = signup.verificationCode;
    document.getElementById("account-name-summary").textContent = signup.systemAccountName;
    document.getElementById("verification-code").textContent = signup.verificationCode;
    document.getElementById("verification-command").textContent = "/인증 " + signup.verificationCode;
    document.getElementById("expires-at").textContent = "코드 만료: " + new Date(signup.codeExpiresAt).toLocaleString("ko-KR");
    formView.hidden = true;
    verificationView.hidden = false;
    statusMessage.className = "message status";
    statusMessage.textContent = "카카오톡 인증을 기다리고 있어요.";
    verificationView.querySelector("h2").focus && verificationView.querySelector("h2").focus();
    startPolling();
  }

  async function checkStatus() {
    if (!current.challengeId) return;
    try {
      var payload = await request("/api/v1/verification-challenges/" + encodeURIComponent(current.challengeId));
      var status = payload.verification.status;
      if (status === "verified") {
        statusMessage.className = "message status success";
        statusMessage.textContent = "인증이 완료됐어요. 이제 호이월드를 시작할 수 있습니다.";
        checkButton.disabled = true;
        reissueButton.hidden = true;
        if (pollTimer) window.clearInterval(pollTimer);
      } else if (status === "expired" || status === "failed") {
        statusMessage.className = "message error";
        statusMessage.textContent = status === "expired" ? "인증 코드가 만료됐어요. 새 코드를 발급해 주세요." : "인증에 실패했어요. 새 코드를 발급해 주세요.";
        if (pollTimer) window.clearInterval(pollTimer);
      } else {
        statusMessage.className = "message status";
        statusMessage.textContent = "아직 인증 전이에요. 카카오톡에서 명령어를 전송해 주세요.";
      }
    } catch (error) {
      statusMessage.className = "message error";
      statusMessage.textContent = error instanceof Error ? error.message : "인증 상태를 확인하지 못했습니다.";
    }
  }

  function startPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(checkStatus, 5000);
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    formError.hidden = true;
    if (!form.reportValidity()) return;
    var data = new FormData(form);
    current.loginId = String(data.get("loginId") || "");
    current.password = String(data.get("password") || "");
    setBusy(submitButton, true, "계정을 만들고 있어요…", "인증 코드 받기");
    try {
      var payload = await request("/api/v1/user-accounts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loginId: current.loginId,
          password: current.password,
          systemAccountName: String(data.get("systemAccountName") || ""),
          acceptTerms: data.get("acceptTerms") === "on"
        })
      });
      showCode(payload.signup);
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : "회원가입을 완료하지 못했습니다.";
      formError.hidden = false;
      formError.focus && formError.focus();
    } finally {
      setBusy(submitButton, false, "계정을 만들고 있어요…", "인증 코드 받기");
    }
  });

  checkButton.addEventListener("click", async function () {
    setBusy(checkButton, true, "확인 중…", "인증 상태 확인");
    await checkStatus();
    setBusy(checkButton, false, "확인 중…", "인증 상태 확인");
  });

  reissueButton.addEventListener("click", async function () {
    setBusy(reissueButton, true, "발급 중…", "새 코드 발급");
    try {
      var payload = await request("/api/v1/verification-challenges", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId: current.loginId, password: current.password })
      });
      showCode(payload.signup);
    } catch (error) {
      statusMessage.className = "message error";
      statusMessage.textContent = error instanceof Error ? error.message : "새 코드를 발급하지 못했습니다.";
    } finally {
      setBusy(reissueButton, false, "발급 중…", "새 코드 발급");
    }
  });

  copyButton.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(current.code);
      copyButton.textContent = "복사됨";
      window.setTimeout(function () { copyButton.textContent = "코드 복사"; }, 1500);
    } catch (_error) {
      statusMessage.className = "message status";
      statusMessage.textContent = "코드를 길게 눌러 복사해 주세요.";
    }
  });
})();
`;
