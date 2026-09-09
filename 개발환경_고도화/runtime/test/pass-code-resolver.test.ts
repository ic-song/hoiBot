import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PASS_CODE_MAPPINGS,
  PASS_CODE_PASSTHROUGH,
  PASS_CODE_POLICY_SHA256,
  PASS_CODE_POLICY_VERSION,
  PASS_COMPATIBILITY_CODES,
  PASS_SEMANTIC_CODES,
  PassCodeResolutionError,
  resolvePassCode
} from "../src/pass/pass-code-resolver.js";

const policyFixturePath = fileURLToPath(new URL(
  "../../migration-control/fixtures/synthetic-relational/pass-six-identity-policy-snapshot-v1.json",
  import.meta.url
));
const importerPath = fileURLToPath(new URL("../scripts/import-legacy-json.ts", import.meta.url));
const profileReaderPath = fileURLToPath(new URL("../src/player/maria-profile-repository.ts", import.meta.url));
const policyFixture = JSON.parse(readFileSync(policyFixturePath, "utf8")) as {
  policyVersion: string;
  policySha256: string;
  policy: { semanticIdentities: Array<{ semanticCode: string }> };
};
const importerSource = readFileSync(importerPath, "utf8");
const profileReaderSource = readFileSync(profileReaderPath, "utf8");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const semanticToCompatibility = (code: string, policyVersion: string = PASS_CODE_POLICY_VERSION) => resolvePassCode({
  code,
  sourceScope: "SEMANTIC",
  targetScope: "COMPATIBILITY",
  policyVersion
});

const compatibilityToSemantic = (code: string, policyVersion: string = PASS_CODE_POLICY_VERSION) => resolvePassCode({
  code,
  sourceScope: "COMPATIBILITY",
  targetScope: "SEMANTIC",
  policyVersion
});

describe("Lease2411 typed pass code resolver", () => {
  it("pins the WBS663 policy version, hash, and exact six-code allowlists", () => {
    assert.equal(PASS_CODE_POLICY_VERSION, policyFixture.policyVersion);
    assert.equal(PASS_CODE_POLICY_SHA256, policyFixture.policySha256);
    assert.deepEqual([...PASS_SEMANTIC_CODES].sort(), policyFixture.policy.semanticIdentities.map((row) => row.semanticCode).sort());
    assert.deepEqual(PASS_COMPATIBILITY_CODES, ["support", "beginner", "premium", "contribution", "diamond", "oneday"]);
  });

  it("resolves exactly three semantic and compatibility mappings in both directions", () => {
    assert.deepEqual(PASS_CODE_MAPPINGS, [
      { semanticCode: "hoi", compatibilityCode: "support" },
      { semanticCode: "newbie", compatibilityCode: "beginner" },
      { semanticCode: "premium", compatibilityCode: "premium" }
    ]);
    for (const mapping of PASS_CODE_MAPPINGS) {
      assert.equal(semanticToCompatibility(mapping.semanticCode), mapping.compatibilityCode);
      assert.equal(compatibilityToSemantic(mapping.compatibilityCode), mapping.semanticCode);
    }
  });

  it("passes contribution, diamond, and oneday through without another identity", () => {
    assert.deepEqual(PASS_CODE_PASSTHROUGH, ["contribution", "diamond", "oneday"]);
    for (const code of PASS_CODE_PASSTHROUGH) {
      assert.equal(semanticToCompatibility(code), code);
      assert.equal(compatibilityToSemantic(code), code);
    }
  });

  it("rejects stale policy, unknown, display-name, and implicit cross-scope inputs", () => {
    assert.throws(() => semanticToCompatibility("hoi", "stale"), (error) =>
      error instanceof PassCodeResolutionError && error.code === "PASS_CODE_POLICY_VERSION_MISMATCH");
    for (const code of ["unknown", "호이패스🐶", "support"]) {
      assert.throws(() => semanticToCompatibility(code), (error) =>
        error instanceof PassCodeResolutionError && error.code === "PASS_CODE_NOT_ALLOWED_FOR_SCOPE");
    }
    assert.throws(() => compatibilityToSemantic("hoi"), (error) =>
      error instanceof PassCodeResolutionError && error.code === "PASS_CODE_NOT_ALLOWED_FOR_SCOPE");
    assert.throws(() => resolvePassCode({ code: "hoi", sourceScope: "SEMANTIC", targetScope: "SEMANTIC", policyVersion: PASS_CODE_POLICY_VERSION }), (error) =>
      error instanceof PassCodeResolutionError && error.code === "PASS_CODE_SCOPE_INVALID");
  });

  it("replays the complete dual-read plan deterministically", () => {
    const first = PASS_SEMANTIC_CODES.map((code) => [code, semanticToCompatibility(code)] as const);
    const reverse = first.map(([, compatibility]) => [compatibility, compatibilityToSemantic(compatibility)] as const);
    const replay = PASS_SEMANTIC_CODES.map((code) => [code, semanticToCompatibility(code)] as const);
    assert.deepEqual(replay, first);
    assert.deepEqual(reverse.map(([, semantic]) => semantic), [...PASS_SEMANTIC_CODES]);
    assert.equal(sha256(JSON.stringify(first)), sha256(JSON.stringify(replay)));
  });

  it("keeps importer and profile reads on opposite directions of the same resolver", () => {
    assert.match(importerSource, /sourceScope: "SEMANTIC"/);
    assert.match(importerSource, /targetScope: "COMPATIBILITY"/);
    assert.match(profileReaderSource, /sourceScope: "COMPATIBILITY"/);
    assert.match(profileReaderSource, /targetScope: "SEMANTIC"/);
    for (const source of [importerSource, profileReaderSource]) {
      assert.match(source, /PASS_CODE_POLICY_VERSION/);
      assert.match(source, /resolvePassCode/);
    }
  });
});
