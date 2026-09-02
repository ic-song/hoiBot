import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaRawLandingRepository, type RawLandingBundleManifest } from "../src/data-migration/maria-raw-landing-repository.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const manifestPath = argument("--manifest");
const bundleRoot = argument("--bundle-root");
if (!manifestPath || !bundleRoot) throw new Error("USAGE: --manifest <bundle-manifest.json> --bundle-root <private-directory> [--rollback]");
const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as RawLandingBundleManifest;
const database = createDatabaseClient(loadConfig().database);
try {
  const repository = new MariaRawLandingRepository(database);
  if (process.argv.includes("--rollback")) {
    process.stdout.write(`${JSON.stringify({ status: "ROLLED_BACK", deletedRuns: await repository.rollbackRun(manifest.bundleSha256) })}\n`);
  } else {
    const result = await repository.importBundle(manifest, (entry) => readFile(join(resolve(bundleRoot), manifest.snapshotManifestSha256, "payload", entry.storageName)));
    process.stdout.write(`${JSON.stringify({ status: "PASS", ...result })}\n`);
  }
} finally {
  await database.close();
}
