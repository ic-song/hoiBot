import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAccountRecoveryRoutes } from "../src/site-web/account-recovery.js";
import {
  ACCOUNT_RECOVERY_CLIENT,
  ACCOUNT_RECOVERY_HTML,
  ACCOUNT_RECOVERY_STYLES
} from "../src/site-web/account-recovery-assets.js";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

class FakeElement {
  hidden = false;
  textContent = "";
  value = "";
  checked = false;
  disabled = false;
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: { preventDefault(): void }) => Promise<void> | void>();

  constructor(readonly id: string, private readonly focusLog: string[]) {}
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => Promise<void> | void) { this.listeners.set(type, listener); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { this.focusLog.push(this.id); }
}

function createClientHarness(pathname: string, responses: Array<{ status: number; payload?: Record<string, unknown> }>) {
  const focusLog: string[] = [];
  const ids = [
    "loading-view", "delete-view", "recover-view", "live-status", "header-state", "delete-account", "delete-link-state",
    "delete-title", "delete-form", "delete-confirmed", "delete-confirm-error", "delete-error", "delete-error-message",
    "delete-button", "delete-form-panel", "scheduled-delete-at", "delete-success", "recover-form", "recover-error",
    "recover-error-message", "recover-login-id", "recover-password", "recover-login-id-error", "recover-password-error",
    "recover-button", "recover-form-panel", "recover-success", "recover-title"
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id, focusLog)]));
  ["delete-view", "recover-view", "delete-error", "delete-confirm-error", "delete-success", "recover-error", "recover-login-id-error", "recover-password-error", "recover-success"]
    .forEach((id) => { const element = elements.get(id); if (element !== undefined) element.hidden = true; });
  const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
  const redirects: string[] = [];
  const document = { getElementById: (id: string) => elements.get(id) };
  const window = {
    location: { pathname, replace: (url: string) => redirects.push(url) },
    setTimeout: (callback: () => void) => { callback(); return 0; }
  };
  const fetch = async (url: string, options?: Record<string, unknown>) => {
    calls.push({ url, options: options ?? {} });
    const response = responses.shift();
    if (response === undefined) throw new Error(`응답 fixture가 부족합니다: ${url}`);
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: async () => response.payload ?? {}
    };
  };
  new Function("document", "window", "fetch", "Intl", ACCOUNT_RECOVERY_CLIENT)(document, window, fetch, Intl);
  return { elements, calls, redirects, focusLog };
}

async function flushClient(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function submit(element: FakeElement): Promise<void> {
  const listener = element.listeners.get("submit");
  assert.ok(listener);
  await listener({ preventDefault() {} });
}

function assertSecurityHeaders(headers: Record<string, string | string[] | number | undefined>) {
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["content-security-policy"], CSP);
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
}

test("계정 탈퇴·복구 화면과 자산을 보안 헤더와 함께 제공합니다", async () => {
  const app = Fastify();
  await registerAccountRecoveryRoutes(app);
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/account/delete" }),
    app.inject({ method: "GET", url: "/recover-account" }),
    app.inject({ method: "GET", url: "/site/assets/account-recovery.css" }),
    app.inject({ method: "GET", url: "/site/assets/account-recovery.js" })
  ]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    assertSecurityHeaders(response.headers);
  }
  assert.equal(responses[0]?.body, ACCOUNT_RECOVERY_HTML);
  assert.equal(responses[1]?.body, ACCOUNT_RECOVERY_HTML);
  assert.equal(responses[2]?.body, ACCOUNT_RECOVERY_STYLES);
  assert.equal(responses[3]?.body, ACCOUNT_RECOVERY_CLIENT);
  await app.close();
});

test("탈퇴 요청 화면은 30일 유예·세션 종료·복구 경로를 명시합니다", () => {
  assert.match(ACCOUNT_RECOVERY_HTML, /30일의 유예 기간/);
  assert.match(ACCOUNT_RECOVERY_HTML, /모든 로그인 세션이 종료/);
  assert.match(ACCOUNT_RECOVERY_HTML, /href="\/recover-account"/);
  assert.match(ACCOUNT_RECOVERY_HTML, /id="delete-confirmed" type="checkbox"/);
  assert.match(ACCOUNT_RECOVERY_HTML, /aria-describedby="delete-confirm-error"/);
  assert.match(ACCOUNT_RECOVERY_HTML, /role="alert" tabindex="-1"/);
  assert.match(ACCOUNT_RECOVERY_HTML, /aria-live="polite"/);
  assert.match(ACCOUNT_RECOVERY_HTML, /autocomplete="username"/);
  assert.match(ACCOUNT_RECOVERY_HTML, /autocomplete="current-password"/);
  assert.match(ACCOUNT_RECOVERY_HTML, /maxlength="64" aria-describedby="recover-password-error"/);
  assert.match(ACCOUNT_RECOVERY_STYLES, /@media \(min-width:820px\)/);
  assert.match(ACCOUNT_RECOVERY_STYLES, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(ACCOUNT_RECOVERY_HTML, /<script(?! src=)/);
});

test("브라우저는 기존 계정 API만 사용하고 자격 증명을 저장하지 않습니다", () => {
  assert.match(ACCOUNT_RECOVERY_CLIENT, /\/api\/v1\/sessions\/current/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /\/api\/v1\/account-deletion-requests/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /\/api\/v1\/account-deletion-requests\/current/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /method: "POST"/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /method: "DELETE"/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /"x-csrf-token": state\.csrfToken/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /JSON\.stringify\(\{ confirmed: true \}\)/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /credentials: "same-origin"/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /AUTH_RATE_LIMITED/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /passwordInput\.value = ""/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /maskLoginId/);
  assert.doesNotMatch(ACCOUNT_RECOVERY_CLIENT, /localStorage|sessionStorage|Authorization|console\./);
  assert.doesNotThrow(() => new Function(ACCOUNT_RECOVERY_CLIENT));
});

test("탈퇴 요청은 세션 CSRF를 사용하고 성공 뒤 민감 표시를 지웁니다", async () => {
  const harness = createClientHarness("/account/delete", [
    { status: 200, payload: { session: { loginId: "player01", playerId: "private-player-id" }, csrfToken: "csrf-1" } },
    { status: 201, payload: { deletionRequest: { requestId: "private-request-id", scheduledDeleteAt: "2026-10-09T12:39:52.000Z" } } }
  ]);
  await flushClient();
  assert.equal(harness.elements.get("delete-account")?.textContent, "pla*****");
  assert.doesNotMatch(harness.elements.get("delete-account")?.textContent ?? "", /player01|private/);
  const confirmed = harness.elements.get("delete-confirmed");
  assert.ok(confirmed);
  confirmed.checked = true;
  const form = harness.elements.get("delete-form");
  assert.ok(form);
  await submit(form);
  assert.equal(harness.calls[1]?.url, "/api/v1/account-deletion-requests");
  assert.deepEqual((harness.calls[1]?.options.headers as Record<string, string>)["x-csrf-token"], "csrf-1");
  assert.equal(harness.elements.get("delete-account")?.textContent, "—");
  assert.equal(harness.elements.get("delete-link-state")?.textContent, "세션 종료됨");
  assert.equal(harness.elements.get("delete-success")?.hidden, false);
});

test("계정 복구는 자격 증명을 전송한 뒤 입력값을 지웁니다", async () => {
  const harness = createClientHarness("/recover-account", [
    { status: 200, payload: { deletionRequest: { requestId: "private-request-id", status: "recovered" } } }
  ]);
  const login = harness.elements.get("recover-login-id");
  const password = harness.elements.get("recover-password");
  const form = harness.elements.get("recover-form");
  assert.ok(login && password && form);
  login.value = "player01";
  password.value = "Pass1234";
  await submit(form);
  assert.equal(harness.calls[0]?.url, "/api/v1/account-deletion-requests/current");
  assert.equal(harness.calls[0]?.options.method, "DELETE");
  assert.equal(login.value, "");
  assert.equal(password.value, "");
  assert.equal(harness.elements.get("recover-success")?.hidden, false);
});

test("세션 조회는 401만 로그인으로 보내고 서버 오류는 재시도를 표시합니다", async () => {
  const unauthenticated = createClientHarness("/account/delete", [{ status: 401 }]);
  await flushClient();
  assert.deepEqual(unauthenticated.redirects, ["/login"]);

  const unavailable = createClientHarness("/account/delete", [{ status: 503 }]);
  await flushClient();
  assert.deepEqual(unavailable.redirects, []);
  assert.equal(unavailable.elements.get("delete-error")?.hidden, false);
  assert.equal(unavailable.elements.get("delete-form-panel")?.hidden, true);
});

test("탈퇴 CSRF 오류와 복구 요청 제한을 화면에 남기고 비밀번호를 지웁니다", async () => {
  const deletion = createClientHarness("/account/delete", [
    { status: 200, payload: { session: { loginId: "player01", playerId: "private-player-id" }, csrfToken: "csrf-1" } },
    { status: 403, payload: { error: { code: "CSRF_TOKEN_INVALID" } } }
  ]);
  await flushClient();
  const confirmed = deletion.elements.get("delete-confirmed");
  const deletionForm = deletion.elements.get("delete-form");
  assert.ok(confirmed && deletionForm);
  confirmed.checked = true;
  await submit(deletionForm);
  assert.equal(deletion.elements.get("delete-error")?.hidden, false);
  assert.match(deletion.elements.get("delete-error-message")?.textContent ?? "", /새로고침/);
  assert.equal(deletion.elements.get("delete-success")?.hidden, true);

  const recovery = createClientHarness("/recover-account", [
    { status: 429, payload: { error: { code: "AUTH_RATE_LIMITED" } } }
  ]);
  const login = recovery.elements.get("recover-login-id");
  const password = recovery.elements.get("recover-password");
  const recoveryForm = recovery.elements.get("recover-form");
  assert.ok(login && password && recoveryForm);
  login.value = "player01";
  password.value = "Pass1234";
  await submit(recoveryForm);
  assert.equal(password.value, "");
  assert.equal(recovery.elements.get("recover-error")?.hidden, false);
  assert.match(recovery.elements.get("recover-error-message")?.textContent ?? "", /요청이 너무 많아요/);
});

test("복구 비밀번호는 서버 계약과 같은 8~64자 범위를 검사합니다", async () => {
  const harness = createClientHarness("/recover-account", []);
  const login = harness.elements.get("recover-login-id");
  const password = harness.elements.get("recover-password");
  const form = harness.elements.get("recover-form");
  assert.ok(login && password && form);
  login.value = "player01";
  password.value = `A1${"x".repeat(63)}`;
  await submit(form);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.elements.get("recover-password-error")?.hidden, false);
  assert.match(harness.elements.get("recover-password-error")?.textContent ?? "", /8~64자/);
});
