import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  REQUEST_REUSE_CONTRACT_VERSION,
  RequestReuseProvider,
  assertLegacyAppWiringReplay,
  assertLegacyCurrencyReplay,
  assertLegacyFurnitureReplay,
  createLegacyAppWiringFingerprints,
  createLegacyCurrencyPayloadFingerprint,
  createLegacyFurniturePayloadFingerprint,
  createRequestReuseEnvelope,
  createRequestReuseTerminalReceipt,
  replayRequestReuseTerminal,
  serializeRequestReuseValue,
  type RequestReuseAtomicSession,
  type RequestReuseAtomicStore,
  type RequestReuseInput,
  type RequestReuseTerminalReceipt,
  type RequestReuseValue,
} from "../src/shared/request-reuse-contract.js";

type Result = { readonly status: string; readonly quantity: bigint };
type Context = { addEffect(): void };

class AtomicMemoryStore implements RequestReuseAtomicStore<Context, Result> {
  readonly receipts = new Map<string, RequestReuseTerminalReceipt<Result>>();
  effectCount = 0;
  private readonly locks = new Map<string, Promise<void>>();

  async withLockedRequestKey<T>(requestKey: string, work: (session: RequestReuseAtomicSession<Context, Result>) => Promise<T>): Promise<T> {
    const prior = this.locks.get(requestKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    this.locks.set(requestKey, tail);
    await prior;
    let stagedEffects = 0;
    let stagedReceipt: RequestReuseTerminalReceipt<Result> | undefined;
    try {
      const result = await work({
        context: { addEffect: () => { stagedEffects += 1; } },
        readTerminal: async () => this.receipts.get(requestKey),
        persistTerminal: async (receipt) => {
          if (stagedReceipt !== undefined || this.receipts.has(requestKey)) throw new Error("TEST_DUPLICATE_TERMINAL");
          stagedReceipt = receipt;
        },
      });
      this.effectCount += stagedEffects;
      if (stagedReceipt !== undefined) this.receipts.set(requestKey, stagedReceipt);
      return result;
    } finally {
      release();
      if (this.locks.get(requestKey) === tail) this.locks.delete(requestKey);
    }
  }
}

function request(overrides: Partial<RequestReuseInput> = {}): RequestReuseInput {
  return {
    scope: "inventory.stack",
    requestKey: "iris:event-100",
    sourceEventId: "event-100",
    actor: { actorType: "platform_user", actorId: "kakao-room-a:user-a", playerId: "player01" },
    operationKind: "ITEM_STACK_CHANGE",
    targetType: "ITEM",
    targetId: "item0001",
    payload: { itemId: "item0001", quantityDelta: 2n, reason: "CRAFT" },
    ...overrides,
  };
}

const effect = async (context: Context): Promise<Result> => {
  context.addEffect();
  await Promise.resolve();
  return { status: "COMPLETED", quantity: 7n };
};

describe("RFA-01 request reuse canonical contract", () => {
  it("normalizes object key order while preserving arrays and scalar types", () => {
    assert.equal(serializeRequestReuseValue({ b: 2n, a: [null, "2", 2] }), serializeRequestReuseValue({ a: [null, "2", 2], b: 2n }));
    assert.notEqual(serializeRequestReuseValue(2n), serializeRequestReuseValue("2"));
    assert.notEqual(serializeRequestReuseValue("2"), serializeRequestReuseValue(2));
    assert.notEqual(serializeRequestReuseValue(["a", "b"]), serializeRequestReuseValue(["b", "a"]));
  });

  it("fails closed for holes, cycles, undefined and non-finite numbers", () => {
    const hole = ["a", , "b"] as unknown as RequestReuseValue;
    const cyclic: { self?: RequestReuseValue } = {};
    cyclic.self = cyclic as RequestReuseValue;
    for (const value of [hole, cyclic as RequestReuseValue, undefined as unknown as RequestReuseValue, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => serializeRequestReuseValue(value), /REQUEST_REUSE_VALUE_NOT_CANONICAL/);
    }
  });

  it("replays the exact terminal result without a second effect", async () => {
    const store = new AtomicMemoryStore();
    const provider = new RequestReuseProvider();
    const first = await provider.execute(request(), store, effect);
    const replay = await provider.execute(request({ payload: { reason: "CRAFT", quantityDelta: 2n, itemId: "item0001" } }), store, async () => { throw new Error("MUST_NOT_EXECUTE"); });
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, first.result);
    assert.equal(store.effectCount, 1);
    assert.equal(store.receipts.size, 1);
  });

  it("returns a detached frozen replay when an adapter supplies a mutable parsed receipt", async () => {
    const store = new AtomicMemoryStore();
    const persisted = { ...createRequestReuseTerminalReceipt(request(), { status: "COMPLETED", quantity: 7n }), result: { status: "COMPLETED", quantity: 7n } };
    store.receipts.set(request().requestKey, persisted);
    const replay = await new RequestReuseProvider().execute(request(), store, async () => { throw new Error("MUST_NOT_EXECUTE"); });
    assert.notEqual(replay.receipt, persisted);
    assert.notEqual(replay.result, persisted.result);
    assert.equal(Object.isFrozen(replay.result), true);
    assert.throws(() => { (replay.result as { quantity: bigint }).quantity = 99n; }, TypeError);
    assert.equal(persisted.result.quantity, 7n);
  });

  it("rejects fingerprint-less legacy item and operations receipts before the effect", async () => {
    for (const legacy of [
      { requestKey: request().requestKey, result: { status: "COMPLETED", quantity: 7n }, resultingQuantity: 7n },
      { requestKey: request().requestKey, result: { status: "COMPLETED", quantity: 7n }, resultJson: '{"status":"COMPLETED"}' },
    ]) {
      const store = new AtomicMemoryStore();
      store.receipts.set(request().requestKey, legacy as unknown as RequestReuseTerminalReceipt<Result>);
      let effects = 0;
      await assert.rejects(() => new RequestReuseProvider().execute(request(), store, async () => { effects += 1; return { status: "COMPLETED", quantity: 7n }; }), /REQUEST_REUSE_CONTRACT_CONFLICT/);
      assert.equal(effects, 0);
      assert.equal(store.effectCount, 0);
    }
  });

  it("fails closed on identity drift for the same request key", async () => {
    const variants: RequestReuseInput[] = [
      request({ scope: "inventory.other" }),
      request({ sourceEventId: "event-other" }),
      request({ actor: { ...request().actor, actorType: "admin" } }),
      request({ actor: { ...request().actor, actorId: "other-actor" } }),
      request({ actor: { ...request().actor, playerId: "player02" } }),
      request({ operationKind: "ITEM_STACK_REMOVE" }),
      request({ targetType: "CURRENCY" }),
      request({ targetId: "item0002" }),
    ];
    for (const variant of variants) {
      const store = new AtomicMemoryStore();
      await new RequestReuseProvider().execute(request(), store, effect);
      await assert.rejects(() => new RequestReuseProvider().execute(variant, store, effect), /REQUEST_REUSE_IDENTITY_CONFLICT/);
      assert.equal(store.effectCount, 1);
    }
  });

  it("fails closed on item, quantity and reason payload drift for the same request key", async () => {
    const variants: RequestReuseInput[] = [
      request({ payload: { itemId: "item0002", quantityDelta: 2n, reason: "CRAFT" } }),
      request({ payload: { itemId: "item0001", quantityDelta: 3n, reason: "CRAFT" } }),
      request({ payload: { itemId: "item0001", quantityDelta: 2n, reason: "ADMIN" } }),
    ];
    for (const variant of variants) {
      const store = new AtomicMemoryStore();
      await new RequestReuseProvider().execute(request(), store, effect);
      await assert.rejects(() => new RequestReuseProvider().execute(variant, store, effect), /REQUEST_REUSE_PAYLOAD_CONFLICT/);
      assert.equal(store.effectCount, 1);
    }
  });

  it("executes identical command payloads from distinct source events independently", async () => {
    const store = new AtomicMemoryStore();
    const provider = new RequestReuseProvider();
    await provider.execute(request(), store, effect);
    await provider.execute(request({ requestKey: "iris:event-101", sourceEventId: "event-101" }), store, effect);
    assert.equal(store.effectCount, 2);
    assert.equal(store.receipts.size, 2);
  });

  it("serializes concurrent duplicates to one effect and one receipt", async () => {
    const store = new AtomicMemoryStore();
    const provider = new RequestReuseProvider();
    const [first, second] = await Promise.all([provider.execute(request(), store, effect), provider.execute(request(), store, effect)]);
    assert.equal(Number(first.replayed) + Number(second.replayed), 1);
    assert.equal(store.effectCount, 1);
    assert.equal(store.receipts.size, 1);
  });

  it("replays after provider restart and rolls back a failed atomic attempt", async () => {
    const store = new AtomicMemoryStore();
    const firstProvider = new RequestReuseProvider();
    await assert.rejects(() => firstProvider.execute(request(), store, async (context) => { context.addEffect(); throw new Error("INJECTED_FAILURE"); }), /INJECTED_FAILURE/);
    assert.equal(store.effectCount, 0);
    assert.equal(store.receipts.size, 0);
    const completed = await firstProvider.execute(request(), store, effect);
    const restartedProvider = new RequestReuseProvider();
    const replay = await restartedProvider.execute(request(), store, async () => { throw new Error("MUST_NOT_EXECUTE"); });
    assert.equal(completed.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(store.effectCount, 1);
  });

  it("rejects altered contract and persisted result fingerprints", () => {
    const receipt = createRequestReuseTerminalReceipt(request(), { status: "COMPLETED", quantity: 7n });
    assert.equal(replayRequestReuseTerminal(request(), receipt).quantity, 7n);
    assert.throws(() => replayRequestReuseTerminal(request(), { ...receipt, contractVersion: "OTHER" as typeof REQUEST_REUSE_CONTRACT_VERSION }), /REQUEST_REUSE_CONTRACT_CONFLICT/);
    assert.throws(() => replayRequestReuseTerminal(request(), { ...receipt, resultFingerprint: "0".repeat(64) }), /REQUEST_REUSE_RESULT_CONFLICT/);
  });

  it("stores a detached frozen result so caller mutation cannot alter the terminal receipt", () => {
    const mutable = { status: "COMPLETED", quantity: 7n };
    const receipt = createRequestReuseTerminalReceipt(request(), mutable);
    mutable.quantity = 99n;
    assert.equal(receipt.result.quantity, 7n);
    assert.equal(Object.isFrozen(receipt.result), true);
    assert.equal(replayRequestReuseTerminal(request(), receipt).quantity, 7n);
  });

  it("returns the detached frozen receipt result on the first execution too", async () => {
    const mutable = { status: "COMPLETED", quantity: 7n };
    const executed = await new RequestReuseProvider().execute(request(), new AtomicMemoryStore(), async (context) => { context.addEffect(); return mutable; });
    assert.equal(executed.result, executed.receipt.result);
    assert.notEqual(executed.result, mutable);
    assert.equal(Object.isFrozen(executed.result), true);
    mutable.quantity = 99n;
    assert.equal(executed.result.quantity, 7n);
  });

  it("snapshots the request before waiting or running the effect", async () => {
    const mutable = request() as { -readonly [K in keyof RequestReuseInput]: RequestReuseInput[K] };
    const store = new AtomicMemoryStore();
    const executed = await new RequestReuseProvider().execute(mutable, store, async (context) => {
      mutable.scope = "mutated.scope";
      mutable.payload = { itemId: "item9999", quantityDelta: 99n, reason: "MUTATED" };
      return effect(context);
    });
    assert.equal(executed.receipt.identityFingerprint, createRequestReuseEnvelope(request()).identityFingerprint);
    assert.equal(executed.receipt.payloadFingerprint, createRequestReuseEnvelope(request()).payloadFingerprint);
  });

  it("preserves an own __proto__ result key without prototype mutation", () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"status":"COMPLETED"}') as RequestReuseValue;
    const receipt = createRequestReuseTerminalReceipt(request(), value);
    assert.equal(Object.getPrototypeOf(receipt.result), Object.prototype);
    assert.equal(Object.prototype.hasOwnProperty.call(receipt.result, "__proto__"), true);
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  });

  it("keeps the request fingerprint bound to identity and payload fingerprints", () => {
    const original = createRequestReuseEnvelope(request());
    const changed = createRequestReuseEnvelope(request({ payload: { itemId: "item0001", quantityDelta: 3n, reason: "CRAFT" } }));
    assert.notEqual(original.payloadFingerprint, changed.payloadFingerprint);
    assert.notEqual(original.requestFingerprint, changed.requestFingerprint);
  });
});

describe("RFA-01 exact legacy compatibility projectors", () => {
  it("matches the existing canonical currency tuple and detects every covered drift", () => {
    const input = { currencyId: "curr0001", deltaMinorAmount: 5n, operationKind: "credit", reasonKey: "quest" };
    const expected = createHash("sha256").update(JSON.stringify([["currencyId", "curr0001"], ["deltaMinorAmount", "5"], ["operationKind", "credit"], ["reasonKey", "quest"]]), "utf8").digest("hex");
    assert.equal(createLegacyCurrencyPayloadFingerprint(input), expected);
    assert.notEqual(createLegacyCurrencyPayloadFingerprint({ ...input, deltaMinorAmount: 6n }), expected);
    assert.doesNotThrow(() => assertLegacyCurrencyReplay({ operationKind: input.operationKind, payloadFingerprint: expected }, input));
    assert.throws(() => assertLegacyCurrencyReplay({ operationKind: input.operationKind, payloadFingerprint: expected }, { ...input, currencyId: "curr0002" }), /REQUEST_REUSE_LEGACY_CURRENCY_CONFLICT/);
  });

  it("matches each existing furniture operation ordered-array formula", () => {
    const expected = createHash("sha256").update(JSON.stringify(["grant_owned_furniture", "player01", "furn0001", "0"]), "utf8").digest("hex");
    assert.equal(createLegacyFurniturePayloadFingerprint("grant_owned_furniture", ["player01", "furn0001", "0"]), expected);
    assert.notEqual(createLegacyFurniturePayloadFingerprint("grant_owned_furniture", ["player01", "furn0001", "1"]), expected);
    assert.doesNotThrow(() => assertLegacyFurnitureReplay({ operationKind: "grant_owned_furniture", payloadFingerprint: expected }, { operationKind: "grant_owned_furniture", orderedValues: ["player01", "furn0001", "0"] }));
    assert.throws(() => assertLegacyFurnitureReplay({ operationKind: "grant_owned_furniture", payloadFingerprint: expected }, { operationKind: "place_owned_furniture", orderedValues: ["player01", "furn0001", "0"] }), /REQUEST_REUSE_LEGACY_FURNITURE_CONFLICT/);
    assert.throws(() => createLegacyFurniturePayloadFingerprint("unknown", ["player01", "furn0001", "0"]), /REQUEST_REUSE_LEGACY_FURNITURE_SHAPE_INVALID/);
    assert.throws(() => createLegacyFurniturePayloadFingerprint("grant_owned_furniture", ["player01", "furn0001"]), /REQUEST_REUSE_LEGACY_FURNITURE_SHAPE_INVALID/);
  });

  it("matches app-wiring request identity and sorted canonical payload formulas", () => {
    const actual = createLegacyAppWiringFingerprints({ requestNamespace: "dev", entrypointKind: "IRIS", externalRequestId: "100", normalizedPayload: { z: 2, a: [true, null, "값"] } });
    assert.equal(actual.requestIdentityFingerprint, createHash("sha256").update(JSON.stringify(["dev", "IRIS", "100"]), "utf8").digest("hex"));
    assert.equal(actual.payloadFingerprint, createHash("sha256").update('{"a":[true,null,"값"],"z":2}', "utf8").digest("hex"));
    assert.doesNotThrow(() => assertLegacyAppWiringReplay(actual, { requestNamespace: "dev", entrypointKind: "IRIS", externalRequestId: "100", normalizedPayload: { a: [true, null, "값"], z: 2 } }));
    assert.throws(() => assertLegacyAppWiringReplay(actual, { requestNamespace: "dev", entrypointKind: "IRIS", externalRequestId: "101", normalizedPayload: { a: [true, null, "값"], z: 2 } }), /REQUEST_REUSE_LEGACY_APP_WIRING_CONFLICT/);
    assert.throws(() => createLegacyAppWiringFingerprints({ requestNamespace: "dev", entrypointKind: "UNKNOWN", externalRequestId: "100", normalizedPayload: {} }), /REQUEST_REUSE_LEGACY_APP_WIRING_SHAPE_INVALID/);
    assert.throws(() => createLegacyAppWiringFingerprints({ requestNamespace: "dev", entrypointKind: "IRIS", externalRequestId: "100", normalizedPayload: ["a", , "b"] }), /REQUEST_REUSE_VALUE_NOT_CANONICAL/);
  });

  it("records fingerprint-less item and operations receipts as explicitly incompatible", () => {
    const contract = JSON.parse(readFileSync(new URL("../../migration-control/contracts/request-reuse-contract.v1.json", import.meta.url), "utf8")) as { legacyCompatibility: { notCompatible: string[] } };
    assert.equal(contract.legacyCompatibility.notCompatible.some((entry) => entry.includes("item inventory")), true);
    assert.equal(contract.legacyCompatibility.notCompatible.some((entry) => entry.includes("operations result_json")), true);
  });
});
