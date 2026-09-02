import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { calculateCanonicalMiniPetCharm, MariaCanonicalMiniPetRepository } from "../src/mini-pet/canonical-mini-pet-repository.js";

const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-mini-pet-v1.json", import.meta.url), "utf8")) as {
  dependency: string;
  definition: { mini_pet_id: string; base_battle_charm: string; base_castle_charm: string; base_raid_charm: string };
  enhancementRules: Array<{ targetEnhancementLevel: number; battleCharmGain: string; castleCharmGain: string; raidCharmGain: string }>;
  ownedInstances: Array<{ owned_mini_pet_id: string; mini_pet_id: string }>;
  expectedLevel2Charm: string;
};

function fingerprint(miniPetId: string, bound: boolean): string {
  return createHash("sha256").update(JSON.stringify({ operationKind: "acquire", miniPetId, bound })).digest("hex");
}

function database(replays: Array<Record<string, unknown>> = [], duplicateReplayOnce = false): { client: DatabaseClient; writes: Array<{ sql: string; values: readonly unknown[] }> } {
  const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
  let replayReads = 0;
  let duplicate = duplicateReplayOnce;
  const query = async <T>(sql: string): Promise<T> => {
    if (sql.includes("canonical_mini_pet_operation_replays")) {
      replayReads += 1;
      return (duplicateReplayOnce && replayReads === 1 ? [] : replays) as T;
    }
    if (sql.includes("canonical_mini_pet_definitions")) return [{ mini_pet_id: fixture.definition.mini_pet_id }] as T;
    if (sql.includes("canonical_owned_mini_pet_instances")) return fixture.ownedInstances as T;
    return [] as T;
  };
  const execute = async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
    writes.push({ sql, values });
    if (duplicate && sql.includes("canonical_mini_pet_operation_replays")) {
      duplicate = false;
      throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    }
    return { affectedRows: 1n, insertId: 0n };
  };
  const transaction: DatabaseTransaction = { query, execute };
  return { writes, client: { ping: async () => undefined, verifyRollback: async () => true, query, execute, withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => work(transaction), close: async () => undefined } };
}

test("calculates non-linear enhanced charms from definition rules without an owned-row snapshot", () => {
  const result = calculateCanonicalMiniPetCharm(
    { battleCharm: BigInt(fixture.definition.base_battle_charm), castleCharm: BigInt(fixture.definition.base_castle_charm), raidCharm: BigInt(fixture.definition.base_raid_charm) },
    2,
    fixture.enhancementRules.map((rule) => ({ targetEnhancementLevel: rule.targetEnhancementLevel, battleCharmGain: BigInt(rule.battleCharmGain), castleCharmGain: BigInt(rule.castleCharmGain), raidCharmGain: BigInt(rule.raidCharmGain) })),
  );
  assert.equal(result.battleCharm.toString(), fixture.expectedLevel2Charm);
  assert.equal(result.castleCharm.toString(), fixture.expectedLevel2Charm);
  assert.equal(result.raidCharm.toString(), fixture.expectedLevel2Charm);
});

test("creates a distinct owned instance for each acquisition of the same definition", async () => {
  assert.equal(fixture.dependency, "444_canonical_item_inventory.sql -> canonical_players(player_id)");
  assert.equal(new Set(fixture.ownedInstances.map((row) => row.mini_pet_id)).size, 1);
  assert.equal(new Set(fixture.ownedInstances.map((row) => row.owned_mini_pet_id)).size, 2);
  const mock = database();
  const repository = new MariaCanonicalMiniPetRepository(mock.client);
  const first = await repository.acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false });
  const second = await repository.acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-2", bound: false });
  assert.notEqual(first.ownedMiniPetId, second.ownedMiniPetId);
  const ownedWrites = mock.writes.filter((entry) => entry.sql.includes("INSERT INTO canonical_owned_mini_pet_instances"));
  assert.equal(ownedWrites.length, 2);
  assert.ok(ownedWrites.every((entry) => entry.values[2] === "minipet1"));
});

test("replays an identical request and rejects a changed payload", async () => {
  const replay = { mini_pet_operation_id: "operat01", owned_mini_pet_id: "ownedmp1", operation_kind: "acquire", payload_fingerprint: fingerprint("minipet1", false) };
  const repository = new MariaCanonicalMiniPetRepository(database([replay]).client);
  assert.deepEqual(await repository.acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false }), { miniPetOperationId: "operat01", ownedMiniPetId: "ownedmp1", replayed: true });
  await assert.rejects(repository.acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: true }), /REQUEST_PAYLOAD_CONFLICT/);
});

test("re-reads the committed replay after a same-key duplicate race", async () => {
  const replay = { mini_pet_operation_id: "operat01", owned_mini_pet_id: "ownedmp1", operation_kind: "acquire", payload_fingerprint: fingerprint("minipet1", false) };
  const result = await new MariaCanonicalMiniPetRepository(database([replay], true).client).acquire({ actor: "migration", playerId: "player01", miniPetId: "minipet1", requestKey: "event-1", bound: false });
  assert.deepEqual(result, { miniPetOperationId: "operat01", ownedMiniPetId: "ownedmp1", replayed: true });
});

test("equips only an owned instance for the same player and updates audit fields", async () => {
  const mock = database();
  await new MariaCanonicalMiniPetRepository(mock.client, () => new Date("2026-09-02T16:45:00.000Z")).equip({ actor: "tester", playerId: "player01", ownedMiniPetId: "ownedmp2" });
  assert.ok(mock.writes.some((entry) => entry.sql.includes("equipped_flag=FALSE")));
  assert.ok(mock.writes.some((entry) => entry.sql.includes("equipped_flag=TRUE") && entry.values.includes("2026-09-03 01:45:00")));
});
