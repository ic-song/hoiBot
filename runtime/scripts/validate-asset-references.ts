import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StagingTransformManifest } from "../src/data-migration/staging-transform.js";
import {
  validateAssetReferences,
  type AssetReferenceQuarantineManifest,
  type CanonicalAssetSnapshot
} from "../src/data-migration/asset-reference-validation.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const stagingRoot = argument("--staging");
  const stagingManifestPath = argument("--staging-manifest");
  const canonicalSnapshotPath = argument("--canonical-snapshot");
  const outputPath = argument("--output");
  const quarantineManifestPath = argument("--quarantine-manifest");
  if (!stagingRoot || !stagingManifestPath || !canonicalSnapshotPath || !outputPath) {
    throw new Error("USAGE: --staging <private-root> --staging-manifest <json> --canonical-snapshot <json> --output <json>");
  }
  const stagingManifest = JSON.parse(await readFile(resolve(stagingManifestPath), "utf8")) as StagingTransformManifest;
  const canonicalSnapshot = JSON.parse(await readFile(resolve(canonicalSnapshotPath), "utf8")) as CanonicalAssetSnapshot;
  const quarantineManifest = quarantineManifestPath
    ? JSON.parse(await readFile(resolve(quarantineManifestPath), "utf8")) as AssetReferenceQuarantineManifest
    : undefined;
  const report = await validateAssetReferences(resolve(stagingRoot), stagingManifest, canonicalSnapshot, quarantineManifest);
  const output = resolve(outputPath);
  const temporary = `${output}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporary, output);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    dataMigrationReady: report.dataMigrationReady,
    payloadFileCount: report.payloadFileCount,
    referenceCount: report.referenceCount,
    distinctReferenceCount: report.distinctReferenceCount,
    resolvedCount: report.resolvedCount,
    orphanCount: report.orphanCount,
    ambiguousCount: report.ambiguousCount,
    inactiveCount: report.inactiveCount,
    detectedOrphanCount: report.detectedOrphanCount,
    detectedAmbiguousCount: report.detectedAmbiguousCount,
    detectedInactiveCount: report.detectedInactiveCount,
    quarantinedIdentityCount: report.quarantinedIdentityCount,
    quarantinedCount: report.quarantinedCount,
    quarantineManifestSha256: report.quarantineManifestSha256,
    canonicalDuplicateCount: report.canonicalDuplicateCount,
    canonicalCollisionCount: report.canonicalCollisionCount,
    stagingSha256: report.stagingSha256,
    canonicalSha256: report.canonicalSha256,
    reportSha256: report.reportSha256
  })}\n`);
}

await main();
