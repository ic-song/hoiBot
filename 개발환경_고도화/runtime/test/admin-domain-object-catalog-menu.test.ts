import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { ADMIN_WEB_CLIENT, ADMIN_WEB_HTML, ADMIN_WEB_STYLES } from "../src/admin/web-shell-assets.js";
import { registerAdminWebShellRoutes } from "../src/admin/web-shell.js";

const domainMenus = [
  { label: "다이아상점", view: "diamond-catalog", path: "/admin/catalog/diamond-shop" },
  { label: "펫스킬", view: "pet-skill-catalog", path: "/admin/catalog/pet-skills" },
  { label: "아이템", view: "item-catalog", path: "/admin/catalog/items" },
  { label: "가구", view: "furniture-catalog", path: "/admin/catalog/furniture" },
  { label: "미니펫", view: "mini-pet-catalog", path: "/admin/catalog/mini-pets" }
] as const;

describe("admin domain object catalog menu", () => {
  it("exposes five explicit domain menus while preserving package and configuration catalogs", () => {
    for (const menu of domainMenus) {
      assert.match(ADMIN_WEB_CLIENT, new RegExp(`id: "${menu.view}"`));
      assert.match(ADMIN_WEB_CLIENT, new RegExp(`label: "${menu.label}"`));
      assert.match(ADMIN_WEB_CLIENT, new RegExp(menu.path.replaceAll("/", "\\/")));
    }
    assert.match(ADMIN_WEB_CLIENT, /label: "패키지 카탈로그"/);
    assert.match(ADMIN_WEB_CLIENT, /label: "설정 카탈로그"/);
    assert.match(ADMIN_WEB_CLIENT, /label: "다이아상점"[\s\S]*label: "펫스킬"[\s\S]*label: "아이템"[\s\S]*label: "가구"[\s\S]*label: "미니펫"[\s\S]*label: "패키지 카탈로그"[\s\S]*label: "설정 카탈로그"/);
  });

  it("returns the same secured shell for direct and trailing-slash catalog links", async () => {
    const app = Fastify({ logger: false });
    await registerAdminWebShellRoutes(app);
    try {
      for (const menu of domainMenus) {
        for (const path of [menu.path, `${menu.path}/`]) {
          const response = await app.inject({ method: "GET", url: path });
          assert.equal(response.statusCode, 200);
          assert.equal(response.body, ADMIN_WEB_HTML);
          assert.equal(response.headers["cache-control"], "no-store");
        }
      }
    } finally {
      await app.close();
    }
  });

  it("restores the active menu from the URL and keeps browser history navigation", () => {
    assert.match(ADMIN_WEB_CLIENT, /catalogViewFromLocation/);
    assert.match(ADMIN_WEB_CLIENT, /candidate\.path === window\.location\.pathname/);
    assert.match(ADMIN_WEB_CLIENT, /aria-current=\\"page\\"/);
    assert.match(ADMIN_WEB_CLIENT, /pushState/);
    assert.match(ADMIN_WEB_CLIENT, /popstate/);
  });

  it("reuses dedicated diamond and pet-skill flows", () => {
    assert.match(ADMIN_WEB_CLIENT, /loadDiamondCatalog\(\)/);
    assert.match(ADMIN_WEB_CLIENT, /\/api\/v1\/admin\/diamond-shop\/catalog/);
    assert.match(ADMIN_WEB_CLIENT, /loadPetSkillCatalog\(\)/);
    assert.match(ADMIN_WEB_CLIENT, /\/api\/v1\/admin\/pet-skill-catalog/);
    assert.match(ADMIN_WEB_CLIENT, /"x-csrf-token"/);
    assert.match(ADMIN_WEB_CLIENT, /"idempotency-key"/);
  });

  it("shows safe empty preparation views for item, furniture, and mini-pet", () => {
    for (const label of ["아이템", "가구", "미니펫"]) {
      assert.match(ADMIN_WEB_CLIENT, new RegExp(`loadPendingCatalog\\("${label}"`));
    }
    assert.match(ADMIN_WEB_CLIENT, /title \+ " 목록을 준비하고 있습니다/);
    assert.match(ADMIN_WEB_CLIENT, /loadingState/);
    assert.match(ADMIN_WEB_CLIENT, /errorState/);
    assert.match(ADMIN_WEB_CLIENT, /emptyState/);
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /object-register-form|object-update-form|object-active-form/);
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /currency\.lease2374_credit|lease2374_credit/);
  });

  it("keeps navigation and buttons keyboard visible with 44px minimum targets", () => {
    assert.match(ADMIN_WEB_STYLES, /\.nav-button \{[^}]*min-height: 44px/);
    assert.match(ADMIN_WEB_STYLES, /\.primary-button, \.secondary-button, \.text-button, \.icon-button \{\s*min-height: 44px/);
    assert.match(ADMIN_WEB_STYLES, /\.checkbox-field \{[^}]*min-height: 44px/);
    assert.match(ADMIN_WEB_STYLES, /\.danger-button \{[^}]*min-height: 44px; min-width: 44px/);
    assert.match(ADMIN_WEB_STYLES, /button:focus-visible/);
    assert.match(ADMIN_WEB_STYLES, /\.pagination button \{[^}]*min-height: 44px/);
    assert.match(ADMIN_WEB_STYLES, /@media \(max-width: 980px\)/);
    assert.match(ADMIN_WEB_STYLES, /@media \(max-width: 640px\)/);
  });

  it("removes the generic object editor and its implementation placeholders", () => {
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /오브젝트 카탈로그|Object key|Object type|Metadata JSON|Canonical source/);
    assert.doesNotMatch(ADMIN_WEB_CLIENT, /object-catalog\/objects/);
  });
});
