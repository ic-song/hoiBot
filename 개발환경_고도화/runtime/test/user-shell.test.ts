import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerUserShellRoutes } from "../src/site-web/user-shell.js";
import { USER_SHELL_CLIENT, USER_SHELL_HTML, USER_SHELL_STYLES } from "../src/site-web/user-shell-assets.js";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

class ShellElement {
  hidden = false;
  textContent = "";
  value = "";
  disabled = false;
  children: ShellElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: { preventDefault(): void }) => Promise<void> | void>();

  constructor(readonly id: string, private readonly focusLog: string[]) {}
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => Promise<void> | void) { this.listeners.set(type, listener); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  replaceChildren() { this.children = []; }
  append(...children: ShellElement[]) { this.children.push(...children); }
  focus() { this.focusLog.push(this.id); }
}

function createShellHarness(responses: Array<{ status: number; payload?: Record<string, unknown> }>) {
  const focusLog: string[] = [];
  const ids = [
    "loading-view", "login-view", "app-view", "login-form", "login-button", "login-id", "password",
    "login-error-summary", "login-error-message", "app-error", "app-error-message", "logout-button", "retry-button",
    "live-status", "header-session", "login-id-error", "password-error", "profile-list", "profile-empty", "profile-state",
    "account-login-id", "account-id", "system-account-name", "player-id", "account-name", "welcome-title", "login-title"
  ];
  const elements = new Map(ids.map((id) => [id, new ShellElement(id, focusLog)]));
  ["login-view", "app-view", "login-error-summary", "app-error", "login-id-error", "password-error", "profile-empty"]
    .forEach((id) => { const element = elements.get(id); if (element !== undefined) element.hidden = true; });
  const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
  const history: string[] = [];
  const document = {
    getElementById: (id: string) => elements.get(id),
    createElement: (tag: string) => new ShellElement(tag, focusLog)
  };
  const window = {
    setTimeout: (callback: () => void) => { callback(); return 0; },
    history: { replaceState: (_state: unknown, _title: string, url: string) => history.push(url) }
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
  new Function("document", "window", "fetch", USER_SHELL_CLIENT)(document, window, fetch);
  return { elements, calls, history, focusLog };
}

async function flushShellClient(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function click(element: ShellElement): Promise<void> {
  const listener = element.listeners.get("click");
  assert.ok(listener);
  await listener({ preventDefault() {} });
}

async function buildShellApp() {
  const app = Fastify();
  await registerUserShellRoutes(app);
  return app;
}

function assertSecurityHeaders(headers: Record<string, string | string[] | number | undefined>) {
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["content-security-policy"], CSP);
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
}

test("이용자 셸과 정적 자산을 보안 헤더와 함께 제공합니다", async () => {
  const app = await buildShellApp();
  const [root, login, protectedApp, css, client] = await Promise.all([
    app.inject({ method: "GET", url: "/" }),
    app.inject({ method: "GET", url: "/login" }),
    app.inject({ method: "GET", url: "/app" }),
    app.inject({ method: "GET", url: "/site/assets/user-shell.css" }),
    app.inject({ method: "GET", url: "/site/assets/user-shell.js" })
  ]);

  for (const response of [root, login, protectedApp, css, client]) {
    assert.equal(response.statusCode, 200);
    assertSecurityHeaders(response.headers);
  }
  assert.match(root.headers["content-type"] ?? "", /^text\/html; charset=utf-8/);
  assert.match(css.headers["content-type"] ?? "", /^text\/css; charset=utf-8/);
  assert.match(client.headers["content-type"] ?? "", /^text\/javascript; charset=utf-8/);
  assert.equal(root.body, USER_SHELL_HTML);
  assert.equal(login.body, USER_SHELL_HTML);
  assert.equal(protectedApp.body, USER_SHELL_HTML);
  assert.equal(css.body, USER_SHELL_STYLES);
  assert.equal(client.body, USER_SHELL_CLIENT);
  await app.close();
});

test("로그인 화면은 키보드·스크린리더·비밀번호 관리자를 지원합니다", () => {
  assert.match(USER_SHELL_HTML, /<html lang="ko">/);
  assert.match(USER_SHELL_HTML, /class="skip-link" href="#main-content"/);
  assert.match(USER_SHELL_HTML, /id="main-content" tabindex="-1"/);
  assert.match(USER_SHELL_HTML, /aria-label="이용자 로그인"/);
  assert.match(USER_SHELL_HTML, /autocomplete="username"/);
  assert.match(USER_SHELL_HTML, /autocomplete="current-password"/);
  assert.match(USER_SHELL_HTML, /pattern="\[a-z0-9\]\{6,20\}"/);
  assert.match(USER_SHELL_HTML, /role="alert" tabindex="-1"/);
  assert.match(USER_SHELL_HTML, /aria-live="polite"/);
  assert.match(USER_SHELL_HTML, /<script src="\/site\/assets\/user-shell\.js" defer><\/script>/);
  assert.doesNotMatch(USER_SHELL_HTML, /<script(?! src=)/);
  assert.match(USER_SHELL_STYLES, /min-height: 4[46]px/);
  assert.match(USER_SHELL_STYLES, /@media \(min-width: 820px\)/);
  assert.match(USER_SHELL_STYLES, /prefers-reduced-motion: reduce/);
  assert.match(USER_SHELL_STYLES, /\.app-sidebar nav \{[^}]*align-content: start;/);
  assert.match(USER_SHELL_STYLES, /grid-template-columns: 224px minmax\(0, 1fr\)/);
  assert.match(USER_SHELL_STYLES, /\.summary-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(USER_SHELL_STYLES, /@media \(max-width: 619px\)/);
  assert.doesNotMatch(USER_SHELL_STYLES, /grid-template-rows: auto 1fr auto/);
  assert.match(USER_SHELL_HTML, /보안 상태/);
  assert.match(USER_SHELL_HTML, /aria-labelledby="guide-title"/);
  assert.doesNotMatch(USER_SHELL_HTML, /WBS/);
  assert.doesNotThrow(() => new Function(USER_SHELL_CLIENT));
});

test("브라우저는 기존 사용자 세션 API만 소비하고 비밀을 저장하지 않습니다", () => {
  assert.match(USER_SHELL_CLIENT, /POST/);
  assert.match(USER_SHELL_CLIENT, /\/api\/v1\/sessions/);
  assert.match(USER_SHELL_CLIENT, /\/api\/v1\/player-profiles\/current/);
  assert.match(USER_SHELL_CLIENT, /DELETE/);
  assert.match(USER_SHELL_CLIENT, /credentials: "same-origin"/);
  assert.match(USER_SHELL_CLIENT, /"x-csrf-token"/);
  assert.match(USER_SHELL_CLIENT, /ACCOUNT_DELETION_GRACE/);
  assert.match(USER_SHELL_CLIENT, /ACCOUNT_TEMPORARILY_LOCKED/);
  assert.match(USER_SHELL_CLIENT, /clearSensitiveView/);
  assert.match(USER_SHELL_CLIENT, /error\.status !== 403/);
  assert.match(USER_SHELL_HTML, /href="\/signup"/);
  assert.doesNotMatch(USER_SHELL_CLIENT, /\/api\/v1\/admin/);
  assert.doesNotMatch(USER_SHELL_CLIENT, /localStorage|sessionStorage|Authorization/);
  assert.doesNotMatch(USER_SHELL_CLIENT, /console\./);
});

test("현재 사용자 프로필을 읽고 갱신된 CSRF로 로그아웃합니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", accountId: "private-account", playerId: "private-player", systemAccountName: "호이월드" }, csrfToken: "csrf-before-profile" } },
    { status: 200, payload: { profile: { nickname: "테스트용사", level: 27, tier: "골드", serverName: "호이월드 1" } } },
    { status: 200, payload: { session: { loginId: "player01", accountId: "private-account", playerId: "private-player", systemAccountName: "호이월드" }, csrfToken: "csrf-after-profile" } },
    { status: 204 }
  ]);
  await flushShellClient();
  assert.deepEqual(harness.calls.slice(0, 3).map((call) => call.url), [
    "/api/v1/sessions/current", "/api/v1/player-profiles/current", "/api/v1/sessions/current"
  ]);
  assert.equal(harness.elements.get("account-login-id")?.textContent, "pla*****");
  assert.equal(harness.elements.get("account-id")?.textContent, "웹 계정 연결 확인됨");
  assert.equal(harness.elements.get("player-id")?.textContent, "게임계정 연결 확인됨");
  assert.equal(harness.elements.get("profile-list")?.children.length, 4);
  const logout = harness.elements.get("logout-button");
  assert.ok(logout);
  await click(logout);
  assert.equal(harness.calls[3]?.options.method, "DELETE");
  assert.equal((harness.calls[3]?.options.headers as Record<string, string>)["x-csrf-token"], "csrf-after-profile");
  assert.equal(harness.history.at(-1), "/login");
  assert.equal(harness.elements.get("account-login-id")?.textContent, "—");
});

test("프로필 조회가 401이면 로그인 화면으로 전환하고 계정 표시를 지웁니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", accountId: "private-account", playerId: "private-player", systemAccountName: "호이월드" }, csrfToken: "csrf-1" } },
    { status: 401, payload: { error: { code: "UNAUTHENTICATED" } } }
  ]);
  await flushShellClient();
  assert.equal(harness.history.at(-1), "/login");
  assert.equal(harness.elements.get("login-view")?.hidden, false);
  assert.equal(harness.elements.get("app-view")?.hidden, true);
  assert.equal(harness.elements.get("account-login-id")?.textContent, "—");
  assert.equal(harness.elements.get("system-account-name")?.textContent, "—");
  assert.equal(harness.elements.get("profile-list")?.children.length, 0);
});
