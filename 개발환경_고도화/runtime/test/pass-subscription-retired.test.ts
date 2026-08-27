import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPassSubscriptionRetiredCommandCandidate, normalizePassSubscriptionRetiredDispatchMessage, parsePassSubscriptionRetiredCommand, PassSubscriptionRetiredCommandService, type PassSubscriptionRetiredResult } from "../src/pass/pass-subscription-retired-command-service.js";

function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults], sql: string[] = []; let insertId = 1000n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId }; },
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected query"); }, execute: async () => { throw new Error("Unexpected execute"); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined,
  };
  return { database, sql };
}

describe("retired pass subscription", () => {
  it("preserves both reachable legacy guards and exact aliases", () => {
    assert.equal(isPassSubscriptionRetiredCommandCandidate("/공헌패스구독"), true);
    assert.equal(isPassSubscriptionRetiredCommandCandidate("/다이아패스구독 안내"), true);
    assert.equal(isPassSubscriptionRetiredCommandCandidate("/구독패스지급"), false);
    assert.equal(normalizePassSubscriptionRetiredDispatchMessage("/다이아패스구독 안내"), "/다이아패스구독");
  });
  it("returns the exact unified retirement notice", () => {
    assert.equal(parsePassSubscriptionRetiredCommand("/공헌패스구독")?.data, "⚠️ 기존 패스 지급 명령어는 사용이 중단되었습니다.\n패스 지급 명령어가 /구독패스지급 으로 통합되었습니다.");
  });
  it("queues one reply without pass, inventory, item, pet, or currency mutation", async () => {
    const scripted = scriptedDatabase([[{ id: 9n }], []]);
    const result = await new PassSubscriptionRetiredCommandService(scripted.database).reply({ command: parsePassSubscriptionRetiredCommand("/공헌패스구독")!, eventId: "retired-pass-event", destinationId: "room", actorId: "user" });
    assert.equal(result.status, "replied");
    assert.equal(scripted.sql.filter(sql => sql.includes("INSERT INTO outbox_messages")).length, 1);
    assert.equal(scripted.sql.some(sql => /player_support_passes|inventory|currency_|pet_/i.test(sql)), false);
  });
  it("replays without a second outbox", async () => {
    const command = parsePassSubscriptionRetiredCommand("/다이아패스구독")!;
    const stored: PassSubscriptionRetiredResult = { status: "replied", data: command.data, outboxId: "1", auditId: "2", replayed: false };
    const scripted = scriptedDatabase([[{ id: 9n }], [{ result_json: JSON.stringify(stored) }]]);
    const result = await new PassSubscriptionRetiredCommandService(scripted.database).reply({ command, eventId: "replay", destinationId: "room", actorId: "user" });
    assert.equal(result.replayed, true);
    assert.equal(scripted.sql.some(sql => sql.includes("INSERT INTO outbox_messages")), false);
  });
});
