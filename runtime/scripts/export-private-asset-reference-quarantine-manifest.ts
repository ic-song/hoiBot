import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  buildAssetReferenceQuarantineManifest,
  type PrivateAssetReferenceGapCrosswalk
} from "../src/data-migration/asset-reference-validation.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const crosswalkPath = argument("--crosswalk");
  const outputPath = argument("--output");
  if (!crosswalkPath || !outputPath) throw new Error("USAGE: --crosswalk <private-json> --output <private-json>");
  const output = resolve(outputPath);
  const relativeOutput = relative(resolve(tmpdir()), output);
  if (relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) throw new Error("PRIVATE_QUARANTINE_OUTPUT_MUST_BE_TEMP");
  const crosswalk = JSON.parse(await readFile(resolve(crosswalkPath), "utf8")) as PrivateAssetReferenceGapCrosswalk;
  const manifest = buildAssetReferenceQuarantineManifest(crosswalk);
  const temporary = `${output}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporary, output);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    catalogVersion: manifest.catalogVersion,
    identityCount: manifest.entries.length,
    occurrenceCount: manifest.entries.reduce((sum, entry) => sum + entry.occurrenceCount, 0),
    stagingSha256: manifest.stagingSha256,
    canonicalSha256: manifest.canonicalSha256,
    manifestSha256: manifest.manifestSha256
  })}\n`);
}

await main();
