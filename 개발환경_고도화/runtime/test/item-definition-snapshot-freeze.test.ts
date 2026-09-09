import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type SourceRef = {
  migration: string;
  seedKind: "VALUES" | "PACKAGE_PROJECTION" | "DIRECT_SELECT";
  upstreamPackageSource?: string;
};

type SnapshotRow = {
  code: string;
  displayName: string;
  assetType: string;
  stackable: boolean;
  active: boolean;
  version: number;
  boundary: "COMMON_ITEM" | "PACKAGE_COMPATIBILITY" | "PENDANT_INSTANCE";
  inclusionReason: string;
  sources: SourceRef[];
};

type Snapshot = {
  baseline: string;
  sourceCandidates: number;
  previousControlCount: number;
  authoritativeMembershipCount: number;
  correctionCount: number;
  exclusions: Array<{ code: string; reason: string; sources: SourceRef[] }>;
  corrections: Array<{ code: string; source: string; reason: string }>;
  boundaries: {
    COMMON_ITEM: number;
    PACKAGE_COMPATIBILITY: number;
    PENDANT_INSTANCE: number;
  };
  pendantObjectLink: { count: number; migration: string; commit: string; changesDefinitionMembership: boolean };
  hashes: { sourceFilesSha256: string; membershipSha256: string; exclusionsSha256: string; correctionsSha256: string };
  rows: SnapshotRow[];
};

const fixturePath = fileURLToPath(new URL("../../migration-control/fixtures/synthetic-relational/item-definition-snapshot-v1.json", import.meta.url));
const evidencePath = fileURLToPath(new URL("../../migration-control/evidence/item-definition-snapshot-freeze/slice.json", import.meta.url));
const checkpointPath = fileURLToPath(new URL("../../migration-control/evidence/item-definition-snapshot-freeze/checkpoint.json", import.meta.url));
const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Snapshot;
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as { gates: Record<string, boolean> };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function membershipText(rows: SnapshotRow[]): string {
  return rows.map((row) => [
    row.code,
    row.displayName,
    row.assetType,
    row.stackable ? "1" : "0",
    row.active ? "1" : "0",
    String(row.version),
    row.boundary,
    row.inclusionReason,
  ].join("\t")).join("\n");
}

test("freezes the authoritative sorted 413 item-definition membership", () => {
  assert.equal(fixture.baseline, "472ad5f7146fbd083b7c3193aad8f5307cbfcbea");
  assert.equal(fixture.sourceCandidates, 415);
  assert.equal(fixture.authoritativeMembershipCount, 413);
  assert.equal(fixture.rows.length, 413);
  assert.equal(new Set(fixture.rows.map((row) => row.code)).size, 413);
  assert.deepEqual(
    fixture.rows.map((row) => row.code),
    fixture.rows.map((row) => row.code).toSorted((left, right) => left.localeCompare(right)),
  );
  assert.equal(sha256(membershipText(fixture.rows)), fixture.hashes.membershipSha256);
});

test("corrects the previous 408 control with five direct SELECT seed identities", () => {
  const expected = [
    "ITEM-TERRITORY-AMBUSH-10",
    "ITEM-TERRITORY-AMBUSH-40",
    "ITEM-TERRITORY-ATTACK",
    "ITEM-TERRITORY-DEFENSE-20",
    "ITEM-TERRITORY-DEFENSE-50",
  ];
  assert.equal(fixture.previousControlCount, 408);
  assert.equal(fixture.correctionCount, 5);
  assert.equal(fixture.previousControlCount + fixture.correctionCount, fixture.authoritativeMembershipCount);
  assert.deepEqual(fixture.corrections.map((row) => row.code).toSorted(), expected);
  const migration212 = fs.readFileSync(path.join(migrationsDir, "212_admin_legacy_data_cleanup.sql"), "utf8");
  for (const code of expected) {
    const escaped = code.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    assert.match(migration212, new RegExp("SELECT '" + escaped + "'"));
    assert.ok(fixture.rows.some((row) => row.code === code));
  }
  assert.equal((migration212.match(/INSERT INTO item_definitions/g) ?? []).length, 6);
  assert.equal((migration212.match(/WHERE NOT EXISTS\(SELECT 1 FROM item_definitions WHERE display_name=/g) ?? []).length, 5);
});

test("preserves exact source evidence for every included definition", () => {
  for (const row of fixture.rows) {
    assert.ok(row.sources.length > 0, "missing source for " + row.code);
    assert.equal(typeof row.stackable, "boolean");
    assert.equal(typeof row.active, "boolean");
    assert.ok(Number.isSafeInteger(row.version) && row.version >= 1);
    assert.ok(row.sources.some((source) => {
      const sourceFile = source.upstreamPackageSource ?? source.migration;
      const sql = fs.readFileSync(path.join(migrationsDir, sourceFile), "utf8");
      return sql.includes(row.code);
    }), "source does not contain " + row.code);
  }
});

test("keeps currency and package compatibility boundaries explicit", () => {
  assert.deepEqual(fixture.exclusions.map((row) => row.code).toSorted(), ["diamond", "point"]);
  assert.ok(fixture.exclusions.every((row) => row.reason === "CURRENCY_COMPATIBILITY_BOUNDARY"));
  assert.equal(fixture.boundaries.COMMON_ITEM + fixture.boundaries.PACKAGE_COMPATIBILITY + fixture.boundaries.PENDANT_INSTANCE, 413);
  assert.ok(fixture.boundaries.PACKAGE_COMPATIBILITY > 0);
  assert.ok(fixture.rows.every((row) => row.code !== "point" && row.code !== "diamond"));
});

test("carries forward thirteen pendant object links without changing definition membership", () => {
  const pendantRows = fixture.rows.filter((row) => row.boundary === "PENDANT_INSTANCE");
  const migration399 = fs.readFileSync(path.join(migrationsDir, fixture.pendantObjectLink.migration), "utf8");
  assert.equal(pendantRows.length, 13);
  assert.equal(fixture.pendantObjectLink.count, 13);
  assert.equal(fixture.pendantObjectLink.commit, "472ad5f7146fbd083b7c3193aad8f5307cbfcbea");
  assert.equal(fixture.pendantObjectLink.changesDefinitionMembership, false);
  assert.match(migration399, /definition_row\.asset_type_code='PENDANT'/);
  assert.doesNotMatch(migration399, /INSERT INTO item_definitions/i);
});

test("records immutable evidence and Gate1 through Gate7 checkpoint only", () => {
  assert.equal(evidence.sliceId, "SL-ASSET-ITEM-DEFINITION-SNAPSHOT-FREEZE-01");
  assert.deepEqual(checkpoint.gates, {
    gate1: true,
    gate2: true,
    gate3: true,
    gate4: true,
    gate5: true,
    gate6: true,
    gate7: true,
    gate8: false,
  });
});
