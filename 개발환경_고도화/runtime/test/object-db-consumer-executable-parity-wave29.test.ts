import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): any => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const sha = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
const ids = ["legacy-827e1dc284cea52c", "legacy-bf7edb9e7cee98cd"];
const scenarios = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];

describe("Wave29 home badge usage DIRECT parity", () => {
  it("preserves all 352 receipts byte-for-byte and adds ten DIRECT receipts", () => {
    const current = read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave29-v1.json");
    const prior = read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave27-v1.json");
    const prefix = JSON.stringify(current.receipts.slice(0, 352));
    assert.equal(current.receipts.length, 362);
    assert.deepEqual(current.receipts.slice(0, 352), prior.receipts);
    assert.equal(Buffer.byteLength(prefix), 1_361_204);
    assert.equal(sha(prefix), "70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b");
    assert.ok(current.receipts.slice(352).every((receipt: any) => receipt.proofMode === "DIRECT" && receipt.verdict === "PASS"));
  });

  it("binds two consumers to all five required read scenarios", () => {
    const fixture = read("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave29-home-badge-usage-v1.json");
    assert.equal(fixture.bindings.length, 10);
    for (const id of ids) assert.deepEqual(fixture.bindings.filter((binding: any) => binding.consumerId === id).map((binding: any) => binding.scenarioKind).sort(), scenarios.slice().sort());
    assert.equal(fixture.receiptContract.authDenied, "NOT_APPLICABLE");
    assert.equal(fixture.receiptContract.wrongRoomRejected, "NOT_APPLICABLE");
  });

  it("moves only the two target consumers in the final ledger", () => {
    const ledger = read("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json");
    assert.equal(ledger.coverage.directPassConsumers, 50);
    assert.equal(ledger.coverage.equivalentPassConsumers, 12);
    assert.equal(ledger.coverage.verdicts.STATIC_ONLY, 989);
    assert.equal(ledger.coverage.verdicts.BLOCKED_DYNAMIC, 82);
    assert.equal(ledger.coverage.provenConsumers, 62);
    assert.equal(ledger.coverage.unprovenConsumers, 1071);
    for (const id of ids) {
      const entry = ledger.entries.find((candidate: any) => candidate.consumerId === id);
      assert.equal(entry.verdict, "DIRECT_PASS");
      assert.deepEqual(entry.scenarios.map((scenario: any) => scenario.scenarioKind).sort(), scenarios.slice().sort());
    }
  });
});
