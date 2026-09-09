import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { calculateRawLandingBundleSha256, validateRawLandingBundleManifest, type RawLandingBundleEntry } from "../src/data-migration/maria-raw-landing-repository.js";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const entries: RawLandingBundleEntry[] = [
  { pathSha256: hash("a.json"), contentSha256: hash("{}"), size: 2, storageName: `${hash("a.json")}.bin` },
  { pathSha256: hash("b.txt"), contentSha256: hash("ok"), size: 2, storageName: `${hash("b.txt")}.bin` }
].sort((left, right) => left.pathSha256.localeCompare(right.pathSha256, "en"));

describe("data migration RAW landing manifest", () => {
  it("accepts an exact deterministic bundle", () => {
    assert.doesNotThrow(() => validateRawLandingBundleManifest({ format: "hoibot-raw-landing-bundle-v1", snapshotManifestSha256: hash("snapshot"), fileCount: 2, totalBytes: 4, bundleSha256: calculateRawLandingBundleSha256(entries), entries }));
  });
  it("rejects count, bytes, duplicate path and bundle hash drift", () => {
    const base = { format: "hoibot-raw-landing-bundle-v1" as const, snapshotManifestSha256: hash("snapshot"), fileCount: 2, totalBytes: 4, bundleSha256: calculateRawLandingBundleSha256(entries), entries };
    assert.throws(() => validateRawLandingBundleManifest({ ...base, fileCount: 3 }), /FILE_COUNT/);
    assert.throws(() => validateRawLandingBundleManifest({ ...base, totalBytes: 9 }), /TOTAL_BYTES/);
    assert.throws(() => validateRawLandingBundleManifest({ ...base, entries: [entries[0]!, entries[0]!] }), /DUPLICATE_PATH/);
    assert.throws(() => validateRawLandingBundleManifest({ ...base, bundleSha256: hash("drift") }), /BUNDLE_HASH/);
  });
});
