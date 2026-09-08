import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { deriveUniqueClassMethodSourceSpan } from "../src/data-migration/object-db-consumer-transition-audit.js";

interface EvidenceTrace {
  processId: number;
  committedDml: string[];
  committedRows: number;
  rolledBackAffectedRows: number;
  replayed: boolean | null;
  errorCode: string | null;
  attempts: Array<{ lockOrder: string[]; failure: { code: string | null; errno: number | null; errorKind: string; constraintName: string | null } | null }>;
  beforeRows: Record<string, unknown[]>;
  afterRows: Record<string, unknown[]>;
  beforeSha256: string;
  afterSha256: string;
  locatorProjection: { mode: string; rows: unknown[]; locatorOK: boolean };
  externalNetworkCalls: number;
  replyCalls: number;
}

interface TargetedEvidence {
  contractVersion: string;
  consumerId: string;
  sliceId: string;
  executionId: string;
  leaseRow: number;
  baselineCommit: string;
  sourceMethod: { start: number; end: number; sha256: string };
  migrationClosure: string[];
  scenarios: {
    success: EvidenceTrace;
    rollback: EvidenceTrace;
    duplicate: [EvidenceTrace, EvidenceTrace];
    drift: [EvidenceTrace, EvidenceTrace];
    restart: [EvidenceTrace, EvidenceTrace];
    concurrency: [EvidenceTrace, EvidenceTrace];
  };
}

const repositoryRoot = resolve(import.meta.dirname, "../..");
const evidence = JSON.parse(readFileSync(resolve(repositoryRoot, "migration-control/evidence/wbs787-furniture-place/targeted-evidence.json"), "utf8")) as TargetedEvidence;
const stableHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("WBS787 furniture placement targeted evidence", () => {
  it("binds the frozen consumer, lease, migrations, and current method span", () => {
    assert.equal(evidence.contractVersion, "WBS787_FURNITURE_PLACE_TARGETED_V1");
    assert.equal(evidence.consumerId, "sql-repository-818137c4fb22037a");
    assert.equal(evidence.sliceId, "SL-FURNITURE-PLACE-MUTATION-PARITY-01");
    assert.equal(evidence.leaseRow, 2615);
    assert.equal(evidence.baselineCommit, "24fac92e9b73fb112dc75177945cc33326c272ad");
    assert.deepEqual(evidence.migrationClosure, ["443_object_identity_audit_provider.sql", "444_canonical_item_inventory.sql", "445_object_furniture_home_canonical_model.sql"]);
    const source = readFileSync(resolve(repositoryRoot, "runtime/src/home/canonical-furniture-home-repository.ts"), "utf8").replace(/\r\n?/g, "\n");
    assert.deepEqual(evidence.sourceMethod, deriveUniqueClassMethodSourceSpan(source, "MariaCanonicalFurnitureHomeRepository", "placeOwnedFurniture"));
  });

  it("seals exact DML, rollback, replay, restart, and concurrency outcomes", () => {
    const { success, rollback, duplicate, drift, restart, concurrency } = evidence.scenarios;
    assert.equal(success.committedRows, 4);
    assert.deepEqual(success.attempts[0]?.lockOrder, ["object_furniture_operation_replays", "object_owned_furniture_instances", "object_home_furniture_placements"]);
    assert.deepEqual(success.committedDml.map((sql) => /^(?:INSERT INTO|UPDATE)\s+(\w+)/i.exec(sql)?.[1]), ["object_furniture_operation_replays", "object_home_furniture_placements", "object_furniture_ownership_history", "object_owned_furniture_instances"]);
    assert.equal(rollback.committedRows, 0); assert.equal(rollback.rolledBackAffectedRows, 1); assert.equal(rollback.beforeSha256, rollback.afterSha256);
    assert.deepEqual(rollback.attempts[0]?.failure, { code: "ER_DUP_ENTRY", errno: 1062, errorKind: "BUSINESS_UNIQUE_CONFLICT", constraintName: "PRIMARY" });
    assert.equal(duplicate[1].committedRows, 0); assert.equal(duplicate[1].replayed, true); assert.equal(duplicate[1].beforeSha256, duplicate[1].afterSha256);
    assert.equal(drift[1].committedRows, 0); assert.match(drift[1].errorCode ?? "", /IDEMPOTENCY_CONFLICT/); assert.equal(drift[1].beforeSha256, drift[1].afterSha256);
    assert.notEqual(restart[0].processId, restart[1].processId); assert.equal(restart[1].committedRows, 0); assert.equal(restart[1].replayed, true);
    assert.deepEqual(concurrency.map((trace) => trace.committedRows).sort((left, right) => left - right), [0, 4]);
    assert.equal(concurrency.filter((trace) => trace.replayed === true).length, 1);
  });

  it("keeps exact row hashes, raw locator projection, and external effects sealed", () => {
    const values = Object.values(evidence.scenarios).flatMap((value) => Array.isArray(value) ? value : [value]);
    for (const trace of values) {
      assert.equal(trace.beforeSha256, stableHash(trace.beforeRows));
      assert.equal(trace.afterSha256, stableHash(trace.afterRows));
      assert.equal(trace.locatorProjection.mode, "RAW_COMPOSITE");
      assert.equal(trace.locatorProjection.locatorOK, true);
      assert.equal(trace.externalNetworkCalls, 0);
      assert.equal(trace.replyCalls, 0);
    }
  });
});
