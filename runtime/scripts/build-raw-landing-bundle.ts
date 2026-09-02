import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildRawLandingBundle,
  type RawSnapshotManifest,
  writeRawLandingBundleManifest
} from "../src/data-migration/raw-snapshot.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const source = argument("--source");
const snapshotPath = argument("--snapshot");
const bundleRoot = argument("--bundle-root");
const output = argument("--output");
if (!source || !snapshotPath || !bundleRoot || !output) {
  throw new Error("USAGE: --source <directory> --snapshot <manifest.json> --bundle-root <private-directory> --output <bundle-manifest.json>");
}
const snapshot = JSON.parse(await readFile(resolve(snapshotPath), "utf8")) as RawSnapshotManifest;
const manifest = await buildRawLandingBundle(resolve(source), resolve(bundleRoot), snapshot);
await writeRawLandingBundleManifest(resolve(output), manifest);
process.stdout.write(`${JSON.stringify({
  status: "PASS",
  snapshotManifestSha256: manifest.snapshotManifestSha256,
  fileCount: manifest.fileCount,
  totalBytes: manifest.totalBytes,
  bundleSha256: manifest.bundleSha256
})}\n`);
