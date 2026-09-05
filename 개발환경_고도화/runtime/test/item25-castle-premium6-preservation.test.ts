import assert from "node:assert/strict";
import { test } from "node:test";
import { buildItem25CanonicalDefinitionManifest } from "../src/data-migration/item25-canonical-definition-provider.js";
import { buildItem25StagingRecords, payloadAt, readRepositoryFile, readRepositoryJson, sha256, SOURCE_CONTENT_SHA256, stable, stringNumbers } from "./support/item25-preservation-fixture.js";

type AuditEntry = { pointer: string; recordKind: string; name: string; successRate: number; locatorSha256: string; payloadSha256: string };
type Audit = { castlePremiumMetadata: { entries: AuditEntry[]; runtimeSixToFourMapping: string; rateOverwriteAuthorized: boolean } };
type TerritoryFixture = { rows: Array<{ scope: string; sourceKey: string; displayName: string; successRate: number }> };

const audit = readRepositoryJson<Audit>("개발환경_고도화/migration-control/evidence/item25-raid-territory-source-audit-lease2562-2563/audit.json");
const fixture = readRepositoryJson<TerritoryFixture>("개발환경_고도화/migration-control/fixtures/synthetic-relational/iteminfo-territory-tickets-v1.json");
const source = readRepositoryJson<Record<string, unknown>>("data/itemInfo.json");

test("WBS755 seals six independent castlePremium occurrences and their exact stored rates", () => {
  assert.equal(sha256(readRepositoryFile("data/itemInfo.json")), SOURCE_CONTENT_SHA256);
  const manifest = buildItem25CanonicalDefinitionManifest(buildItem25StagingRecords());
  const entries = manifest.entries.filter((entry) => entry.sourcePointer.startsWith("/castlePremiumItem/"));
  assert.equal(entries.length, 6);
  assert.equal(audit.castlePremiumMetadata.entries.length, 6);
  assert.equal(audit.castlePremiumMetadata.runtimeSixToFourMapping, "NOT_CONFIRMED");
  assert.equal(audit.castlePremiumMetadata.rateOverwriteAuthorized, false);

  for (const entry of entries) {
    const audited = audit.castlePremiumMetadata.entries.find((candidate) => candidate.pointer === entry.sourcePointer);
    const fixtureRow = fixture.rows.find((row) => `/castlePremiumItem/${row.scope}/${row.sourceKey}` === entry.sourcePointer);
    const payload = payloadAt(source, entry.sourcePointer);
    assert.ok(audited);
    assert.ok(fixtureRow);
    assert.equal(audited.recordKind, "TERRITORY_ITEM_DEFINITION");
    assert.equal(audited.locatorSha256, entry.sourceLocatorSha256);
    assert.equal(audited.payloadSha256, entry.sourcePayloadFingerprint);
    assert.equal(sha256(stable(payload)), entry.sourcePayloadFingerprint);
    assert.equal(sha256(stable(stringNumbers(payload))), entry.definitionOptionsSha256);
    assert.deepEqual(payload, { name: fixtureRow.displayName, successRate: fixtureRow.successRate });
  }
});

test("WBS755 preserves migration 387 active rows while keeping metadata six separate from runtime four", () => {
  const migration = readRepositoryFile("개발환경_고도화/runtime/migrations/387_iteminfo_territory_ticket_definitions.sql");
  const provider = readRepositoryFile("개발환경_고도화/runtime/src/data-migration/item25-canonical-definition-provider.ts");
  const runtime = readRepositoryFile("main.js");
  for (const audited of audit.castlePremiumMetadata.entries) {
    assert.match(migration, new RegExp(audited.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(provider, new RegExp(audited.pointer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(migration, /active=1/);
  assert.match(provider, /payload\.active_flag !== true/);
  assert.match(runtime, /영지기습공격권🔥\(40%\)/);
  assert.match(runtime, /영지기습공격권🔥\(10%\)/);
  assert.match(runtime, /영지절대방어권🛡\(50%\)/);
  assert.match(runtime, /영지절대방어권🛡\(20%\)/);
  assert.doesNotMatch(runtime, /castlePremiumItem\s*=/);
});

test("WBS755 rejects any attempt to collapse or rewrite the six source occurrences", () => {
  const duplicatePointer = buildItem25StagingRecords();
  const first = duplicatePointer.findIndex((entry) => entry.sourcePointer === "/castlePremiumItem/offense/item_0");
  const second = duplicatePointer.findIndex((entry) => entry.sourcePointer === "/castlePremiumItem/offense/item_1");
  duplicatePointer[second] = { ...duplicatePointer[second]!, sourcePointer: duplicatePointer[first]!.sourcePointer, identityPointer: duplicatePointer[first]!.identityPointer, projectionLocator: duplicatePointer[first]!.projectionLocator, sourceLocatorSha256: duplicatePointer[first]!.sourceLocatorSha256 };
  assert.throws(() => buildItem25CanonicalDefinitionManifest(duplicatePointer), /AUTHORITATIVE_ENTRY_DRIFT|SOURCE_DUPLICATE/);

  const rateDrift = buildItem25StagingRecords();
  const target = rateDrift.findIndex((entry) => entry.sourcePointer === "/castlePremiumItem/offense/item_1");
  rateDrift[target] = { ...rateDrift[target]!, payloadJson: '{"name":"영지기습공격권🔥(60%)","successRate":0.4}' };
  assert.throws(() => buildItem25CanonicalDefinitionManifest(rateDrift), /SOURCE_PAYLOAD_FINGERPRINT_DRIFT/);
});
