import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertItemBagImportContinuation,
  calculateItemBagLedgerEntryFingerprint,
  calculateItemBagStackBaselineFingerprint,
  type ItemBagLedgerEntry
} from "../src/data-migration/item-bag-import-completeness-readiness.js";

const playerId = "play0001";
const ledger = (id: string, operation: string, sequence: string, itemId: string, stackId: string, delta: string): ItemBagLedgerEntry => {
  const row = {
    itemInventoryLedgerEntryId: id,
    itemInventoryOperationId: operation,
    playerId,
    itemId,
    ownedItemStackId: stackId,
    ownedItemId: null,
    quantityDelta: delta,
    reasonType: "TEST",
    ledgerSequence: sequence
  };
  return { ...row, ledgerEntryFingerprint: calculateItemBagLedgerEntryFingerprint(row) };
};

describe("WBS777 item bag continuation readiness", () => {
  const baselineStack = {
    playerId,
    itemId: "item0001",
    ownedItemStackId: "stack001",
    baselineQuantity: "5"
  };
  const sealedBaselineStack = { ...baselineStack, stackEntryFingerprint: calculateItemBagStackBaselineFingerprint(baselineStack) };
  const baselineLedger = ledger("zzzzzzzz", "oper0001", "1", "item0001", "stack001", "5");

  it("uses sequence rather than CUID2 lexical order and accepts later canonical mutation", () => {
    const later = ledger("aaaaaaaa", "oper0002", "2", "item0001", "stack001", "3");
    assert.doesNotThrow(() => assertItemBagImportContinuation({
      playerId, baselineHeadSequence: "1", baselineStacks: [sealedBaselineStack], baselineLedgers: [baselineLedger],
      currentHeadSequence: "2", currentLedgers: [later, baselineLedger],
      currentStacks: [{ playerId, itemId: "item0001", ownedItemStackId: "stack001", quantity: "8" }]
    }));
  });

  it("accepts a new post-baseline stack only when its deltas reconcile", () => {
    const later = ledger("aaaaaaaa", "oper0002", "2", "item0002", "stack002", "4");
    assert.doesNotThrow(() => assertItemBagImportContinuation({
      playerId, baselineHeadSequence: "1", baselineStacks: [sealedBaselineStack], baselineLedgers: [baselineLedger],
      currentHeadSequence: "2", currentLedgers: [baselineLedger, later],
      currentStacks: [
        { playerId, itemId: "item0001", ownedItemStackId: "stack001", quantity: "5" },
        { playerId, itemId: "item0002", ownedItemStackId: "stack002", quantity: "4" }
      ]
    }));
  });

  it("rejects deleted baseline rows, gaps and balance drift", () => {
    const later = ledger("aaaaaaaa", "oper0002", "3", "item0001", "stack001", "3");
    const base = {
      playerId, baselineHeadSequence: "1", baselineStacks: [sealedBaselineStack], baselineLedgers: [baselineLedger],
      currentHeadSequence: "3", currentLedgers: [baselineLedger, later],
      currentStacks: [{ playerId, itemId: "item0001", ownedItemStackId: "stack001", quantity: "8" }]
    };
    assert.throws(() => assertItemBagImportContinuation(base), /SEQUENCE_COUNT_MISMATCH|SEQUENCE_GAP/);
    assert.throws(() => assertItemBagImportContinuation({ ...base, currentHeadSequence: "1", currentLedgers: [later] }), /BASELINE_EXACT_SET_MISMATCH|SEQUENCE_GAP/);
    assert.throws(() => assertItemBagImportContinuation({ ...base, currentHeadSequence: "2", currentLedgers: [baselineLedger, { ...later, ledgerSequence: "2" }], currentStacks: [{ playerId, itemId: "item0001", ownedItemStackId: "stack001", quantity: "7" }] }), /LEDGER_FINGERPRINT_INVALID|CURRENT_BALANCE_MISMATCH/);
  });

  it("keeps an empty bag complete with zero baseline rows", () => {
    assert.doesNotThrow(() => assertItemBagImportContinuation({
      playerId, baselineHeadSequence: "0", baselineStacks: [], baselineLedgers: [],
      currentHeadSequence: "0", currentLedgers: [], currentStacks: []
    }));
  });
});
