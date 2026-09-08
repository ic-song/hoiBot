import { createHash } from "node:crypto";
import { stableDomainImportJson } from "./object-domain-importer.js";

export interface ItemBagBaselineStack {
  playerId: string;
  itemId: string;
  ownedItemStackId: string;
  baselineQuantity: string;
  stackEntryFingerprint: string;
}

export interface ItemBagLedgerEntry {
  itemInventoryLedgerEntryId: string;
  itemInventoryOperationId: string;
  playerId: string;
  itemId: string;
  ownedItemStackId: string | null;
  ownedItemId: string | null;
  quantityDelta: string;
  reasonType: string;
  ledgerSequence: string;
  ledgerEntryFingerprint: string;
}

export interface ItemBagCurrentStack {
  playerId: string;
  itemId: string;
  ownedItemStackId: string;
  quantity: string;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function integer(value: string, error: string): bigint {
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(error);
  return BigInt(value);
}

export function calculateItemBagStackBaselineFingerprint(input: Omit<ItemBagBaselineStack, "stackEntryFingerprint">): string {
  return sha256(stableDomainImportJson({
    baseline_quantity: input.baselineQuantity,
    item_id: input.itemId,
    owned_item_stack_id: input.ownedItemStackId,
    player_id: input.playerId
  }));
}

export function calculateItemBagLedgerEntryFingerprint(input: Omit<ItemBagLedgerEntry, "ledgerSequence" | "ledgerEntryFingerprint">): string {
  return sha256(stableDomainImportJson({
    item_id: input.itemId,
    item_inventory_ledger_entry_id: input.itemInventoryLedgerEntryId,
    item_inventory_operation_id: input.itemInventoryOperationId,
    owned_item_id: input.ownedItemId,
    owned_item_stack_id: input.ownedItemStackId,
    player_id: input.playerId,
    quantity_delta: input.quantityDelta,
    reason_type: input.reasonType
  }));
}

export function calculateItemBagStackBaselineSetFingerprint(rows: ItemBagBaselineStack[]): string {
  const canonical = [...rows].sort((left, right) => left.ownedItemStackId.localeCompare(right.ownedItemStackId, "en")).map((row) => ({
    player_id: row.playerId,
    item_id: row.itemId,
    owned_item_stack_id: row.ownedItemStackId,
    baseline_quantity: row.baselineQuantity,
    stack_entry_fingerprint: row.stackEntryFingerprint
  }));
  return sha256(stableDomainImportJson(canonical));
}

export function calculateItemBagLedgerBaselineSetFingerprint(rows: ItemBagLedgerEntry[]): string {
  const canonical = [...rows].sort((left, right) => {
    const a = BigInt(left.ledgerSequence), b = BigInt(right.ledgerSequence);
    return a < b ? -1 : a > b ? 1 : 0;
  }).map((row) => ({
    player_id: row.playerId,
    item_inventory_ledger_entry_id: row.itemInventoryLedgerEntryId,
    item_inventory_operation_id: row.itemInventoryOperationId,
    ledger_sequence: row.ledgerSequence,
    item_id: row.itemId,
    owned_item_stack_id: row.ownedItemStackId,
    owned_item_id: row.ownedItemId,
    quantity_delta: row.quantityDelta,
    reason_type: row.reasonType,
    ledger_entry_fingerprint: row.ledgerEntryFingerprint
  }));
  return sha256(stableDomainImportJson(canonical));
}

export function assertItemBagImportContinuation(input: {
  playerId: string;
  baselineHeadSequence: string;
  baselineStacks: ItemBagBaselineStack[];
  baselineLedgers: ItemBagLedgerEntry[];
  currentHeadSequence: string;
  currentStacks: ItemBagCurrentStack[];
  currentLedgers: ItemBagLedgerEntry[];
}): void {
  const baselineHead = integer(input.baselineHeadSequence, "ITEM_BAG_READINESS_BASELINE_HEAD_INVALID");
  const currentHead = integer(input.currentHeadSequence, "ITEM_BAG_READINESS_CURRENT_HEAD_INVALID");
  if (baselineHead < 0n || currentHead < baselineHead) throw new Error("ITEM_BAG_READINESS_HEAD_INVALID");
  const orderedCurrent = [...input.currentLedgers].sort((left, right) => {
    const a = integer(left.ledgerSequence, "ITEM_BAG_READINESS_SEQUENCE_INVALID");
    const b = integer(right.ledgerSequence, "ITEM_BAG_READINESS_SEQUENCE_INVALID");
    return a < b ? -1 : a > b ? 1 : 0;
  });
  if (BigInt(orderedCurrent.length) !== currentHead) throw new Error("ITEM_BAG_READINESS_SEQUENCE_COUNT_MISMATCH");
  for (let index = 0; index < orderedCurrent.length; index += 1) {
    const row = orderedCurrent[index]!;
    if (row.playerId !== input.playerId || integer(row.ledgerSequence, "ITEM_BAG_READINESS_SEQUENCE_INVALID") !== BigInt(index + 1)) throw new Error("ITEM_BAG_READINESS_SEQUENCE_GAP");
    if (calculateItemBagLedgerEntryFingerprint(row) !== row.ledgerEntryFingerprint) throw new Error("ITEM_BAG_READINESS_LEDGER_FINGERPRINT_INVALID");
  }
  if (BigInt(input.baselineLedgers.length) !== baselineHead) throw new Error("ITEM_BAG_READINESS_BASELINE_COUNT_MISMATCH");
  const baselineBySequence = new Map(input.baselineLedgers.map((row) => [row.ledgerSequence, row]));
  if (baselineBySequence.size !== input.baselineLedgers.length) throw new Error("ITEM_BAG_READINESS_BASELINE_SEQUENCE_DUPLICATE");
  for (let sequence = 1n; sequence <= baselineHead; sequence += 1n) {
    const stored = baselineBySequence.get(sequence.toString());
    const current = orderedCurrent[Number(sequence - 1n)];
    if (stored === undefined || current === undefined || stableDomainImportJson(stored) !== stableDomainImportJson(current)) throw new Error("ITEM_BAG_READINESS_BASELINE_EXACT_SET_MISMATCH");
  }
  const expected = new Map<string, { itemId: string; quantity: bigint }>();
  for (const stack of input.baselineStacks) {
    if (stack.playerId !== input.playerId || stack.stackEntryFingerprint !== calculateItemBagStackBaselineFingerprint(stack) || expected.has(stack.ownedItemStackId)) throw new Error("ITEM_BAG_READINESS_STACK_BASELINE_INVALID");
    expected.set(stack.ownedItemStackId, { itemId: stack.itemId, quantity: integer(stack.baselineQuantity, "ITEM_BAG_READINESS_BASELINE_QUANTITY_INVALID") });
  }
  for (const ledger of orderedCurrent.filter((row) => integer(row.ledgerSequence, "ITEM_BAG_READINESS_SEQUENCE_INVALID") > baselineHead && row.ownedItemStackId !== null)) {
    const state = expected.get(ledger.ownedItemStackId!) ?? { itemId: ledger.itemId, quantity: 0n };
    if (state.itemId !== ledger.itemId) throw new Error("ITEM_BAG_READINESS_POST_BASELINE_ITEM_DRIFT");
    state.quantity += integer(ledger.quantityDelta, "ITEM_BAG_READINESS_DELTA_INVALID");
    if (state.quantity < 0n) throw new Error("ITEM_BAG_READINESS_NEGATIVE_RECONCILIATION");
    expected.set(ledger.ownedItemStackId!, state);
  }
  const current = new Map<string, { itemId: string; quantity: bigint }>();
  for (const stack of input.currentStacks) {
    if (stack.playerId !== input.playerId || current.has(stack.ownedItemStackId)) throw new Error("ITEM_BAG_READINESS_CURRENT_STACK_INVALID");
    current.set(stack.ownedItemStackId, { itemId: stack.itemId, quantity: integer(stack.quantity, "ITEM_BAG_READINESS_CURRENT_QUANTITY_INVALID") });
  }
  if (expected.size !== current.size) throw new Error("ITEM_BAG_READINESS_CURRENT_STACK_SET_MISMATCH");
  for (const [stackId, state] of expected) {
    const actual = current.get(stackId);
    if (actual === undefined || actual.itemId !== state.itemId || actual.quantity !== state.quantity) throw new Error("ITEM_BAG_READINESS_CURRENT_BALANCE_MISMATCH");
  }
}
