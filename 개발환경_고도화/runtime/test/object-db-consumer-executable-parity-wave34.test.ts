import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const sha = (value: string): string => createHash("sha256").update(value.replace(/\r\n?/g, "\n")).digest("hex");
const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;

describe("WBS801 Wave34 cumulative evidence", () => {
  it("preserves every prior receipt prefix and adds exactly twelve direct receipts", () => {
    const current = JSON.parse(read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave34-v1.json"));
    const prior = JSON.parse(read("개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave33-v1.json"));
    assert.equal(current.receipts.length, 413); assert.deepEqual(current.receipts.slice(0, 401), prior.receipts);
    for (const [count, bytes, digest] of [
      [243, 970854, "e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97"],
      [324, 1260829, "72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb"],
      [352, 1361204, "70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b"],
      [362, 1382594, "5cf3063b351bc18a343b075997dead5769cde57d7a8854218c7b89e3abed7373"],
      [372, 1485238, "f9b490aaea9ea67ece2188fcc1424b1c46c36871606d525ce1c0620a2d818546"],
      [382, 1588071, "df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506"],
      [387, 1639915, "59a43f463dd33b1945c7e5d16c7c9da632c2075bbad57852d1b1092da78b7bfb"],
      [401, 1674239, "cff9566698b0850b4151153ef4f1ad9901a92cf304f43c28f6d89d72dd6f8156"]
    ] as const) {
      const prefix = JSON.stringify(current.receipts.slice(0, count)); assert.equal(Buffer.byteLength(prefix), bytes); assert.equal(sha(prefix), digest);
    }
    const added = current.receipts.slice(401); assert.equal(new Set(added.map((receipt: any) => receipt.receiptId)).size, 12);
    for (const consumerId of ["legacy-9cd62419b853c929", "runtime-dispatch-d9a426f3b9d18d3a"]) {
      const receipts = added.filter((receipt: any) => receipt.consumerId === consumerId);
      assert.equal(receipts.length, 6); assert.deepEqual(receipts.map((receipt: any) => receipt.scenario.scenarioKind).sort(), ["CONCURRENCY_SINGLE_WRITER", "DOMAIN_FAILURE_ROLLBACK", "DUPLICATE_REPLAY_DML_ZERO", "MUTATION_SUCCESS", "PAYLOAD_DRIFT_FAIL_CLOSED", "RESTART_REPLAY"]);
      assert.ok(receipts.every((receipt: any) => receipt.proofMode === "DIRECT" && receipt.verdict === "PASS"));
    }
  });

  it("validates the Wave34 binding delta and mutation fixture with strict Draft 2020-12 schemas", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    for (const [schemaPath, dataPath] of ([
      ["개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-34.v1.schema.json", "개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-34.v1.json"],
      ["개발환경_고도화/migration-control/contracts/object-db-consumer-mutation-evidence-wave34.v1.schema.json", "개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave34-member-title-select-v1.json"]
    ] as const)) {
      const validate = ajv.compile(JSON.parse(read(schemaPath))); assert.equal(validate(JSON.parse(read(dataPath))), true, JSON.stringify(validate.errors));
    }
  });

  it("records the exact final ledger and residual coverage", () => {
    const ledger = JSON.parse(read("개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-ledger.v1.json"));
    assert.equal(ledger.entrySetSha256, "b35b9e1f659b4704aeed3a146642e213c3254c5f70f4c54eb62dc5d0bd0bafe5");
    assert.deepEqual({ direct: ledger.coverage.directPassConsumers, equivalent: ledger.coverage.equivalentPassConsumers, proven: ledger.coverage.provenConsumers, static: ledger.coverage.verdicts.STATIC_ONLY, blocked: ledger.coverage.verdicts.BLOCKED_DYNAMIC }, { direct: 59, equivalent: 12, proven: 71, static: 980, blocked: 82 });
    for (const consumerId of ["legacy-9cd62419b853c929", "runtime-dispatch-d9a426f3b9d18d3a"]) assert.equal(ledger.entries.find((entry: any) => entry.consumerId === consumerId)?.verdict, "DIRECT_PASS");
    const residual = JSON.parse(read("개발환경_고도화/migration-control/contracts/object-db-consumer-residual-work-plan.v1.json"));
    assert.deepEqual({ total: residual.summary.residualConsumers, c: residual.summary.categoryCounts.C_DIRECT_EXECUTION, d: residual.summary.categoryCounts.D_PREREQUISITE, memberTitle: residual.summary.byDomain["MEMBER-TITLE"] }, { total: 1062, c: 980, d: 82, memberTitle: 14 });
  });
});
