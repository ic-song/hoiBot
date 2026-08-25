import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { isMiniPetForceUnequipCommand, MiniPetForceUnequipService, parseMiniPetForceUnequipCommand } from "../src/mini-pet/force-unequip-service.js";

function scripted(results: unknown[]) {
  const queue = [...results]; const sql: string[] = []; let insertId = 70n;
  const tx: DatabaseTransaction = {
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return (queue.shift() ?? []) as T; },
    execute: async (statement: string): Promise<DatabaseWriteResult> => { sql.push(statement); insertId += 1n; return { affectedRows: 1n, insertId }; }
  };
  return { sql, database: { ping: async () => undefined, verifyRollback: async () => true, query: tx.query, execute: tx.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(tx), close: async () => undefined } as DatabaseClient };
}

const command = { externalUserId: "admin-user", channelId: "admin-room", eventId: "force-event",
  message: "/미니펫해제 대상 회원", environmentCode: "dev" as const };
const equipped = { owned_mini_pet_id: 700071n, stable_owned_id: "00000000-0000-0000-0000-000000700071",
  sort_index: null, display_name: "장착펫", state_code: "active" };

describe("mini-pet force unequip", () => {
  it("accepts only bare usage or a complete target name", async () => {
    assert.equal(isMiniPetForceUnequipCommand("/미니펫해제"), true);
    assert.equal(isMiniPetForceUnequipCommand("/미니펫해제 대상 회원"), true);
    assert.equal(isMiniPetForceUnequipCommand("/미니펫해제 대상 "), false);
    assert.equal(isMiniPetForceUnequipCommand("/미니펫해제대상"), false);
    assert.equal(parseMiniPetForceUnequipCommand(command.message), "대상 회원");
    const result = await new MiniPetForceUnequipService(scripted([]).database).execute({ ...command, message: "/미니펫해제" });
    assert.equal(result.status, "invalid_command");
  });

  it("returns the equipped stable ID to the next contiguous bag index", async () => {
    const s = scripted([[{ environment_code: "dev" }], [{ operator_id: 2n }], [],
      [{ player_id: 1n, current_display_name: "대상 회원" }], [{ capacity_limit: 100, bag_shape_code: "array" }],
      [equipped], [{ owned_mini_pet_id: 700070n, sort_index: 1 }]]);
    const result = await new MiniPetForceUnequipService(s.database).execute(command);
    assert.equal(result.status, "unequipped"); assert.equal(result.afterSortIndex, 2);
    assert.equal(result.stableOwnedId, equipped.stable_owned_id);
    assert.equal(s.sql.some(sql => sql.includes("mini_pet_force_unequip_events")), true);
  });

  it("rejects unauthorized operators before target lookup", async () => {
    const s = scripted([[{ environment_code: "dev" }], []]);
    await assert.rejects(() => new MiniPetForceUnequipService(s.database).execute(command), /권한/);
    assert.equal(s.sql.some(sql => sql.includes("player_profiles")), false);
  });

  it("replays the operation without touching the newly equipped pet", async () => {
    const prior = { status: "unequipped" as const, stableOwnedId: equipped.stable_owned_id, afterSortIndex: 2 };
    const s = scripted([[{ environment_code: "dev" }], [{ operator_id: 2n }], [{ result_json: prior }]]);
    const result = await new MiniPetForceUnequipService(s.database).execute(command);
    assert.equal(result.replayed, true);
    assert.equal(s.sql.some(sql => sql.includes("FROM player_profiles")), false);
  });

  it("does not mutate when the bag order is not contiguous", async () => {
    const s = scripted([[{ environment_code: "dev" }], [{ operator_id: 2n }], [],
      [{ player_id: 1n, current_display_name: "대상 회원" }], [{ capacity_limit: 100, bag_shape_code: "array" }],
      [equipped], [{ owned_mini_pet_id: 700070n, sort_index: 2 }]]);
    const result = await new MiniPetForceUnequipService(s.database).execute(command);
    assert.equal(result.status, "snapshot_required");
    assert.equal(s.sql.some(sql => sql.includes("INSERT INTO operations")), false);
  });
});
