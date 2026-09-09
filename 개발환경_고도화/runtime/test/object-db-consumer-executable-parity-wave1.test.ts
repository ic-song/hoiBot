import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");
const readJson = (path: string): any => JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));

describe("object DB executable parity Wave1 title list-owned cohort", () => {
  it("promotes only the exact three source-derived consumers with a complete five-scenario matrix", () => {
    const ledger = readJson("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json");
    const receipts = readJson("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave1-v1.json");
    const fixture = readJson("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave1-title-list-owned-v1.json");
    const cohort = ["sql-repository-0dc3c380c54081a2", "sql-repository-6a1bdfaafba10749", "sql-repository-a0a5f5d8f3338d7b"];
    assert.equal(ledger.coverage.manifestConsumers, 1111);
    assert.equal(ledger.coverage.ledgerEntries, ledger.coverage.manifestConsumers);
    assert.ok(ledger.coverage.provenConsumers >= 18);
    assert.equal(ledger.coverage.unprovenConsumers, ledger.coverage.manifestConsumers - ledger.coverage.provenConsumers);
    assert.equal(ledger.coverage.directPassConsumers + ledger.coverage.equivalentPassConsumers, ledger.coverage.provenConsumers);
    assert.equal(Object.values(ledger.coverage.verdicts).reduce((sum: number, count: any) => sum + count, 0), ledger.coverage.manifestConsumers);
    assert.deepEqual(ledger.entries.filter((entry: any) => entry.verdict === "DIRECT_PASS" && cohort.includes(entry.consumerId)).map((entry: any) => entry.consumerId).sort(), cohort);
    assert.equal(receipts.receipts.length, 15);
    assert.equal(fixture.payload.cases.length, 1);
    assert.deepEqual(fixture.payload.cases[0].consumers.map((consumer: any) => consumer.consumerId).sort(), cohort);
    for (const consumerId of cohort) {
      const bound = fixture.bindings.filter((binding: any) => binding.consumerId === consumerId);
      assert.equal(bound.length, 5);
      assert.deepEqual(bound.map((binding: any) => binding.scenarioKind).sort(), ["EXACT_OUTPUT", "NEGATIVE_GUARD", "READ_POSITIVE", "RESTART_CONSISTENCY", "SOURCE_DOMAIN_DML_ZERO"]);
      assert.ok(fixture.payload.cases[0].consumers.find((consumer: any) => consumer.consumerId === consumerId).assertions.length > 0);
    }
  });
});
