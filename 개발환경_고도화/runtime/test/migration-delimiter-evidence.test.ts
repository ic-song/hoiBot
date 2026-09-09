import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assertMigrationDelimiterEvidence, type JsonValue, type MigrationDelimiterEvidenceReceipt } from "./fixtures/migration-delimiter-evidence-validator.js";

const receiptPath = new URL("../../migration-control/evidence/migration-delimiter-runner-lease2618/receipt.json", import.meta.url);
const transcriptPath = new URL("../../migration-control/evidence/migration-delimiter-runner-lease2618/transcript.txt", import.meta.url);
const migrationPath = new URL("../migrations/490_item_bag_import_baseline_ordering.sql", import.meta.url);
const loadReceipt = (): MigrationDelimiterEvidenceReceipt => JSON.parse(readFileSync(receiptPath, "utf8")) as MigrationDelimiterEvidenceReceipt;

describe("Lease2618 durable migration evidence", () => {
  it("recalculates migration, transcript and canonical result hashes", () => {
    assert.doesNotThrow(() => assertMigrationDelimiterEvidence(loadReceipt(), readFileSync(migrationPath), readFileSync(transcriptPath)));
  });

  it("fails closed when any core projection field is tampered", () => {
    const original = loadReceipt();
    for (const key of Object.keys(original.resultHashPayload)) {
      const tampered = structuredClone(original);
      const current = tampered.resultHashPayload[key];
      tampered.resultHashPayload[key] = (typeof current === "number" ? current + 1 : typeof current === "boolean" ? !current : `${String(current)}-tampered`) as JsonValue;
      assert.throws(() => assertMigrationDelimiterEvidence(tampered, readFileSync(migrationPath), readFileSync(transcriptPath)), /MIGRATION_DELIMITER_EVIDENCE_(?:FILE|TRANSCRIPT|RESULT)_SHA_MISMATCH/, key);
    }
  });
});
