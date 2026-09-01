import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADMIN_WEB_HTML, ADMIN_WEB_STYLES } from "../src/admin/web-shell-assets.js";
import { buildSyntheticAdminWebShellApp } from "./support/admin-web-shell-preview.js";

describe("admin web login hero polish", () => {
  it("keeps one accessible Hoiworld hero and removes the former marketing copy", () => {
    assert.match(ADMIN_WEB_HTML, /<section class="login-copy" aria-labelledby="login-title">\s*<h1 id="login-title">호이월드<\/h1>\s*<\/section>/);
    assert.doesNotMatch(ADMIN_WEB_HTML, /hoiBot Operations|PERMISSIONED CONTROL SURFACE|운영 판단과 계정 조치|권한 우선|변경 통제|감사 기반/);
    assert.match(ADMIN_WEB_HTML, /<section class="login-panel" aria-label="관리자 로그인">/);
  });

  it("freezes desktop, tablet, and mobile responsive hero boundaries", () => {
    assert.match(ADMIN_WEB_STYLES, /\.login-view \{ min-height: 100vh; display: grid; grid-template-columns: minmax\(0, 1\.2fr\) minmax\(400px, \.8fr\); \}/);
    assert.match(ADMIN_WEB_STYLES, /font-size: clamp\(52px, 8vw, 112px\)/);
    assert.match(ADMIN_WEB_STYLES, /@media \(max-width: 980px\)[\s\S]*?\.login-copy \{ min-height: 38vh; padding: 48px; \}/);
    assert.match(ADMIN_WEB_STYLES, /@media \(max-width: 640px\)[\s\S]*?\.login-copy \{ min-height: 30vh; padding: 32px 24px; \}[\s\S]*?\.login-copy h1 \{ font-size: 44px; \}/);
  });

  it("serves the polished login while preserving session and post-login admin APIs", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      const page = await app.inject({ method: "GET", url: "/admin" });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /<h1 id="login-title">호이월드<\/h1>/);
      const login = await app.inject({ method: "POST", url: "/api/v1/admin/sessions", payload: { loginId: "shadow.manager", password: "synthetic" } });
      assert.equal(login.statusCode, 200);
      assert.equal((await app.inject({ method: "GET", url: "/api/v1/admin/object-catalog/objects?page=1&limit=25" })).statusCode, 200);
    } finally { await app.close(); }
  });
});
