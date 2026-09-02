import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  validateAssetReferences,
  type CanonicalAssetEntry,
  type CanonicalAssetSnapshot
} from "../src/data-migration/asset-reference-validation.js";
import type { StagingTransformManifest } from "../src/data-migration/staging-transform.js";

const hash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

function entry(objectId: string, objectType: string, objectKey: string, displayName: string, metadata: Record<string, unknown> = {}): CanonicalAssetEntry {
  return { objectId, objectType, objectKey, displayName, active: true, metadata, sources: [{ sourceSystem: "SYNTHETIC", sourceTable: "fixture", sourceKey: displayName }] };
}

async function fixture(canonicalEntries?: CanonicalAssetEntry[]): Promise<{ root: string; manifest: StagingTransformManifest; snapshot: CanonicalAssetSnapshot }> {
  const root = await mkdtemp(join(tmpdir(), "hoibot-asset-reference-"));
  const payloadFixture = JSON.parse(await readFile(new URL("./fixtures/asset-reference-validation-v1.json", import.meta.url), "utf8"));
  const sourcePathSha256 = hash("synthetic/member.json");
  const sourceContentSha256 = hash("synthetic-content");
  const decisionSha256 = hash("synthetic-decision");
  const serialized = `${JSON.stringify({ sourcePathSha256, sourceContentSha256, decision: "KEEP", format: "JSON", payload: payloadFixture.payload })}\n`;
  const payloadDirectory = join(root, decisionSha256, "payload");
  await mkdir(payloadDirectory, { recursive: true });
  await writeFile(join(payloadDirectory, `${sourcePathSha256}.json`), serialized, "utf8");
  const manifest: StagingTransformManifest = {
    format: "hoibot-isolated-staging-v1", catalogVersion: "STAGING-SYNTHETIC-01", policyVersion: "POLICY-01",
    decisionSha256, generatedAt: "2026-09-02T00:00:00.000Z", sourceFileCount: 1, stagedFileCount: 1,
    quarantinedFileCount: 0, excludedFileCount: 0, reviewFileCount: 0, sourceBytes: 1,
    stagingPayloadBytes: Buffer.byteLength(serialized), stagingSha256: hash("staging"),
    entries: [{ sourcePathSha256, sourceContentSha256, decision: "KEEP", format: "JSON", rootKind: "OBJECT", recordCount: 1, stagingPayloadSha256: hash(serialized), status: "STAGED" }]
  };
  const entries = canonicalEntries ?? [
    entry("1", "ITEM", "ITEM-SYNTHETIC-POTION", "Synthetic Potion"),
    entry("2", "FURNITURE", "FURNITURE-SYNTHETIC-CHAIR", "Synthetic Chair", { grade: "A" }),
    entry("3", "MINI_PET", "MINI-PET-SYNTHETIC", "Synthetic MiniM", { grade: "S", emoji: "M" }),
    entry("4", "ITEM", "ITEM-SYNTHETIC-PENDANT", "Synthetic Pendant", { grade: "1" }),
    entry("5", "TITLE", "TITLE-SYNTHETIC-HERO", "Synthetic Hero"),
    entry("6", "SKILL", "SKILL-SYNTHETIC-SLASH", "Synthetic Slash"),
    entry("7", "BADGE", "BADGE-SYNTHETIC-001", "Synthetic Badge"),
    entry("8", "PACKAGE", "PACKAGE-SYNTHETIC-001", "Synthetic Package"),
    entry("9", "PASS", "PASS-SYNTHETIC-001", "Synthetic Pass")
  ];
  return { root, manifest, snapshot: { format: "hoibot-canonical-asset-reference-v1", catalogVersion: "ASSET-SYNTHETIC-01", generatedAt: "2026-09-02T00:00:00.000Z", entries } };
}

describe("data migration asset reference validation", () => {
  it("resolves bag, furniture, mini-pet, pendant, title, skill, badge, package and pass references", async () => {
    const input = await fixture();
    const report = await validateAssetReferences(input.root, input.manifest, input.snapshot);
    assert.equal(report.referenceCount, 11);
    assert.equal(report.resolvedCount, 11);
    assert.equal(report.dataMigrationReady, true);
  });

  it("returns only hashed issue identities without raw user or asset values", async () => {
    const input = await fixture([]);
    const report = await validateAssetReferences(input.root, input.manifest, input.snapshot);
    const serialized = JSON.stringify(report);
    assert.equal(report.orphanCount, 11);
    assert.equal(serialized.includes("synthetic-user"), false);
    assert.equal(serialized.includes("Synthetic Potion"), false);
  });

  it("fails closed when one display identity has multiple canonical owners", async () => {
    const duplicate = [entry("1", "ITEM", "ITEM-ONE", "Synthetic Potion"), entry("2", "ITEM", "ITEM-TWO", "Synthetic Potion")];
    const input = await fixture(duplicate);
    const report = await validateAssetReferences(input.root, input.manifest, input.snapshot);
    assert.ok(report.ambiguousCount >= 1);
    assert.equal(report.dataMigrationReady, false);
  });

  it("prefers an exact object key over compatibility metadata matches", async () => {
    const exact = entry("7", "BADGE", "BADGE-SYNTHETIC-001", "Synthetic Badge");
    const compatibility = entry("70", "BADGE", "BADGE-COMPATIBILITY-001", "Compatibility Badge", {
      legacyCode: "BADGE-SYNTHETIC-001"
    });
    const input = await fixture([
      exact,
      compatibility,
      entry("1", "ITEM", "ITEM-SYNTHETIC-POTION", "Synthetic Potion"),
      entry("2", "FURNITURE", "FURNITURE-SYNTHETIC-CHAIR", "Synthetic Chair", { grade: "A" }),
      entry("3", "MINI_PET", "MINI-PET-SYNTHETIC", "Synthetic MiniM", { grade: "S", emoji: "M" }),
      entry("4", "ITEM", "ITEM-SYNTHETIC-PENDANT", "Synthetic Pendant", { grade: "1" }),
      entry("5", "TITLE", "TITLE-SYNTHETIC-HERO", "Synthetic Hero"),
      entry("6", "SKILL", "SKILL-SYNTHETIC-SLASH", "Synthetic Slash"),
      entry("8", "PACKAGE", "PACKAGE-SYNTHETIC-001", "Synthetic Package"),
      entry("9", "PASS", "PASS-SYNTHETIC-001", "Synthetic Pass")
    ]);
    const report = await validateAssetReferences(input.root, input.manifest, input.snapshot);
    assert.equal(report.ambiguousCount, 0);
    assert.equal(report.dataMigrationReady, true);
  });

  it("rejects a changed private staging payload", async () => {
    const input = await fixture();
    const payloadDirectory = join(input.root, input.manifest.decisionSha256, "payload");
    const payloadName = `${input.manifest.entries[0]!.sourcePathSha256}.json`;
    await writeFile(join(payloadDirectory, payloadName), "{}\n", "utf8");
    await assert.rejects(validateAssetReferences(input.root, input.manifest, input.snapshot), /STAGING_PAYLOAD_HASH_MISMATCH/);
  });

  it("keeps the report digest stable across replay", async () => {
    const input = await fixture();
    const first = await validateAssetReferences(input.root, input.manifest, input.snapshot);
    const second = await validateAssetReferences(input.root, input.manifest, input.snapshot);
    assert.equal(first.reportSha256, second.reportSha256);
  });
});
