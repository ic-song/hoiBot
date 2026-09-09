import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { assertCommonStagingDatabaseName, calculateCommonStagingManifestSha256, MariaCommonStagingRepository, type CommonStagingExtractionManifest } from "../src/data-migration/common-staging-extractor.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const manifestPath = argument("--manifest");
if (manifestPath === undefined) throw new Error("USAGE: --manifest <common-staging-manifest.json> [--rollback]");
const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as CommonStagingExtractionManifest;
const config = loadConfig();
assertCommonStagingDatabaseName(config.database.name);
const database = createDatabaseClient(config.database);
try {
  const repository = new MariaCommonStagingRepository(database);
  if (process.argv.includes("--rollback")) {
    const deletedRuns = await repository.rollback(manifest.rawBundleSha256, calculateCommonStagingManifestSha256(manifest));
    process.stdout.write(`${JSON.stringify({ status: "ROLLED_BACK", deletedRuns })}\n`);
  } else {
    const result = await repository.extractAndStage(manifest);
    process.stdout.write(`${JSON.stringify({ status: "PASS", ...result })}\n`);
  }
} finally {
  await database.close();
}
