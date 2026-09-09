import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

interface Trace {
  processId: number;
  database: { host: string; port: number; name: string };
  attempts: Array<{ outcome: string; lockOrder: string[] }>;
  committedDml: string[];
  committedRows: number;
  rolledBackAffectedRows: number;
  replayed: boolean | null;
  resultingQuantity: string | null;
  operationId: string | null;
  errorCode: string | null;
  beforeRows: Record<string, unknown[]>;
  afterRows: Record<string, unknown[]>;
  beforeSha256: string;
  afterSha256: string;
  locatorProjection: { mode: string; rows: unknown[]; locatorOK: boolean };
  externalNetworkCalls: number;
  replyCalls: number;
}
interface Evidence { contractVersion:string; consumerId:string; leaseRow:number; baselineCommit:string; migrationClosure:string[]; scenarios:{success:Trace;rollback:Trace;replay:[Trace,Trace];drift:[Trace,Trace];restart:[Trace,Trace];sameKeyConcurrency:[Trace,Trace];differentKeyConcurrency:[Trace,Trace,Trace]}; }
const root = resolve(import.meta.dirname, "../..");
const evidence = JSON.parse(readFileSync(resolve(root, "migration-control/evidence/wbs789-pet-skill-grant/targeted-evidence.json"), "utf8")) as Evidence;
const stableHash = (value:unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("WBS789 pet-skill grant targeted evidence", () => {
  it("binds the frozen consumer, lease, isolation, and migration closure", () => {
    assert.equal(evidence.contractVersion, "WBS789_PET_SKILL_GRANT_TARGETED_V1");
    assert.equal(evidence.consumerId, "sql-repository-31c4099080d9c9c1");
    assert.equal(evidence.leaseRow, 2617);
    assert.equal(evidence.baselineCommit, "2304dd0fc30984b5e31d58df3fbb36f5f77167a1");
    assert.deepEqual(evidence.migrationClosure, ["443_object_identity_audit_provider.sql", "444_canonical_item_inventory.sql", "446_canonical_pet_equipment.sql", "449_canonical_pet_skill.sql"]);
    for (const trace of Object.values(evidence.scenarios).flat()) {
      assert.deepEqual(trace.database, { host: "127.0.0.1", port: 3348, name: "hoibot_wbs789_pet_skill_grant_2617" });
      assert.notEqual(trace.database.port, 3306);
      assert.equal(trace.externalNetworkCalls, 0); assert.equal(trace.replyCalls, 0);
      assert.equal(trace.locatorProjection.mode, "RAW_COMPOSITE"); assert.equal(trace.locatorProjection.locatorOK, true);
      assert.equal(trace.beforeSha256, stableHash(trace.beforeRows)); assert.equal(trace.afterSha256, stableHash(trace.afterRows));
    }
  });

  it("seals success, rollback, replay, drift, and restart outcomes", () => {
    const { success, rollback, replay, drift, restart } = evidence.scenarios;
    assert.equal(success.committedRows, 2);
    assert.deepEqual(success.attempts[0]?.lockOrder, ["canonical_pet_skill_operation_replays", "canonical_players", "canonical_pet_skill_definitions", "canonical_owned_pet_skill_stacks", "object_identity_crosswalks:petSkillOperation", "object_identity_crosswalks:ownedPetSkill"]);
    assert.deepEqual(success.committedDml.map((sql) => /^(?:INSERT INTO|UPDATE)\s+(\w+)/i.exec(sql)?.[1]), ["canonical_owned_pet_skill_stacks", "canonical_pet_skill_operation_replays"]);
    assert.equal(rollback.committedRows, 0); assert.equal(rollback.rolledBackAffectedRows, 1); assert.equal(rollback.beforeSha256, rollback.afterSha256);
    assert.equal(replay[1].committedRows, 0); assert.equal(replay[1].replayed, true); assert.equal(replay[1].beforeSha256, replay[1].afterSha256);
    assert.equal(drift[1].committedRows, 0); assert.match(drift[1].errorCode ?? "", /REQUEST_PAYLOAD_CONFLICT/); assert.equal(drift[1].beforeSha256, drift[1].afterSha256);
    assert.notEqual(restart[0].processId, restart[1].processId); assert.equal(restart[1].committedRows, 0); assert.equal(restart[1].replayed, true);
  });

  it("seals same-key single writer and different-key absent-stack sum", () => {
    const { sameKeyConcurrency, differentKeyConcurrency } = evidence.scenarios;
    assert.deepEqual(sameKeyConcurrency.map((trace) => trace.committedRows).sort(), [0, 2]);
    assert.equal(sameKeyConcurrency.filter((trace) => trace.replayed === true).length, 1);
    const writers = differentKeyConcurrency.slice(0, 2);
    assert.equal(writers.every((trace) => trace.committedRows === 2 && trace.replayed === false), true);
    assert.notEqual(writers[0]?.operationId, writers[1]?.operationId);
    assert.equal(differentKeyConcurrency[2]?.committedRows, 0);
    const finalStacks = differentKeyConcurrency[2]?.afterRows["canonical_owned_pet_skill_stacks"] as Array<{ quantity?: string }> | undefined;
    assert.equal(finalStacks?.[0]?.quantity, "8");
  });
});
