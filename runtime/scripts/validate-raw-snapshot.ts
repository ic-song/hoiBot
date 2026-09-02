import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildRawSnapshotManifest,
  compareRawSnapshotManifests,
  type RawSnapshotManifest,
  writeRawSnapshotManifest
} from "../src/data-migration/raw-snapshot.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const source = argument("--source");
  const output = argument("--output");
  const comparePath = argument("--compare");
  const sourceLabel = argument("--label") ?? "operational-data";

  if (!source || !output) {
    throw new Error("USAGE: --source <directory> --output <manifest.json> [--compare <manifest.json>]");
  }

  const manifest = await buildRawSnapshotManifest(resolve(source), sourceLabel);
  await writeRawSnapshotManifest(resolve(output), manifest);

  if (comparePath) {
    const expected = JSON.parse(await readFile(resolve(comparePath), "utf8")) as RawSnapshotManifest;
    const comparison = compareRawSnapshotManifests(expected, manifest);
    if (!comparison.equal) {
      throw new Error(`SNAPSHOT_PARITY_FAILED:${comparison.reasons.join(",")}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      fileCount: manifest.fileCount,
      jsonFileCount: manifest.jsonFileCount,
      textFileCount: manifest.textFileCount,
      totalBytes: manifest.totalBytes,
      manifestSha256: manifest.manifestSha256
    })}\n`
  );
}

await main();

