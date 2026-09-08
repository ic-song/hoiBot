import assert from "node:assert/strict";
import test from "node:test";

import type { AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import { CanonicalItemBagImportReadinessProvider } from "../src/inventory/canonical-item-bag-import-readiness-provider.js";

const context = { canonicalPlayerId: "player01", legacyPlayerId: "42", externalIdentityId: "7", displayName: "회원", rankEmoji: "", platformCode: "kakao", externalContextId: "room", selectionSource: "ACTIVE_CONTEXT" as const };
const complete = {
  owned_item_stack_id: "stack001", stack_run_id: "runstack", definition_run_id: "rundef01",
  stack_run_status: "COMPLETE", definition_run_status: "COMPLETE",
  stack_import_sha256: "a".repeat(64), definition_import_sha256: "b".repeat(64),
  stack_expected_source_count: 1, stack_projected_source_count: 1, stack_quarantined_source_count: 0, stack_ignored_source_count: 0,
  stack_expected_row_count: 1, stack_imported_row_count: 1,
  definition_expected_source_count: 1, definition_projected_source_count: 1, definition_quarantined_source_count: 0, definition_ignored_source_count: 0,
  definition_expected_row_count: 1, definition_imported_row_count: 1,
};

function participant(rows: readonly Record<string, unknown>[]): AppWiringReadParticipant {
  return { async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    assert.match(sql.trim(), /^SELECT\b/);
    assert.doesNotMatch(sql, /FOR\s+UPDATE|\b(?:INSERT|UPDATE|DELETE|REPLACE|CALL|SET)\b/i);
    assert.deepEqual(values, ["player01"]);
    return [...rows] as T;
  } };
}

test("requires a complete per-stack and definition import run with hash and quarantine zero", async () => {
  const provider = new CanonicalItemBagImportReadinessProvider();
  assert.equal(await provider.inspect(participant([complete]), context), true);
  assert.equal(await provider.inspect(participant([{ ...complete, stack_quarantined_source_count: 1 }]), context), false);
  assert.equal(await provider.inspect(participant([{ ...complete, definition_import_sha256: null }]), context), false);
});

test("fails closed for empty bags because the current schema has no per-player zero-row receipt", async () => {
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant([]), context), false);
});

test("fails closed when a stack has duplicate provenance records", async () => {
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant([complete, complete]), context), false);
});

test("rejects an impossible zero-row COMPLETE run that is linked to a concrete import record", async () => {
  const impossible = {
    ...complete,
    stack_expected_source_count: 0, stack_projected_source_count: 0,
    stack_expected_row_count: 0, stack_imported_row_count: 0,
  };
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant([impossible]), context), false);
});
