import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { PetCreationService } from "../src/pet/pet-creation-service.js";
import { generateStarterPet, parsePetCreationCommand } from "../src/pet/pet-creation-policy.js";

// 펫 생성 Service가 실행한 SQL과 순서를 기록하는 테스트 DB를 만듭니다.
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const sql: string[] = [];
  let insertId = 100n;
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
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, sql };
}

describe("pet creation policy", () => {
  it("accepts only a full command with a whitespace-free 1-6 character name", () => {
    assert.equal(parsePetCreationCommand("/펫생성 봉봉"), "봉봉");
    assert.equal(parsePetCreationCommand("/펫생성 일곱글자입니다"), null);
    assert.equal(parsePetCreationCommand("/펫생성 봉봉 해봐"), null);
    assert.equal(parsePetCreationCommand("/펫생성 "), null);
  });

  it("uses the legacy personality, type and emoji candidates deterministically", () => {
    const values = [0, 0, 0.5, 0];
    const generated = generateStarterPet(() => values.shift() ?? 0);
    assert.deepEqual(generated, {
      typeCode: "legacy-sky", typeDisplayName: "하늘", imageValue: "🦃", personality: "다정한", unique: false
    });
  });
});

describe("pet creation service", () => {
  it("creates every starter relation and queues the legacy reply sequence atomically", async () => {
    const scripted = createScriptedDatabase([
      [{ identity_id: 11n, player_id: 21n, current_display_name: "합성회원 남" }],
      [],
      [{ id: 31n, display_name: null }]
    ]);
    const values = [0, 0, 0.5, 0];
    const service = new PetCreationService(scripted.database, () => values.shift() ?? 0, () => new Date("2026-08-13T01:02:03.000Z"));
    const result = await service.handle({
      externalUserId: "kakao-11", channelId: "room-1", message: "/펫생성 봉봉", eventId: "event-pet-create"
    });

    assert.equal(result.status, "created");
    assert.equal(result.petName, "봉봉");
    assert.equal(result.personality, "다정한");
    assert.equal(result.replies.length, 2);
    assert.equal(result.replies[0]?.data, "펫이 탄생했습니다!");
    assert.match(result.replies[1]?.data ?? "", /🌱합성회원 남/);
    for (const fragment of [
      "UPDATE player_pets", "INSERT INTO player_pet_elementals", "INSERT INTO pet_skill_inventory",
      "INSERT INTO owned_mini_pets", "INSERT INTO player_homes", "INSERT INTO command_executions",
      "INSERT INTO command_audit", "INSERT INTO outbox_messages", "UPDATE operations SET status = 'completed'"
    ]) {
      assert.ok(scripted.sql.some((statement) => statement.includes(fragment)), fragment);
    }
  });

  it("rejects an existing pet without mutating starter tables", async () => {
    const scripted = createScriptedDatabase([
      [{ identity_id: 12n, player_id: 22n, current_display_name: "기존회원 여" }],
      [],
      [{ id: 32n, display_name: "이미있음" }]
    ]);
    await assert.rejects(
      () => new PetCreationService(scripted.database).handle({
        externalUserId: "kakao-12", channelId: "room-2", message: "/펫생성 새펫", eventId: "event-existing-pet"
      }),
      (error: unknown) => error instanceof ApplicationError && error.code === "PET_ALREADY_EXISTS"
    );
    assert.equal(scripted.sql.some((statement) => statement.includes("UPDATE player_pets SET")), false);
  });
});
