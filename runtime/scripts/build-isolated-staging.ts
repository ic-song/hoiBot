import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FilterDecisionManifest } from "../src/data-migration/filter-policy.js";
import {
  buildIsolatedStaging,
  writeStagingTransformManifest
} from "../src/data-migration/staging-transform.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const source = argument("--source");
  const decisionsPath = argument("--decisions");
  const staging = argument("--staging");
  const output = argument("--output");
  const catalogVersion = argument("--catalog-version");
  if (!source || !decisionsPath || !staging || !output || !catalogVersion) {
    throw new Error(
      "USAGE: --source <directory> --decisions <json> --staging <private-directory> --output <manifest.json> --catalog-version <version>"
    );
  }

  const decisions = JSON.parse(
    await readFile(resolve(decisionsPath), "utf8")
  ) as FilterDecisionManifest;
  const manifest = await buildIsolatedStaging(
    resolve(source),
    resolve(staging),
    decisions,
    catalogVersion
  );
  await writeStagingTransformManifest(resolve(output), manifest);
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      catalogVersion: manifest.catalogVersion,
      sourceFileCount: manifest.sourceFileCount,
      stagedFileCount: manifest.stagedFileCount,
      quarantinedFileCount: manifest.quarantinedFileCount,
      excludedFileCount: manifest.excludedFileCount,
      reviewFileCount: manifest.reviewFileCount,
      sourceBytes: manifest.sourceBytes,
      stagingPayloadBytes: manifest.stagingPayloadBytes,
      stagingSha256: manifest.stagingSha256
    })}\n`
  );
}

await main();

