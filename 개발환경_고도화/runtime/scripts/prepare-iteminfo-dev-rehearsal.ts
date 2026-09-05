import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildItemInfoDevRehearsalArtifacts } from "../src/data-migration/iteminfo-dev-rehearsal-adapter.js";
import { assertItemInfoRehearsalTempRoot } from "../src/data-migration/iteminfo-dev-rehearsal-environment.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourceArgument = argument("--source");
const outputArgument = argument("--output-root");
const expectedSha256 = argument("--expected-sha256");
if (sourceArgument === undefined || outputArgument === undefined || expectedSha256 === undefined) {
  throw new Error("USAGE: --source <itemInfo.json> --output-root <new-private-directory> --expected-sha256 <sha256>");
}
if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("ITEMINFO_REHEARSAL_EXPECTED_HASH_INVALID");

const source = resolve(sourceArgument);
const outputRoot = assertItemInfoRehearsalTempRoot(outputArgument);
const sourceBytes = await readFile(source);
const sourceHashBefore = createHash("sha256").update(sourceBytes).digest("hex");
if (sourceHashBefore !== expectedSha256) throw new Error("ITEMINFO_REHEARSAL_SOURCE_HASH_MISMATCH");
const artifacts = buildItemInfoDevRehearsalArtifacts(sourceBytes, "lease2549-iteminfo-dev-rehearsal");
const rawEntry = artifacts.rawManifest.entries[0]!;
const payloadDirectory = join(outputRoot, artifacts.rawManifest.snapshotManifestSha256, "payload");
await mkdir(outputRoot, { recursive: false });
await mkdir(join(outputRoot, artifacts.rawManifest.snapshotManifestSha256), { recursive: false });
await mkdir(payloadDirectory, { recursive: false });
const snapshotCopy = join(payloadDirectory, rawEntry.storageName);
await copyFile(source, snapshotCopy);
await chmod(snapshotCopy, 0o444);

const copyBytes = await readFile(snapshotCopy);
const copyHash = createHash("sha256").update(copyBytes).digest("hex");
const sourceHashAfter = createHash("sha256").update(await readFile(source)).digest("hex");
if (copyBytes.byteLength !== sourceBytes.byteLength || copyHash !== sourceHashBefore || sourceHashAfter !== sourceHashBefore) throw new Error("ITEMINFO_REHEARSAL_COPY_SEAL_MISMATCH");

await Promise.all([
  writeFile(join(outputRoot, "raw-manifest.private.json"), `${JSON.stringify(artifacts.rawManifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
  writeFile(join(outputRoot, "staging-manifest.private.json"), `${JSON.stringify(artifacts.stagingManifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
  writeFile(join(outputRoot, "approval-provenance.private.json"), `${JSON.stringify(artifacts.approvalProvenance, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
]);
const copyStats = await stat(snapshotCopy);
const evidence = {
  format: "hoibot-iteminfo-dev-rehearsal-hash-evidence-v1",
  catalogVersion: "SC-20260902-1",
  claimRow: 2549,
  sourceHashBefore,
  sourceHashAfter,
  copyHash,
  sourceBytes: sourceBytes.byteLength,
  copyBytes: copyStats.size,
  copyReadOnly: (copyStats.mode & 0o222) === 0,
  rawBundleSha256: artifacts.rawManifest.bundleSha256,
  snapshotManifestSha256: artifacts.rawManifest.snapshotManifestSha256,
  approvalProvenanceSha256: artifacts.approvalProvenanceSha256,
  reconciliation: artifacts.reconciliation,
  productionMigrationReuseAllowed: false
};
await writeFile(join(outputRoot, "hash-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ status: "SEALED", outputRoot, ...evidence })}\n`);
