import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFilterDecisionManifest,
  createDefaultFilterPolicy
} from "../src/data-migration/filter-policy.js";
import { buildIsolatedStaging } from "../src/data-migration/staging-transform.js";

async function fixture(): Promise<{ source: string; staging: string }> {
  const root = await mkdtemp(join(tmpdir(), "hoibot-staging-"));
  const source = join(root, "source");
  const staging = join(root, "private-staging");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(source));
  return { source, staging };
}

describe("isolated staging transform", () => {
  it("stages JSON and text under hashed names without changing source", async () => {
    const { source, staging } = await fixture();
    const jsonPath = join(source, "safe.json");
    await writeFile(jsonPath, JSON.stringify([{ score: 1 }]), "utf8");
    await writeFile(join(source, "safe.txt"), "synthetic\n", "utf8");
    const before = await readFile(jsonPath);
    const decisions = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());
    const manifest = await buildIsolatedStaging(source, staging, decisions, "ASSET-TEST-01");

    assert.equal(manifest.sourceFileCount, 2);
    assert.equal(manifest.stagedFileCount, 2);
    assert.equal(manifest.entries[0]?.sourcePathSha256.length, 64);
    assert.deepEqual(await readFile(jsonPath), before);
  });

  it("preserves review data in private staging but not in evidence", async () => {
    const { source, staging } = await fixture();
    await writeFile(join(source, "private.json"), JSON.stringify({ email: "private@test" }), "utf8");
    const decisions = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());
    const manifest = await buildIsolatedStaging(source, staging, decisions, "ASSET-TEST-01");

    assert.equal(manifest.reviewFileCount, 1);
    assert.equal(JSON.stringify(manifest).includes("private@test"), false);
    assert.equal(JSON.stringify(manifest).includes("private.json"), false);
  });

  it("does not create a payload for an explicit exclusion", async () => {
    const { source, staging } = await fixture();
    await writeFile(join(source, "excluded.json"), "{}", "utf8");
    const baseline = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());
    const pathHash = baseline.entries[0]?.pathSha256;
    assert.ok(pathHash);
    const decisions = await buildFilterDecisionManifest(
      source,
      createDefaultFilterPolicy([pathHash])
    );
    const manifest = await buildIsolatedStaging(source, staging, decisions, "ASSET-TEST-01");

    assert.equal(manifest.excludedFileCount, 1);
    assert.equal(manifest.stagedFileCount, 0);
  });

  it("replays without adding files or changing the staging hash", async () => {
    const { source, staging } = await fixture();
    await writeFile(join(source, "safe.json"), "{}", "utf8");
    const decisions = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());
    const first = await buildIsolatedStaging(source, staging, decisions, "ASSET-TEST-01");
    const payloadDirectory = join(staging, decisions.decisionSha256, "payload");
    const beforeFiles = await readdir(payloadDirectory);
    const second = await buildIsolatedStaging(source, staging, decisions, "ASSET-TEST-01");

    assert.equal(first.stagingSha256, second.stagingSha256);
    assert.deepEqual(await readdir(payloadDirectory), beforeFiles);
  });

  it("rejects changed source content after a decision freeze", async () => {
    const { source, staging } = await fixture();
    const path = join(source, "safe.json");
    await writeFile(path, "{}", "utf8");
    const decisions = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());
    await writeFile(path, "{\"changed\":true}", "utf8");

    await assert.rejects(
      buildIsolatedStaging(source, staging, decisions, "ASSET-TEST-01"),
      /SOURCE_DECISION_CONTENT_MISMATCH/
    );
  });
});

