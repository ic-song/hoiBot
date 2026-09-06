import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { assertTrustedWave2ConsumerFixtureMapping } from "../src/data-migration/object-db-consumer-executable-parity-ledger.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const readJson = (path: string): any => JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
const fixture = readJson("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave2-compatibility-resolver-v1.json");
const manifest = readJson("개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json");
const cohort = ["sql-repository-520566e376bf7ee8", "sql-repository-aa5b2d6d12d1268b", "sql-repository-fd1e8659cff045f9"];

describe("object DB executable parity Wave2 compatibility resolver cohort", () => {
  it("promotes the exact source-derived cohort without changing the frozen denominator", () => {
    const ledger = readJson("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json");
    const receipts = readJson("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave2-v1.json");
    assert.equal(ledger.coverage.manifestConsumers, 1111);
    assert.equal(ledger.coverage.ledgerEntries, 1111);
    assert.equal(ledger.coverage.provenConsumers, 11);
    assert.equal(ledger.coverage.unprovenConsumers, 1100);
    assert.equal(ledger.coverage.directPassConsumers, 11);
    assert.equal(ledger.coverage.registrySourceMismatchCount, 8);
    assert.equal(receipts.receipts.length, 30);
    assert.deepEqual(ledger.entries.filter((entry: any) => cohort.includes(entry.consumerId) && entry.verdict === "DIRECT_PASS").map((entry: any) => entry.consumerId).sort(), cohort);
    for (const consumerId of cohort) {
      assert.equal(receipts.receipts.filter((receipt: any) => receipt.consumerId === consumerId).length, 5);
      const consumer = fixture.payload.cases[0].consumers.find((item: any) => item.consumerId === consumerId);
      const source = manifest.consumers.find((item: any) => item.consumerId === consumerId);
      assert.doesNotThrow(() => assertTrustedWave2ConsumerFixtureMapping(consumerId, consumer, source));
    }
  });

  it("fails closed on consumer, locator, method, SQL and input drift", () => {
    const original = fixture.payload.cases[0].consumers.find((item: any) => item.consumerId === cohort[1]);
    const source = manifest.consumers.find((item: any) => item.consumerId === cohort[1]);
    for (const mutate of [
      (value: any) => { value.sourceLocator.symbol = "resolveAlias"; },
      (value: any) => { value.method = "resolveAlias"; },
      (value: any) => { value.input[0] = "43"; value.expectedQueryValues[0] = "43"; },
      (value: any) => { value.expectedNormalizedSql = value.expectedNormalizedSql.replace("object_registry", "object_aliases"); },
      (value: any) => { value.expectedRow.legacyObjectId = "43"; value.mockRows[0].legacyObjectId = "43"; },
    ]) {
      const swapped = structuredClone(original); mutate(swapped);
      assert.throws(() => assertTrustedWave2ConsumerFixtureMapping(cohort[1]!, swapped, source), /drift/);
    }
  });
});
