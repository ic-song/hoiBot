import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";

interface SourceHash { path: string; byteCount: number; sha256: string }
interface GitBlobAmendment {
  amendmentType: string;
  supersedesEvidenceFiles: string[];
  sourceCommit: string;
  sourceTree: string;
  byteSource: string;
  orderedSources: SourceHash[];
}

const evidenceDirectory = new URL("../evidence/object-db-pet-skill-probability-wave14a-lease2583/", import.meta.url);
const original = JSON.parse(fs.readFileSync(new URL("source-provenance.json", evidenceDirectory), "utf8")) as { sourceCommit: string };
const amendment = JSON.parse(fs.readFileSync(new URL("source-provenance-git-blob-amendment.json", evidenceDirectory), "utf8")) as GitBlobAmendment;

function verifyGitBlobSources(candidate: GitBlobAmendment): void {
  assert.equal(candidate.amendmentType, "GIT_BLOB_SOURCE_HASH_SUPERSESSION");
  assert.deepEqual(candidate.supersedesEvidenceFiles, ["source-provenance.json", "source-provenance-amendment.json"]);
  assert.match(candidate.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(execFileSync("git", ["rev-parse", `${candidate.sourceCommit}^{tree}`], { encoding: "utf8" }).trim(), candidate.sourceTree);
  assert.equal(candidate.byteSource, "git cat-file blob <sourceCommit>:<path>");
  assert.deepEqual(candidate.orderedSources.map(({ path }) => path), [...candidate.orderedSources.map(({ path }) => path)].sort());
  for (const source of candidate.orderedSources) {
    const blob = execFileSync("git", ["cat-file", "blob", `${candidate.sourceCommit}:${source.path}`], { maxBuffer: 4 * 1024 * 1024 });
    assert.equal(blob.byteLength, source.byteCount, `${source.path} committed byte count drift`);
    assert.equal(createHash("sha256").update(blob).digest("hex"), source.sha256, `${source.path} committed blob hash drift`);
  }
}

describe("Wave14A source provenance uses pinned Git blob bytes", () => {
  it("preserves history and supersedes it with a complete committed-source manifest", () => {
    assert.equal(original.sourceCommit, "5d7fdb9b9744d07b962e342cdebb4d5da8425c07");
    assert.equal(amendment.orderedSources.length, 8);
    verifyGitBlobSources(amendment);
  });

  it("fails closed for byte-count and digest tampering", () => {
    const byteTamper = structuredClone(amendment);
    byteTamper.orderedSources[0]!.byteCount += 1;
    assert.throws(() => verifyGitBlobSources(byteTamper), /committed byte count drift/);
    const hashTamper = structuredClone(amendment);
    hashTamper.orderedSources[3]!.sha256 = "0".repeat(64);
    assert.throws(() => verifyGitBlobSources(hashTamper), /committed blob hash drift/);
  });
});
