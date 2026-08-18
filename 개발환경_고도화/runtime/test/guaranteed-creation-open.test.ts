import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import {
  GuaranteedCreationOpenService,
  isGuaranteedCreationOpenCommand
} from "../src/mini-pet/guaranteed-creation-open-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

// 창조 확정 오픈 SQL 순서와 transaction rollback을 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[], failAtExecute?: number) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 900n;
  let executeCount = 0;
  let rolledBack = false;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => {
      sql.push(statement);
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string): Promise<DatabaseWriteResult> => {
      sql.push(statement);
      executeCount += 1;
      if (executeCount === failAtExecute) throw new Error("synthetic transaction write failure");
      insertId += 1n;
      return { affectedRows: 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      try {
        return await work(transaction);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
    close: async () => undefined
  };
  return { database, sql, wasRolledBack: () => rolledBack };
}

const owner = { identity_id: 11n, player_id: 21n };
const packageItem = { item_id: 51n, quantity: 1n, version: 2n };
const successMessage = "🐹 창조패키지 확정 오픈!\n\n호이빛💖(+1350000💕)[창조]을(를) 획득했습니다.";

describe("guaranteed creation open policy", () => {
  it("accepts the exact no-argument command only", () => {
    assert.equal(isGuaranteedCreationOpenCommand("/창조오픈"), true);
    for (const message of ["/창조오픈 ", "/창조오픈 1", "/창조오픈 안내", "/창조오픈추가", "/창세오픈"]) {
      assert.equal(isGuaranteedCreationOpenCommand(message), false);
    }
  });
});

describe("guaranteed creation open service", () => {
  it("keeps the legacy silent return for an unregistered sender", async () => {
    const scripted = createScriptedDatabase([[]]);
    const result = await new GuaranteedCreationOpenService(scripted.database).handle({
      externalUserId: "unknown", channelId: "room-1", message: "/창조오픈", eventId: "event-unknown"
    });
    assert.deepEqual(result, { status: "ignored_missing_member" });
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("reports the exact legacy package shortage before checking bag capacity", async () => {
    const scripted = createScriptedDatabase([[owner], [], [{ ...packageItem, quantity: 0n }]]);
    await assert.rejects(
      () => new GuaranteedCreationOpenService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/창조오픈", eventId: "event-short"
      }),
      (error: unknown) => error instanceof ApplicationError
        && error.code === "GUARANTEED_CREATION_PACKAGE_REQUIRED"
        && error.message === "해당 확정 패키지를 보유하고 있지 않습니다."
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("owned_mini_pets")), false);
  });

  it("blocks a full bag without consuming the package", async () => {
    const scripted = createScriptedDatabase([[owner], [], [packageItem], [{ bag_count: 8n }]]);
    await assert.rejects(
      () => new GuaranteedCreationOpenService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/창조오픈", eventId: "event-full"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "MINI_PET_BAG_FULL"
        && error.message === "보관함 공간이 부족합니다.\n공간을 확보한 후 다시 시도해 주세요."
    );
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE inventory_stacks")), false);
  });

  it("consumes one package and grants the configured creation mini pet atomically", async () => {
    const scripted = createScriptedDatabase([[owner], [], [packageItem], [{ bag_count: 0n }], [{ id: 61n }]]);
    const result = await new GuaranteedCreationOpenService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/창조오픈", eventId: "event-open"
    });
    assert.deepEqual(
      { status: result.status, package: result.packageQuantity, data: result.data },
      { status: "opened", package: "0", data: successMessage }
    );
    const ownedInsert = scripted.sql.find((statement) => statement.includes("INSERT INTO owned_mini_pets"));
    assert.ok(ownedInsert?.includes("battle_experience, castle_experience, raid_experience"));
    for (const fragment of [
      "UPDATE inventory_stacks", "INSERT INTO owned_mini_pets", "INSERT INTO inventory_ledger",
      "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"
    ]) assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
  });

  it("returns the stored result on a repeated event without another mutation", async () => {
    const storedResult = { status: "opened" as const, playerId: "21", packageQuantity: "0", ownedMiniPetId: "901" };
    const scripted = createScriptedDatabase([[owner], [{ result_json: JSON.stringify(storedResult) }]]);
    const result = await new GuaranteedCreationOpenService(scripted.database).handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/창조오픈", eventId: "event-repeat"
    });
    assert.deepEqual(result, storedResult);
    assert.equal(scripted.sql.some((statement) => statement.startsWith("UPDATE ") || statement.startsWith("INSERT ")), false);
  });

  it("propagates a write failure through the transaction rollback boundary", async () => {
    const scripted = createScriptedDatabase([[owner], [], [packageItem], [{ bag_count: 0n }], [{ id: 61n }]], 3);
    await assert.rejects(
      () => new GuaranteedCreationOpenService(scripted.database).handle({
        externalUserId: "kakao-11", channelId: "room-1", message: "/창조오픈", eventId: "event-write-failure"
      }),
      /synthetic transaction write failure/
    );
    assert.equal(scripted.wasRolledBack(), true);
    assert.equal(scripted.sql.some((statement) => statement.includes("command_executions")), false);
  });
});
