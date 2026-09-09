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
  assert.match(ACCOUNT_RECOVERY_CLIENT, /passwordInput\.value = ""/);
  assert.match(ACCOUNT_RECOVERY_CLIENT, /maskLoginId/);
  assert.doesNotMatch(ACCOUNT_RECOVERY_CLIENT, /localStorage|sessionStorage|Authorization|console\./);
  assert.doesNotThrow(() => new Function(ACCOUNT_RECOVERY_CLIENT));
});
