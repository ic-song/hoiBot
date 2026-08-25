import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isYakitoriPackageUseCommand, YakitoriPackageUseService } from "../src/mini-pet/yakitori-package-use-service.js";

function scriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 1000n;
  const tx: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected query outside transaction."); },
    execute: async () => { throw new Error("Unexpected execute outside transaction."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(tx),
    close: async () => undefined
  };
  return { database, sql };
}

const definitions = Array.from({ length: 10 }, (_, index) => ({
  id: BigInt(2000 + index),
  code: `mini_pet_yakitori_${String(index + 1).padStart(2, "0")}`,
  display_name: `태초미니펫${index + 1}`
}));
const command = {
  externalUserId: "kakao-yakitori",
  channelId: "room-yakitori",
  message: "/이랏싸이마쎄",
  eventId: "event-yakitori",
  environmentCode: "dev" as const
};

describe("yakitori package command", () => {
  it("accepts only the exact independent package command", () => {
    assert.equal(isYakitoriPackageUseCommand("/이랏싸이마쎄"), true);
    for (const value of ["/이랏싸이마쎄 1", "/이랏싸이마쎄 해줘", "이랏싸이마쎄"]) {
      assert.equal(isYakitoriPackageUseCommand(value), false);
    }
  });

  it("consumes one package and grants ticket plus ten stable mini-pet instances atomically", async () => {
    const scripted = scriptedDatabase([
      [{ environment_code: "dev" }],
      [{ active_count: 0n }],
      [{ identity_id: 10n, player_id: 20n, current_display_name: "합성회원", tier_code: null }],
      [],
      [{ bag_count: 3n }],
      [
        { item_id: 31n, code: "bag_3241894752b82f7a", quantity: 2n, version: 4n },
        { item_id: 32n, code: "bag_yakitori_package_10", quantity: 1n, version: 5n }
      ],
      definitions
    ]);
    const result = await new YakitoriPackageUseService(scripted.database).handle(command);
    assert.equal(result.status, "opened");
    assert.equal(result.packageQuantity, "0");
    assert.equal(result.ticketQuantity, "1502");
    assert.equal(result.ownedMiniPetIds?.length, 10);
    assert.equal(result.stableOwnedIds?.length, 10);
    assert.equal(scripted.sql.filter((value) => value.includes("INSERT INTO owned_mini_pets")).length, 10);
    assert.ok(scripted.sql.some((value) => value.includes("DELETE FROM inventory_stacks")));
    for (const fragment of [
      "INSERT INTO inventory_ledger", "INSERT INTO command_executions",
      "INSERT INTO command_audit", "INSERT INTO outbox_messages",
      "UPDATE operations SET status = 'completed'"
    ]) assert.ok(scripted.sql.some((value) => value.includes(fragment)), fragment);
  });

  it("rejects a changed request for the same event without mutation", async () => {
    const scripted = scriptedDatabase([
      [{ environment_code: "dev" }],
      [{ active_count: 0n }],
      [{ identity_id: 10n, player_id: 20n, current_display_name: "합성회원", tier_code: null }],
      [{ id: 99n, status: "completed", result_json: { status: "opened" }, request_hash: "different", stale_processing: 0 }]
    ]);
    await assert.rejects(
      () => new YakitoriPackageUseService(scripted.database).handle(command),
      (error: unknown) => error instanceof ApplicationError && error.code === "YAKITORI_REPLAY_MISMATCH"
    );
    assert.equal(scripted.sql.some((value) => value.includes("UPDATE inventory_stacks")), false);
  });

  it("rejects an environment mismatch before inventory access", async () => {
    const scripted = scriptedDatabase([[{ environment_code: "prod" }]]);
    await assert.rejects(
      () => new YakitoriPackageUseService(scripted.database).handle(command),
      (error: unknown) => error instanceof ApplicationError && error.code === "YAKITORI_ENVIRONMENT_MISMATCH"
    );
    assert.equal(scripted.sql.length, 1);
  });

  it("keeps the legacy silent block during an active castle siege", async () => {
    const scripted = scriptedDatabase([[{ environment_code: "dev" }], [{ active_count: 1n }]]);
    const result = await new YakitoriPackageUseService(scripted.database).handle(command);
    assert.deepEqual(result, { status: "blocked_by_castle_siege" });
    assert.equal(scripted.sql.length, 2);
  });

  it("refuses capacity overflow without inventory mutation", async () => {
    const scripted = scriptedDatabase([
      [{ environment_code: "dev" }],
      [{ active_count: 0n }],
      [{ identity_id: 10n, player_id: 20n, current_display_name: "합성회원", tier_code: "seedling" }],
      [],
      [{ bag_count: 91n }]
    ]);
    await assert.rejects(
      () => new YakitoriPackageUseService(scripted.database).handle(command),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINI_PET_BAG_CAPACITY_REQUIRED"
    );
    assert.equal(scripted.sql.some((value) => value.includes("UPDATE inventory_stacks")), false);
  });
});
