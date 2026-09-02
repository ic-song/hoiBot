import { resolve } from "node:path";
import {
  buildFilterDecisionManifest,
  createDefaultFilterPolicy,
  writeFilterDecisionManifest
} from "../src/data-migration/filter-policy.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const source = argument("--source");
  const output = argument("--output");
  const sourceLabel = argument("--label") ?? "operational-data";
  if (!source || !output) {
    throw new Error("USAGE: --source <directory> --output <decision.json>");
  }

  const policy = createDefaultFilterPolicy();
  const manifest = await buildFilterDecisionManifest(resolve(source), policy, sourceLabel);
  await writeFilterDecisionManifest(resolve(output), manifest);
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      policyVersion: manifest.policyVersion,
      sourceFileCount: manifest.sourceFileCount,
      counts: manifest.counts,
      decisionSha256: manifest.decisionSha256
    })}\n`
  );
}

await main();

