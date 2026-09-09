import assert from "node:assert/strict";
import test from "node:test";

import type { AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import { calculateItemBagCompletenessFingerprint } from "../src/data-migration/object-domain-importer.js";
import {
  calculateItemBagLedgerBaselineSetFingerprint,
  calculateItemBagLedgerEntryFingerprint,
  calculateItemBagStackBaselineFingerprint,
  calculateItemBagStackBaselineSetFingerprint
} from "../src/data-migration/item-bag-import-completeness-readiness.js";
import { APPROVED_ITEM_BAG_V3_IMPORT_CONTRACT_SHA256, APPROVED_ITEM_BAG_V3_PROFILE_SEMANTIC_SHA256, CanonicalItemBagImportReadinessProvider } from "../src/inventory/canonical-item-bag-import-readiness-provider.js";

const context = { canonicalPlayerId: "player01", legacyPlayerId: "42", externalIdentityId: "7", displayName: "회원", rankEmoji: "", platformCode: "kakao", externalContextId: "room", selectionSource: "ACTIVE_CONTEXT" as const };

function fixture() {
  const stack = { playerId: "player01", itemId: "item0001", ownedItemStackId: "stack001", baselineQuantity: "5" };
  const baselineStack = { ...stack, stackEntryFingerprint: calculateItemBagStackBaselineFingerprint(stack) };
  const ledgerCore = { itemInventoryLedgerEntryId: "zzzzzzzz", itemInventoryOperationId: "oper0001", playerId: "player01", itemId: "item0001", ownedItemStackId: "stack001", ownedItemId: null, quantityDelta: "5", reasonType: "IMPORT", ledgerSequence: "1" };
  const baselineLedger = { ...ledgerCore, ledgerEntryFingerprint: calculateItemBagLedgerEntryFingerprint(ledgerCore) };
  const stackRows = [{ player_id: "player01", item_id: "item0001", owned_item_stack_id: "stack001", baseline_quantity: "5", stack_entry_fingerprint: baselineStack.stackEntryFingerprint }];
  const ledgerRows = [{ player_id: "player01", item_inventory_ledger_entry_id: "zzzzzzzz", item_inventory_operation_id: "oper0001", ledger_sequence: "1", item_id: "item0001", owned_item_stack_id: "stack001", owned_item_id: null, quantity_delta: "5", reason_type: "IMPORT", ledger_entry_fingerprint: baselineLedger.ledgerEntryFingerprint }];
  const projection = {
    player_item_bag_import_completeness_projection_id: "project1", object_domain_import_run_id: "run00001",
    common_staging_record_id: "wit00001", projection_version: "OBJECT_DOMAIN_IMPORT_RELEVANT_V3", profile_semantic_sha256: APPROVED_ITEM_BAG_V3_PROFILE_SEMANTIC_SHA256, import_contract_sha256: APPROVED_ITEM_BAG_V3_IMPORT_CONTRACT_SHA256,
    source_locator_sha256: "1".repeat(64), source_payload_fingerprint: "2".repeat(64),
    expected_source_key_count: 1, projected_stack_count: 1, quarantined_source_key_count: 0, ignored_source_key_count: 0,
    stack_set_fingerprint: calculateItemBagStackBaselineSetFingerprint([baselineStack]),
    item_ledger_entry_count: "1", baseline_ledger_head_sequence: "1",
    item_ledger_set_fingerprint: calculateItemBagLedgerBaselineSetFingerprint([baselineLedger]),
    completeness_fingerprint: "", revision: "1", active_flag: 1, run_status: "COMPLETE",
    run_import_contract_sha256: APPROVED_ITEM_BAG_V3_IMPORT_CONTRACT_SHA256, run_catalog_version: "SC-20260902-1", catalog_run_status: "COMPLETE", staging_run_status: "COMPLETE",
    witness_source_namespace: "member.bag", witness_record_domain: "item", witness_record_kind: "BAG_CONTAINER", witness_projection_status: "PROJECT", witness_quarantine_reason: null,
    witness_source_locator_sha256: "1".repeat(64), witness_payload_fingerprint: "2".repeat(64), witness_owner_locator_sha256: "42",
    witness_decision_status: "IGNORE", witness_decision_reason: "NOT_OBJECT_DOMAIN_INPUT", witness_decision_projected_row_count: 0,
    witness_decision_source_locator_sha256: "1".repeat(64), witness_decision_payload_fingerprint: "2".repeat(64), player_source_system: "LEGACY_JSON", player_source_identifier: "42"
  };
  projection.completeness_fingerprint = calculateItemBagCompletenessFingerprint({
    player_id: "player01", object_domain_import_run_id: projection.object_domain_import_run_id, common_staging_record_id: projection.common_staging_record_id,
    projection_version: projection.projection_version, profile_semantic_sha256: projection.profile_semantic_sha256, import_contract_sha256: projection.import_contract_sha256,
    source_locator_sha256: projection.source_locator_sha256, source_payload_fingerprint: projection.source_payload_fingerprint,
    expected_source_key_count: projection.expected_source_key_count, projected_stack_count: projection.projected_stack_count,
    quarantined_source_key_count: projection.quarantined_source_key_count, ignored_source_key_count: projection.ignored_source_key_count,
    stack_set_fingerprint: projection.stack_set_fingerprint, item_ledger_entry_count: projection.item_ledger_entry_count,
    baseline_ledger_head_sequence: projection.baseline_ledger_head_sequence, item_ledger_set_fingerprint: projection.item_ledger_set_fingerprint,
    revision: projection.revision, active_flag: true
  });
  return { projection, stackRows, ledgerRows, currentStacks: [{ player_id: "player01", item_id: "item0001", owned_item_stack_id: "stack001", quantity: "5" }], currentLedgers: ledgerRows.map(({ ledger_entry_fingerprint: _fingerprint, ...row }) => row), heads: [{ last_ledger_sequence: "1" }] };
}

function participant(state: ReturnType<typeof fixture>): AppWiringReadParticipant {
  return { async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    assert.match(sql.trim(), /^SELECT\b/);
    assert.doesNotMatch(sql, /FOR\s+UPDATE|\b(?:INSERT|UPDATE|DELETE|REPLACE|CALL|SET)\b/i);
    if (sql.includes("FROM player_item_bag_import_completeness_projections")) return [state.projection] as T;
    if (sql.includes("FROM player_item_bag_import_stack_baselines")) return state.stackRows as T;
    if (sql.includes("FROM player_item_bag_import_ledger_baselines")) return state.ledgerRows as T;
    if (sql.includes("FROM canonical_owned_item_stacks")) return state.currentStacks as T;
    if (sql.includes("FROM canonical_item_inventory_ledger_entries")) return state.currentLedgers as T;
    if (sql.includes("FROM canonical_item_inventory_ledger_heads")) return state.heads as T;
    throw new Error(`UNEXPECTED_QUERY:${sql}:${JSON.stringify(values)}`);
  } };
}

test("accepts an exact typed import baseline", async () => {
  const state = fixture();
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(state), context), true);
});

test("accepts an empty imported bag with zero typed children and no head", async () => {
  const state = fixture();
  state.stackRows = [];
  state.ledgerRows = [];
  state.currentStacks = [];
  state.currentLedgers = [];
  state.heads = [];
  state.projection.expected_source_key_count = 0;
  state.projection.projected_stack_count = 0;
  state.projection.item_ledger_entry_count = "0";
  state.projection.baseline_ledger_head_sequence = "0";
  state.projection.stack_set_fingerprint = calculateItemBagStackBaselineSetFingerprint([]);
  state.projection.item_ledger_set_fingerprint = calculateItemBagLedgerBaselineSetFingerprint([]);
  state.projection.completeness_fingerprint = calculateItemBagCompletenessFingerprint({
    player_id: "player01", object_domain_import_run_id: state.projection.object_domain_import_run_id, common_staging_record_id: state.projection.common_staging_record_id,
    projection_version: state.projection.projection_version, profile_semantic_sha256: state.projection.profile_semantic_sha256, import_contract_sha256: state.projection.import_contract_sha256,
    source_locator_sha256: state.projection.source_locator_sha256, source_payload_fingerprint: state.projection.source_payload_fingerprint,
    expected_source_key_count: 0, projected_stack_count: 0, quarantined_source_key_count: 0, ignored_source_key_count: 0,
    stack_set_fingerprint: state.projection.stack_set_fingerprint, item_ledger_entry_count: "0", baseline_ledger_head_sequence: "0",
    item_ledger_set_fingerprint: state.projection.item_ledger_set_fingerprint, revision: "1", active_flag: true
  });
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(state), context), true);
});

test("accepts post-baseline mutation and a new stack by monotonic sequence, not CUID order", async () => {
  const state = fixture();
  const laterCore = { itemInventoryLedgerEntryId: "aaaaaaaa", itemInventoryOperationId: "oper0002", playerId: "player01", itemId: "item0002", ownedItemStackId: "stack002", ownedItemId: null, quantityDelta: "4", reasonType: "MUTATION", ledgerSequence: "2" };
  state.currentLedgers.push({ player_id: "player01", item_inventory_ledger_entry_id: "aaaaaaaa", item_inventory_operation_id: "oper0002", ledger_sequence: "2", item_id: "item0002", owned_item_stack_id: "stack002", owned_item_id: null, quantity_delta: "4", reason_type: "MUTATION" });
  state.currentStacks.push({ player_id: "player01", item_id: "item0002", owned_item_stack_id: "stack002", quantity: "4" });
  state.heads = [{ last_ledger_sequence: "2" }];
  assert.equal(calculateItemBagLedgerEntryFingerprint(laterCore).length, 64);
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(state), context), true);
});

test("fails closed for missing or extra baseline children, gaps and balance drift", async () => {
  const missing = fixture();
  missing.stackRows = [];
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(missing), context), false);
  const extra = fixture();
  extra.stackRows.push({ ...extra.stackRows[0]!, owned_item_stack_id: "stack002" });
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(extra), context), false);
  const gap = fixture();
  gap.currentLedgers[0]!.ledger_sequence = "2";
  gap.heads = [{ last_ledger_sequence: "2" }];
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(gap), context), false);
  const drift = fixture();
  drift.currentStacks[0]!.quantity = "4";
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(drift), context), false);
});

test("fails closed when approved contract, witness chain, revision or projection fingerprint drifts", async () => {
  const profile = fixture();
  profile.projection.profile_semantic_sha256 = "a".repeat(64);
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(profile), context), false);
  const contract = fixture();
  contract.projection.run_import_contract_sha256 = "b".repeat(64);
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(contract), context), false);
  const witness = fixture();
  witness.projection.witness_owner_locator_sha256 = "different";
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(witness), context), false);
  const revision = fixture();
  revision.projection.revision = "0";
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(revision), context), false);
  const bogus = fixture();
  bogus.projection.completeness_fingerprint = "c".repeat(64);
  assert.equal(await new CanonicalItemBagImportReadinessProvider().inspect(participant(bogus), context), false);
});
