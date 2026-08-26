import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isRetiredRingCommandCandidate, parseRetiredRingCommand, RetiredRingCommandService, type RetiredRingCommandResult } from "../src/admin/retired-ring-command-service.js";

// 종료 반지 명령의 응답 원장만 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 900n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    },
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
  return { database, sql };
}

describe("retired ring command boundary", () => {
  it("preserves all four legacy guards without accepting upgrade suffix text", () => {
    assert.equal(isRetiredRingCommandCandidate("/반지강화"), true);
    assert.equal(isRetiredRingCommandCandidate("/반지강화 3"), true);
    assert.equal(isRetiredRingCommandCandidate("/반지강화 3 해봐"), false);
    assert.equal(isRetiredRingCommandCandidate("/반지이름조합"), true);
    assert.equal(isRetiredRingCommandCandidate("/반지이름 새 이름"), true);
    assert.equal(isRetiredRingCommandCandidate("/반지속성대상"), true);
  });

  it("keeps the retirement replies and marks only attribute edit as Master-only", () => {
    assert.equal(parseRetiredRingCommand("/반지강화 2")?.data, "반지강화는 펜던트 콘텐츠 전환으로 종료되었습니다.\n기존 반지 강화 매력은 /반지보상받기로 보상받을 수 있습니다.");
    assert.equal(parseRetiredRingCommand("/반지이름조합")?.requiresMaster, false);
    assert.equal(parseRetiredRingCommand("/반지이름 이름")?.requiresMaster, false);
    assert.equal(parseRetiredRingCommand("/반지속성 대상 1")?.requiresMaster, true);
  });

  it("queues one fixed reply without ring, inventory, currency or pet mutation", async () => {
    const command = parseRetiredRingCommand("/반지강화")!;
    const scripted = scriptedDatabase([[]]);
    const result = await new RetiredRingCommandService(scripted.database).reply({ command, idempotencyKey: "ring-event", sourceEventId: "ring-event", destinationId: "room", actorId: "9" });
    assert.equal(result.data, command.data);
    assert.equal(scripted.sql.filter((statement) => statement.includes("INSERT INTO outbox_messages")).length, 1);
    assert.equal(scripted.sql.some((statement) => /UPDATE player_|DELETE FROM|INSERT INTO inventory|currency_/i.test(statement)), false);
  });

  it("returns the stored result without a second outbox", async () => {
    const command = parseRetiredRingCommand("/반지이름조합")!;
    const stored: RetiredRingCommandResult = { status: "replied", data: command.data, outboxId: "1", auditId: "2" };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    const result = await new RetiredRingCommandService(scripted.database).reply({ command, idempotencyKey: "replay", sourceEventId: "replay", destinationId: "room", actorId: "9" });
    assert.deepEqual(result, stored);
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO outbox_messages")), false);
  });
});
