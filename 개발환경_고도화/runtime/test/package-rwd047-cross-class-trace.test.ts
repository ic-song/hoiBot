import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = fileURLToPath(
  new URL(
    "../../migration-control/fixtures/synthetic-relational/package-rwd047-cross-class-trace-v1.json",
    import.meta.url,
  ),
);
const dualFixturePath = fileURLToPath(
  new URL(
    "../../migration-control/fixtures/synthetic-relational/package-canonical-item-dual-consumer-parity-v1.json",
    import.meta.url,
  ),
);
const itemSnapshotPath = fileURLToPath(
  new URL(
    "../../migration-control/fixtures/synthetic-relational/item-definition-snapshot-v1.json",
    import.meta.url,
  ),
);
const migrationPath = fileURLToPath(
  new URL("../migrations/382_package_reward_canonical_gap.sql", import.meta.url),
);
const providerPath = fileURLToPath(
  new URL("../src/package/domain-item-provider.ts", import.meta.url),
);

type TraceFixture = {
  partition: {
    membershipCount: number;
    classes: Record<string, number>;
    overlapCount: number;
    missingCount: number;
    extraCount: number;
    membershipSha256: string;
    aSha256: string;
    bSha256: string;
    dSha256: string;
    sourceCodeHashes: {
      algorithm: string;
      membershipSha256: string;
      aSha256: string;
      bSha256: string;
      dSha256: string;
    };
  };
  bCompatibility: {
    canonicalIdentityCount: number;
    aliasCount: number;
    unchanged: boolean;
  };
  crossClassTrace: {
    count: number;
    sha256: string;
    records: Array<{
      sourceClass: string;
      sourceCode: string;
      canonicalClass: string;
      canonicalCode: string;
      migrationEvidence: string;
      disposition: string;
      partitionMutation: boolean;
    }>;
  };
  ownershipBoundary: {
    canonicalDefinition: string;
    canonicalBalance: string;
    canonicalLedger: string;
    forbiddenWriteTables: string[];
  };
  scopeGuards: Record<string, string | number | boolean>;
};

type DualFixture = {
  canonicalReplacements: Record<string, string>;
  forbiddenOwnershipWrites: string[];
  counts: {
    packageMembership: number;
    includedB: number;
    canonicalIdentities: number;
    compatibilityAliases: number;
    excludedA: number;
    excludedD: number;
  };
  codes: string[];
  unresolvedExcludedCodes: string[];
};

type ItemSnapshot = {
  rows: Array<{ code: string; boundary: string }>;
};

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as TraceFixture;
const dualFixtureSource = readFileSync(dualFixturePath, "utf8");
const dualFixture = JSON.parse(dualFixtureSource) as DualFixture;
const itemSnapshot = JSON.parse(
  readFileSync(itemSnapshotPath, "utf8"),
) as ItemSnapshot;
const migrationSource = readFileSync(migrationPath, "utf8");
const providerSource = readFileSync(providerPath, "utf8");
const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const stableCodeHash = (codes: string[]): string =>
  sha256([...codes].sort().join("\n"));

describe("Lease2405 package RWD047 cross-class trace correction", () => {
  it("freezes exactly one ITEM-RWD-047 to police_thief_ticket trace from migration382", () => {
    assert.equal(fixture.crossClassTrace.count, 1);
    assert.deepEqual(fixture.crossClassTrace.records, [
      {
        sourceClass: "A_PACKAGE_ONLY",
        sourceCode: "ITEM-RWD-047",
        canonicalClass: "B_DUAL_CONSUMER",
        canonicalCode: "police_thief_ticket",
        migrationEvidence: "382_package_reward_canonical_gap.sql",
        disposition: "COMPATIBILITY_RETIREMENT_TRACE",
        partitionMutation: false,
      },
    ]);

    const trace = fixture.crossClassTrace.records[0];
    assert.ok(trace);
    const canonicalLine = [
      "A",
      trace.sourceCode,
      "B",
      trace.canonicalCode,
      trace.migrationEvidence,
    ].join("|");
    assert.equal(sha256(canonicalLine), fixture.crossClassTrace.sha256);
    assert.match(migrationSource, /ITEM-RWD-047/);
    assert.match(migrationSource, /police_thief_ticket/);
    for (const table of [
      "package_reward_rules",
      "package_rewards",
      "package_reward_bundle_items",
      "dynamic_item_catalog_entries",
    ]) {
      assert.match(migrationSource, new RegExp(table));
    }
  });

  it("replays the A74 B76 D1 partition with overlap, missing, and extra all zero", () => {
    const membershipCodes = itemSnapshot.rows
      .filter((row) => row.boundary === "PACKAGE_COMPATIBILITY")
      .map((row) => row.code);
    const bCodes = dualFixture.codes;
    const dCodes = dualFixture.unresolvedExcludedCodes;
    const bSet = new Set(bCodes);
    const dSet = new Set(dCodes);
    const aCodes = membershipCodes.filter(
      (code) => !bSet.has(code) && !dSet.has(code),
    );
    const aSet = new Set(aCodes);
    const membershipSet = new Set(membershipCodes);
    const classifiedCodes = [...aCodes, ...bCodes, ...dCodes];
    const overlapCount = classifiedCodes.length - new Set(classifiedCodes).size;
    const missingCount = membershipCodes.filter(
      (code) => !aSet.has(code) && !bSet.has(code) && !dSet.has(code),
    ).length;
    const extraCount = classifiedCodes.filter(
      (code) => !membershipSet.has(code),
    ).length;

    assert.equal(membershipCodes.length, fixture.partition.membershipCount);
    assert.deepEqual(fixture.partition.classes, {
      A_PACKAGE_ONLY: 74,
      B_DUAL_CONSUMER: 76,
      D_UNRESOLVED: 1,
    });
    assert.equal(aCodes.length, fixture.partition.classes.A_PACKAGE_ONLY);
    assert.equal(bCodes.length, fixture.partition.classes.B_DUAL_CONSUMER);
    assert.equal(dCodes.length, fixture.partition.classes.D_UNRESOLVED);
    assert.equal(overlapCount, fixture.partition.overlapCount);
    assert.equal(missingCount, fixture.partition.missingCount);
    assert.equal(extraCount, fixture.partition.extraCount);
    assert.equal(
      stableCodeHash(membershipCodes),
      fixture.partition.sourceCodeHashes.membershipSha256,
    );
    assert.equal(stableCodeHash(aCodes), fixture.partition.sourceCodeHashes.aSha256);
    assert.equal(stableCodeHash(bCodes), fixture.partition.sourceCodeHashes.bSha256);
    assert.equal(stableCodeHash(dCodes), fixture.partition.sourceCodeHashes.dSha256);
    assert.ok(aSet.has("ITEM-RWD-047"));
    assert.ok(bSet.has("police_thief_ticket"));

    const firstReplay = sha256(JSON.stringify(fixture.crossClassTrace.records));
    const secondReplay = sha256(JSON.stringify(fixture.crossClassTrace.records));
    assert.equal(secondReplay, firstReplay);
  });

  it("preserves B canonical72 and aliases5 without absorbing A74 or D1", () => {
    assert.deepEqual(fixture.bCompatibility, {
      canonicalIdentityCount: 72,
      aliasCount: 5,
      unchanged: true,
    });
    assert.equal(dualFixture.counts.packageMembership, 151);
    assert.equal(dualFixture.counts.includedB, 76);
    assert.equal(dualFixture.counts.canonicalIdentities, 72);
    assert.equal(dualFixture.counts.compatibilityAliases, 5);
    assert.equal(dualFixture.counts.excludedA, 74);
    assert.equal(dualFixture.counts.excludedD, 1);
    assert.equal(Object.keys(dualFixture.canonicalReplacements).length, 5);
    for (const code of [
      "castle_coin",
      "ITEM-RWD-026",
      "ITEM-RWD-046",
      "ITEM-RWD-RANDOM-SPIRIT-BOX",
      "ITEM-RWD-SEASONED-CHICKEN",
    ]) {
      assert.ok(dualFixtureSource.includes(code));
    }
    assert.equal(fixture.scopeGuards.d1Code, "free_market_membership");
    assert.equal(fixture.scopeGuards.convergeA74, false);
    assert.equal(fixture.scopeGuards.convergeD1, false);
  });

  it("keeps the inventory-only write boundary in the synthetic source Shadow", () => {
    assert.equal(fixture.ownershipBoundary.canonicalDefinition, "item_definitions");
    assert.equal(fixture.ownershipBoundary.canonicalBalance, "inventory_stacks");
    assert.equal(fixture.ownershipBoundary.canonicalLedger, "inventory_ledger");
    assert.deepEqual(
      fixture.ownershipBoundary.forbiddenWriteTables,
      dualFixture.forbiddenOwnershipWrites,
    );
    assert.match(providerSource, /inventory_stacks/);
    assert.match(providerSource, /inventory_ledger/);

    for (const table of fixture.ownershipBoundary.forbiddenWriteTables) {
      const forbiddenMutation = new RegExp(
        `(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}`,
        "i",
      );
      assert.doesNotMatch(providerSource, forbiddenMutation);
    }
    assert.equal(fixture.scopeGuards.runtimeChanges, 0);
    assert.equal(fixture.scopeGuards.providerChanges, 0);
    assert.equal(fixture.scopeGuards.schemaChanges, 0);
    assert.equal(fixture.scopeGuards.migrationFilesAdded, 0);
    assert.equal(fixture.scopeGuards.uiChanges, 0);
    assert.equal(fixture.scopeGuards.databaseWrites, 0);
  });
});
