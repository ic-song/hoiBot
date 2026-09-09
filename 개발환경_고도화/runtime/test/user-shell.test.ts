import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerUserShellRoutes } from "../src/site-web/user-shell.js";
import { USER_SHELL_CLIENT, USER_SHELL_HTML, USER_SHELL_STYLES } from "../src/site-web/user-shell-assets.js";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

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
