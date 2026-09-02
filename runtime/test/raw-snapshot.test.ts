import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildRawSnapshotManifest,
  buildRawLandingBundle,
  compareRawSnapshotManifests,
  writeRawLandingBundleManifest,
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

    assert.deepEqual(compareRawSnapshotManifests(first, second), {
      equal: true,
      reasons: [],
      missingPathSha256: [],
      additionalPathSha256: [],
      changedPathSha256: []
    });
  });

  it("detects content tampering", async () => {
    const root = await fixture();
    const first = await buildRawSnapshotManifest(root, "source");
    await writeFile(join(root, "nested", "state.txt"), "tampered\n", "utf8");
    const second = await buildRawSnapshotManifest(root, "downloaded");

    assert.equal(compareRawSnapshotManifests(first, second).equal, false);
    assert.ok(compareRawSnapshotManifests(first, second).reasons.includes("MANIFEST_HASH_MISMATCH"));
    assert.equal(compareRawSnapshotManifests(first, second).changedPathSha256.length, 1);
  });

  it("classifies missing and additional files without exposing their names", async () => {
    const expectedRoot = await fixture();
    const actualRoot = await mkdtemp(join(tmpdir(), "hoibot-raw-snapshot-actual-"));
    await writeFile(join(actualRoot, "additional.json"), "{}", "utf8");
    const expected = await buildRawSnapshotManifest(expectedRoot, "expected");
    const actual = await buildRawSnapshotManifest(actualRoot, "actual");
    const comparison = compareRawSnapshotManifests(expected, actual);

    assert.equal(comparison.missingPathSha256.length, 2);
    assert.equal(comparison.additionalPathSha256.length, 1);
    assert.ok(comparison.reasons.includes("MISSING_FILES"));
    assert.ok(comparison.reasons.includes("ADDITIONAL_FILES"));
    assert.equal(JSON.stringify(comparison).includes("additional.json"), false);
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

  it("builds a replay-safe byte-exact RAW landing bundle", async () => {
    const root = await fixture();
    const bundle = await mkdtemp(join(tmpdir(), "hoibot-raw-landing-"));
    const snapshot = await buildRawSnapshotManifest(root, "test");
    const first = await buildRawLandingBundle(root, bundle, snapshot);
    const replay = await buildRawLandingBundle(root, bundle, snapshot);

    assert.equal(first.fileCount, 2);
    assert.equal(first.bundleSha256, replay.bundleSha256);
    for (const entry of first.entries) {
      const payload = await readFile(
        join(bundle, first.snapshotManifestSha256, "payload", entry.storageName)
      );
      assert.equal(payload.byteLength, entry.size);
      assert.equal(entry.storageName.includes("member.json"), false);
    }
    await writeRawLandingBundleManifest(join(bundle, "manifest.json"), first);
    assert.equal(JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8")).fileCount, 2);
  });

  it("rejects source drift and an altered existing landing payload", async () => {
    const root = await fixture();
    const bundle = await mkdtemp(join(tmpdir(), "hoibot-raw-landing-conflict-"));
    const snapshot = await buildRawSnapshotManifest(root, "test");
    const first = await buildRawLandingBundle(root, bundle, snapshot);
    const target = first.entries[0]!;
    await writeFile(
      join(bundle, first.snapshotManifestSha256, "payload", target.storageName),
      "tampered",
      "utf8"
    );
    await assert.rejects(buildRawLandingBundle(root, bundle, snapshot), /RAW_LANDING_PAYLOAD_CONFLICT/);
    await writeFile(join(root, "member.json"), "{}", "utf8");
    await assert.rejects(buildRawLandingBundle(root, await mkdtemp(join(tmpdir(), "raw-drift-")), snapshot), /RAW_LANDING_SOURCE_DRIFT/);
  });
});
