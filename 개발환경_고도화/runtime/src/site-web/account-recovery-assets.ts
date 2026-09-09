export const ACCOUNT_RECOVERY_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>계정 탈퇴·복구 | 호이월드 이용자 포털</title>
  <link rel="stylesheet" href="/site/assets/account-recovery.css">
</head>
<body>
  <a class="skip-link" href="#main-content">본문으로 바로가기</a>
  <header class="site-header">
    <a class="brand" href="/app" aria-label="호이월드 이용자 포털 홈"><span class="brand-mark">H</span><span>HOI WORLD</span></a>
    <span class="header-state" id="header-state">계정 상태 확인 중</span>
  </header>

  <main id="main-content" tabindex="-1">
    <section class="loading-card" id="loading-view" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <h1>계정 정보를 확인하고 있어요</h1>
      <p>잠시만 기다려 주세요.</p>
    </section>

    <section class="page-shell" id="delete-view" hidden>
      <aside class="context-panel" aria-label="탈퇴 전 안내">
        <p class="eyebrow">ACCOUNT SETTINGS</p>
        <h1 id="delete-title" tabindex="-1">계정 탈퇴를 요청할까요?</h1>
        <p class="lead">요청 즉시 모든 로그인 세션이 종료되고, 30일의 유예 기간이 시작됩니다.</p>
        <dl class="account-chip" aria-label="현재 계정">
          <div><dt>현재 계정</dt><dd id="delete-account">—</dd></div>
          <div><dt>연결 상태</dt><dd id="delete-link-state">확인 중</dd></div>
        </dl>
        <a class="back-link" href="/app">← 내 호이월드로 돌아가기</a>
      </aside>

      <div class="action-panel">
        <div id="delete-form-panel">
          <p class="eyebrow dark">BEFORE YOU LEAVE</p>
          <h2>요청 전에 확인해 주세요</h2>
          <ul class="notice-list">
            <li><strong>30일 동안 보관</strong><span>유예 기간에는 계정과 연결 정보가 보관됩니다.</span></li>
            <li><strong>모든 세션 종료</strong><span>요청이 완료되면 이 기기를 포함한 모든 로그인이 해제됩니다.</span></li>
            <li><strong>기간 안에 복구 가능</strong><span>로그인 ID와 비밀번호로 탈퇴 요청을 철회할 수 있습니다.</span></li>
          </ul>
          <div class="alert error" id="delete-error" role="alert" tabindex="-1" hidden>
            <strong>요청을 완료하지 못했어요</strong><span id="delete-error-message"></span><a href="/account/delete">화면 새로고침</a>
          </div>
          <form id="delete-form" aria-label="계정 탈퇴 요청 확인">
            <label class="confirm-row">
              <input id="delete-confirmed" type="checkbox" aria-describedby="delete-confirm-error">
              <span>위 내용을 읽었으며 30일 탈퇴 유예와 모든 세션 종료에 동의합니다.</span>
            </label>
            <p class="field-error" id="delete-confirm-error" hidden>탈퇴 내용을 확인한 뒤 동의해 주세요.</p>
            <button class="danger-button" id="delete-button" type="submit">탈퇴 요청하기</button>
          </form>
        </div>

        <div class="result-card" id="delete-success" tabindex="-1" hidden>
          <span class="result-icon" aria-hidden="true">✓</span>
          <p class="eyebrow dark">REQUEST RECEIVED</p>
          <h2>탈퇴 요청이 접수됐어요</h2>
          <p>예정 삭제일은 <strong id="scheduled-delete-at">—</strong>입니다. 이 브라우저의 로그인도 종료됐어요.</p>
          <a class="primary-link" href="/recover-account">계정 복구하기</a>
          <a class="secondary-link" href="/login">로그인 화면으로</a>
        </div>
      </div>
    </section>

    <section class="page-shell recovery" id="recover-view" hidden>
      <aside class="context-panel recovery-context">
        <p class="eyebrow">ACCOUNT RECOVERY</p>
        <h1 id="recover-title" tabindex="-1">탈퇴 유예 중인 계정을 복구하세요</h1>
        <p class="lead">30일 유예 기간 안에 본인 로그인 정보를 다시 확인하면 탈퇴 요청을 철회할 수 있어요.</p>
        <div class="safety-note"><strong>안전한 복구</strong><span>입력한 비밀번호를 이 사이트의 저장소에 별도로 저장하지 않습니다.</span></div>
        <a class="back-link" href="/login">← 로그인 화면으로 돌아가기</a>
      </aside>

      <div class="action-panel">
        <div id="recover-form-panel">
          <p class="eyebrow dark">VERIFY ACCOUNT</p>
          <h2>로그인 정보를 확인해 주세요</h2>
          <p class="subcopy">탈퇴를 요청했던 계정의 정보를 입력하세요.</p>
          <div class="alert error" id="recover-error" role="alert" tabindex="-1" hidden>
            <strong>계정을 복구하지 못했어요</strong><span id="recover-error-message"></span>
          </div>
          <form id="recover-form" aria-label="탈퇴 유예 계정 복구">
            <div class="field">
              <label for="recover-login-id">로그인 ID</label>
              <input id="recover-login-id" name="loginId" type="text" inputmode="text" autocomplete="username" pattern="[a-z0-9]{6,20}" maxlength="20" aria-describedby="recover-login-id-error" required>
              <p class="field-error" id="recover-login-id-error" hidden></p>
            </div>
            <div class="field">
              <label for="recover-password">비밀번호</label>
              <input id="recover-password" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="64" aria-describedby="recover-password-error" required>
              <p class="field-error" id="recover-password-error" hidden></p>
            </div>
            <button class="primary-button" id="recover-button" type="submit">계정 복구하기</button>
          </form>
        </div>

        <div class="result-card" id="recover-success" tabindex="-1" hidden>
          <span class="result-icon" aria-hidden="true">✓</span>
          <p class="eyebrow dark">RECOVERY COMPLETE</p>
          <h2>계정이 복구됐어요</h2>
          <p>탈퇴 요청이 철회됐습니다. 다시 로그인해 호이월드를 이용할 수 있어요.</p>
          <a class="primary-link" href="/login">로그인하기</a>
        </div>
      </div>
    </section>
  </main>

  <footer>호이월드 계정 작업은 검증된 요청으로만 처리됩니다.</footer>
  <div class="sr-only" id="live-status" aria-live="polite"></div>
  <script src="/site/assets/account-recovery.js" defer></script>
</body>
</html>`;

export const ACCOUNT_RECOVERY_STYLES = `
:root{color-scheme:light;--navy:#0f172a;--navy-2:#172554;--blue:#1e3a8a;--focus:#2563eb;--gold:#a16207;--gold-light:#fbbf24;--ink:#172033;--muted:#5f6b7c;--line:#d8dee8;--surface:#fff;--canvas:#f8fafc;--danger:#b42318;--danger-soft:#fff1f0;--success:#166534;--shadow:0 22px 54px rgba(15,23,42,.12)}
*{box-sizing:border-box}html{font-family:Inter,Pretendard,"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;background:var(--canvas);color:var(--ink)}body{margin:0;min-width:320px;min-height:100vh;display:flex;flex-direction:column;background:radial-gradient(circle at 12% 10%,rgba(30,58,138,.08),transparent 34%),var(--canvas)}a{color:inherit}.skip-link{position:fixed;left:12px;top:-80px;z-index:10;padding:12px 16px;border-radius:8px;background:#fff;color:var(--navy);font-weight:800;box-shadow:var(--shadow)}.skip-link:focus{top:12px}.site-header{height:68px;padding:0 clamp(18px,4vw,64px);display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.94);border-bottom:1px solid var(--line)}.brand{display:flex;gap:10px;align-items:center;text-decoration:none;font-size:.82rem;font-weight:900;letter-spacing:.12em}.brand-mark{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--navy);color:var(--gold-light);font-family:Georgia,serif;font-size:1.15rem}.header-state{font-size:.78rem;font-weight:800;color:var(--muted)}main{width:min(1120px,calc(100% - 28px));margin:auto;padding:28px 0}.loading-card{width:min(520px,100%);margin:10vh auto;padding:48px 28px;text-align:center;background:#fff;border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow)}.loading-card h1{font-size:clamp(1.35rem,4vw,1.8rem);margin:20px 0 8px}.loading-card p{margin:0;color:var(--muted)}.spinner{display:inline-block;width:34px;height:34px;border:3px solid #dbe2ed;border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite}.page-shell{display:grid;overflow:hidden;border:1px solid rgba(15,23,42,.08);border-radius:28px;background:#fff;box-shadow:var(--shadow)}.context-panel{padding:clamp(30px,7vw,68px);color:#fff;background:linear-gradient(145deg,var(--navy),var(--navy-2));position:relative}.context-panel:after{content:"";position:absolute;width:210px;height:210px;right:-95px;bottom:-110px;border:1px solid rgba(251,191,36,.35);border-radius:50%}.recovery-context{background:linear-gradient(145deg,#172554,#1e3a8a)}.eyebrow{margin:0 0 18px;font-size:.72rem;font-weight:900;letter-spacing:.16em;color:var(--gold-light)}.eyebrow.dark{color:var(--gold)}.context-panel h1{max-width:520px;margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(2rem,8vw,3.8rem);line-height:1.08;letter-spacing:-.04em}.lead{max-width:560px;margin:22px 0 0;color:#dce5f3;line-height:1.75}.account-chip{margin:34px 0 0;padding:18px;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:rgba(255,255,255,.08)}.account-chip div{display:flex;justify-content:space-between;gap:18px;padding:7px 0}.account-chip dt{color:#cbd5e1}.account-chip dd{margin:0;font-weight:800;text-align:right}.back-link{position:relative;z-index:1;display:inline-block;margin-top:30px;color:#fff;font-weight:800;text-underline-offset:4px}.safety-note{display:flex;flex-direction:column;gap:5px;margin-top:34px;padding:18px;border-left:3px solid var(--gold-light);background:rgba(255,255,255,.08)}.safety-note span{color:#dce5f3;line-height:1.6}.action-panel{padding:clamp(28px,7vw,64px)}.action-panel h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(1.7rem,5vw,2.4rem);letter-spacing:-.03em}.subcopy{margin:10px 0 26px;color:var(--muted)}.notice-list{list-style:none;margin:28px 0;padding:0;display:grid;gap:12px}.notice-list li{display:grid;gap:4px;padding:16px 16px 16px 50px;border:1px solid var(--line);border-radius:14px;position:relative}.notice-list li:before{content:"✓";position:absolute;left:18px;top:17px;color:var(--success);font-weight:900}.notice-list strong{font-size:.95rem}.notice-list span{color:var(--muted);font-size:.88rem;line-height:1.55}.alert{display:grid;gap:4px;margin:18px 0;padding:14px 16px;border-radius:12px;font-size:.88rem}.alert.error{color:#7a271a;background:var(--danger-soft);border:1px solid #f5b8b2}.alert a{margin-top:5px;font-weight:800;text-underline-offset:3px}.confirm-row{display:flex;gap:12px;align-items:flex-start;margin:24px 0 10px;padding:17px;border-radius:14px;background:#f3f6fa;line-height:1.55;cursor:pointer}.confirm-row input{width:20px;height:20px;flex:0 0 auto;margin-top:2px;accent-color:var(--blue)}.field{display:grid;gap:8px;margin-bottom:18px}.field label{font-size:.9rem;font-weight:800}.field input{width:100%;min-height:48px;border:1px solid #bcc5d2;border-radius:12px;padding:11px 13px;background:#fff;color:var(--ink);font:inherit}.field input[aria-invalid="true"]{border-color:var(--danger);background:#fff9f8}.field-error{margin:7px 0 0;color:var(--danger);font-size:.82rem;font-weight:700}.danger-button,.primary-button,.primary-link,.secondary-link{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;border-radius:12px;font:inherit;font-weight:900;text-decoration:none;cursor:pointer}.danger-button{border:1px solid #8f1711;background:var(--danger);color:#fff}.primary-button,.primary-link{border:1px solid var(--blue);background:var(--blue);color:#fff}.secondary-link{margin-top:10px;border:1px solid var(--line);color:var(--ink);background:#fff}.danger-button:disabled,.primary-button:disabled{cursor:wait;opacity:.7}.result-card{padding:10px 0;text-align:center}.result-icon{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 22px;border-radius:50%;background:#dcfce7;color:var(--success);font-size:1.5rem;font-weight:900}.result-card p:not(.eyebrow){margin:16px auto 26px;max-width:440px;color:var(--muted);line-height:1.7}.result-card strong{color:var(--ink)}footer{padding:20px;text-align:center;color:var(--muted);font-size:.78rem}.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}[hidden]{display:none!important}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.context-panel :focus-visible{outline-color:var(--gold-light)}@keyframes spin{to{transform:rotate(360deg)}}
@media (min-width:820px){main{padding:48px 0}.page-shell{grid-template-columns:minmax(0,1.03fr) minmax(400px,.97fr);min-height:650px}.context-panel,.action-panel{display:flex;flex-direction:column;justify-content:center}.action-panel{min-width:0}.account-chip{max-width:480px}}
@media (max-width:480px){.site-header{height:60px}.brand{font-size:.72rem}.header-state{font-size:.7rem}main{width:min(100% - 20px,1120px);padding:18px 0}.page-shell{border-radius:20px}.context-panel,.action-panel{padding:26px 22px}.context-panel h1{font-size:2.15rem}.lead{font-size:.92rem}.account-chip div{display:grid;gap:3px}.account-chip dd{text-align:left}}
@media (prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

export const ACCOUNT_RECOVERY_CLIENT = `
(function () {
  "use strict";

  var state = { csrfToken: "", session: null };
  var loadingView = document.getElementById("loading-view");
  var deleteView = document.getElementById("delete-view");
  var recoverView = document.getElementById("recover-view");
  var liveStatus = document.getElementById("live-status");

  function announce(message) {
    liveStatus.textContent = "";
    window.setTimeout(function () { liveStatus.textContent = message; }, 10);
  }

  function show(view) {
    loadingView.hidden = view !== "loading";
    deleteView.hidden = view !== "delete";
    recoverView.hidden = view !== "recover";
    document.getElementById("header-state").textContent = view === "delete" ? "로그인됨" : view === "recover" ? "계정 복구" : "계정 상태 확인 중";
  }

  function setBusy(button, busy, busyText, normalText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : normalText;
  }

  function maskLoginId(value) {
    var loginId = String(value || "");
    if (loginId.length <= 3) return loginId ? loginId.charAt(0) + "**" : "—";
    return loginId.slice(0, 3) + "*".repeat(Math.min(5, loginId.length - 3));
  }

  async function api(url, options) {
    var response = await fetch(url, Object.assign({ credentials: "same-origin" }, options || {}));
    var payload = response.status === 204 ? {} : await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var code = String(payload && payload.error && payload.error.code || payload.code || "");
      var error = new Error(apiErrorMessage(response.status, code));
      error.status = response.status;
      error.code = code;
      throw error;
    }
    return payload;
  }

  function apiErrorMessage(status, code) {
    var messages = {
      CONFIRMATION_REQUIRED: "탈퇴 내용을 다시 확인해 주세요.",
      INVALID_CREDENTIALS: "로그인 ID 또는 비밀번호를 확인해 주세요.",
      DELETION_REQUEST_NOT_RECOVERABLE: "복구할 수 있는 탈퇴 요청이 없어요.",
      CSRF_TOKEN_REQUIRED: "보안 확인 정보가 만료됐어요. 화면을 새로고침해 주세요.",
      CSRF_TOKEN_INVALID: "보안 확인 정보가 만료됐어요. 화면을 새로고침해 주세요.",
      RATE_LIMITED: "요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요."
    };
    if (messages[code]) return messages[code];
    if (status === 401) return "로그인 ID 또는 비밀번호를 확인해 주세요.";
    if (status === 403) return "보안 확인 정보가 만료됐어요. 화면을 새로고침해 주세요.";
    if (status === 409) return "현재 계정 상태에서는 이 요청을 처리할 수 없어요.";
    if (status === 429) return "요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.";
    return "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  function showError(containerId, messageId, message) {
    var container = document.getElementById(containerId);
    document.getElementById(messageId).textContent = message;
    container.hidden = false;
    container.focus();
  }

  function formatDate(isoValue) {
    var date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return "30일 뒤";
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(date);
  }

  async function startDeleteView() {
    show("loading");
    try {
      var payload = await api("/api/v1/sessions/current");
      state.session = payload.session;
      state.csrfToken = payload.csrfToken || "";
      document.getElementById("delete-account").textContent = maskLoginId(state.session && state.session.loginId);
      document.getElementById("delete-link-state").textContent = state.session && state.session.playerId ? "게임계정 연결됨" : "연결 확인 필요";
      show("delete");
      document.getElementById("delete-title").focus();
    } catch (error) {
      if (error.status === 401) {
        window.location.replace("/login");
        return;
      }
      state.session = null;
      state.csrfToken = "";
      document.getElementById("delete-form-panel").hidden = true;
      show("delete");
      showError("delete-error", "delete-error-message", "계정 정보를 확인하지 못했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.");
    }
  }

  document.getElementById("delete-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var confirmed = document.getElementById("delete-confirmed");
    var confirmError = document.getElementById("delete-confirm-error");
    var errorPanel = document.getElementById("delete-error");
    errorPanel.hidden = true;
    confirmError.hidden = true;
    confirmed.removeAttribute("aria-invalid");
    if (!confirmed.checked) {
      confirmed.setAttribute("aria-invalid", "true");
      confirmError.hidden = false;
      confirmed.focus();
      return;
    }
    var button = document.getElementById("delete-button");
    setBusy(button, true, "요청 중…", "탈퇴 요청하기");
    try {
      var payload = await api("/api/v1/account-deletion-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": state.csrfToken },
        body: JSON.stringify({ confirmed: true })
      });
      state.csrfToken = "";
      state.session = null;
      document.getElementById("delete-account").textContent = "—";
      document.getElementById("delete-link-state").textContent = "세션 종료됨";
      document.getElementById("scheduled-delete-at").textContent = formatDate(payload.deletionRequest && payload.deletionRequest.scheduledDeleteAt);
      document.getElementById("delete-form-panel").hidden = true;
      var result = document.getElementById("delete-success");
      result.hidden = false;
      result.focus();
      document.getElementById("header-state").textContent = "탈퇴 유예 중";
      announce("탈퇴 요청이 접수됐습니다. 모든 로그인 세션이 종료됐습니다.");
    } catch (error) {
      if (error.status === 401) {
        state.csrfToken = "";
        state.session = null;
        window.location.replace("/login");
        return;
      }
      showError("delete-error", "delete-error-message", error.message);
    } finally {
      setBusy(button, false, "요청 중…", "탈퇴 요청하기");
    }
  });

  function clearRecoverErrors() {
    document.getElementById("recover-error").hidden = true;
    ["recover-login-id", "recover-password"].forEach(function (id) { document.getElementById(id).removeAttribute("aria-invalid"); });
    ["recover-login-id-error", "recover-password-error"].forEach(function (id) {
      var fieldError = document.getElementById(id);
      fieldError.hidden = true;
      fieldError.textContent = "";
    });
  }

  function fieldError(inputId, errorId, message) {
    document.getElementById(inputId).setAttribute("aria-invalid", "true");
    var target = document.getElementById(errorId);
    target.textContent = message;
    target.hidden = false;
  }

  document.getElementById("recover-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    clearRecoverErrors();
    var loginInput = document.getElementById("recover-login-id");
    var passwordInput = document.getElementById("recover-password");
    var loginId = loginInput.value.trim();
    var password = passwordInput.value;
    var invalid = false;
    if (!/^[a-z0-9]{6,20}$/.test(loginId)) { fieldError("recover-login-id", "recover-login-id-error", "영문 소문자와 숫자 6~20자로 입력해 주세요."); invalid = true; }
    if (password.length < 8 || password.length > 64 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) { fieldError("recover-password", "recover-password-error", "영문과 숫자를 포함해 8~64자로 입력해 주세요."); invalid = true; }
    if (invalid) { showError("recover-error", "recover-error-message", "입력하지 않았거나 형식이 맞지 않는 항목이 있어요."); return; }
    var button = document.getElementById("recover-button");
    setBusy(button, true, "복구 중…", "계정 복구하기");
    try {
      await api("/api/v1/account-deletion-requests/current", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId: loginId, password: password })
      });
      loginInput.value = "";
      passwordInput.value = "";
      document.getElementById("recover-form-panel").hidden = true;
      var result = document.getElementById("recover-success");
      result.hidden = false;
      result.focus();
      announce("계정 복구가 완료됐습니다. 다시 로그인할 수 있습니다.");
    } catch (error) {
      passwordInput.value = "";
      showError("recover-error", "recover-error-message", error.message);
    } finally {
      setBusy(button, false, "복구 중…", "계정 복구하기");
    }
  });

  if (window.location.pathname.indexOf("/recover-account") === 0) {
    show("recover");
    document.getElementById("recover-title").focus();
  } else {
    startDeleteView();
  }
}());
`;
