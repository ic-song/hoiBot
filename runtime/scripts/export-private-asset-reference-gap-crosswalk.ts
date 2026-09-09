import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  buildPrivateAssetReferenceGapCrosswalk,
  type CanonicalAssetSnapshot
} from "../src/data-migration/asset-reference-validation.js";
import type { StagingTransformManifest } from "../src/data-migration/staging-transform.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const stagingRoot = argument("--staging");
  const stagingManifestPath = argument("--staging-manifest");
  const canonicalSnapshotPath = argument("--canonical-snapshot");
  const outputPath = argument("--output");
  if (!stagingRoot || !stagingManifestPath || !canonicalSnapshotPath || !outputPath) {
    throw new Error("USAGE: --staging <private-root> --staging-manifest <json> --canonical-snapshot <json> --output <private-json>");
  }

  const output = resolve(outputPath);
  const relativeOutput = relative(resolve(tmpdir()), output);
  if (relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) throw new Error("PRIVATE_CROSSWALK_OUTPUT_MUST_BE_TEMP");
  const stagingManifest = JSON.parse(await readFile(resolve(stagingManifestPath), "utf8")) as StagingTransformManifest;
  const canonicalSnapshot = JSON.parse(await readFile(resolve(canonicalSnapshotPath), "utf8")) as CanonicalAssetSnapshot;
  const crosswalk = await buildPrivateAssetReferenceGapCrosswalk(resolve(stagingRoot), stagingManifest, canonicalSnapshot);
  const serialized = `${JSON.stringify(crosswalk, null, 2)}\n`;
  const temporary = `${output}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, serialized, "utf8");
  await rename(temporary, output);

  const counts = new Map<string, { identities: number; occurrences: number }>();
  for (const entry of crosswalk.entries) {
    const key = `${entry.kind}|${entry.requestedType}`;
    const current = counts.get(key) ?? { identities: 0, occurrences: 0 };
    current.identities += 1;
    current.occurrences += entry.occurrenceCount;
    counts.set(key, current);
  }
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    catalogVersion: crosswalk.catalogVersion,
    payloadFileCount: crosswalk.payloadFileCount,
    distinctReferenceCount: crosswalk.distinctReferenceCount,
    gapIdentityCount: crosswalk.gapIdentityCount,
    counts: Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))),
    stagingSha256: crosswalk.stagingSha256,
    canonicalSha256: crosswalk.canonicalSha256,
    crosswalkSha256: createHash("sha256").update(serialized).digest("hex")
  })}\n`);
}

await main();
