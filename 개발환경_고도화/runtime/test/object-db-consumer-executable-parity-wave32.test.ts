import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { parseObjectDbConsumerExecutionReceiptBundle } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): any => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const sha = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
const receiptPath = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave32-v1.json";
const fixturePath = "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave32-member-title-legacy-info-v1.json";
const consumerId = "legacy-798257cac0e93e27";
const scenarios = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];

describe("Wave32 committed main.js versus actual member-title info DIRECT parity", () => {
  it("preserves Wave31 and every required historical prefix byte-for-byte", () => {
    const current = read(receiptPath);
    const prior = read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave31-v1.json");
    assert.equal(current.receipts.length, 387);
    assert.deepEqual(current.receipts.slice(0, 382), prior.receipts);
    for (const [count, bytes, hash] of [
      [382, 1_588_071, "df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506"],
      [372, 1_485_238, "f9b490aaea9ea67ece2188fcc1424b1c46c36871606d525ce1c0620a2d818546"],
      [362, 1_382_594, "5cf3063b351bc18a343b075997dead5769cde57d7a8854218c7b89e3abed7373"],
      [352, 1_361_204, "70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b"],
      [324, 1_260_829, "72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb"],
      [243, 970_854, "e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97"]
    ] as const) {
      const prefix = JSON.stringify(current.receipts.slice(0, count));
      assert.equal(Buffer.byteLength(prefix), bytes);
      assert.equal(sha(prefix), hash);
    }
  });

  it("seals all five actual ingress scenarios including castle siege NO_REPLY", () => {
    const bundle = read(receiptPath);
    const fixture = read(fixturePath);
    const receipts = bundle.receipts.filter((receipt: any) => receipt.consumerId === consumerId);
    assert.deepEqual(receipts.map((receipt: any) => receipt.scenario.scenarioKind).sort(), scenarios.slice().sort());
    assert.equal(fixture.bindings.length, 5);
    const siege = fixture.bindings.find((binding: any) => binding.scenarioId === "wave32-info-castle-siege-negative");
    assert.equal(siege.castleSiegeFlag, true);
    assert.equal(siege.expectedReply, "NO_REPLY");
    for (const receipt of receipts) {
      assert.equal(receipt.proofMode, "DIRECT");
      assert.equal(receipt.expectedActual.transaction.actual, "COMMIT");
      assert.equal(receipt.expectedActual.dml.match, true);
      assert.ok(receipt.expectedActual.dml.actualNormalizedStatements.length > 0);
    }
  });

  it("rejects prefix tamper and promotes exactly the legacy info consumer", () => {
    const bundle = read(receiptPath);
    bundle.receipts[0].receiptSha256 = "0".repeat(64);
    assert.throws(() => parseObjectDbConsumerExecutionReceiptBundle(bundle), /historical receipt fingerprint drift/);
    const ledger = read("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json");
    assert.equal(ledger.coverage.directPassConsumers, 59);
    assert.equal(ledger.coverage.equivalentPassConsumers, 12);
    assert.equal(ledger.coverage.provenConsumers, 71);
    assert.equal(ledger.coverage.verdicts.STATIC_ONLY, 980);
    assert.equal(ledger.coverage.verdicts.BLOCKED_DYNAMIC, 82);
    assert.equal(ledger.entries.find((entry: any) => entry.consumerId === consumerId).verdict, "DIRECT_PASS");
  });
});
