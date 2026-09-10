import cookie from "@fastify/cookie";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { registerCurrentPlayerBagWebRoutes } from "../src/inventory/current-player-bag-web-routes.js";
import { compareLegacyBagItems } from "../src/inventory/legacy-bag-formatter.js";
import { MariaBagRepository } from "../src/inventory/maria-bag-repository.js";
import { ApplicationError } from "../src/shared/application-error.js";
import type { UserAuthService } from "../src/user-auth/user-auth-service.js";

const PLAYER_ID = "18446744073709551615";
const ITEMS = [
  { display_name: "ABC", quantity: 2n, legacy_bag_order: null },
  { display_name: "양념치킨🐔", quantity: 12n, legacy_bag_order: "21" },
  { display_name: "합성 물약", quantity: 3n, legacy_bag_order: null },
  { display_name: "잡템☠️", quantity: 18_446_744_073_709_551_615n, legacy_bag_order: "20" },
  { display_name: "펫 친밀도🐾 [Lv.2](3/1000)+4💕", quantity: 1n, legacy_bag_order: null }
] as const;

const FURNITURE_ITEMS = [
  { display_name: "가구 C", charm_snapshot: 18_446_744_073_709_551_615n, grade_display_name: "에픽", status: "bag" },
  { display_name: "가구 A", charm_snapshot: 9n, grade_display_name: "레어", status: "bag" },
  { display_name: "가구 B", charm_snapshot: 4n, grade_display_name: "일반", status: "bag" },
  { display_name: "가구 D", charm_snapshot: 1n, grade_display_name: "등급없음", status: "bag" }
] as const;

const FURNITURE_ITEMS_WITH_NON_BAG_STATES = [
  ...FURNITURE_ITEMS,
  { display_name: "배치된 가구", charm_snapshot: 100n, grade_display_name: "전설", status: "placed" },
  { display_name: "판매된 가구", charm_snapshot: 99n, grade_display_name: "전설", status: "sold" }
] as const;

function databaseFixture(active: boolean, items: readonly object[], furnitureItems: readonly { status?: string }[] = FURNITURE_ITEMS) {
  const sql: string[] = [];
  const failWrite = async (): Promise<DatabaseWriteResult> => { throw new Error("DML_NOT_ALLOWED"); };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (statement.includes("FROM players player")) {
        return (active ? [{ player_id: 18_446_744_073_709_551_615n, display_name: "현재유저" }] : []) as T;
      }
      if (statement.includes("FROM inventory_stacks stack")) return [...items] as T;
      if (statement.includes("FROM furniture_inventory_instances instance")) {
        return furnitureItems.filter((item) => item.status === "bag") as T;
      }
      if (statement.includes("FROM configuration_sets config")) return [{ string_value: "합성 광고" }] as T;
      throw new Error(`UNEXPECTED_SQL: ${statement}`);
    },
    execute: failWrite,
    withTransaction: async <T>(_work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> => {
      throw new Error("TRANSACTION_NOT_ALLOWED");
    },
    close: async () => undefined
  };
  return { database, sql };
}

function authFixture(expired = false) {
  const tokens: string[] = [];
  const auth = {
    async refreshSession(token: string) {
      tokens.push(token);
      if (expired) throw new ApplicationError("USER_SESSION_INVALID", "로그인 세션이 만료됐습니다.", 401);
      return {
        session: { sessionId: "1", accountId: "2", playerId: PLAYER_ID, loginId: "player01", systemAccountName: "호이월드" },
        csrfToken: "csrf"
      };
    }
  } as Pick<UserAuthService, "refreshSession">;
  return { auth, tokens };
}

async function createApp(active = true, items: readonly object[] = ITEMS, expired = false, furnitureItems: readonly { status?: string }[] = FURNITURE_ITEMS) {
  const app = Fastify();
  const database = databaseFixture(active, items, furnitureItems);
  const auth = authFixture(expired);
  await app.register(cookie);
  await registerCurrentPlayerBagWebRoutes(app, {
    auth: auth.auth,
    bags: new MariaBagRepository(database.database)
  });
  await app.ready();
  return { app, database, auth };
}

describe("current player bag web route integration", () => {
  it("serves first, middle, and last pages with exact same-input legacy ordering", async () => {
    const fixture = await createApp();
    try {
      const pages = [];
      for (const offset of [0, 2, 4]) {
        const response = await fixture.app.inject({
          method: "GET",
          url: `/api/v1/inventory/current?limit=2&offset=${offset}`,
          headers: { cookie: "hoibot_user_session=session-token" }
        });
        assert.equal(response.statusCode, 200);
        pages.push(response.json());
      }
      assert.deepEqual(pages.map((page) => page.pagination), [
        { limit: 2, offset: 0, total: 5, hasMore: true },
        { limit: 2, offset: 2, total: 5, hasMore: true },
        { limit: 2, offset: 4, total: 5, hasMore: false }
      ]);
      const actual = pages.flatMap((page) => page.items);
      const expected = ITEMS.map((item) => ({
        displayName: item.display_name,
        quantity: item.quantity.toString(),
        legacyBagOrder: item.legacy_bag_order === null ? null : Number(item.legacy_bag_order)
      })).sort(compareLegacyBagItems).map(({ displayName, quantity }) => ({ displayName, quantity }));
      assert.deepEqual(actual, expected);
      assert.equal(actual.find((item) => item.displayName === "잡템☠️")?.quantity, PLAYER_ID);
      assert.equal(pages.some((page) => Object.hasOwn(page, "playerId")), false);
      assert.deepEqual(fixture.auth.tokens, ["session-token", "session-token", "session-token"]);
      assert.equal(fixture.database.sql.every((statement) => /^\s*SELECT\b/i.test(statement)), true);
    } finally {
      await fixture.app.close();
    }
  });

  it("returns an empty page for an active player and 404 for a missing or inactive player", async () => {
    const empty = await createApp(true, []);
    const inactive = await createApp(false, ITEMS);
    try {
      const emptyResponse = await empty.app.inject({ method: "GET", url: "/api/v1/inventory/current", headers: { cookie: "hoibot_user_session=a" } });
      assert.equal(emptyResponse.statusCode, 200);
      assert.deepEqual(emptyResponse.json().items, []);
      assert.deepEqual(emptyResponse.json().pagination, { limit: 20, offset: 0, total: 0, hasMore: false });

      const inactiveResponse = await inactive.app.inject({ method: "GET", url: "/api/v1/inventory/current", headers: { cookie: "hoibot_user_session=b" } });
      assert.equal(inactiveResponse.statusCode, 404);
      assert.equal(inactiveResponse.json().code, "CURRENT_PLAYER_NOT_AVAILABLE");
      assert.equal(inactive.database.sql.length, 1);
    } finally {
      await empty.app.close();
      await inactive.app.close();
    }
  });

  it("keeps omitted and general category API responses in exact parity", async () => {
    const fixture = await createApp();
    try {
      const omitted = await fixture.app.inject({ method: "GET", url: "/api/v1/inventory/current?limit=2&offset=1", headers: { cookie: "hoibot_user_session=a" } });
      const general = await fixture.app.inject({ method: "GET", url: "/api/v1/inventory/current?category=general&limit=2&offset=1", headers: { cookie: "hoibot_user_session=a" } });
      assert.equal(omitted.statusCode, 200);
      assert.equal(general.statusCode, 200);
      const { requestId: omittedRequestId, ...omittedBody } = omitted.json();
      const { requestId: generalRequestId, ...generalBody } = general.json();
      assert.equal(typeof omittedRequestId, "string");
      assert.equal(typeof generalRequestId, "string");
      assert.deepEqual(generalBody, omittedBody);
      assert.equal(Object.hasOwn(omittedBody, "category"), false);
    } finally {
      await fixture.app.close();
    }
  });

  it("serves furniture first, middle, and last pages without exposing stable IDs", async () => {
    const fixture = await createApp();
    try {
      const pages = [];
      for (const offset of [0, 1, 3]) {
        const response = await fixture.app.inject({
          method: "GET",
          url: `/api/v1/inventory/current?category=furniture&limit=1&offset=${offset}`,
          headers: { cookie: "hoibot_user_session=session-token" }
        });
        assert.equal(response.statusCode, 200);
        pages.push(response.json());
      }
      assert.deepEqual(pages.map((page) => page.pagination), [
        { limit: 1, offset: 0, total: 4, hasMore: true },
        { limit: 1, offset: 1, total: 4, hasMore: true },
        { limit: 1, offset: 3, total: 4, hasMore: false }
      ]);
      assert.deepEqual(pages.map((page) => page.items[0]), [
        { displayName: "가구 C", quantity: "1", charm: PLAYER_ID, gradeDisplayName: "에픽" },
        { displayName: "가구 A", quantity: "1", charm: "9", gradeDisplayName: "레어" },
        { displayName: "가구 D", quantity: "1", charm: "1", gradeDisplayName: "등급없음" }
      ]);
      assert.equal(pages.every((page) => page.category === "furniture"), true);
      assert.equal(JSON.stringify(pages).includes("playerId"), false);
      assert.equal(fixture.database.sql.every((statement) => /^\s*SELECT\b/i.test(statement)), true);
      const furnitureSql = fixture.database.sql.find((statement) => statement.includes("FROM furniture_inventory_instances instance"));
      assert.match(furnitureSql ?? "", /instance\.status = 'bag'/);
      assert.match(furnitureSql ?? "", /ORDER BY instance\.charm_snapshot DESC, definition\.display_name COLLATE utf8mb4_unicode_ci, instance\.id/);
    } finally {
      await fixture.app.close();
    }
  });

  it("returns empty furniture pages, excludes non-bag state fixtures, and fails unavailable furniture owners closed", async () => {
    const empty = await createApp(true, ITEMS, false, []);
    const inactive = await createApp(false, ITEMS, false, FURNITURE_ITEMS);
    const filtered = await createApp(true, ITEMS, false, FURNITURE_ITEMS_WITH_NON_BAG_STATES);
    try {
      const emptyResponse = await empty.app.inject({ method: "GET", url: "/api/v1/inventory/current?category=furniture", headers: { cookie: "hoibot_user_session=a" } });
      assert.equal(emptyResponse.statusCode, 200);
      assert.deepEqual(emptyResponse.json().items, []);
      assert.deepEqual(emptyResponse.json().pagination, { limit: 20, offset: 0, total: 0, hasMore: false });

      const filteredResponse = await filtered.app.inject({ method: "GET", url: "/api/v1/inventory/current?category=furniture&limit=100", headers: { cookie: "hoibot_user_session=c" } });
      assert.equal(filteredResponse.statusCode, 200);
      assert.equal(filteredResponse.json().pagination.total, 4);
      assert.equal(filteredResponse.json().items.some((item: { displayName: string }) => item.displayName === "배치된 가구" || item.displayName === "판매된 가구"), false);

      const inactiveResponse = await inactive.app.inject({ method: "GET", url: "/api/v1/inventory/current?category=furniture", headers: { cookie: "hoibot_user_session=b" } });
      assert.equal(inactiveResponse.statusCode, 404);
      assert.equal(inactiveResponse.json().code, "CURRENT_PLAYER_NOT_AVAILABLE");
      assert.equal(inactive.database.sql.length, 1);
    } finally {
      await empty.app.close();
      await inactive.app.close();
      await filtered.app.close();
    }
  });

  it("stops before provider access for an expired session", async () => {
    const fixture = await createApp(true, ITEMS, true);
    try {
      const response = await fixture.app.inject({ method: "GET", url: "/api/v1/inventory/current?category=furniture", headers: { cookie: "hoibot_user_session=expired" } });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().code, "USER_SESSION_INVALID");
      assert.deepEqual(fixture.auth.tokens, ["expired"]);
      assert.deepEqual(fixture.database.sql, []);
    } finally {
      await fixture.app.close();
    }
  });

  it("rejects invalid page query values before reading the bag", async () => {
    const fixture = await createApp();
    try {
      for (const query of ["limit=0", "limit=101", "limit=1.5", "offset=-1", "offset=1.5", "offset=9007199254740992"]) {
        const response = await fixture.app.inject({
          method: "GET",
          url: `/api/v1/inventory/current?${query}`,
          headers: { cookie: "hoibot_user_session=session-token" }
        });
        assert.equal(response.statusCode, 422, query);
        assert.equal(response.json().code, "BAG_PAGINATION_INVALID");
      }
      assert.deepEqual(fixture.database.sql, []);
    } finally {
      await fixture.app.close();
    }
  });

  it("rejects unknown category values before reading the bag", async () => {
    const fixture = await createApp();
    try {
      for (const category of ["Furniture", "pet", "가구", "furniture%20bag"]) {
        const response = await fixture.app.inject({
          method: "GET",
          url: `/api/v1/inventory/current?category=${category}`,
          headers: { cookie: "hoibot_user_session=session-token" }
        });
        assert.equal(response.statusCode, 422, category);
        assert.equal(response.json().code, "BAG_CATEGORY_INVALID");
      }
      assert.deepEqual(fixture.database.sql, []);
    } finally {
      await fixture.app.close();
    }
  });
});
