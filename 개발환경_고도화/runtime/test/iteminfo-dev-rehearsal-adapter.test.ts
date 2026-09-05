import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { extractCommonStagingRecords } from "../src/data-migration/common-staging-extractor.js";
import { calculateCatalogTargetSchemaSha256, calculateCatalogProjectionManifestSha256, type CatalogProjectionPolicy } from "../src/data-migration/catalog-projection-provider.js";
import { buildItemInfoDevCatalogProjectionManifest, buildItemInfoDevRehearsalArtifacts } from "../src/data-migration/iteminfo-dev-rehearsal-adapter.js";
import { validateRawLandingBundleManifest } from "../src/data-migration/maria-raw-landing-repository.js";
import { assertItemInfoRehearsalCredentialPath, assertItemInfoRehearsalTempRoot, expectedItemInfoRehearsalTempRoot, itemInfoProjectionContractPath, manageItemInfoRehearsalDatabase } from "../src/data-migration/iteminfo-dev-rehearsal-environment.js";

const hash = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const synthetic = {
  elemental: {
    "grade/a~": { nameList: ["동일표시", "다른표시"], maxLevel: 1 },
    gradeB: { nameList: ["동일표시"], maxLevel: 2 }
  },
  ring: { ringA: { nameList: ["동일표시"], maxLevel: 3 } },
  raidSpecialItem: { groupA: { item_0: { name: "raid" } } },
  castlePremiumItem: { groupB: { item_0: { name: "territory" } } },
  castleItem: { castleA: { name: "castle", exp: 1 } }
};
const expected = { rootEntries: 6, aliasLeaves: 4, definitionOccurrences: 6 };

describe("itemInfo development rehearsal adapter", () => {
  it("separates structural definition identities from display-name alias leaves", () => {
    const payload = Buffer.from(JSON.stringify(synthetic), "utf8");
    const artifacts = buildItemInfoDevRehearsalArtifacts(payload, "iteminfo-rehearsal", expected);
    validateRawLandingBundleManifest(artifacts.rawManifest);
    assert.deepEqual(artifacts.reconciliation, {
      ...expected,
      elementalDefinitions: 2,
      ringDefinitions: 1,
      raidDefinitions: 1,
      territoryDefinitions: 1,
      castleDefinitions: 1,
      projectedOccurrences: 6,
      quarantinedOccurrences: 0,
      ignoredOccurrences: 0
    });
    const pointers = artifacts.stagingManifest.entries[0]!.records.map((record) => record.sourcePointer);
    assert.deepEqual(pointers, ["/elemental/grade~1a~0", "/elemental/gradeB", "/ring/ringA", "/raidSpecialItem/groupA/item_0", "/castlePremiumItem/groupB/item_0", "/castleItem/castleA"]);
    assert.equal(new Set(pointers).size, 6);
    assert.equal(artifacts.approvalProvenance.identityPolicy, "STRUCTURAL_POINTER_NOT_DISPLAY_NAME");
    assert.equal(artifacts.approvalProvenance.projectionPolicy, "LEASE2549_DEV_REHEARSAL_GENERATED_LOCATOR");
    assert.equal(artifacts.approvalProvenance.productionMigrationReuseAllowed, false);
    assert.match(artifacts.approvalProvenanceSha256, /^[a-f0-9]{64}$/);
  });

  it("projects typed item leaves but quarantines lossy equipment definitions", () => {
    const payload = Buffer.from(JSON.stringify(synthetic), "utf8");
    const artifacts = buildItemInfoDevRehearsalArtifacts(payload, "iteminfo-rehearsal", expected);
    const entry = artifacts.rawManifest.entries[0]!;
    const extraction = extractCommonStagingRecords(artifacts.stagingManifest, new Map([[entry.pathSha256, payload]]));
    const schemaText = JSON.stringify({ catalogVersion: "SC-20260902-1", columns: [
      { table: "canonical_item_definitions", column: "item_id", sqlType: "CHAR(8)", nullable: false },
      { table: "canonical_item_definitions", column: "item_name", sqlType: "VARCHAR(255)", nullable: false },
      { table: "canonical_item_definitions", column: "item_description", sqlType: "TEXT", nullable: true },
      { table: "canonical_item_definitions", column: "item_kind", sqlType: "VARCHAR(50)", nullable: false },
      { table: "canonical_item_definitions", column: "item_grade", sqlType: "VARCHAR(50)", nullable: true },
      { table: "canonical_item_definitions", column: "price_amount", sqlType: "DECIMAL(30,3)", nullable: true },
      { table: "canonical_item_definitions", column: "price_currency_source_identifier", sqlType: "VARCHAR(191)", nullable: true },
      { table: "canonical_item_definitions", column: "stackable_flag", sqlType: "BOOLEAN", nullable: false },
      { table: "canonical_item_definitions", column: "active_flag", sqlType: "BOOLEAN", nullable: false },
      { table: "canonical_item_definitions", column: "definition_options", sqlType: "JSON", nullable: true }
    ] });
    const targetSchemaSha256 = calculateCatalogTargetSchemaSha256(schemaText);
    const manifest = buildItemInfoDevCatalogProjectionManifest(artifacts, extraction, "a1234567", targetSchemaSha256, "iteminfo-rehearsal");
    assert.equal(manifest.sources.length, 6);
    assert.equal(manifest.sources.filter((source) => source.decisionStatus === "PROJECT").length, 3);
    assert.equal(manifest.sources.filter((source) => source.decisionStatus === "QUARANTINE").length, 3);
    assert.equal(manifest.sources.flatMap((source) => source.outputs).length, 3);
    const policy: CatalogProjectionPolicy = {
      targetSchemaSha256,
      columns: JSON.parse(schemaText).columns,
      generatedCuidBindings: [{ targetTable: "canonical_item_definitions", targetPkColumn: "item_id", objectType: "CANONICAL_ITEM_DEFINITIONS", sourceNamespace: "object-import.item.canonical_item_definitions" }],
      reusedPrimaryKeys: [], foreignKeys: [],
      domainTargets: { item: ["canonical_item_definitions"], pet_equipment: [] },
      quarantineReasons: ["SOURCE_SHAPE_MISMATCH"]
    };
    assert.match(calculateCatalogProjectionManifestSha256(manifest, policy), /^[a-f0-9]{64}$/);
  });

  it("normalizes lossless source numbers before JSON projection", () => {
    const large = structuredClone(synthetic);
    large.castleItem.castleA.exp = 999999999999999999999 as unknown as number;
    const payload = Buffer.from(JSON.stringify(large).replace("1e+21", "999999999999999999999"), "utf8");
    const artifacts = buildItemInfoDevRehearsalArtifacts(payload, "iteminfo-rehearsal", expected);
    const entry = artifacts.rawManifest.entries[0]!;
    const extraction = extractCommonStagingRecords(artifacts.stagingManifest, new Map([[entry.pathSha256, payload]]));
    const manifest = buildItemInfoDevCatalogProjectionManifest(artifacts, extraction, "a1234567", "a".repeat(64), "iteminfo-rehearsal");
    const castle = manifest.sources.find((source) => source.outputs[0]?.payload.item_kind === "CASTLE_UNIT")!;
    assert.equal((castle.outputs[0]!.payload.definition_options as Record<string, unknown>).exp, "999999999999999999999");
  });

  it("round-trips every exact structural pointer through Common Staging", () => {
    const payload = Buffer.from(JSON.stringify(synthetic), "utf8");
    const artifacts = buildItemInfoDevRehearsalArtifacts(payload, "iteminfo-rehearsal", expected);
    const entry = artifacts.rawManifest.entries[0]!;
    const extraction = extractCommonStagingRecords(artifacts.stagingManifest, new Map([[entry.pathSha256, payload]]));
    assert.equal(extraction.records.length, expected.definitionOccurrences);
    assert.equal(extraction.records.filter((record) => record.projectionStatus === "PROJECT").length, expected.definitionOccurrences);
    assert.equal(extraction.records.filter((record) => record.projectionStatus === "QUARANTINE").length, 0);
    assert.equal(extraction.records.filter((record) => record.recordDomain === "PET_EQUIPMENT").length, 3);
    assert.equal(extraction.records.filter((record) => record.recordDomain === "ITEM").length, 3);
    assert.equal(entry.contentSha256, hash(payload));
  });

  it("fails closed on count, category, name-list, item-key, and payload drift", () => {
    const payload = Buffer.from(JSON.stringify(synthetic), "utf8");
    assert.throws(() => buildItemInfoDevRehearsalArtifacts(payload, "iteminfo-rehearsal"), /COUNT_DRIFT/);
    assert.throws(() => buildItemInfoDevRehearsalArtifacts(Buffer.from("{}"), "iteminfo-rehearsal", expected), /CATEGORY_SCOPE_MISMATCH/);
    const missingNames = structuredClone(synthetic) as Record<string, unknown>;
    (missingNames.elemental as Record<string, Record<string, unknown>>).gradeB!.nameList = [];
    assert.throws(() => buildItemInfoDevRehearsalArtifacts(Buffer.from(JSON.stringify(missingNames)), "iteminfo-rehearsal", expected), /NAME_LIST_INVALID/);
    const invalidKey = structuredClone(synthetic) as Record<string, unknown>;
    const raid = invalidKey.raidSpecialItem as Record<string, Record<string, unknown>>;
    raid.groupA!.bad = raid.groupA!.item_0;
    delete raid.groupA!.item_0;
    assert.throws(() => buildItemInfoDevRehearsalArtifacts(Buffer.from(JSON.stringify(invalidKey)), "iteminfo-rehearsal", expected), /TYPED_ITEM_KEY_INVALID/);
    const artifacts = buildItemInfoDevRehearsalArtifacts(payload, "iteminfo-rehearsal", expected);
    const pathHash = artifacts.rawManifest.entries[0]!.pathSha256;
    assert.throws(() => extractCommonStagingRecords(artifacts.stagingManifest, new Map([[pathHash, Buffer.from(`${payload.toString("utf8")} `)]])), /RAW_PAYLOAD_MISMATCH/);
  });

  it("rejects repository and wrong temporary output paths", () => {
    assert.throws(() => assertItemInfoRehearsalTempRoot("relative-task-output"), /ASSET_TARGET_REFUSED/);
    assert.throws(() => assertItemInfoRehearsalTempRoot(process.cwd()), /ASSET_TARGET_REFUSED/);
    assert.throws(() => assertItemInfoRehearsalTempRoot(join(expectedItemInfoRehearsalTempRoot(), "nested")), /ASSET_TARGET_REFUSED/);
    assert.throws(() => assertItemInfoRehearsalCredentialPath(join(expectedItemInfoRehearsalTempRoot(), "wrong.env")), /CREDENTIAL_PATH_REFUSED/);
    assert.equal(assertItemInfoRehearsalTempRoot(expectedItemInfoRehearsalTempRoot()), expectedItemInfoRehearsalTempRoot());
  });

  it("compensates exact database and user when credential writing fails", async () => {
    const statements: string[] = [];
    await assert.rejects(() => manageItemInfoRehearsalDatabase({ action: "create", credentialsPath: join(expectedItemInfoRehearsalTempRoot(), "rehearsal.env.private") }, {
      password: () => "synthetic-secret-not-logged",
      writeCredential: async () => { throw new Error("synthetic write failure"); },
      runMariaAdmin: (sql) => {
        statements.push(sql);
        return { status: 0, stdout: sql.startsWith("SELECT COUNT") ? "0\n0\n" : "" };
      }
    }), /CREDENTIAL_WRITE_FAILED_COMPENSATED/);
    assert.equal(statements.length, 3);
    assert.match(statements[0]!, /CREATE DATABASE `hoibot_rehearsal_iteminfo_20260905a`/);
    assert.match(statements[1]!, /DROP USER IF EXISTS 'iteminfo_r2549'@'%'/);
    assert.match(statements[2]!, /information_schema\.schemata/);
  });

  it("compensates a partial CREATE multi-statement failure and verifies zero residue", async () => {
    const statements: string[] = [];
    let credentialWrites = 0;
    await assert.rejects(() => manageItemInfoRehearsalDatabase({ action: "create", credentialsPath: join(expectedItemInfoRehearsalTempRoot(), "rehearsal.env.private") }, {
      password: () => "synthetic-secret-not-logged",
      writeCredential: async () => { credentialWrites += 1; },
      runMariaAdmin: (sql) => {
        statements.push(sql);
        if (statements.length === 1) return { status: 1, stdout: "" };
        return { status: 0, stdout: sql.startsWith("SELECT COUNT") ? "0\n0\n" : "" };
      }
    }), /DB_CREATE_FAILED_COMPENSATED/);
    assert.equal(credentialWrites, 0);
    assert.equal(statements.length, 3);
    assert.match(statements[1]!, /DROP DATABASE IF EXISTS `hoibot_rehearsal_iteminfo_20260905a`/);
    assert.match(statements[1]!, /DROP USER IF EXISTS 'iteminfo_r2549'@'%'/);
    assert.match(statements[2]!, /mysql\.user/);
  });

  it("rejects a wrong absolute env path at the probe entrypoint", () => {
    const script = fileURLToPath(new URL("../scripts/probe-iteminfo-dev-rehearsal.ts", import.meta.url));
    const result = spawnSync(process.execPath, ["--import", "tsx", script, "--env", join(process.cwd(), "wrong-rehearsal.env")], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CREDENTIAL_PATH_REFUSED/);
  });

  it("resolves the projection contract independently from process cwd", async () => {
    const path = itemInfoProjectionContractPath();
    const contract = JSON.parse(await readFile(path, "utf8")) as { catalogVersion?: string };
    assert.equal(contract.catalogVersion, "SC-20260902-1");
    assert.equal(isAbsolute(path), true);
  });
});
