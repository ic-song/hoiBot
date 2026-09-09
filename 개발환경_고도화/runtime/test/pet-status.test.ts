import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isPetStatusCommand, PetStatusService, type PetStatusResult } from "../src/pet/pet-status-service.js";

function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults]; const sql: string[] = []; let insertId = 400n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement); if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
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

describe("pet status command boundary", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isPetStatusCommand("/펫상태"), true);
    assert.equal(isPetStatusCommand("/펫상태 해봐"), false);
    assert.equal(isPetStatusCommand("/펫상태1"), false);
  });

  it("queues the imported newimg-preferred image without pet mutation", async () => {
    const scripted = scriptedDatabase([[], [{ identity_id: 9n, pet_id: 10n, pet_name: "호이", pet_image: "🐶✨" }]]);
    const result = await new PetStatusService(scripted.database).read({
      externalUserId: "user", destinationId: "room", idempotencyKey: "status-event", sourceEventId: "status-event",
    });
    assert.equal(result.data, "🐶✨");
    assert.equal(scripted.sql.filter((statement) => statement.includes("INSERT INTO outbox_messages")).length, 1);
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE player_pets") || statement.includes("DELETE ")), false);
  });

  it("records no reply when the linked player has no named pet image", async () => {
    const scripted = scriptedDatabase([[], [{ identity_id: 9n, pet_id: null, pet_name: null, pet_image: null }]]);
    const result = await new PetStatusService(scripted.database).read({
      externalUserId: "user", destinationId: "room", idempotencyKey: "no-pet", sourceEventId: "no-pet",
    });
    assert.equal(result.status, "no_reply"); assert.equal(result.data, null);
    assert.equal(scripted.sql.some((statement) => statement.includes("INSERT INTO outbox_messages")), false);
  });

  it("returns a stored result without a second pet read or outbox", async () => {
    const stored: PetStatusResult = { status: "displayed", petId: "10", data: "🐶", outboxId: "1", auditId: "2" };
    const scripted = scriptedDatabase([[{ result_json: JSON.stringify(stored) }]]);
    const result = await new PetStatusService(scripted.database).read({
      externalUserId: "user", destinationId: "room", idempotencyKey: "replay", sourceEventId: "replay",
    });
    assert.deepEqual(result, stored);
    assert.equal(scripted.sql.some((statement) => statement.includes("FROM external_identities")), false);
  });
});
