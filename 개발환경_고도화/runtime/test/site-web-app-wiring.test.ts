import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { OutgoingHttpHeaders } from "node:http";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function assertBrowserSecurityHeaders(headers: OutgoingHttpHeaders) {
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["content-security-policy"], CSP);
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
}

test("이용자 셸과 계정 복구 셸을 기존 웹 경로와 충돌 없이 한 번씩 연결합니다", async () => {
  const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.equal(source.match(/registerUserShellRoutes\(app\);/g)?.length, 1);
  assert.equal(source.match(/registerAccountRecoveryRoutes\(app\);/g)?.length, 1);

  const app = buildApp(loadConfig({
    NODE_ENV: "test",
    IRIS_SHARED_TOKEN: "site-web-wiring-token"
  }));

  try {
    await app.ready();
    const paths = [
      "/", "/login", "/login/", "/app", "/app/",
      "/site/assets/user-shell.css", "/site/assets/user-shell.js", "/account/inventory", "/account/inventory/",
      "/account/delete", "/account/delete/", "/recover-account", "/recover-account/",
      "/site/assets/account-recovery.css", "/site/assets/account-recovery.js",
      "/signup", "/signup/", "/admin", "/admin/"
    ];

    for (const path of paths) {
      const response = await app.inject({ method: "GET", url: path });
      assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
      assertBrowserSecurityHeaders(response.headers);
    }
  } finally {
    await app.close();
  }
});
