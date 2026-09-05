import assert from "node:assert/strict";
import { test } from "node:test";
import { buildItem25CanonicalDefinitionManifest } from "../src/data-migration/item25-canonical-definition-provider.js";
import { buildItem25StagingRecords, payloadAt, readRepositoryFile, readRepositoryJson, sha256, SOURCE_CONTENT_SHA256, stable, stringNumbers } from "./support/item25-preservation-fixture.js";

type AuditEntry = { pointer: string; recordKind: string; name: string; exp: number; locatorSha256: string; payloadSha256: string };
type Audit = { raidDept1: { entries: AuditEntry[]; databaseDefinitionActiveEvidence: { migration386ActiveEqualsOne: boolean; item25ProviderRequiresActiveFlagTrue: boolean; deletionOrDeactivationAuthorized: boolean }; auctionBareNamesAreEquivalent: string } };
type RaidFixture = { rows: Array<{ sourceIdentity: string; displayName: string; raidExpBonus: number; department: string; sourceKey: string }> };

const audit = readRepositoryJson<Audit>("개발환경_고도화/migration-control/evidence/item25-raid-territory-source-audit-lease2562-2563/audit.json");
const fixture = readRepositoryJson<RaidFixture>("개발환경_고도화/migration-control/fixtures/synthetic-relational/iteminfo-raid-definitions-v1.json");
const source = readRepositoryJson<Record<string, unknown>>("data/itemInfo.json");

test("WBS753 seals all eight raid dept1 occurrences by pointer, payload and active options", () => {
  assert.equal(sha256(readRepositoryFile("data/itemInfo.json")), SOURCE_CONTENT_SHA256);
  const manifest = buildItem25CanonicalDefinitionManifest(buildItem25StagingRecords());
  const entries = manifest.entries.filter((entry) => entry.sourcePointer.startsWith("/raidSpecialItem/dept1/"));
  assert.equal(entries.length, 8);
  assert.equal(audit.raidDept1.entries.length, 8);
  assert.equal(audit.raidDept1.databaseDefinitionActiveEvidence.migration386ActiveEqualsOne, true);
  assert.equal(audit.raidDept1.databaseDefinitionActiveEvidence.item25ProviderRequiresActiveFlagTrue, true);
  assert.equal(audit.raidDept1.databaseDefinitionActiveEvidence.deletionOrDeactivationAuthorized, false);
  assert.equal(audit.raidDept1.auctionBareNamesAreEquivalent, "NOT_CONFIRMED");

  for (const [index, entry] of entries.entries()) {
    const audited = audit.raidDept1.entries[index]!;
    const payload = payloadAt(source, entry.sourcePointer);
    const fixtureRow = fixture.rows.find((row) => `/${row.department}/${row.sourceKey}` === entry.sourcePointer.replace("/raidSpecialItem", ""));
    assert.ok(fixtureRow);
    assert.equal(audited.pointer, entry.sourcePointer);
    assert.equal(audited.recordKind, "RAID_ITEM_DEFINITION");
    assert.equal(audited.locatorSha256, entry.sourceLocatorSha256);
    assert.equal(audited.payloadSha256, entry.sourcePayloadFingerprint);
    assert.equal(sha256(stable(payload)), entry.sourcePayloadFingerprint);
    assert.equal(sha256(stable(stringNumbers(payload))), entry.definitionOptionsSha256);
    assert.deepEqual(payload, { name: fixtureRow.displayName, exp: fixtureRow.raidExpBonus });
  }
});

test("WBS753 preserves migration 386 and canonical provider boundaries without adding a domain consumer", () => {
  const migration = readRepositoryFile("개발환경_고도화/runtime/migrations/386_iteminfo_raid_definitions.sql");
  const provider = readRepositoryFile("개발환경_고도화/runtime/src/data-migration/item25-canonical-definition-provider.ts");
  const inventory = readRepositoryFile("개발환경_고도화/runtime/src/inventory/canonical-item-inventory-repository.ts");
  for (const audited of audit.raidDept1.entries) {
    assert.match(migration, new RegExp(audited.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(provider, new RegExp(audited.pointer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(migration, /active=1/);
  assert.match(provider, /payload\.active_flag !== true/);
  assert.match(inventory, /WHERE player_id=\? AND item_id=\? FOR UPDATE/);
  assert.doesNotMatch(inventory, /WHERE player_id=\? AND item_name=\?/);
});

test("WBS753 rejects pointer or payload drift before any preservation claim", () => {
  const pointerDrift = buildItem25StagingRecords();
  pointerDrift[0] = { ...pointerDrift[0]!, sourcePointer: "/raidSpecialItem/dept1/item_8", identityPointer: "/raidSpecialItem/dept1/item_8", projectionLocator: "/raidSpecialItem/dept1/item_8" };
  assert.throws(() => buildItem25CanonicalDefinitionManifest(pointerDrift), /AUTHORITATIVE_POINTER_REJECTED|SOURCE_LOCATOR_DRIFT/);

  const payloadDrift = buildItem25StagingRecords();
  payloadDrift[0] = { ...payloadDrift[0]!, payloadJson: '{"name":"항생제💊(+51👾)","exp":51}' };
  assert.throws(() => buildItem25CanonicalDefinitionManifest(payloadDrift), /SOURCE_PAYLOAD_FINGERPRINT_DRIFT/);
});
