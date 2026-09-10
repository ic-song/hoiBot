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

function createShellHarness(responses: Array<{ status: number; payload?: Record<string, unknown> }>, pathname = "/app") {
  const focusLog: string[] = [];
  const ids = [
    "loading-view", "login-view", "app-view", "home-content", "account-content", "inventory-content", "nav-home", "nav-account", "nav-inventory", "account-title", "inventory-title", "login-form", "login-button", "login-id", "password",
    "login-error-summary", "login-error-message", "login-session-notice", "login-session-message", "app-error", "app-error-message", "logout-button", "retry-button",
    "live-status", "header-session", "login-id-error", "password-error", "profile-list", "profile-empty", "profile-state",
    "account-login-id", "account-id", "system-account-name", "player-id", "account-name", "link-login-id", "link-system-account", "link-player-name", "link-player-server", "welcome-title", "login-title",
    "inventory-count", "inventory-state", "inventory-owner", "inventory-loading", "inventory-empty", "inventory-error", "inventory-error-message", "inventory-list", "inventory-pagination", "inventory-page-status", "inventory-retry-button", "inventory-prev-button", "inventory-next-button"
  ];
  const elements = new Map(ids.map((id) => [id, new ShellElement(id, focusLog)]));
  ["login-view", "app-view", "account-content", "inventory-content", "login-error-summary", "login-session-notice", "app-error", "login-id-error", "password-error", "profile-empty", "inventory-empty", "inventory-error", "inventory-list", "inventory-pagination"]
    .forEach((id) => { const element = elements.get(id); if (element !== undefined) element.hidden = true; });
  const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
  const history: string[] = [];
  const document = {
    getElementById: (id: string) => elements.get(id),
    createElement: (tag: string) => new ShellElement(tag, focusLog)
  };
  const window = {
    setTimeout: (callback: () => void) => { callback(); return 0; },
    location: { pathname },
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
  const [root, login, protectedApp, account, inventory, accountLinks, css, client] = await Promise.all([
    app.inject({ method: "GET", url: "/" }),
    app.inject({ method: "GET", url: "/login" }),
    app.inject({ method: "GET", url: "/app" }),
    app.inject({ method: "GET", url: "/account" }),
    app.inject({ method: "GET", url: "/account/inventory" }),
    app.inject({ method: "GET", url: "/account/links" }),
    app.inject({ method: "GET", url: "/site/assets/user-shell.css" }),
    app.inject({ method: "GET", url: "/site/assets/user-shell.js" })
  ]);

  for (const response of [root, login, protectedApp, account, inventory, accountLinks, css, client]) {
    assert.equal(response.statusCode, 200);
    assertSecurityHeaders(response.headers);
  }
  assert.match(root.headers["content-type"] ?? "", /^text\/html; charset=utf-8/);
  assert.match(css.headers["content-type"] ?? "", /^text\/css; charset=utf-8/);
  assert.match(client.headers["content-type"] ?? "", /^text\/javascript; charset=utf-8/);
  assert.equal(root.body, USER_SHELL_HTML);
  assert.equal(login.body, USER_SHELL_HTML);
  assert.equal(protectedApp.body, USER_SHELL_HTML);
  assert.equal(account.body, USER_SHELL_HTML);
  assert.equal(inventory.body, USER_SHELL_HTML);
  assert.equal((await app.inject({ method: "GET", url: "/account/inventory/" })).body, USER_SHELL_HTML);
  assert.equal(accountLinks.body, USER_SHELL_HTML);
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
  assert.match(USER_SHELL_HTML, /id="login-session-notice" class="session-notice" role="status" tabindex="-1" hidden/);
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
  assert.match(USER_SHELL_STYLES, /\.inventory-card \{ min-width: 0;/);
  assert.match(USER_SHELL_STYLES, /\.inventory-item-name \{ min-width: 0;[^}]*overflow-wrap: anywhere;/);
  assert.match(USER_SHELL_STYLES, /\.inventory-pagination \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \}/);
  assert.match(USER_SHELL_STYLES, /\.login-intro h1 \{[^}]*word-break: keep-all;[^}]*text-wrap: balance;/);
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
  assert.match(USER_SHELL_CLIENT, /\/api\/v1\/inventory\/current\?limit=" \+ state\.inventoryLimit \+ "&offset=/);
  assert.match(USER_SHELL_HTML, /id="inventory-list" class="inventory-list" aria-label="가방 아이템" tabindex="-1" hidden/);
  assert.match(USER_SHELL_HTML, /id="inventory-pagination" class="inventory-pagination" hidden/);
  assert.match(USER_SHELL_HTML, /aria-busy="true"/);
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
  assert.doesNotMatch(USER_SHELL_CLIENT, /innerHTML/);
  assert.doesNotMatch(USER_SHELL_CLIENT, /console\./);
});

test("현재 사용자 프로필을 읽고 갱신된 CSRF로 로그아웃합니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", accountId: "private-account", playerId: "private-player", systemAccountName: "호이월드" }, csrfToken: "csrf-before-profile" } },
    { status: 200, payload: { profile: { displayName: "테스트용사", level: "27", accumulatedLevel: "35", server: { code: "HOI-1", displayName: "호이월드 1" } } } },
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
  assert.equal(harness.elements.get("profile-list")?.children[0]?.children[1]?.textContent, "테스트용사");
  assert.equal(harness.elements.get("profile-list")?.children[3]?.children[1]?.textContent, "호이월드 1");
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
  assert.equal(harness.elements.get("login-session-notice")?.hidden, false);
  assert.equal(harness.elements.get("login-session-message")?.textContent, "세션이 만료됐어요. 계속 이용하려면 다시 로그인해 주세요.");
  assert.equal(harness.focusLog.at(-1), "login-session-notice");
});

test("계정 연결 경로는 본인 세션과 현재 프로필만 마스킹해 표시합니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", accountId: "private-account", playerId: "private-player", systemAccountName: "호이월드" }, csrfToken: "csrf-1" } },
    { status: 200, payload: { profile: { displayName: "테스트용사", level: "27", accumulatedLevel: "35", server: { code: "HOI-1", displayName: "호이월드 1" } } } },
    { status: 200, payload: { session: { loginId: "player01", accountId: "private-account", playerId: "private-player", systemAccountName: "호이월드" }, csrfToken: "csrf-2" } }
  ], "/account/links");
  await flushShellClient();
  assert.equal(harness.history.at(-1), "/account");
  assert.equal(harness.elements.get("home-content")?.hidden, true);
  assert.equal(harness.elements.get("account-content")?.hidden, false);
  assert.equal(harness.elements.get("link-login-id")?.textContent, "pla*****");
  assert.equal(harness.elements.get("link-system-account")?.textContent, "호이월드");
  assert.equal(harness.elements.get("link-player-name")?.textContent, "테스트용사");
  assert.equal(harness.elements.get("link-player-server")?.textContent, "호이월드 1");
  assert.equal(harness.focusLog.includes("account-title"), true);
  assert.doesNotMatch(USER_SHELL_HTML, /id="link-account-id"|id="link-player-id"/);
});

test("가방 경로는 현재 사용자 가방 계약을 안전하게 렌더링하고 페이지를 전환합니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-1" } },
    { status: 200, payload: { profile: { displayName: "테스트용사", level: "27", accumulatedLevel: "35", server: { displayName: "호이월드 1" } } } },
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-2" } },
    { status: 200, payload: { ownerLabel: "테스트용사", advertisement: "", items: [{ displayName: "안전한 <아이템>", quantity: "2" }], pagination: { limit: 20, offset: 0, total: 21, hasMore: true } } },
    { status: 200, payload: { ownerLabel: "테스트용사", advertisement: "", items: [{ displayName: "다음 아이템", quantity: "1" }], pagination: { limit: 20, offset: 20, total: 21, hasMore: false } } }
  ], "/account/inventory");
  await flushShellClient();
  assert.equal(harness.history.at(-1), "/account/inventory");
  assert.equal(harness.elements.get("inventory-content")?.hidden, false);
  assert.equal(harness.elements.get("nav-inventory")?.attributes.get("aria-current"), "page");
  assert.equal(harness.elements.get("inventory-list")?.children[0]?.children[0]?.textContent, "안전한 <아이템>");
  assert.equal(harness.elements.get("inventory-next-button")?.disabled, false);
  assert.equal(harness.calls[3]?.url, "/api/v1/inventory/current?limit=20&offset=0");
  const next = harness.elements.get("inventory-next-button");
  assert.ok(next);
  await click(next);
  await flushShellClient();
  assert.equal(harness.calls[4]?.url, "/api/v1/inventory/current?limit=20&offset=20");
  assert.equal(harness.elements.get("inventory-prev-button")?.disabled, false);
  assert.equal(harness.elements.get("inventory-next-button")?.disabled, true);
  assert.equal(harness.focusLog.includes("inventory-title"), true);
});

test("가방 조회의 세션 만료는 표시 데이터를 지우고 로그인 안내로 전환합니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-1" } },
    { status: 200, payload: { profile: { displayName: "테스트용사" } } },
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-2" } },
    { status: 401, payload: { error: { code: "UNAUTHENTICATED" } } }
  ], "/account/inventory");
  await flushShellClient();
  assert.equal(harness.elements.get("login-view")?.hidden, false);
  assert.equal(harness.elements.get("inventory-list")?.children.length, 0);
  assert.equal(harness.elements.get("inventory-pagination")?.hidden, true);
  assert.equal(harness.elements.get("login-session-message")?.textContent, "세션이 만료됐어요. 계속 이용하려면 다시 로그인해 주세요.");
});

test("빈 가방은 빈 상태와 최종 live announcement를 표시합니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-1" } },
    { status: 200, payload: { profile: { displayName: "테스트용사" } } },
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-2" } },
    { status: 200, payload: { ownerLabel: "테스트용사", items: [], pagination: { limit: 20, offset: 0, total: 0, hasMore: false } } }
  ], "/account/inventory");
  await flushShellClient();
  assert.equal(harness.elements.get("inventory-empty")?.hidden, false);
  assert.equal(harness.elements.get("inventory-list")?.hidden, true);
  assert.equal(harness.elements.get("inventory-pagination")?.hidden, true);
  assert.equal(harness.elements.get("live-status")?.textContent, "가방이 비어 있어요.");
});

test("가방 오류는 표시하고 재시도 성공으로 안전하게 대체합니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-1" } },
    { status: 200, payload: { profile: { displayName: "테스트용사" } } },
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-2" } },
    { status: 500, payload: { error: { code: "BAG_READ_FAILED" } } },
    { status: 200, payload: { ownerLabel: "테스트용사", items: [{ displayName: "재시도 아이템", quantity: "3" }], pagination: { limit: 20, offset: 0, total: 1, hasMore: false } } }
  ], "/account/inventory");
  await flushShellClient();
  assert.equal(harness.elements.get("inventory-error")?.hidden, false);
  assert.match(harness.elements.get("inventory-error-message")?.textContent ?? "", /요청을 처리하지 못했어요/);
  const retry = harness.elements.get("inventory-retry-button");
  assert.ok(retry);
  await click(retry);
  await flushShellClient();
  assert.equal(harness.calls[4]?.url, "/api/v1/inventory/current?limit=20&offset=0");
  assert.equal(harness.elements.get("inventory-error")?.hidden, true);
  assert.equal(harness.elements.get("inventory-list")?.children[0]?.children[0]?.textContent, "재시도 아이템");
  assert.equal(harness.elements.get("live-status")?.textContent, "가방 항목 1개를 표시합니다.");
});

test("가방 경로에서 프로필 401 뒤에는 가방 요청을 시작하지 않습니다", async () => {
  const harness = createShellHarness([
    { status: 200, payload: { session: { loginId: "player01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "csrf-1" } },
    { status: 401, payload: { error: { code: "UNAUTHENTICATED" } } },
    { status: 200, payload: { ownerLabel: "후속 응답", items: [{ displayName: "표시되면 안 되는 아이템", quantity: "1" }], pagination: { limit: 20, offset: 0, total: 1, hasMore: false } } }
  ], "/account/inventory");
  await flushShellClient();
  assert.deepEqual(harness.calls.map((call) => call.url), ["/api/v1/sessions/current", "/api/v1/player-profiles/current"]);
  assert.equal(harness.history.at(-1), "/login");
  assert.equal(harness.elements.get("login-view")?.hidden, false);
  assert.equal(harness.elements.get("inventory-list")?.children.length, 0);
  assert.equal(harness.elements.get("inventory-pagination")?.hidden, true);
  assert.equal(harness.elements.get("inventory-count")?.textContent, "조회 준비 중");
});
