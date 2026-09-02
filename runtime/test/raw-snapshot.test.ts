import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildRawSnapshotManifest,
  compareRawSnapshotManifests,
  writeRawSnapshotManifest
} from "../src/data-migration/raw-snapshot.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hoibot-raw-snapshot-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "member.json"), JSON.stringify({ user: "synthetic", bag: [] }), "utf8");
  await writeFile(join(root, "nested", "state.txt"), "synthetic-state\n", "utf8");
  return root;
}

describe("RAW snapshot manifest", () => {
  it("creates a content-free deterministic manifest summary", async () => {
    const root = await fixture();
    const manifest = await buildRawSnapshotManifest(root, "test");

    assert.equal(manifest.fileCount, 2);
    assert.equal(manifest.jsonFileCount, 1);
    assert.equal(manifest.textFileCount, 2);
    assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(manifest).includes("synthetic-state"), false);
    assert.equal(JSON.stringify(manifest).includes("member.json"), false);
  });

  it("reports parity after an unchanged copy", async () => {
    const root = await fixture();
    const first = await buildRawSnapshotManifest(root, "source");
    const second = await buildRawSnapshotManifest(root, "downloaded");

    assert.deepEqual(compareRawSnapshotManifests(first, second), { equal: true, reasons: [] });
  });

  it("detects content tampering", async () => {
    const root = await fixture();
    const first = await buildRawSnapshotManifest(root, "source");
    await writeFile(join(root, "nested", "state.txt"), "tampered\n", "utf8");
    const second = await buildRawSnapshotManifest(root, "downloaded");

    assert.equal(compareRawSnapshotManifests(first, second).equal, false);
    assert.ok(compareRawSnapshotManifests(first, second).reasons.includes("MANIFEST_HASH_MISMATCH"));
  });

  it("rejects malformed JSON and invalid UTF-8", async () => {
    const root = await fixture();
    await writeFile(join(root, "broken.json"), "{", "utf8");
    await assert.rejects(buildRawSnapshotManifest(root), /INVALID_JSON/);
    await writeFile(join(root, "broken.json"), Buffer.from([0xff, 0xfe]));
    await assert.rejects(buildRawSnapshotManifest(root), /INVALID_UTF8/);
  });

  it("writes a manifest atomically", async () => {
    const root = await fixture();
    const manifest = await buildRawSnapshotManifest(root, "test");
    const output = join(root, "evidence", "manifest.json");

    await writeRawSnapshotManifest(output, manifest);
    const written = await buildRawSnapshotManifest(join(root, "evidence"), "manifest-output");
    assert.equal(written.fileCount, 1);
  });
});

