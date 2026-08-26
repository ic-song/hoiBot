import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { parsePetTitleAddCommand, PetTitleAddService, type PetTitleAddResult } from "../src/admin/pet-title-add-service.js";

// 펫 타이틀 지급의 SQL 순서와 멱등 결과를 기록하는 합성 DB를 만듭니다.
function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 300n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId };
    },
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined,
  };
  return { database, sql };
}

describe("pet title add command boundary", () => {
  it("parses only the complete legacy comma and price form", () => {
    assert.deepEqual(parsePetTitleAddCommand("/펫타이틀추가 대상, 별빛 타이틀 100000"), {
      targetName: "대상", titleName: "별빛 타이틀", priceDigits: "100000",
    });
    assert.equal(parsePetTitleAddCommand("/펫타이틀추가 대상,별빛 100"), null);
    assert.equal(parsePetTitleAddCommand("/펫타이틀추가 대상, 별빛 100 해봐"), null);
  });

  it("adds a stable no-pet title instance with raw price and order", async () => {
    const scripted = scriptedDatabase([[], [{ player_id: 41n, display_name: "대상" }], [{ last_order: 2n }]]);
    const result = await new PetTitleAddService(scripted.database).add({
      targetName: "대상", titleName: "별빛 타이틀", priceDigits: "999999999999999999999999999999999999",
      idempotencyKey: "pet-title-add", sourceEventId: "pet-title-add", destinationId: "room", operatorId: "7",
    });
    assert.equal(result.displayOrder, "3");
    assert.match(result.titleKey, /^PET_TITLE_[0-9a-f]{64}$/);
    assert.equal(result.data, "[대상] 님에게\n[별빛 타이틀] 펫 타이틀이 부여되었습니다.");
    assert.ok(scripted.sql.some((statement) => statement.includes("player_pet_title_instances")));
    assert.equal(scripted.sql.some((statement) => statement.includes("player_pets")), false);
    for (const ledger of ["operations", "command_executions", "command_audit", "outbox_messages"])
      assert.ok(scripted.sql.some((statement) => statement.includes(ledger)), ledger);
  });

  it("returns the stored result without adding another instance", async () => {
    const stored: PetTitleAddResult = {
      status: "added", playerId: "1", instanceId: "2", instanceKey: "key", titleKey: "title",
      displayOrder: "1", data: "reply", outboxId: "3", auditId: "4",
    };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    const result = await new PetTitleAddService(scripted.database).add({
      targetName: "대상", titleName: "별빛", priceDigits: "1", idempotencyKey: "replay",
      sourceEventId: "replay", destinationId: "room", operatorId: "7",
    });
    assert.deepEqual(result, stored);
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO player_pet_title_instances")), false);
  });
});

