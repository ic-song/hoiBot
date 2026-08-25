import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isTerritoryProtectionGrantCommand, TerritoryProtectionGrantService } from "../src/admin/territory-protection-grant-service.js";

// 공방권 Service의 SQL 순서와 mutation 유무를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults]; const sql: string[] = []; let insertId = 700n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`); return remaining.shift() as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId }; }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); }, execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined
  };
  return { database, sql };
}

const operator = [{ operator_id: 7n }];
const target = [{ player_id: 21n }];
const items = [{ id: 41n, code: "legacy-territory-surprise-attack-ticket" }, { id: 42n, code: "legacy-territory-absolute-defense-ticket" }];
const stacks = [{ item_id: 41n, code: "legacy-territory-surprise-attack-ticket", quantity: 2n, version: 1n }, { item_id: 42n, code: "legacy-territory-absolute-defense-ticket", quantity: 3n, version: 4n }];

describe("territory protection grant command policy", () => {
  it("accepts only the complete legacy comma forms", () => {
    for (const message of ["/공방, 대상", "/공방2, 대상 회원"]) assert.equal(isTerritoryProtectionGrantCommand(message), true);
    for (const message of ["/공방", "/공방0 대상", "/공방-1, 대상", "/공방2, ", "/공방2, 대상  "]) assert.equal(isTerritoryProtectionGrantCommand(message), false);
  });
  it("rejects zero and oversized quantities before database access", async () => {
    for (const message of ["/공방0, 대상", "/공방1000001, 대상"]) {
      const scripted = createScriptedDatabase([]);
      await assert.rejects(() => new TerritoryProtectionGrantService(scripted.database).execute({ externalUserId: "admin", channelId: "room", eventId: message, message }),
        (error: unknown) => error instanceof ApplicationError && error.code === "TERRITORY_PROTECTION_GRANT_LIMIT");
      assert.equal(scripted.sql.length, 0);
    }
  });
});

describe("territory protection grant service", () => {
  it("grants both ticket stacks and writes two ledgers atomically", async () => {
    const scripted = createScriptedDatabase([operator, [], target, items, stacks]);
    const result = await new TerritoryProtectionGrantService(scripted.database).execute({ externalUserId: "admin", channelId: "room", eventId: "grant-1", message: "/공방2, 대상" });
    assert.deepEqual([result.grantQuantity, result.attackTicketQuantity, result.defenseTicketQuantity], ["2", "4", "5"]);
    for (const fragment of ["INSERT IGNORE INTO inventory_stacks", "UPDATE inventory_stacks", "INSERT INTO inventory_ledger", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });
  it("defaults omitted quantity to one", async () => {
    const scripted = createScriptedDatabase([operator, [], target, items, stacks]);
    const result = await new TerritoryProtectionGrantService(scripted.database).execute({ externalUserId: "admin", channelId: "room", eventId: "grant-default", message: "/공방, 대상" });
    assert.equal(result.grantQuantity, "1");
  });
  it("keeps unauthorized invocation silent-ready without mutation", async () => {
    const scripted = createScriptedDatabase([[]]);
    await assert.rejects(() => new TerritoryProtectionGrantService(scripted.database).execute({ externalUserId: "member", channelId: "room", eventId: "forbidden", message: "/공방, 대상" }),
      (error: unknown) => error instanceof ApplicationError && error.statusCode === 403);
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO inventory_ledger")), false);
  });
  it("replays the stored result without a second mutation", async () => {
    const stored = { status: "granted", targetPlayerId: "21", targetName: "대상", grantQuantity: "2", attackTicketQuantity: "4", defenseTicketQuantity: "5", outboxId: "9", auditId: "10", data: "완료" };
    const scripted = createScriptedDatabase([operator, [{ result_json: JSON.stringify(stored) }]]);
    const result = await new TerritoryProtectionGrantService(scripted.database).execute({ externalUserId: "admin", channelId: "room", eventId: "grant-replay", message: "/공방2, 대상" });
    assert.equal(result.replayed, true); assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE inventory_stacks")), false);
  });
});
