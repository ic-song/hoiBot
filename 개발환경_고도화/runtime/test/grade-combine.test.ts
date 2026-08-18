import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { GradeCombineService, isGradeCombineCommand, parseGradeCombineCommand } from "../src/mini-pet/grade-combine-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

interface SqlCall { statement: string; values: readonly unknown[]; }
function createScriptedDatabase(queryResults: unknown[]) {
  const remaining = [...queryResults];
  const calls: SqlCall[] = [];
  let insertId = 1000n;
  const transaction: DatabaseTransaction = {
    query: async <T>(statement: string, values: readonly unknown[] = []): Promise<T> => {
      calls.push({ statement, values });
      if (remaining.length === 0) throw new Error(`Unexpected query: ${statement}`);
      return remaining.shift() as T;
    },
    execute: async (statement: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
      calls.push({ statement, values });
      insertId += 1n;
      return { affectedRows: statement.startsWith("DELETE FROM owned_mini_pets") ? 2n : 1n, insertId };
    }
  };
  const database: DatabaseClient = {
    ping: async () => undefined, verifyRollback: async () => true,
    query: async () => { throw new Error("Unexpected non-transactional query."); },
    execute: async () => { throw new Error("Unexpected non-transactional execute."); },
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction),
    close: async () => undefined
  };
  return { database, calls };
}

const owner = { identity_id: 11n, player_id: 21n, current_display_name: "합성회원 남", tier_code: "seedling" };
function pet(id: bigint, grade: string, experience: bigint, name = `재료${id}`) {
  return { id, definition_id: id + 100n, display_name: name, custom_name: name, grade_name: grade, emoji_value: "🐹", battle_experience: experience };
}
const command = (message: string, eventId = "event-1") => ({ externalUserId: "kakao-11", channelId: "room-1", message, eventId });

describe("grade combine parser parity", () => {
  it("preserves broad startsWith guards and parseInt suffix acceptance", () => {
    assert.equal(isGradeCombineCommand("/미니펫조합태초+확장 1abc 2xyz"), true);
    const parsed = parseGradeCombineCommand("/미니펫조합태초+확장 1abc 2xyz");
    assert.equal(parsed.policy.label, "태초+");
    assert.deepEqual([parsed.firstIndex, parsed.secondIndex], [1, 2]);
    assert.equal(parseGradeCombineCommand("/미니펫조합창조접미").automatic, true);
  });

  it("preserves usage, numeric, and duplicate-index errors", () => {
    for (const [message, code] of [
      ["/미니펫조합창세", "GRADE_COMBINE_USAGE"],
      ["/미니펫조합창세 x 2", "GRADE_COMBINE_INDEX_NUMBER_REQUIRED"],
      ["/미니펫조합창세 2 2", "GRADE_COMBINE_DISTINCT_INDEX_REQUIRED"]
    ] as const) assert.throws(() => parseGradeCombineCommand(message), (error: unknown) => error instanceof ApplicationError && error.code === code);
  });
});

describe("grade combine transaction", () => {
  it("consumes both primordial sources on the 50% failure path", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [pet(1n, "태초", 20n), pet(2n, "태초", 10n)]]);
    const result = await new GradeCombineService(scripted.database, () => 0.5).handle(command("/미니펫조합태초+ 1 2"));
    assert.equal(result.status, "failed");
    assert.deepEqual(result.consumedOwnedMiniPetIds, ["1", "2"]);
    assert.match(result.data!, /성공 확률: 50%/);
    assert.ok(scripted.calls.some(({ statement }) => statement.startsWith("DELETE FROM owned_mini_pets")));
    assert.equal(scripted.calls.some(({ statement }) => statement.startsWith("INSERT INTO owned_mini_pets")), false);
  });

  it("consumes both primordial-plus sources on the 70% failure path", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [pet(3n, "태초+", 20n), pet(4n, "태초+", 10n)]]);
    const result = await new GradeCombineService(scripted.database, () => 0.3).handle(command("/미니펫조합창세 1 2"));
    assert.equal(result.status, "failed");
    assert.match(result.data!, /성공 확률: 30%/);
    assert.deepEqual(result.consumedOwnedMiniPetIds, ["3", "4"]);
  });

  it("creates the selected reward and writes operation, audit, execution, and outbox atomically", async () => {
    const randomValues = [0.499999, 0];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [pet(1n, "태초", 20n), pet(2n, "태초", 10n)], [{ id: 501n }]]);
    const result = await new GradeCombineService(scripted.database, () => randomValues.shift() ?? 0).handle(command("/미니펫조합태초+ 1 2"));
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.reward, { name: "찰보리", emoji: "🌾", grade: "태초+", experience: "700500" });
    assert.match(result.data!, /획득: 찰보리🌾\(\+700500💕\)\[태초\+\]/);
    for (const fragment of ["INSERT INTO operations", "DELETE FROM owned_mini_pets", "INSERT INTO owned_mini_pets", "INSERT INTO command_executions", "INSERT INTO command_audit", "INSERT INTO outbox_messages"]) {
      assert.ok(scripted.calls.some(({ statement }) => statement.includes(fragment)), fragment);
    }
  });

  it("succeeds immediately below the 30% genesis boundary", async () => {
    const randomValues = [0.299999, 0];
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [pet(3n, "태초+", 20n), pet(4n, "태초+", 10n)], [{ id: 551n }]]);
    const result = await new GradeCombineService(scripted.database, () => randomValues.shift() ?? 0).handle(command("/미니펫조합창세 1 2"));
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.reward, { name: "미카엘", emoji: "👼", grade: "창세", experience: "805000" });
  });

  it("uses sorted bag order for automatic creation and also permits manual creation", async () => {
    const unsorted = [pet(10n, "창세", 10n, "낮음"), pet(11n, "태초+", 999n), pet(12n, "창세", 30n, "높음"), pet(13n, "창세", 20n, "중간")];
    const automatic = createScriptedDatabase([[{ active_count: 0n }], [owner], [], unsorted, [{ id: 601n }]]);
    const autoResult = await new GradeCombineService(automatic.database, () => 0).handle(command("/미니펫조합창조"));
    assert.deepEqual(autoResult.consumedOwnedMiniPetIds, ["12", "13"]);
    assert.equal(autoResult.reward?.name, "컬렉션창조 미니펫");

    const manual = createScriptedDatabase([[{ active_count: 0n }], [owner], [], unsorted, [{ id: 601n }]]);
    const manualResult = await new GradeCombineService(manual.database, () => 0).handle(command("/미니펫조합창조 2 3"));
    assert.deepEqual(manualResult.consumedOwnedMiniPetIds, ["12", "13"]);
  });

  it("raises after source deletion so the real transaction rolls the sources back when reward definition is missing", async () => {
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], [pet(1n, "태초", 20n), pet(2n, "태초", 10n)], []]);
    await assert.rejects(() => new GradeCombineService(scripted.database, () => 0).handle(command("/미니펫조합태초+ 1 2")),
      (error: unknown) => error instanceof ApplicationError && error.code === "GRADE_COMBINE_REWARD_DEFINITION_REQUIRED");
    const operationIndex = scripted.calls.findIndex(({ statement }) => statement.startsWith("INSERT INTO operations"));
    const deleteIndex = scripted.calls.findIndex(({ statement }) => statement.startsWith("DELETE FROM owned_mini_pets"));
    const definitionIndex = scripted.calls.findIndex(({ statement }) => statement.startsWith("SELECT id FROM mini_pet_definitions"));
    assert.ok(operationIndex >= 0 && operationIndex < deleteIndex && deleteIndex < definitionIndex);
    assert.equal(scripted.calls.some(({ statement }) => statement.startsWith("INSERT INTO owned_mini_pets")), false);
  });

  it("returns the stored operation on duplicate/restart replay without mutation", async () => {
    const stored = { status: "failed" as const, playerId: "21", consumedOwnedMiniPetIds: ["1", "2"], data: "stored" };
    const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [{ result_json: JSON.stringify(stored) }]]);
    const result = await new GradeCombineService(scripted.database, () => { throw new Error("random must not run"); }).handle(command("/미니펫조합태초+ 1 2", "repeat"));
    assert.deepEqual(result, stored);
    assert.equal(scripted.calls.some(({ statement }) => statement.startsWith("DELETE ") || statement.startsWith("INSERT ") || statement.startsWith("UPDATE ")), false);
  });

  it("preserves bag, missing-index, grade, and automatic-material errors without mutation", async () => {
    const cases: Array<{ message: string; bag: ReturnType<typeof pet>[]; code: string }> = [
      { message: "/미니펫조합태초+ 1 2", bag: [], code: "GRADE_COMBINE_MATERIAL_SHORTAGE" },
      { message: "/미니펫조합태초+ 1 3", bag: [pet(1n, "태초", 2n), pet(2n, "태초", 1n)], code: "GRADE_COMBINE_INDEX_NOT_FOUND" },
      { message: "/미니펫조합태초+ 1 2", bag: [pet(1n, "태초", 2n), pet(2n, "창세", 1n)], code: "GRADE_COMBINE_GRADE_MISMATCH" },
      { message: "/미니펫조합창조", bag: [pet(1n, "창세", 2n), pet(2n, "태초+", 1n)], code: "GRADE_COMBINE_AUTO_MATERIAL_REQUIRED" }
    ];
    for (const value of cases) {
      const scripted = createScriptedDatabase([[{ active_count: 0n }], [owner], [], value.bag]);
      await assert.rejects(() => new GradeCombineService(scripted.database, () => 0).handle(command(value.message)),
        (error: unknown) => error instanceof ApplicationError && error.code === value.code);
      assert.equal(scripted.calls.some(({ statement }) => statement.startsWith("DELETE ") || statement.startsWith("INSERT ") || statement.startsWith("UPDATE ")), false);
    }
  });
});
