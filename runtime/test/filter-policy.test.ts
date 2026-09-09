import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFilterDecisionManifest,
  createDefaultFilterPolicy
} from "../src/data-migration/filter-policy.js";

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hoibot-filter-policy-"));
}

describe("data migration filter policy", () => {
  it("keeps valid JSON and text by default", async () => {
    const source = await root();
    await writeFile(join(source, "safe.json"), JSON.stringify({ score: 1 }), "utf8");
    await writeFile(join(source, "safe.txt"), "synthetic\n", "utf8");
    const manifest = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());

    assert.deepEqual(manifest.counts, { KEEP: 2, QUARANTINE: 0, EXCLUDE: 0, REVIEW: 0 });
  });

  it("reviews sensitive key categories without copying names or values", async () => {
    const source = await root();
    await writeFile(
      join(source, "private-user.json"),
      JSON.stringify({ email: "private@example.test", nested: { address: "private" } }),
      "utf8"
    );
    const manifest = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());
    const serialized = JSON.stringify(manifest);

    assert.equal(manifest.entries[0]?.decision, "REVIEW");
    assert.deepEqual(manifest.entries[0]?.sensitiveKeyCategories, ["CONTACT", "LOCATION"]);
    assert.equal(serialized.includes("private@example.test"), false);
    assert.equal(serialized.includes("private-user.json"), false);
  });

  it("reviews executable content and quarantines invalid data", async () => {
    const source = await root();
    await writeFile(join(source, "legacy.js"), "var synthetic = true;", "utf8");
    await writeFile(join(source, "broken.json"), "{", "utf8");
    await writeFile(join(source, "binary.bin"), Buffer.from([0xff, 0xfe]));
    const manifest = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());

    assert.equal(manifest.counts.REVIEW, 1);
    assert.equal(manifest.counts.QUARANTINE, 2);
    assert.equal(manifest.counts.EXCLUDE, 0);
  });

  it("excludes only an explicitly approved path hash", async () => {
    const source = await root();
    await writeFile(join(source, "candidate.json"), "{}", "utf8");
    const baseline = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());
    const pathSha256 = baseline.entries[0]?.pathSha256;
    assert.ok(pathSha256);

    const manifest = await buildFilterDecisionManifest(
      source,
      createDefaultFilterPolicy([pathSha256])
    );
    assert.equal(manifest.counts.EXCLUDE, 1);
    assert.equal(manifest.entries[0]?.reasonCodes[0], "EXPLICIT_PATH_HASH_EXCLUSION");
  });

  it("produces a deterministic decision hash", async () => {
    const source = await root();
    await writeFile(join(source, "safe.json"), "{}", "utf8");
    const first = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());
    const second = await buildFilterDecisionManifest(source, createDefaultFilterPolicy());

    assert.equal(first.decisionSha256, second.decisionSha256);
    assert.deepEqual(first.entries, second.entries);
  });
});

