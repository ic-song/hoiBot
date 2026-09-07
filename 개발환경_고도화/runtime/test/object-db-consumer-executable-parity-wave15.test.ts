import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const evidenceCommit = "ec7144a29c8bcd5066bf21243fc111c873582b1b";
const receiptPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave15-v1.json";
const fixturePath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave15-pet-skill-info-private-dev-v1.json";
const harnessPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave15-harness.mjs";
const targetPath = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave15-pet-skill-info-private-dev.mjs";
const receiptGitBlob = "2ed4568cd6d7651a810890510e022e3693cb1354";

const sha = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
const blob = (path: string): string => execFileSync("git", ["show", `${evidenceCommit}:${path}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const live = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8").replace(/\r\n?/g, "\n");
const gitHashObject = (path: string): string => execFileSync("git", ["hash-object", path], { cwd: repoRoot, encoding: "utf8" }).trim();

describe("Wave15 /펫스킬정보 private/dev historical seal", () => {
  it("keeps the executed Wave15 receipt bundle and its evidence inputs pinned", () => {
    const receiptText = live(receiptPath);
    const bundle = JSON.parse(receiptText) as { evidenceCommit: string; receipts: unknown[] };
    const compact = JSON.stringify(bundle.receipts);

    assert.equal(bundle.evidenceCommit, evidenceCommit);
    assert.equal(gitHashObject(receiptPath), receiptGitBlob);
    assert.equal(bundle.receipts.length, 167);
    assert.equal(Buffer.byteLength(compact, "utf8"), 800_975);
    assert.equal(sha(compact), "13f737ec01a5f0ace33efc2d4243baef1880d21fb5ac21f47f8bbe60fc2c44f5");
    assert.equal(sha(receiptText), "373de982e86892d35032ced3547a9cc4c5b43f5c9c9010964b96dfafbf330c6f");

    for (const path of [fixturePath, harnessPath, targetPath]) {
      assert.equal(live(path), blob(path).replace(/\r\n?/g, "\n"), path);
    }
    assert.equal(sha(live(fixturePath)), "2e6bea0bc856a3ec0fdbbd8e80350db201ddc7a88de9946c61f03d2787ad54cc");
    assert.equal(sha(live(harnessPath)), "fc16a16494d18c59b9293750eebe1121c698c5796e4fe72dcb7113e12bcdb00a");
    assert.equal(sha(live(targetPath)), "cf8d765757856e22c111269f85b7fb157005a6ac4284fa09f2e7182a03b2bb12");
  });

  it("rejects any coordinated receipt mutation against the historical seal", () => {
    const bundle = JSON.parse(live(receiptPath)) as { receipts: Array<Record<string, unknown>> };
    const original = JSON.stringify(bundle.receipts);
    bundle.receipts[160] = { ...bundle.receipts[160], receiptId: "receipt:wave15:tampered" };
    const tampered = JSON.stringify(bundle.receipts);

    assert.notEqual(tampered, original);
    assert.notEqual(Buffer.byteLength(tampered, "utf8"), 800_975);
    assert.notEqual(sha(tampered), "13f737ec01a5f0ace33efc2d4243baef1880d21fb5ac21f47f8bbe60fc2c44f5");
  });
});
