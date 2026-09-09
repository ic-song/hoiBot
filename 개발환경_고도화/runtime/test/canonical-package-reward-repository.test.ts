import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { assertSafeCanonicalNestedPackageTarget, CANONICAL_PACKAGE_MAX_NESTED_DEPTH, CANONICAL_PACKAGE_REQUEST_KEY_MAX_LENGTH, MariaCanonicalPackageRewardRepository, type CanonicalPackageImportInput } from "../src/package/canonical-package-reward-repository.js";

const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-package-reward-v1.json", import.meta.url), "utf8")) as {
  sourceSystem: string; sourceNamespace: string; sourceIdentifier: string; requestKey: string; packageName: string; packageDescription: string;
  maxOpenQuantity: number; selectionMode: "all"; resolvedRewards: Array<Record<string, string | number>>; gapReward: Record<string, string | number>;
  expected: Record<string, number>;
};
const migration = readFileSync(new URL("../migrations/451_canonical_package_reward.sql", import.meta.url), "utf8");

function input(overrides: Partial<CanonicalPackageImportInput> = {}): CanonicalPackageImportInput {
  return {
    actor: "fixture", sourceSystem: fixture.sourceSystem, sourceNamespace: fixture.sourceNamespace,
    sourceIdentifier: fixture.sourceIdentifier, requestKey: fixture.requestKey, packageName: fixture.packageName,
    packageDescription: fixture.packageDescription, maxOpenQuantity: fixture.maxOpenQuantity, active: true, selectionMode: fixture.selectionMode,
    rewards: [
      { kind: "item", sourceRewardIdentifier: "reward-001", rewardOrder: 1, itemId: "item0001", quantity: 3n, probability: "1" },
      { kind: "package", sourceRewardIdentifier: "reward-002", rewardOrder: 2, packageId: "pack0002", quantity: 1n, probability: "0.25" },
      { kind: "gap", sourceRewardIdentifier: "reward-003", rewardOrder: 3, targetKind: "item", targetSourceIdentifier: "legacy-missing-item", targetDisplayName: "미확인보상🎁(원문)", quarantineReason: "TARGET_UNMAPPED" },
    ],
    ...overrides,
  };
}

function database(options: { replay?: Record<string, string>; imported?: Record<string, string>; deadlockOnce?: boolean; deadlockAttempts?: number; unsafeNested?: Record<string, string | number>; forceUnsafeNested?: boolean; invalidDetail?: boolean } = {}): { client: DatabaseClient; writes: Array<{ sql: string; values: readonly unknown[] }>; attempts: () => number } {
  const writes: Array<{ sql: string; values: readonly unknown[] }> = [];
  let attempts = 0;
  const query = async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
    if (sql.includes("canonical_package_definition_replays")) return (options.replay === undefined ? [] : [options.replay]) as T;
    if (sql.includes("canonical_package_definition_imports")) return (options.imported === undefined ? [] : [options.imported]) as T;
    if (sql.includes("WITH RECURSIVE package_descendants")) {
      if (options.unsafeNested === undefined) return [] as T;
      const depth = Number(options.unsafeNested.depth);
      const sourcePackageId = String(values[2]);
      const rejectedDepth = Number(values[3]);
      const isCycle = String(options.unsafeNested.package_id) === sourcePackageId && depth > 0;
      return (options.forceUnsafeNested || isCycle || depth >= rejectedDepth ? [options.unsafeNested] : []) as T;
    }
    if (sql.includes("HAVING detail_count<>1")) return (options.invalidDetail ? [{ package_reward_entry_id: "entry001", detail_count: 2 }] : []) as T;
    if (sql.includes("canonical_item_definitions") || sql.includes("canonical_package_definitions")) return [{ target_id: "target01" }] as T;
    if (sql.includes("object_identity_crosswalks")) return [] as T;
    return [] as T;
  };
  const execute = async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => { writes.push({ sql, values }); return { affectedRows: 1n, insertId: 0n }; };
  const transaction: DatabaseTransaction = { query, execute };
  return {
    writes, attempts: () => attempts,
    client: { ping: async () => undefined, verifyRollback: async () => true, query, execute, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => { attempts += 1; if ((options.deadlockOnce && attempts === 1) || attempts <= (options.deadlockAttempts ?? 0)) throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 }); return work(transaction); }, close: async () => undefined },
  };
}

test("migration451 keeps package definitions, typed targets, gaps, and replay additive", () => {
  for (const table of ["canonical_package_definitions", "canonical_package_definition_imports", "canonical_package_reward_groups", "canonical_package_reward_entries", "canonical_package_item_rewards", "canonical_package_nested_rewards", "canonical_package_reward_quarantines", "canonical_package_definition_replays"]) assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  assert.match(migration, /FOREIGN KEY \(item_id\) REFERENCES canonical_item_definitions \(item_id\)/);
  assert.match(migration, /FOREIGN KEY \(package_id\) REFERENCES canonical_package_definitions \(package_id\)/);
  assert.match(migration, /UNIQUE KEY uq_canonical_package_reward_entry_order \(package_reward_group_id, reward_order\)/);
  assert.doesNotMatch(migration, /ALTER TABLE (?:package_catalog|package_rewards|object_registry)/i);
  assert.doesNotMatch(migration, /\b(?:package|item)_code\b/i);
  assert.match(migration, /request_key VARCHAR\(182\)/);
  assert.equal((migration.match(/INSERT_USER VARCHAR\(100\)/g) ?? []).length, 8);
});

test("imports one exact-name definition with item, nested-package, and quarantined gap targets", async () => {
  const mock = database();
  const result = await new MariaCanonicalPackageRewardRepository(mock.client).importDefinition(input());
  assert.equal(result.replayed, false);
  assert.equal(mock.writes.filter((row) => row.sql.includes("INSERT INTO canonical_package_definitions(")).length, fixture.expected.definitionRows);
  assert.equal(mock.writes.filter((row) => row.sql.includes("INSERT INTO canonical_package_reward_entries")).length, fixture.expected.rewardEntryRows);
  assert.equal(mock.writes.filter((row) => row.sql.includes("INSERT INTO canonical_package_item_rewards")).length, fixture.expected.itemRewardRows);
  assert.equal(mock.writes.filter((row) => row.sql.includes("INSERT INTO canonical_package_nested_rewards")).length, fixture.expected.nestedRewardRows);
  assert.equal(mock.writes.filter((row) => row.sql.includes("INSERT INTO canonical_package_reward_quarantines")).length, fixture.expected.quarantineRows);
  const definition = mock.writes.find((row) => row.sql.includes("INSERT INTO canonical_package_definitions("));
  assert.equal(definition?.values[1], "다이아상자💎(/다이아상자오픈)");
  assert.equal(definition?.values[4], false, "a package with an unresolved reward must remain inactive");
  assert.equal(mock.writes.filter((row) => /INSERT INTO (?:package_catalog|package_item_definitions|object_registry)/.test(row.sql)).length, fixture.expected.legacyWrites);
});

test("replays the same request and rejects changed payload or changed source payload", async () => {
  const first = database();
  const created = await new MariaCanonicalPackageRewardRepository(first.client).importDefinition(input());
  const replayWrite = first.writes.find((row) => row.sql.includes("INSERT INTO canonical_package_definition_replays"));
  const fingerprint = String(replayWrite?.values[4]);
  const replay = database({ replay: { package_definition_operation_id: created.packageDefinitionOperationId, package_id: created.packageId, payload_fingerprint: fingerprint } });
  assert.equal((await new MariaCanonicalPackageRewardRepository(replay.client).importDefinition(input())).replayed, true);
  await assert.rejects(new MariaCanonicalPackageRewardRepository(replay.client).importDefinition(input({ packageName: "변경" })), /REQUEST_PAYLOAD_CONFLICT/);
  const changedSourceIdentifier = database({ replay: { package_definition_operation_id: created.packageDefinitionOperationId, package_id: created.packageId, payload_fingerprint: fingerprint } });
  await assert.rejects(new MariaCanonicalPackageRewardRepository(changedSourceIdentifier.client).importDefinition(input({ sourceIdentifier: "fixture-package-002" })), /REQUEST_PAYLOAD_CONFLICT/);
  assert.equal(changedSourceIdentifier.writes.length, 0);
  const imported = database({ imported: { package_id: created.packageId, payload_fingerprint: "0".repeat(64) } });
  await assert.rejects(new MariaCanonicalPackageRewardRepository(imported.client).importDefinition(input({ requestKey: "second-request" })), /SOURCE_PAYLOAD_CONFLICT/);
});

test("rejects double-target, missing-target, target-kind mismatch, and duplicate-order inputs", async () => {
  const invalid = database();
  await assert.rejects(new MariaCanonicalPackageRewardRepository(invalid.client).importDefinition(input({ rewards: [{ kind: "item", sourceRewardIdentifier: "x", rewardOrder: 1, itemId: "pack0002", quantity: 1n }, { kind: "package", sourceRewardIdentifier: "y", rewardOrder: 1, packageId: "pack0002", quantity: 1n }] })), /REWARD_ORDER_INVALID/);
  assert.equal(invalid.writes.length, 0);
  const doubleTarget = { kind: "item", sourceRewardIdentifier: "x", rewardOrder: 1, itemId: "item0001", packageId: "pack0002", quantity: 1n } as unknown as CanonicalPackageImportInput["rewards"][number];
  await assert.rejects(new MariaCanonicalPackageRewardRepository(database().client).importDefinition(input({ rewards: [doubleTarget] })), /TARGET_SHAPE_INVALID/);
  const missingKind = { sourceRewardIdentifier: "x", rewardOrder: 1, itemId: "item0001", quantity: 1n } as unknown as CanonicalPackageImportInput["rewards"][number];
  await assert.rejects(new MariaCanonicalPackageRewardRepository(database().client).importDefinition(input({ rewards: [missingKind] })), /TARGET_SHAPE_INVALID|TARGET_IDENTIFIER_INVALID/);
  const mismatchedKind = { kind: "package", sourceRewardIdentifier: "x", rewardOrder: 1, itemId: "item0001", quantity: 1n } as unknown as CanonicalPackageImportInput["rewards"][number];
  await assert.rejects(new MariaCanonicalPackageRewardRepository(database().client).importDefinition(input({ rewards: [mismatchedKind] })), /TARGET_SHAPE_INVALID/);
  await assert.rejects(new MariaCanonicalPackageRewardRepository(databaseWithMissingItem()).importDefinition(input({ rewards: [{ kind: "item", sourceRewardIdentifier: "x", rewardOrder: 1, itemId: "item0001", quantity: 1n }] })), /ITEM_TARGET_NOT_FOUND/);
});

test("fails closed for weighted sums, gaps, self-reference, cycles, and depth overflow", async () => {
  await assert.rejects(new MariaCanonicalPackageRewardRepository(database().client).importDefinition(input({ selectionMode: "weighted_one", rewards: [{ kind: "item", sourceRewardIdentifier: "x", rewardOrder: 1, itemId: "item0001", quantity: 1n, probability: "0.9" }] })), /WEIGHTED_PROBABILITY_SUM_INVALID/);
  await assert.rejects(new MariaCanonicalPackageRewardRepository(database().client).importDefinition(input({ selectionMode: "weighted_one", rewards: [{ kind: "gap", sourceRewardIdentifier: "x", rewardOrder: 1, targetKind: "item", targetSourceIdentifier: "missing", targetDisplayName: "미확인", quarantineReason: "TARGET_UNMAPPED" }] })), /WEIGHTED_GAP_UNSAFE/);
  assert.throws(() => assertSafeCanonicalNestedPackageTarget("pack0002", "pack0002"), /NESTED_SELF_REFERENCE/);
  assert.equal(CANONICAL_PACKAGE_MAX_NESTED_DEPTH, 8);
  await assert.rejects(new MariaCanonicalPackageRewardRepository(database({ unsafeNested: { package_id: "source01", depth: 2 }, forceUnsafeNested: true }).client).importDefinition(input({ rewards: [{ kind: "package", sourceRewardIdentifier: "x", rewardOrder: 1, packageId: "pack0002", quantity: 1n }] })), /NESTED_(?:CYCLE|DEPTH_EXCEEDED)/);
  await new MariaCanonicalPackageRewardRepository(database({ unsafeNested: { package_id: "other001", depth: 7 } }).client).importDefinition(input({ rewards: [{ kind: "package", sourceRewardIdentifier: "x", rewardOrder: 1, packageId: "pack0002", quantity: 1n }] }));
  await assert.rejects(new MariaCanonicalPackageRewardRepository(database({ unsafeNested: { package_id: "other001", depth: 8 } }).client).importDefinition(input({ rewards: [{ kind: "package", sourceRewardIdentifier: "x", rewardOrder: 1, packageId: "pack0002", quantity: 1n }] })), /NESTED_DEPTH_EXCEEDED/);
});

test("uses exact fixed-10 probability arithmetic and the shared request-key boundary", async () => {
  const exact = database();
  await new MariaCanonicalPackageRewardRepository(exact.client).importDefinition(input({ selectionMode: "weighted_one", rewards: [
    { kind: "item", sourceRewardIdentifier: "a", rewardOrder: 1, itemId: "item0001", quantity: 1n, probability: "0.1" },
    { kind: "item", sourceRewardIdentifier: "b", rewardOrder: 2, itemId: "item0001", quantity: 1n, probability: "0.2" },
    { kind: "item", sourceRewardIdentifier: "c", rewardOrder: 3, itemId: "item0001", quantity: 1n, probability: "0.7" },
  ] }));
  for (const invalid of ["1e-1", ".5", "0.12345678901", "01.0", "1.0000000001"]) {
    await assert.rejects(new MariaCanonicalPackageRewardRepository(database().client).importDefinition(input({ rewards: [{ kind: "item", sourceRewardIdentifier: "x", rewardOrder: 1, itemId: "item0001", quantity: 1n, probability: invalid }] })), /PROBABILITY_INVALID/);
  }
  assert.equal(CANONICAL_PACKAGE_REQUEST_KEY_MAX_LENGTH, 182);
  await new MariaCanonicalPackageRewardRepository(database().client).importDefinition(input({ requestKey: "r".repeat(182) }));
  const rejected = database();
  await assert.rejects(new MariaCanonicalPackageRewardRepository(rejected.client).importDefinition(input({ requestKey: "r".repeat(183) })), /REQUEST_KEY_INVALID/);
  assert.equal(rejected.writes.length, 0);
});

function databaseWithMissingItem(): DatabaseClient {
  const mock = database();
  const base = mock.client;
  return { ...base, withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work({ query: async <T>(sql: string) => sql.includes("canonical_item_definitions") ? [] as T : sql.includes("object_identity_crosswalks") ? [] as T : [] as T, execute: base.execute }) };
}

test("retries a deadlock and preserves one transaction boundary", async () => {
  const mock = database({ deadlockOnce: true });
  await new MariaCanonicalPackageRewardRepository(mock.client).importDefinition(input());
  assert.equal(mock.attempts(), 2);
});

test("reconciles the committed replay after bounded deadlock retries are exhausted", async () => {
  const seed=database();
  await new MariaCanonicalPackageRewardRepository(seed.client).importDefinition(input());
  const fingerprint=String(seed.writes.find((row)=>row.sql.includes("INSERT INTO canonical_package_definition_replays"))?.values[4]);
  const mock=database({deadlockAttempts:3,replay:{package_definition_operation_id:"oper0001",package_id:"pack0001",payload_fingerprint:fingerprint}});
  const result=await new MariaCanonicalPackageRewardRepository(mock.client).importDefinition(input());
  assert.deepEqual(result,{packageDefinitionOperationId:"oper0001",packageId:"pack0001",replayed:true});
  assert.equal(mock.attempts(),3);
});

test("verifies exactly one typed detail per reward entry before commit", async () => {
  await assert.rejects(new MariaCanonicalPackageRewardRepository(database({ invalidDetail: true }).client).importDefinition(input()), /DETAIL_XOR_INVALID/);
});
