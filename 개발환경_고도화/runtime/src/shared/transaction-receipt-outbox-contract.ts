import { types as nodeTypes } from "node:util";
import {
  RequestReuseProvider,
  serializeRequestReuseValue,
  snapshotRequestReuseTerminalReceipt,
  type RequestReuseAtomicSession,
  type RequestReuseAtomicStore,
  type RequestReuseInput,
  type RequestReuseTerminalReceipt,
  type RequestReuseValue,
} from "./request-reuse-contract.js";

export const TRANSACTION_RECEIPT_OUTBOX_CONTRACT_VERSION = "RFA02_TRANSACTION_RECEIPT_OUTBOX_V1" as const;
const commitAckAmbiguityBrand = new WeakSet<object>();
export const RFA02_ERROR_CODES = Object.freeze([
  "RFA02_EVIDENCE_NOT_CANONICAL",
  "RFA02_TYPED_RECEIPT_KIND_INVALID",
  "RFA02_TYPED_RECEIPT_ID_INVALID",
  "RFA02_TYPED_RECEIPT_NOT_COMPLETED",
  "RFA02_TYPED_RECEIPT_FINGERPRINT_INVALID",
  "RFA02_OUTBOX_ID_INVALID",
  "RFA02_OUTBOX_PAYLOAD_FINGERPRINT_INVALID",
  "RFA02_OUTBOX_RESULT_FINGERPRINT_INVALID",
  "RFA02_NO_OUTBOX_REASON_INVALID",
  "RFA02_NO_OUTBOX_RESULT_FINGERPRINT_INVALID",
  "RFA02_DELIVERY_KIND_INVALID",
  "RFA02_TYPED_RECEIPT_RESULT_DRIFT",
  "RFA02_DELIVERY_RESULT_DRIFT",
  "RFA02_CONTRACT_CONFLICT",
  "RFA02_WORK_EVIDENCE_MISSING",
  "RFA02_TERMINAL_EVIDENCE_MISSING",
  "RFA02_COMMIT_ACK_AMBIGUOUS",
  "RFA02_COMMIT_RECONCILIATION_READ_FAILED",
  "RFA02_COMMIT_RECONCILIATION_MISSING",
  "RFA02_COMMIT_RECONCILIATION_DRIFT",
] as const);
export type Rfa02ErrorCode = typeof RFA02_ERROR_CODES[number];

// Transaction adapter가 commit 호출 뒤 ACK 수신 여부만 확정할 수 없을 때 사용하는 유일한 재조정 신호입니다.
export class TransactionCommitAckAmbiguousError extends Error {
  readonly code = "RFA02_COMMIT_ACK_AMBIGUOUS" as const;
  constructor(message = "RFA02_COMMIT_ACK_AMBIGUOUS", options?: ErrorOptions) {
    super(message, options);
    this.name = "TransactionCommitAckAmbiguousError";
    if (new.target === TransactionCommitAckAmbiguousError) commitAckAmbiguityBrand.add(this);
  }
}

export function isTransactionCommitAckAmbiguousError(error: unknown): error is TransactionCommitAckAmbiguousError {
  return typeof error === "object" && error !== null && commitAckAmbiguityBrand.has(error);
}

export interface TransactionTypedReceiptEvidence {
  readonly receiptKind: string;
  readonly receiptId: string;
  readonly receiptStatus: "COMPLETED";
  readonly resultFingerprint: string;
}

export type TransactionDeliveryEvidence =
  | {
    readonly deliveryKind: "OUTBOX";
    readonly outboxId: string;
    readonly payloadFingerprint: string;
    readonly resultFingerprint: string;
  }
  | {
    readonly deliveryKind: "NO_OUTBOX";
    readonly reasonCode: "NO_REPLY" | "INTERNAL_ONLY";
    readonly resultFingerprint: string;
  };

export interface TransactionReceiptOutboxTerminal<TResult extends RequestReuseValue> {
  readonly contractVersion: typeof TRANSACTION_RECEIPT_OUTBOX_CONTRACT_VERSION;
  readonly requestReceipt: RequestReuseTerminalReceipt<TResult>;
  readonly typedReceipt: TransactionTypedReceiptEvidence;
  readonly deliveryEvidence: TransactionDeliveryEvidence;
}

export interface TransactionReceiptOutboxSession<TContext, TResult extends RequestReuseValue> {
  readonly context: TContext;
  // Adapter implementations must read the terminal, typed receipt, and delivery row in the same locked transaction.
  readTerminal(): Promise<TransactionReceiptOutboxTerminal<TResult> | undefined>;
  // Adapter implementations must verify referenced evidence and persist this terminal before the transaction commits.
  persistTerminal(terminal: TransactionReceiptOutboxTerminal<TResult>): Promise<void>;
}

export interface TransactionReceiptOutboxStore<TContext, TResult extends RequestReuseValue> {
  // The same raw request key must be serialized; domain DML, receipt, delivery evidence, and terminal share this transaction.
  withLockedTransaction<T>(requestKey: string, work: (session: TransactionReceiptOutboxSession<TContext, TResult>) => Promise<T>): Promise<T>;
  // A fresh connection/transaction must re-read all evidence after an ambiguous commit outcome.
  readCommitted(requestKey: string): Promise<TransactionReceiptOutboxTerminal<TResult> | undefined>;
}

export interface TransactionReceiptOutboxWorkResult<TResult extends RequestReuseValue> {
  readonly result: TResult;
  readonly typedReceipt: TransactionTypedReceiptEvidence;
  readonly deliveryEvidence: TransactionDeliveryEvidence;
}

export interface TransactionReceiptOutboxExecutionResult<TResult extends RequestReuseValue> {
  readonly result: TResult;
  readonly receipt: RequestReuseTerminalReceipt<TResult>;
  readonly typedReceipt: TransactionTypedReceiptEvidence;
  readonly deliveryEvidence: TransactionDeliveryEvidence;
  readonly replayed: boolean;
  readonly reconciledCommit: boolean;
}

interface StagedEvidence {
  readonly typedReceipt: TransactionTypedReceiptEvidence;
  readonly deliveryEvidence: TransactionDeliveryEvidence;
}

function failBoundary(): never { throw new Error("RFA02_EVIDENCE_NOT_CANONICAL"); }

function dataFields(value: unknown): ReadonlyMap<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return failBoundary();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return failBoundary();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return failBoundary();
  const fields = new Map<string, unknown>();
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return failBoundary();
    fields.set(key, descriptor.value);
  }
  return fields;
}

function assertExactFieldNames(fields: ReadonlyMap<string, unknown>, keys: readonly string[]): void {
  const actual = [...fields.keys()].sort(), expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) return failBoundary();
}

function exactFields(value: unknown, keys: readonly string[]): ReadonlyMap<string, unknown> {
  const fields = dataFields(value);
  assertExactFieldNames(fields, keys);
  return fields;
}

function requiredCode(value: unknown, error: string): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(value)) throw new Error(error);
  return value;
}

function requiredId(value: unknown, error: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,191}$/.test(value)) throw new Error(error);
  return value;
}

function requiredFingerprint(value: unknown, error: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(error);
  return value;
}

function snapshotTypedReceipt(value: unknown): TransactionTypedReceiptEvidence {
  const fields = exactFields(value, ["receiptKind", "receiptId", "receiptStatus", "resultFingerprint"]);
  if (fields.get("receiptStatus") !== "COMPLETED") throw new Error("RFA02_TYPED_RECEIPT_NOT_COMPLETED");
  return Object.freeze({
    receiptKind: requiredCode(fields.get("receiptKind"), "RFA02_TYPED_RECEIPT_KIND_INVALID"),
    receiptId: requiredId(fields.get("receiptId"), "RFA02_TYPED_RECEIPT_ID_INVALID"),
    receiptStatus: "COMPLETED",
    resultFingerprint: requiredFingerprint(fields.get("resultFingerprint"), "RFA02_TYPED_RECEIPT_FINGERPRINT_INVALID"),
  });
}

function snapshotDelivery(value: unknown): TransactionDeliveryEvidence {
  const fields = dataFields(value);
  const kind = fields.get("deliveryKind");
  if (kind === "OUTBOX") {
    assertExactFieldNames(fields, ["deliveryKind", "outboxId", "payloadFingerprint", "resultFingerprint"]);
    return Object.freeze({ deliveryKind: "OUTBOX", outboxId: requiredId(fields.get("outboxId"), "RFA02_OUTBOX_ID_INVALID"),
      payloadFingerprint: requiredFingerprint(fields.get("payloadFingerprint"), "RFA02_OUTBOX_PAYLOAD_FINGERPRINT_INVALID"),
      resultFingerprint: requiredFingerprint(fields.get("resultFingerprint"), "RFA02_OUTBOX_RESULT_FINGERPRINT_INVALID") });
  }
  if (kind === "NO_OUTBOX") {
    assertExactFieldNames(fields, ["deliveryKind", "reasonCode", "resultFingerprint"]);
    const reasonCode = fields.get("reasonCode");
    if (reasonCode !== "NO_REPLY" && reasonCode !== "INTERNAL_ONLY") throw new Error("RFA02_NO_OUTBOX_REASON_INVALID");
    return Object.freeze({ deliveryKind: "NO_OUTBOX", reasonCode,
      resultFingerprint: requiredFingerprint(fields.get("resultFingerprint"), "RFA02_NO_OUTBOX_RESULT_FINGERPRINT_INVALID") });
  }
  throw new Error("RFA02_DELIVERY_KIND_INVALID");
}

function snapshotEvidence(value: unknown): StagedEvidence {
  const fields = exactFields(value, ["typedReceipt", "deliveryEvidence"]);
  return Object.freeze({ typedReceipt: snapshotTypedReceipt(fields.get("typedReceipt")), deliveryEvidence: snapshotDelivery(fields.get("deliveryEvidence")) });
}

function assertEvidenceFingerprint(evidence: StagedEvidence, resultFingerprint: string): void {
  if (evidence.typedReceipt.resultFingerprint !== resultFingerprint) throw new Error("RFA02_TYPED_RECEIPT_RESULT_DRIFT");
  if (evidence.deliveryEvidence.resultFingerprint !== resultFingerprint) throw new Error("RFA02_DELIVERY_RESULT_DRIFT");
}

function snapshotStored<TResult extends RequestReuseValue>(value: unknown): TransactionReceiptOutboxTerminal<TResult> {
  const fields = exactFields(value, ["contractVersion", "requestReceipt", "typedReceipt", "deliveryEvidence"]);
  if (fields.get("contractVersion") !== TRANSACTION_RECEIPT_OUTBOX_CONTRACT_VERSION) throw new Error("RFA02_CONTRACT_CONFLICT");
  // RFA-01 owns the one canonical deep snapshot for its terminal receipt and result.
  const requestReceipt = snapshotRequestReuseTerminalReceipt(fields.get("requestReceipt") as RequestReuseTerminalReceipt<TResult>);
  const evidence = snapshotEvidence({ typedReceipt: fields.get("typedReceipt"), deliveryEvidence: fields.get("deliveryEvidence") });
  assertEvidenceFingerprint(evidence, requestReceipt.resultFingerprint);
  return Object.freeze({ contractVersion: TRANSACTION_RECEIPT_OUTBOX_CONTRACT_VERSION, requestReceipt, ...evidence });
}

function terminalFrom<TResult extends RequestReuseValue>(receipt: RequestReuseTerminalReceipt<TResult>, evidence: StagedEvidence): TransactionReceiptOutboxTerminal<TResult> {
  assertEvidenceFingerprint(evidence, receipt.resultFingerprint);
  return Object.freeze({ contractVersion: TRANSACTION_RECEIPT_OUTBOX_CONTRACT_VERSION, requestReceipt: receipt, ...evidence });
}

function sameTerminal<TResult extends RequestReuseValue>(left: TransactionReceiptOutboxTerminal<TResult>, right: TransactionReceiptOutboxTerminal<TResult>): boolean {
  return serializeRequestReuseValue(left as unknown as RequestReuseValue) === serializeRequestReuseValue(right as unknown as RequestReuseValue);
}

// RFA-01의 request/result snapshot을 그대로 사용하며 transaction receipt와 delivery 증거만 원자 경계에 추가합니다.
export class TransactionReceiptOutboxProvider {
  constructor(private readonly requestReuse = new RequestReuseProvider()) {}

  async execute<TContext, TResult extends RequestReuseValue>(
    input: RequestReuseInput,
    store: TransactionReceiptOutboxStore<TContext, TResult>,
    work: (context: TContext) => Promise<TransactionReceiptOutboxWorkResult<TResult>>,
  ): Promise<TransactionReceiptOutboxExecutionResult<TResult>> {
    let stagedEvidence: StagedEvidence | undefined;
    let observedEvidence: StagedEvidence | undefined;
    let expectedTerminal: TransactionReceiptOutboxTerminal<TResult> | undefined;
    const atomicStore: RequestReuseAtomicStore<TContext, TResult> = {
      withLockedRequestKey: <T>(requestKey: string, operation: (session: RequestReuseAtomicSession<TContext, TResult>) => Promise<T>) =>
        store.withLockedTransaction(requestKey, async (session) => operation({
          context: session.context,
          readTerminal: async () => {
            const stored = await session.readTerminal();
            if (stored === undefined) return undefined;
            const snapshot = snapshotStored<TResult>(stored);
            observedEvidence = snapshotEvidence({ typedReceipt: snapshot.typedReceipt, deliveryEvidence: snapshot.deliveryEvidence });
            return snapshot.requestReceipt;
          },
          persistTerminal: async (receipt) => {
            if (stagedEvidence === undefined) throw new Error("RFA02_WORK_EVIDENCE_MISSING");
            expectedTerminal = terminalFrom(receipt, stagedEvidence);
            await session.persistTerminal(expectedTerminal);
            observedEvidence = stagedEvidence;
          },
        })),
    };

    try {
      const executed = await this.requestReuse.execute(input, atomicStore, async (context) => {
        const outcomeFields = exactFields(await work(context), ["result", "typedReceipt", "deliveryEvidence"]);
        stagedEvidence = snapshotEvidence({ typedReceipt: outcomeFields.get("typedReceipt"), deliveryEvidence: outcomeFields.get("deliveryEvidence") });
        return outcomeFields.get("result") as TResult;
      });
      if (observedEvidence === undefined) throw new Error("RFA02_TERMINAL_EVIDENCE_MISSING");
      assertEvidenceFingerprint(observedEvidence, executed.receipt.resultFingerprint);
      return Object.freeze({ ...executed, ...observedEvidence, reconciledCommit: false });
    } catch (error) {
      if (!isTransactionCommitAckAmbiguousError(error)) throw error;
      if (expectedTerminal === undefined) throw error;
      let committed: TransactionReceiptOutboxTerminal<TResult> | undefined;
      try { committed = await store.readCommitted(expectedTerminal.requestReceipt.requestKey); }
      catch (readError) { throw new Error("RFA02_COMMIT_RECONCILIATION_READ_FAILED", { cause: readError }); }
      if (committed === undefined) throw new Error("RFA02_COMMIT_RECONCILIATION_MISSING");
      const snapshot = snapshotStored<TResult>(committed);
      if (!sameTerminal(snapshot, expectedTerminal)) throw new Error("RFA02_COMMIT_RECONCILIATION_DRIFT");
      const result = expectedTerminal.requestReceipt.result;
      return Object.freeze({ result, receipt: expectedTerminal.requestReceipt, typedReceipt: expectedTerminal.typedReceipt,
        deliveryEvidence: expectedTerminal.deliveryEvidence, replayed: false, reconciledCommit: true });
    }
  }
}
