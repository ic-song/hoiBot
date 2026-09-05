import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createRequestReuseEnvelope, type RequestReuseInput, type RequestReuseValue } from "../src/shared/request-reuse-contract.js";
import {
  TransactionReceiptOutboxProvider,
  TransactionCommitAckAmbiguousError,
  RFA02_ERROR_CODES,
  type TransactionReceiptOutboxSession,
  type TransactionReceiptOutboxStore,
  type TransactionReceiptOutboxTerminal,
  type TransactionReceiptOutboxWorkResult,
} from "../src/shared/transaction-receipt-outbox-contract.js";

type Result = { readonly status: string; readonly quantity: bigint };
type Context = { mutate(): void; writeTypedReceipt(): void; writeOutbox(): void };

class AtomicStore implements TransactionReceiptOutboxStore<Context, Result> {
  readonly terminals = new Map<string, TransactionReceiptOutboxTerminal<Result>>();
  domainMutations = 0;
  typedReceipts = 0;
  outboxes = 0;
  terminalWrites = 0;
  throwAfterCommit = false;
  throwPlainAfterCommit = false;
  failTerminalWrite = false;
  failCommittedRead = false;
  commitAckError?: Error;
  committedOverride?: TransactionReceiptOutboxTerminal<Result>;
  private readonly locks = new Map<string, Promise<void>>();

  async withLockedTransaction<T>(requestKey: string, work: (session: TransactionReceiptOutboxSession<Context, Result>) => Promise<T>): Promise<T> {
    const prior = this.locks.get(requestKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    this.locks.set(requestKey, tail);
    await prior;
    let domain = 0, typed = 0, outbox = 0;
    let terminal: TransactionReceiptOutboxTerminal<Result> | undefined;
    try {
      const result = await work({
        context: { mutate: () => { domain += 1; }, writeTypedReceipt: () => { typed += 1; }, writeOutbox: () => { outbox += 1; } },
        readTerminal: async () => this.terminals.get(requestKey),
        persistTerminal: async (value) => {
          if (this.failTerminalWrite) throw new Error("INJECTED_TERMINAL_FAILURE");
          if (terminal !== undefined || this.terminals.has(requestKey)) throw new Error("DUPLICATE_TERMINAL");
          terminal = value;
        },
      });
      this.domainMutations += domain;
      this.typedReceipts += typed;
      this.outboxes += outbox;
      if (terminal !== undefined) { this.terminals.set(requestKey, terminal); this.terminalWrites += 1; }
      if (this.throwAfterCommit) throw new TransactionCommitAckAmbiguousError();
      if (this.throwPlainAfterCommit) throw new Error("RFA02_COMMIT_ACK_AMBIGUOUS");
      if (this.commitAckError !== undefined) throw this.commitAckError;
      return result;
    } finally {
      release();
      if (this.locks.get(requestKey) === tail) this.locks.delete(requestKey);
    }
  }

  async readCommitted(requestKey: string): Promise<TransactionReceiptOutboxTerminal<Result> | undefined> {
    if (this.failCommittedRead) throw new Error("INJECTED_COMMITTED_READ_FAILURE");
    return this.committedOverride ?? this.terminals.get(requestKey);
  }
}

function request(overrides: Partial<RequestReuseInput> = {}): RequestReuseInput {
  return {
    scope: "inventory.stack",
    requestKey: "iris:event-200",
    sourceEventId: "event-200",
    actor: { actorType: "platform_user", actorId: "kakao-room-a:user-a", playerId: "player01" },
    operationKind: "ITEM_STACK_CHANGE",
    targetType: "ITEM",
    targetId: "item0001",
    payload: { itemId: "item0001", quantityDelta: 2n, reason: "CRAFT" },
    ...overrides,
  };
}

const resultFingerprint = createHash("sha256").update('["object",[["quantity",["bigint","7"]],["status",["string","COMPLETED"]]]]', "utf8").digest("hex");
const payloadFingerprint = createHash("sha256").update('{"data":"done"}', "utf8").digest("hex");

async function mutation(context: Context): Promise<TransactionReceiptOutboxWorkResult<Result>> {
  context.mutate(); context.writeTypedReceipt(); context.writeOutbox();
  return {
    result: { status: "COMPLETED", quantity: 7n },
    typedReceipt: { receiptKind: "ITEM_STACK", receiptId: "receipt1", receiptStatus: "COMPLETED", resultFingerprint },
    deliveryEvidence: { deliveryKind: "OUTBOX", outboxId: "outbox1", payloadFingerprint, resultFingerprint },
  };
}

describe("RFA-02 transaction receipt/outbox contract", () => {
  it("commits domain mutation, typed receipt, outbox and RFA-01 terminal once and replays exactly", async () => {
    const store = new AtomicStore(), provider = new TransactionReceiptOutboxProvider();
    const first = await provider.execute(request(), store, mutation);
    const replay = await new TransactionReceiptOutboxProvider().execute(request({ payload: { reason: "CRAFT", quantityDelta: 2n, itemId: "item0001" } }), store, async () => { throw new Error("MUST_NOT_EXECUTE"); });
    assert.equal(first.replayed, false); assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, first.result);
    assert.equal(replay.receipt.identityFingerprint, createRequestReuseEnvelope(request()).identityFingerprint);
    assert.equal(replay.receipt.payloadFingerprint, createRequestReuseEnvelope(request()).payloadFingerprint);
    assert.deepEqual([store.domainMutations, store.typedReceipts, store.outboxes, store.terminalWrites], [1, 1, 1, 1]);
  });

  it("serializes concurrent duplicate requests to one atomic effect", async () => {
    const store = new AtomicStore(), provider = new TransactionReceiptOutboxProvider();
    const pair = await Promise.all([provider.execute(request(), store, mutation), provider.execute(request(), store, mutation)]);
    assert.equal(pair.filter((entry) => entry.replayed).length, 1);
    assert.deepEqual([store.domainMutations, store.typedReceipts, store.outboxes, store.terminalWrites], [1, 1, 1, 1]);
  });

  it("rolls back all staged evidence when terminal persistence fails", async () => {
    const store = new AtomicStore(); store.failTerminalWrite = true;
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), store, mutation), /INJECTED_TERMINAL_FAILURE/);
    assert.deepEqual([store.domainMutations, store.typedReceipts, store.outboxes, store.terminalWrites, store.terminals.size], [0, 0, 0, 0, 0]);
  });

  it("reconciles only an exact terminal after an ambiguous commit acknowledgement", async () => {
    const store = new AtomicStore(); store.throwAfterCommit = true;
    const mutable = request() as { -readonly [K in keyof RequestReuseInput]: RequestReuseInput[K] };
    const executed = await new TransactionReceiptOutboxProvider().execute(mutable, store, async (context) => {
      const outcome = await mutation(context);
      mutable.requestKey = "iris:mutated-after-snapshot";
      return outcome;
    });
    assert.equal(executed.reconciledCommit, true);
    assert.equal(executed.receipt.requestKey, "iris:event-200");
    assert.deepEqual([store.domainMutations, store.typedReceipts, store.outboxes, store.terminalWrites], [1, 1, 1, 1]);
  });

  it("fails closed when ambiguous-commit reconciliation observes drift", async () => {
    const store = new AtomicStore(); store.throwAfterCommit = true;
    const originalRead = store.readCommitted.bind(store);
    store.readCommitted = async (requestKey) => {
      const terminal = await originalRead(requestKey);
      return terminal === undefined ? undefined : { ...terminal, deliveryEvidence: { ...terminal.deliveryEvidence, outboxId: "outbox-drift" } } as TransactionReceiptOutboxTerminal<Result>;
    };
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), store, mutation), /RFA02_COMMIT_RECONCILIATION_DRIFT/);
    assert.deepEqual([store.domainMutations, store.typedReceipts, store.outboxes, store.terminalWrites], [1, 1, 1, 1]);
  });

  it("fails closed when ambiguous-commit reconciliation cannot read the committed terminal", async () => {
    const store = new AtomicStore(); store.throwAfterCommit = true; store.failCommittedRead = true;
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), store, mutation), /RFA02_COMMIT_RECONCILIATION_READ_FAILED/);
  });

  it("does not reconcile ordinary work or adapter failures", async () => {
    const workStore = new AtomicStore(); workStore.committedOverride = {} as TransactionReceiptOutboxTerminal<Result>;
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), workStore, async () => { throw new Error("DETERMINISTIC_WORK_FAILURE"); }), /DETERMINISTIC_WORK_FAILURE/);
    assert.equal(workStore.domainMutations, 0);
    const plainAckStore = new AtomicStore(); plainAckStore.throwPlainAfterCommit = true;
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), plainAckStore, mutation), (error: unknown) => error instanceof Error && error.constructor === Error && error.message === "RFA02_COMMIT_ACK_AMBIGUOUS");
    class DerivedAmbiguity extends TransactionCommitAckAmbiguousError {}
    const derivedStore = new AtomicStore(), derived = new DerivedAmbiguity(); derivedStore.commitAckError = derived;
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), derivedStore, mutation), (error: unknown) => error === derived);
  });

  it("does not reconcile forged or proxied commit-ambiguity errors", async () => {
    const forged = Object.create(TransactionCommitAckAmbiguousError.prototype) as Error;
    const forgedStore = new AtomicStore(); forgedStore.commitAckError = forged;
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), forgedStore, mutation), (error: unknown) => error === forged);

    const exact = new TransactionCommitAckAmbiguousError();
    const proxiedExact = new Proxy(exact, {});
    const proxyStore = new AtomicStore(); proxyStore.commitAckError = proxiedExact;
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), proxyStore, mutation), (error: unknown) => error === proxiedExact);

    const trapped = new Proxy(new Error("TRAPPED_DETERMINISTIC_ERROR"), { getPrototypeOf: () => { throw new Error("GET_PROTOTYPE_TRAP_MUST_NOT_RUN"); } });
    const trappedStore = new AtomicStore(); trappedStore.commitAckError = trapped;
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), trappedStore, mutation), (error: unknown) => error === trapped);
  });

  it("fails closed on identity, payload, typed receipt, outbox and terminal drift before a second effect", async () => {
    const store = new AtomicStore(), provider = new TransactionReceiptOutboxProvider();
    await provider.execute(request(), store, mutation);
    await assert.rejects(() => provider.execute(request({ actor: { ...request().actor, actorId: "other" } }), store, mutation), /REQUEST_REUSE_IDENTITY_CONFLICT/);
    await assert.rejects(() => provider.execute(request({ payload: { itemId: "item0001", quantityDelta: 3n, reason: "CRAFT" } }), store, mutation), /REQUEST_REUSE_PAYLOAD_CONFLICT/);
    const original = store.terminals.get(request().requestKey)!;
    store.terminals.set(request().requestKey, { ...original, typedReceipt: { ...original.typedReceipt, resultFingerprint: "0".repeat(64) } });
    await assert.rejects(() => provider.execute(request(), store, mutation), /RFA02_TYPED_RECEIPT_RESULT_DRIFT/);
    store.terminals.set(request().requestKey, { ...original, deliveryEvidence: { ...original.deliveryEvidence, resultFingerprint: "1".repeat(64) } } as TransactionReceiptOutboxTerminal<Result>);
    await assert.rejects(() => provider.execute(request(), store, mutation), /RFA02_DELIVERY_RESULT_DRIFT/);
    store.terminals.set(request().requestKey, { ...original, contractVersion: "OTHER" } as unknown as TransactionReceiptOutboxTerminal<Result>);
    await assert.rejects(() => provider.execute(request(), store, mutation), /RFA02_CONTRACT_CONFLICT/);
    assert.equal(store.domainMutations, 1);
  });

  it("rejects missing or noncanonical typed receipt/outbox evidence and supports explicit no-outbox terminal evidence", async () => {
    const store = new AtomicStore();
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), store, async (context) => {
      context.mutate(); return { result: { status: "COMPLETED", quantity: 7n }, typedReceipt: undefined, deliveryEvidence: undefined } as unknown as TransactionReceiptOutboxWorkResult<Result>;
    }), /RFA02_EVIDENCE_NOT_CANONICAL/);
    assert.equal(store.domainMutations, 0);

    const noOutbox = new AtomicStore();
    const executed = await new TransactionReceiptOutboxProvider().execute(request(), noOutbox, async (context) => {
      context.mutate(); context.writeTypedReceipt();
      return { result: { status: "COMPLETED", quantity: 7n }, typedReceipt: { receiptKind: "ITEM_STACK", receiptId: "receipt1", receiptStatus: "COMPLETED", resultFingerprint },
        deliveryEvidence: { deliveryKind: "NO_OUTBOX", reasonCode: "NO_REPLY", resultFingerprint } };
    });
    assert.equal(executed.deliveryEvidence.deliveryKind, "NO_OUTBOX");
    assert.deepEqual([noOutbox.domainMutations, noOutbox.typedReceipts, noOutbox.outboxes, noOutbox.terminalWrites], [1, 1, 0, 1]);
  });

  it("never reads evidence accessors or proxies", async () => {
    let reads = 0;
    const hostile: Record<string, unknown> = { receiptKind: "ITEM_STACK", receiptId: "receipt1", receiptStatus: "COMPLETED" };
    Object.defineProperty(hostile, "resultFingerprint", { enumerable: true, get: () => { reads += 1; return resultFingerprint; } });
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), new AtomicStore(), async () => ({
      result: { status: "COMPLETED", quantity: 7n }, typedReceipt: hostile as unknown as TransactionReceiptOutboxWorkResult<RequestReuseValue>["typedReceipt"],
      deliveryEvidence: { deliveryKind: "OUTBOX", outboxId: "outbox1", payloadFingerprint, resultFingerprint },
    })), /RFA02_EVIDENCE_NOT_CANONICAL/);
    assert.equal(reads, 0);
    const proxy = new Proxy({ deliveryKind: "OUTBOX" as const, outboxId: "outbox1", payloadFingerprint, resultFingerprint }, {});
    await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), new AtomicStore(), async () => ({
      result: { status: "COMPLETED", quantity: 7n }, typedReceipt: { receiptKind: "ITEM_STACK", receiptId: "receipt1", receiptStatus: "COMPLETED", resultFingerprint }, deliveryEvidence: proxy,
    })), /RFA02_EVIDENCE_NOT_CANONICAL/);
  });

  it("rejects accessor, proxy, and partial stored evidence on replay without executing work", async () => {
    const variants = (original: TransactionReceiptOutboxTerminal<Result>): unknown[] => {
      let terminalReads = 0, requestReceiptReads = 0, typedReads = 0, deliveryReads = 0;
      const receiptAccessor = { ...original } as Record<string, unknown>;
      Object.defineProperty(receiptAccessor, "requestReceipt", { enumerable: true, get: () => { terminalReads += 1; return original.requestReceipt; } });
      const nestedReceiptAccessor = { ...original.requestReceipt } as Record<string, unknown>;
      Object.defineProperty(nestedReceiptAccessor, "result", { enumerable: true, get: () => { requestReceiptReads += 1; return original.requestReceipt.result; } });
      const typedAccessor = { ...original.typedReceipt } as Record<string, unknown>;
      Object.defineProperty(typedAccessor, "receiptId", { enumerable: true, get: () => { typedReads += 1; return "receipt1"; } });
      const deliveryAccessor = { ...original.deliveryEvidence } as Record<string, unknown>;
      Object.defineProperty(deliveryAccessor, "deliveryKind", { enumerable: true, get: () => { deliveryReads += 1; return original.deliveryEvidence.deliveryKind; } });
      return [
        receiptAccessor,
        new Proxy(original, {}),
        { ...original, requestReceipt: nestedReceiptAccessor },
        { ...original, requestReceipt: new Proxy(original.requestReceipt, {}) },
        { ...original, requestReceipt: { ...original.requestReceipt, result: undefined } },
        { ...original, typedReceipt: typedAccessor },
        { ...original, typedReceipt: new Proxy(original.typedReceipt, {}) },
        { ...original, deliveryEvidence: deliveryAccessor },
        { ...original, deliveryEvidence: new Proxy(original.deliveryEvidence, {}) },
        { contractVersion: original.contractVersion, requestReceipt: original.requestReceipt, typedReceipt: original.typedReceipt },
        { ...original, typedReceipt: { receiptKind: "ITEM_STACK", receiptId: "receipt1", receiptStatus: "COMPLETED" } },
        { ...original, deliveryEvidence: { deliveryKind: "OUTBOX", outboxId: "outbox1", resultFingerprint } },
        { terminalReads: () => terminalReads, requestReceiptReads: () => requestReceiptReads, typedReads: () => typedReads, deliveryReads: () => deliveryReads },
      ];
    };
    const seed = new AtomicStore(); await new TransactionReceiptOutboxProvider().execute(request(), seed, mutation);
    const values = variants(seed.terminals.get(request().requestKey)!);
    const counters = values.pop() as { terminalReads(): number; requestReceiptReads(): number; typedReads(): number; deliveryReads(): number };
    for (const value of values) {
      const store = new AtomicStore(); store.terminals.set(request().requestKey, value as TransactionReceiptOutboxTerminal<Result>);
      await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), store, async () => { throw new Error("MUST_NOT_EXECUTE"); }));
      assert.equal(store.domainMutations, 0);
    }
    assert.deepEqual([counters.terminalReads(), counters.requestReceiptReads(), counters.typedReads(), counters.deliveryReads()], [0, 0, 0, 0]);
  });

  it("returns RFA-01's detached deep-frozen receipt snapshot from stored mutable data", async () => {
    const store = new AtomicStore(); await new TransactionReceiptOutboxProvider().execute(request(), store, mutation);
    const original = store.terminals.get(request().requestKey)!;
    const mutableResult = { status: "COMPLETED", quantity: 7n };
    const mutableReceipt = { ...original.requestReceipt, result: mutableResult };
    store.terminals.set(request().requestKey, { ...original, requestReceipt: mutableReceipt });
    const replay = await new TransactionReceiptOutboxProvider().execute(request(), store, async () => { throw new Error("MUST_NOT_EXECUTE"); });
    assert.notEqual(replay.receipt, mutableReceipt); assert.notEqual(replay.result, mutableResult);
    assert.equal(Object.isFrozen(replay.receipt), true); assert.equal(Object.isFrozen(replay.result), true);
    mutableResult.quantity = 99n;
    assert.equal(replay.result.quantity, 7n);
  });

  it("rejects accessor, proxy, and partial evidence returned by readCommitted", async () => {
    const corruptions = [
      (terminal: TransactionReceiptOutboxTerminal<Result>) => {
        const value = { ...terminal } as Record<string, unknown>;
        Object.defineProperty(value, "requestReceipt", { enumerable: true, get: () => terminal.requestReceipt });
        return value;
      },
      (terminal: TransactionReceiptOutboxTerminal<Result>) => {
        const receipt = { ...terminal.requestReceipt } as Record<string, unknown>;
        Object.defineProperty(receipt, "result", { enumerable: true, get: () => terminal.requestReceipt.result });
        return { ...terminal, requestReceipt: receipt };
      },
      (terminal: TransactionReceiptOutboxTerminal<Result>) => {
        const typed = { ...terminal.typedReceipt } as Record<string, unknown>;
        Object.defineProperty(typed, "receiptId", { enumerable: true, get: () => terminal.typedReceipt.receiptId });
        return { ...terminal, typedReceipt: typed };
      },
      (terminal: TransactionReceiptOutboxTerminal<Result>) => {
        const delivery = { ...terminal.deliveryEvidence } as Record<string, unknown>;
        Object.defineProperty(delivery, "deliveryKind", { enumerable: true, get: () => terminal.deliveryEvidence.deliveryKind });
        return { ...terminal, deliveryEvidence: delivery };
      },
      (terminal: TransactionReceiptOutboxTerminal<Result>) => new Proxy(terminal, {}),
      (terminal: TransactionReceiptOutboxTerminal<Result>) => ({ ...terminal, requestReceipt: new Proxy(terminal.requestReceipt, {}) }),
      (terminal: TransactionReceiptOutboxTerminal<Result>) => ({ ...terminal, typedReceipt: new Proxy(terminal.typedReceipt, {}) }),
      (terminal: TransactionReceiptOutboxTerminal<Result>) => ({ ...terminal, deliveryEvidence: new Proxy(terminal.deliveryEvidence, {}) }),
      (terminal: TransactionReceiptOutboxTerminal<Result>) => ({ contractVersion: terminal.contractVersion, requestReceipt: terminal.requestReceipt, typedReceipt: terminal.typedReceipt }),
      (terminal: TransactionReceiptOutboxTerminal<Result>) => ({ ...terminal, requestReceipt: { ...terminal.requestReceipt, result: undefined } }),
      (terminal: TransactionReceiptOutboxTerminal<Result>) => ({ ...terminal, typedReceipt: { receiptKind: "ITEM_STACK", receiptId: "receipt1", receiptStatus: "COMPLETED" } }),
      (terminal: TransactionReceiptOutboxTerminal<Result>) => ({ ...terminal, deliveryEvidence: { deliveryKind: "OUTBOX", outboxId: "outbox1", resultFingerprint } }),
    ];
    for (const corrupt of corruptions) {
      const store = new AtomicStore(); store.throwAfterCommit = true;
      const originalRead = store.readCommitted.bind(store);
      store.readCommitted = async (key) => {
        const terminal = await originalRead(key);
        return terminal === undefined ? undefined : corrupt(terminal) as TransactionReceiptOutboxTerminal<Result>;
      };
      await assert.rejects(() => new TransactionReceiptOutboxProvider().execute(request(), store, mutation), /(RFA02_EVIDENCE_NOT_CANONICAL|REQUEST_REUSE_VALUE_NOT_CANONICAL)/);
    }
  });

  it("keeps the contract error-code list exhaustive", () => {
    const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/transaction-receipt-outbox-contract.v1.json", import.meta.url), "utf8")) as { errorCodes: string[] };
    assert.deepEqual([...contract.errorCodes].sort(), [...RFA02_ERROR_CODES].sort());
    const source = readFileSync(new URL("../src/shared/transaction-receipt-outbox-contract.ts", import.meta.url), "utf8");
    const sourceCodes = [...new Set([...source.matchAll(/["`](RFA02_[A-Z0-9_]+)["`]/g)].map((match) => match[1]!).filter((code) => code !== "RFA02_TRANSACTION_RECEIPT_OUTBOX_V1"))].sort();
    assert.deepEqual(sourceCodes, [...RFA02_ERROR_CODES].sort());
  });
});
