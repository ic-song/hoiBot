import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPlayerTitleInfo,
  formatPlayerTitleList,
  isPlayerTitleInfoReadCandidate,
  isPlayerTitleListReadCandidate,
  normalizePlayerTitleInfoReadDispatchMessage,
  normalizePlayerTitleListReadDispatchMessage,
  parsePlayerTitleReadCommand,
  PlayerTitleReadService,
  type PlayerTitleReadRow
} from "../src/player/player-title-read-service.js";
import type { DatabaseClient } from "../src/database.js";

const title = (index: number, equipped = false, price = "15000.000"): PlayerTitleReadRow => ({ titleId: String(index), displayName: `타이틀${index}`, acquiredDisplay: "2026-08-27 23:00", acquisitionPrice: price, equipped });

describe("player title read command", () => {
  it("separates exact/self, target-list and prefix info families", () => {
    assert.equal(isPlayerTitleListReadCandidate("/타이틀목록"), true);
    assert.equal(isPlayerTitleListReadCandidate("/타이틀목록 대상회원"), true);
    for (const value of ["/타이틀목록추가", "/타이틀정보 1", undefined]) assert.equal(isPlayerTitleListReadCandidate(value), false);
    for (const value of ["/타이틀정보", "/타이틀정보 1", "/타이틀정보안내"]) assert.equal(isPlayerTitleInfoReadCandidate(value), true);
    assert.equal(normalizePlayerTitleListReadDispatchMessage("/타이틀목록 대상회원"), "/타이틀목록");
    assert.equal(normalizePlayerTitleInfoReadDispatchMessage("/타이틀정보 2"), "/타이틀정보");
  });

  it("preserves the legacy four-character target and numeric parser", () => {
    assert.deepEqual(parsePlayerTitleReadCommand("/타이틀목록 대상회원추가"), { kind: "target_list", targetKey: "대상회원" });
    assert.deepEqual(parsePlayerTitleReadCommand("/타이틀정보 2 "), { kind: "info", index: 2 });
    assert.deepEqual(parsePlayerTitleReadCommand("/타이틀정보 1 안내"), { kind: "info", index: null });
  });

  it("returns no reply before actor or receipt work while a territory war is active", async () => {
    const statements: string[] = [];
    const database = {
      withTransaction: async (work: (transaction: { query: (sql: string) => Promise<Array<{ id: bigint }>> }) => Promise<unknown>) => work({
        query: async (sql: string) => {
          statements.push(sql);
          if (sql.startsWith("SELECT id FROM guild_territory_wars WHERE active=TRUE")) return [{ id: 1n }];
          throw new Error(`unexpected query after active war guard: ${sql}`);
        }
      })
    } as unknown as DatabaseClient;
    const result = await new PlayerTitleReadService(database).read({ eventId: "event-1", externalUserId: "user-1", destinationId: "room-1", message: "/타이틀정보 1" });
    assert.equal(result, null);
    assert.equal(statements.length, 1);
    assert.match(statements[0]!, /^SELECT id FROM guild_territory_wars WHERE active=TRUE/u);
  });

  it("formats selection, allsee, acquisition details and BIGINT-safe sale values", () => {
    const rows = Array.from({ length: 11 }, (_, index) => title(index + 1, index === 1));
    const self = formatPlayerTitleList("⭐회원", rows, false);
    assert.match(self, /^\[⭐회원\]님의 타이틀 목록/);
    assert.match(self, /☞ 2\. 타이틀2/);
    assert.equal((self.match(/\u200b/g) ?? []).length, 500);
    const admin = formatPlayerTitleList("대상회원", [title(1, true)], true);
    assert.match(admin, /1\. 타이틀1\/획득일:2026-08-27 23:00\/가격: 🅟15,000/);
    assert.match(formatPlayerTitleInfo("⭐회원", title(1, false, "9007199254740993.000")), /판매가: 🅟2,702,159,776,422,297/);
    assert.match(formatPlayerTitleInfo("⭐회원", title(1, false, "9999.000")), /판매가: 🅟1,000,000/);
  });
});
