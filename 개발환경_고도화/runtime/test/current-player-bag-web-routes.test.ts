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

function databaseFixture(active: boolean, items: readonly object[]) {
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

async function createApp(active = true, items: readonly object[] = ITEMS, expired = false) {
  const app = Fastify();
  const database = databaseFixture(active, items);
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

  it("stops before provider access for an expired session", async () => {
    const fixture = await createApp(true, ITEMS, true);
    try {
      const response = await fixture.app.inject({ method: "GET", url: "/api/v1/inventory/current", headers: { cookie: "hoibot_user_session=expired" } });
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
});
