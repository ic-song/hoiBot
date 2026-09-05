import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { calculateCatalogTargetSchemaSha256 } from "../src/data-migration/catalog-projection-provider.js";
import { extractCommonStagingRecords, type CommonStagingExtractionManifest } from "../src/data-migration/common-staging-extractor.js";
import { buildItemInfoDevCatalogProjectionManifest, buildItemInfoDevRehearsalArtifacts } from "../src/data-migration/iteminfo-dev-rehearsal-adapter.js";
import type { RawLandingBundleManifest } from "../src/data-migration/maria-raw-landing-repository.js";
import { assertItemInfoRehearsalTempRoot, itemInfoProjectionContractPath } from "../src/data-migration/iteminfo-dev-rehearsal-environment.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const bundleRootArgument = argument("--bundle-root");
const commonStagingRunId = argument("--common-staging-run");
if (bundleRootArgument === undefined || commonStagingRunId === undefined) {
  throw new Error("USAGE: --bundle-root <absolute-private-directory> --common-staging-run <CUID2>");
}
const bundleRoot = assertItemInfoRehearsalTempRoot(bundleRootArgument);
const rawManifest = JSON.parse(await readFile(join(bundleRoot, "raw-manifest.private.json"), "utf8")) as RawLandingBundleManifest;
const stagingManifest = JSON.parse(await readFile(join(bundleRoot, "staging-manifest.private.json"), "utf8")) as CommonStagingExtractionManifest;
const rawEntry = rawManifest.entries[0]!;
const payload = await readFile(join(bundleRoot, rawManifest.snapshotManifestSha256, "payload", rawEntry.storageName));
const artifacts = buildItemInfoDevRehearsalArtifacts(payload, "lease2549-iteminfo-dev-rehearsal");
if (JSON.stringify(artifacts.rawManifest) !== JSON.stringify(rawManifest) || JSON.stringify(artifacts.stagingManifest) !== JSON.stringify(stagingManifest)) throw new Error("ITEMINFO_REHEARSAL_PRIVATE_MANIFEST_DRIFT");
const extraction = extractCommonStagingRecords(stagingManifest, new Map([[rawEntry.pathSha256, payload]]));
const schemaText = await readFile(itemInfoProjectionContractPath(), "utf8");
const manifest = buildItemInfoDevCatalogProjectionManifest(artifacts, extraction, commonStagingRunId, calculateCatalogTargetSchemaSha256(schemaText), "lease2549-iteminfo-dev-rehearsal");
const project = manifest.sources.filter((source) => source.decisionStatus === "PROJECT").length;
const quarantine = manifest.sources.filter((source) => source.decisionStatus === "QUARANTINE").length;
const ignore = manifest.sources.filter((source) => source.decisionStatus === "IGNORE").length;
if (project + quarantine + ignore !== artifacts.reconciliation.definitionOccurrences) throw new Error("ITEMINFO_REHEARSAL_DECISION_RECONCILIATION_MISMATCH");
await writeFile(join(bundleRoot, "catalog-projection-manifest.private.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ status: "PREPARED", commonStagingRunId, sourceOccurrences: manifest.sources.length, project, quarantine, ignore, projectedRows: manifest.sources.flatMap((source) => source.outputs).length, approvalProvenanceSha256: artifacts.approvalProvenanceSha256, productionMigrationReuseAllowed: false })}\n`);
