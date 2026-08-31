import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { registerAdminWebShellRoutes } from "../src/admin/web-shell.js";
import { ADMIN_WEB_CLIENT, ADMIN_WEB_HTML, ADMIN_WEB_STYLES } from "../src/admin/web-shell-assets.js";
import {
  syntheticAdminAudit,
  syntheticAdminOverview,
  syntheticAdminPlayer,
  syntheticAdminRestrictions,
  syntheticAdminSession,
  syntheticMonitoringEvent
} from "./fixtures/admin-web-shell.js";
import { buildSyntheticAdminWebShellApp } from "./support/admin-web-shell-preview.js";

// 운영 API 없이 정적 웹 셸 경로만 검증할 Fastify 인스턴스를 구성합니다.
async function webShellApp() {
  const app = Fastify({ logger: false });
  await registerAdminWebShellRoutes(app);
  return app;
}

describe("admin web shell", () => {
  it("serves the shell and assets with no-store browser security headers", async () => {
    const app = await webShellApp();
    try {
      const [page, styles, client] = await Promise.all([
        app.inject({ method: "GET", url: "/admin" }),
        app.inject({ method: "GET", url: "/admin/assets/admin.css" }),
        app.inject({ method: "GET", url: "/admin/assets/admin.js" })
      ]);
      assert.equal(page.statusCode, 200);
      assert.match(page.headers["content-type"] ?? "", /^text\/html/);
      assert.equal(page.headers["cache-control"], "no-store");
      assert.match(page.headers["content-security-policy"] ?? "", /frame-ancestors 'none'/);
      assert.equal(page.headers["x-frame-options"], "DENY");
      assert.match(page.body, /hoiBot Operations/);
      assert.equal(styles.body, ADMIN_WEB_STYLES);
      assert.equal(client.body, ADMIN_WEB_CLIENT);
    } finally {
      await app.close();
    }
  });

  it("provides accessible login, navigation, and status regions", () => {
    assert.match(ADMIN_WEB_HTML, /<html lang="ko">/);
    assert.match(ADMIN_WEB_HTML, /class="skip-link" href="#main-content"/);
    assert.match(ADMIN_WEB_HTML, /aria-label="관리자 로그인"/);
    assert.match(ADMIN_WEB_HTML, /aria-live="polite"/);
    assert.match(ADMIN_WEB_HTML, /id="main-content"[^>]*tabindex="-1"/);
  });

  it("connects the approved read APIs, session lifecycle, and leased admin mutations", () => {
    for (const path of [
      "/api/v1/admin/sessions",
      "/api/v1/admin/sessions/current",
      "/api/v1/admin/overview",
      "/api/v1/admin/players",
      "/api/v1/admin/players/",
      "/currencies/",
      "/adjustments",
      "/api/v1/admin/restrictions",
      "/api/v1/admin/audit-entries",
      "/api/v1/admin/channel-activity",
      "/api/v1/admin/moderation-incidents",
      "/api/v1/admin/monitoring-events",
      "/api/v1/admin/delivery-failures",
      "/api/v1/admin/balance",
      "/api/v1/admin/diamond-shop/catalog",
      "/api/v1/admin/package-catalog",
      "/api/v1/admin/object-catalog/objects/",
      "/api/v1/admin/backups/managed",
      "/api/v1/admin/backups/dev-sync",
      "/api/v1/admin/restores/preview",
      "/api/v1/admin/restores",
    ]) assert.match(ADMIN_WEB_CLIENT, new RegExp(path.replaceAll("/", "\\/")));

    for (const forbidden of ["server-assignment", "player-assignment", "/operators", "/passes"]) {
      assert.doesNotMatch(ADMIN_WEB_CLIENT, new RegExp(forbidden.replaceAll("/", "\\/")));
    }
    assert.ok((ADMIN_WEB_CLIENT.match(/"POST"/g) ?? []).length >= 6);
    assert.equal((ADMIN_WEB_CLIENT.match(/method: "DELETE"/g) ?? []).length, 1);
    assert.equal((ADMIN_WEB_CLIENT.match(/"PATCH"/g) ?? []).length, 3);
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /method: "PUT"/);
  });

  it("freezes synthetic Gate 3 session and read-response fixtures", () => {
    assert.deepEqual(syntheticAdminSession.permissions, [
      "overview.read", "player.read", "account.restrict", "game.currency.change", "managed_backup.execute", "data_backup.execute", "data_restore.execute", "audit.read", "activity.read", "incident.read", "monitoring.read", "package.catalog.manage", "admin.balance.manage"
    ]);
    assert.equal(syntheticAdminOverview.activePlayers, "1280");
    assert.equal(syntheticAdminPlayer.playerId, "40001");
    assert.equal(syntheticAdminPlayer.currencies.diamond, "350");
    assert.deepEqual(syntheticAdminPlayer.currencyAccounts[0], { code: "diamond", balance: "350", version: "4" });
    assert.equal(syntheticAdminAudit.resultCode, "success");
    assert.equal(syntheticMonitoringEvent.monitoringGroup, "media");
    assert.equal(syntheticAdminRestrictions[0].status, "active");
  });

  it("serves every approved view from synthetic APIs without a database", async () => {
    const app = await buildSyntheticAdminWebShellApp();
    try {
      const login = await app.inject({ method: "POST", url: "/api/v1/admin/sessions", payload: { loginId: "shadow.manager", password: "synthetic" } });
      assert.equal(login.statusCode, 200);
      const responses = await Promise.all([
        app.inject({ method: "GET", url: "/api/v1/admin/sessions/current" }),
        app.inject({ method: "GET", url: "/api/v1/admin/overview" }),
        app.inject({ method: "GET", url: "/api/v1/admin/players?page=1&limit=25" }),
        app.inject({ method: "GET", url: "/api/v1/admin/players/40001" }),
        app.inject({ method: "GET", url: "/api/v1/admin/audit-entries?page=1&limit=25" }),
        app.inject({ method: "GET", url: "/api/v1/admin/channel-activity?page=1&limit=25" }),
        app.inject({ method: "GET", url: "/api/v1/admin/moderation-incidents?page=1&limit=25" }),
        app.inject({ method: "GET", url: "/api/v1/admin/monitoring-events?page=1&limit=25" }),
        app.inject({ method: "GET", url: "/api/v1/admin/delivery-failures?page=1&limit=25" }),
        app.inject({ method: "GET", url: "/api/v1/admin/diamond-shop/catalog" }),
        app.inject({ method: "GET", url: "/api/v1/admin/package-catalog" }),
        app.inject({ method: "GET", url: "/api/v1/admin/balance" })
      ]);
      assert.ok(responses.every((response) => response.statusCode === 200));
      assert.equal(responses[2]?.json().total, 1);
      assert.equal(responses[3]?.json().player.displayName, "합성회원");
      assert.equal(responses[3]?.json().player.restrictions.length, 2);
      assert.equal(responses[8]?.json().items[0].errorCode, "SYNTHETIC_TIMEOUT");
      assert.equal(responses[9]?.json().catalog.catalogVersion, "14");
      assert.equal(responses[10]?.json().catalog.catalogKey, "PACKAGE_CATALOG");
      assert.equal(responses[11]?.json().domains.length, 3);
    } finally {
      await app.close();
    }
  });

  it("keeps permission-aware navigation and failure states in the client contract", () => {
    for (const permission of syntheticAdminSession.permissions) assert.match(ADMIN_WEB_CLIENT, new RegExp(permission.replace(".", "\\.")));
    assert.match(ADMIN_WEB_CLIENT, /조회 권한이 없습니다/);
    assert.match(ADMIN_WEB_CLIENT, /세션이 만료됐습니다/);
    assert.match(ADMIN_WEB_CLIENT, /검색 결과가 없습니다/);
    assert.match(ADMIN_WEB_CLIENT, /다시 시도/);
    assert.match(ADMIN_WEB_CLIENT, /manager/);
    assert.match(ADMIN_WEB_CLIENT, /super_admin/);
  });

  it("provides responsive add, explicit soft-disable, conflict, failure, and replay states", () => {
    assert.match(ADMIN_WEB_CLIENT, /상품 추가/);
    assert.match(ADMIN_WEB_CLIENT, /상품 비활성화 확인/);
    assert.match(ADMIN_WEB_CLIENT, /목록이 먼저 변경되었습니다/);
    assert.match(ADMIN_WEB_CLIENT, /같은 요청 다시 보내기/);
    assert.match(ADMIN_WEB_CLIENT, /이미 완료된 요청입니다/);
    assert.match(ADMIN_WEB_CLIENT, /"x-csrf-token"/);
    assert.match(ADMIN_WEB_CLIENT, /"idempotency-key"/);
    assert.match(ADMIN_WEB_STYLES, /@media \(max-width: 640px\)/);
    assert.match(ADMIN_WEB_STYLES, /\.catalog-layout/);
  });

  it("exposes only package adapter ADD, EDIT, REMOVE and ENABLE states", () => {
    assert.match(ADMIN_WEB_CLIENT, /패키지 추가/);
    assert.match(ADMIN_WEB_CLIENT, /패키지 보상 전체 수정/);
    assert.match(ADMIN_WEB_CLIENT, /패키지 목록 제거 확인/);
    assert.match(ADMIN_WEB_CLIENT, /패키지 활성화 확인/);
    assert.match(ADMIN_WEB_CLIENT, /package\.catalog\.manage/);
    assert.match(ADMIN_WEB_CLIENT, /expectedCatalogVersion/);
    assert.match(ADMIN_WEB_CLIENT, /이미 완료된 패키지 요청입니다/);
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /패키지 카탈로그 발행|package-catalog\/publish/);
  });

  it("exposes exact object lookup and only REGISTER, UPDATE and SET_ACTIVE states", () => {
    assert.match(ADMIN_WEB_CLIENT, /오브젝트 등록/);
    assert.match(ADMIN_WEB_CLIENT, /오브젝트 수정/);
    assert.match(ADMIN_WEB_CLIENT, /오브젝트 비활성화 확인/);
    assert.match(ADMIN_WEB_CLIENT, /object-catalog\/objects/);
    assert.match(ADMIN_WEB_CLIENT, /expectedVersion/);
    assert.match(ADMIN_WEB_CLIENT, /이미 완료된 오브젝트 요청입니다/);
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /object-catalog\/publish|오브젝트 영구 삭제|object-catalog\/objects\?page/);
  });

  it("exposes grouped balance search, preview diff, apply and rollback only", () => {
    assert.match(ADMIN_WEB_CLIENT, /확률·수치 관리/);
    assert.match(ADMIN_WEB_CLIENT, /admin\.balance\.manage/);
    assert.match(ADMIN_WEB_CLIENT, /그룹·검색/);
    assert.match(ADMIN_WEB_CLIENT, /변경 diff 사전검증/);
    assert.match(ADMIN_WEB_CLIENT, /영향 경고/);
    assert.match(ADMIN_WEB_CLIENT, /balance\/.*\/preview/);
    assert.match(ADMIN_WEB_CLIENT, /preview\.mode/);
    assert.match(ADMIN_WEB_CLIENT, /"idempotency-key"/);
    assert.match(ADMIN_WEB_CLIENT, /감사 기록 보기/);
    assert.match(ADMIN_WEB_CLIENT, /모니터링 보기/);
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /generic SQL|table editor|direct DB/);
  });
});
