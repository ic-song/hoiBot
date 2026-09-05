import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

export const REQUEST_REUSE_CONTRACT_VERSION = "RFA01_REQUEST_REUSE_V1" as const;

export type RequestReuseValue = null | boolean | number | bigint | string | readonly RequestReuseValue[] | { readonly [key: string]: RequestReuseValue };

export interface RequestReuseActor {
  readonly actorType: string;
  readonly actorId: string;
  readonly playerId: string | null;
}

export interface RequestReuseInput {
  readonly scope: string;
  readonly requestKey: string;
  readonly sourceEventId: string;
  readonly actor: RequestReuseActor;
  readonly operationKind: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly payload: RequestReuseValue;
}

export interface RequestReuseEnvelope {
  readonly contractVersion: typeof REQUEST_REUSE_CONTRACT_VERSION;
  readonly requestKey: string;
  readonly identityFingerprint: string;
  readonly payloadFingerprint: string;
  readonly requestFingerprint: string;
}

export interface RequestReuseTerminalReceipt<TResult extends RequestReuseValue> extends RequestReuseEnvelope {
  readonly resultFingerprint: string;
  readonly result: TResult;
}

export interface RequestReuseAtomicSession<TContext, TResult extends RequestReuseValue> {
  readonly context: TContext;
  readTerminal(): Promise<RequestReuseTerminalReceipt<TResult> | undefined>;
  persistTerminal(receipt: RequestReuseTerminalReceipt<TResult>): Promise<void>;
}

export interface RequestReuseAtomicStore<TContext, TResult extends RequestReuseValue> {
  // 구현체는 같은 requestKey의 work를 직렬화하고 context의 업무 변경과 terminal receipt를 한 transaction으로 commit/rollback해야 합니다.
  withLockedRequestKey<T>(requestKey: string, work: (session: RequestReuseAtomicSession<TContext, TResult>) => Promise<T>): Promise<T>;
}

export interface RequestReuseExecutionResult<TResult extends RequestReuseValue> {
  readonly result: TResult;
  readonly receipt: RequestReuseTerminalReceipt<TResult>;
  readonly replayed: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function failCanonical(): never {
  throw new Error("REQUEST_REUSE_VALUE_NOT_CANONICAL");
}

type DataFields = ReadonlyMap<string, unknown>;

function exactDataFields(value: unknown, expectedKeys: readonly string[]): DataFields {
  if (typeof value !== "object" || value === null || nodeTypes.isProxy(value) || Array.isArray(value)) return failCanonical();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return failCanonical();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return failCanonical();
  const actual = (keys as string[]).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) return failCanonical();
  const fields = new Map<string, unknown>();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return failCanonical();
    fields.set(key, descriptor.value);
  }
  return fields;
}

function snapshotCanonicalValue(value: unknown, ancestors = new WeakSet<object>(), depth = 0, allowUnsafeInteger = false): RequestReuseValue {
  if (depth > 64) return failCanonical();
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (!allowUnsafeInteger && Number.isInteger(value) && !Number.isSafeInteger(value))) return failCanonical();
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || nodeTypes.isProxy(value) || ancestors.has(value)) return failCanonical();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return failCanonical();
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== "string")) return failCanonical();
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number") return failCanonical();
      const length = lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) return failCanonical();
      const copy: RequestReuseValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return failCanonical();
        copy.push(snapshotCanonicalValue(descriptor.value, ancestors, depth + 1, allowUnsafeInteger));
      }
      return Object.freeze(copy);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return failCanonical();
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return failCanonical();
    const copy = Object.create(prototype) as Record<string, RequestReuseValue>;
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return failCanonical();
      Object.defineProperty(copy, key, { value: snapshotCanonicalValue(descriptor.value, ancestors, depth + 1, allowUnsafeInteger), enumerable: true, configurable: false, writable: false });
    }
    return Object.freeze(copy);
  } finally { ancestors.delete(value); }
}

function serializeSnapshot(value: RequestReuseValue): string {
  if (value === null) return '["null"]';
  if (typeof value === "string") return `["string",${JSON.stringify(value)}]`;
  if (typeof value === "boolean") return `["boolean",${value ? "true" : "false"}]`;
  if (typeof value === "bigint") return `["bigint",${JSON.stringify(value.toString())}]`;
  if (typeof value === "number") return `["number",${JSON.stringify(value)}]`;
  if (Array.isArray(value)) return `["array",[${value.map((entry) => serializeSnapshot(entry)).join(",")}]]`;
  const record = value as { readonly [key: string]: RequestReuseValue };
  return `["object",[${Object.keys(record).sort().map((key) => `[${JSON.stringify(key)},${serializeSnapshot(record[key]!)}]`).join(",")}]]`;
}

// 외부 value를 정확히 한 번 data-only snapshot한 뒤 타입 태그 canonical form을 생성합니다.
export function serializeRequestReuseValue(value: RequestReuseValue): string {
  return serializeSnapshot(snapshotCanonicalValue(value));
}

function requiredText(value: string, name: string, maximum: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) throw new Error(`REQUEST_REUSE_${name}_INVALID`);
  return value;
}

function identityValue(input: RequestReuseInput): RequestReuseValue {
  const actor = input.actor;
  return {
    contractVersion: REQUEST_REUSE_CONTRACT_VERSION,
    scope: requiredText(input.scope, "SCOPE", 191),
    requestKey: requiredText(input.requestKey, "REQUEST_KEY", 191),
    sourceEventId: requiredText(input.sourceEventId, "SOURCE_EVENT_ID", 191),
    actor: { actorType: actor.actorType, actorId: actor.actorId, playerId: actor.playerId },
    operationKind: requiredText(input.operationKind, "OPERATION_KIND", 100),
    targetType: requiredText(input.targetType, "TARGET_TYPE", 100),
    targetId: input.targetId === null ? null : requiredText(input.targetId, "TARGET_ID", 191),
  };
}

function snapshotRequestReuseInput(input: RequestReuseInput): RequestReuseInput {
  const fields = exactDataFields(input, ["scope", "requestKey", "sourceEventId", "actor", "operationKind", "targetType", "targetId", "payload"]);
  const actorFields = exactDataFields(fields.get("actor"), ["actorType", "actorId", "playerId"]);
  const scope = requiredText(fields.get("scope") as string, "SCOPE", 191);
  const requestKey = requiredText(fields.get("requestKey") as string, "REQUEST_KEY", 191);
  const sourceEventId = requiredText(fields.get("sourceEventId") as string, "SOURCE_EVENT_ID", 191);
  const actorType = requiredText(actorFields.get("actorType") as string, "ACTOR_TYPE", 100);
  const actorId = requiredText(actorFields.get("actorId") as string, "ACTOR_ID", 191);
  const rawPlayerId = actorFields.get("playerId");
  const playerId = rawPlayerId === null ? null : requiredText(rawPlayerId as string, "PLAYER_ID", 191);
  const operationKind = requiredText(fields.get("operationKind") as string, "OPERATION_KIND", 100);
  const targetType = requiredText(fields.get("targetType") as string, "TARGET_TYPE", 100);
  const rawTargetId = fields.get("targetId");
  const targetId = rawTargetId === null ? null : requiredText(rawTargetId as string, "TARGET_ID", 191);
  return Object.freeze({
    scope, requestKey, sourceEventId,
    actor: Object.freeze({ actorType, actorId, playerId }),
    operationKind, targetType, targetId,
    payload: snapshotCanonicalValue(fields.get("payload")),
  });
}

function createEnvelopeFromSnapshot(input: RequestReuseInput): RequestReuseEnvelope {
  const identityFingerprint = sha256(serializeSnapshot(identityValue(input)));
  const payloadFingerprint = sha256(serializeSnapshot(input.payload));
  return Object.freeze({
    contractVersion: REQUEST_REUSE_CONTRACT_VERSION,
    requestKey: input.requestKey,
    identityFingerprint,
    payloadFingerprint,
    requestFingerprint: sha256(serializeSnapshot({ contractVersion: REQUEST_REUSE_CONTRACT_VERSION, identityFingerprint, payloadFingerprint })),
  });
}

export function createRequestReuseEnvelope(input: RequestReuseInput): RequestReuseEnvelope {
  return createEnvelopeFromSnapshot(snapshotRequestReuseInput(input));
}

function createReceiptFromSnapshots<TResult extends RequestReuseValue>(input: RequestReuseInput, result: TResult): RequestReuseTerminalReceipt<TResult> {
  return Object.freeze({ ...createEnvelopeFromSnapshot(input), resultFingerprint: sha256(serializeSnapshot(result)), result });
}

export function createRequestReuseTerminalReceipt<TResult extends RequestReuseValue>(input: RequestReuseInput, result: TResult): RequestReuseTerminalReceipt<TResult> {
  return createReceiptFromSnapshots(snapshotRequestReuseInput(input), snapshotCanonicalValue(result) as TResult);
}

function snapshotTerminalReceipt<TResult extends RequestReuseValue>(receipt: RequestReuseTerminalReceipt<TResult>): RequestReuseTerminalReceipt<TResult> {
  const fields = exactDataFields(receipt, ["contractVersion", "requestKey", "identityFingerprint", "payloadFingerprint", "requestFingerprint", "resultFingerprint", "result"]);
  const text = (key: string): string => {
    const value = fields.get(key);
    if (typeof value !== "string") return failCanonical();
    return value;
  };
  return Object.freeze({
    contractVersion: text("contractVersion") as typeof REQUEST_REUSE_CONTRACT_VERSION,
    requestKey: text("requestKey"), identityFingerprint: text("identityFingerprint"),
    payloadFingerprint: text("payloadFingerprint"), requestFingerprint: text("requestFingerprint"),
    resultFingerprint: text("resultFingerprint"), result: snapshotCanonicalValue(fields.get("result")) as TResult,
  });
}

function verifyReplaySnapshots<TResult extends RequestReuseValue>(input: RequestReuseInput, receipt: RequestReuseTerminalReceipt<TResult>): void {
  if (receipt.contractVersion !== REQUEST_REUSE_CONTRACT_VERSION || receipt.requestKey !== input.requestKey) throw new Error("REQUEST_REUSE_CONTRACT_CONFLICT");
  const expected = createEnvelopeFromSnapshot(input);
  if (receipt.identityFingerprint !== expected.identityFingerprint) throw new Error("REQUEST_REUSE_IDENTITY_CONFLICT");
  if (receipt.payloadFingerprint !== expected.payloadFingerprint || receipt.requestFingerprint !== expected.requestFingerprint) throw new Error("REQUEST_REUSE_PAYLOAD_CONFLICT");
  if (receipt.resultFingerprint !== sha256(serializeSnapshot(receipt.result))) throw new Error("REQUEST_REUSE_RESULT_CONFLICT");
}

export function replayRequestReuseTerminal<TResult extends RequestReuseValue>(input: RequestReuseInput, receipt: RequestReuseTerminalReceipt<TResult>): TResult {
  const stableInput = snapshotRequestReuseInput(input);
  const stableReceipt = snapshotTerminalReceipt(receipt);
  verifyReplaySnapshots(stableInput, stableReceipt);
  return stableReceipt.result;
}

export class RequestReuseProvider {
  async execute<TContext, TResult extends RequestReuseValue>(
    input: RequestReuseInput,
    store: RequestReuseAtomicStore<TContext, TResult>,
    effect: (context: TContext) => Promise<TResult>,
  ): Promise<RequestReuseExecutionResult<TResult>> {
    const stableInput = snapshotRequestReuseInput(input);
    // scope drift도 같은 외부 request key의 충돌로 닫기 위해 raw requestKey가 store lock/lookup key입니다.
    return store.withLockedRequestKey(stableInput.requestKey, async (session) => {
      const prior = await session.readTerminal();
      if (prior !== undefined) {
        const receipt = snapshotTerminalReceipt(prior);
        verifyReplaySnapshots(stableInput, receipt);
        return Object.freeze({ result: receipt.result, receipt, replayed: true });
      }
      const result = snapshotCanonicalValue(await effect(session.context)) as TResult;
      const receipt = createReceiptFromSnapshots(stableInput, result);
      await session.persistTerminal(receipt);
      return Object.freeze({ result: receipt.result, receipt, replayed: false });
    });
  }
}

function legacyCanonicalJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const visit = (current: unknown, depth: number): string => {
    if (depth > 64) return failCanonical();
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") return JSON.stringify(current);
    if (typeof current === "number") return Number.isFinite(current) ? JSON.stringify(current) : failCanonical();
    if (typeof current !== "object" || ancestors.has(current)) return failCanonical();
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) return failCanonical();
        const keys = Reflect.ownKeys(current);
        if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length))) return failCanonical();
        const items: string[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return failCanonical();
          items.push(visit(descriptor.value, depth + 1));
        }
        return `[${items.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return failCanonical();
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) return failCanonical();
      const entries: string[] = [];
      for (const key of (keys as string[]).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return failCanonical();
        entries.push(`${JSON.stringify(key)}:${visit(descriptor.value, depth + 1)}`);
      }
      return `{${entries.join(",")}}`;
    } finally { ancestors.delete(current); }
  };
  return visit(value, 0);
}

// 아래 함수는 기존 저장 지문을 검산하는 한정 호환 경계이며 RFA01 V1 전체 identity 증거로 승격하지 않습니다.
export function createLegacyCurrencyPayloadFingerprint(input: { readonly currencyId: string; readonly deltaMinorAmount: bigint; readonly operationKind: string; readonly reasonKey: string }): string {
  return legacyCurrencyFingerprint(snapshotLegacyCurrencyInput(input));
}

type LegacyCurrencyInput = { readonly currencyId: string; readonly deltaMinorAmount: bigint; readonly operationKind: string; readonly reasonKey: string };
function snapshotLegacyCurrencyInput(input: LegacyCurrencyInput): LegacyCurrencyInput {
  const fields = exactDataFields(input, ["currencyId", "deltaMinorAmount", "operationKind", "reasonKey"]);
  const currencyId = fields.get("currencyId"), deltaMinorAmount = fields.get("deltaMinorAmount"), operationKind = fields.get("operationKind"), reasonKey = fields.get("reasonKey");
  if (typeof currencyId !== "string" || typeof deltaMinorAmount !== "bigint" || typeof operationKind !== "string" || typeof reasonKey !== "string") return failCanonical();
  return Object.freeze({ currencyId, deltaMinorAmount, operationKind, reasonKey });
}
function legacyCurrencyFingerprint(input: LegacyCurrencyInput): string {
  return sha256(JSON.stringify([["currencyId", input.currencyId], ["deltaMinorAmount", input.deltaMinorAmount.toString()], ["operationKind", input.operationKind], ["reasonKey", input.reasonKey]]));
}

export function assertLegacyCurrencyReplay(
  stored: { readonly operationKind: string; readonly payloadFingerprint: string },
  input: { readonly currencyId: string; readonly deltaMinorAmount: bigint; readonly operationKind: string; readonly reasonKey: string },
): void {
  const storedFields = exactDataFields(stored, ["operationKind", "payloadFingerprint"]);
  const stableInput = snapshotLegacyCurrencyInput(input);
  if (storedFields.get("operationKind") !== stableInput.operationKind || storedFields.get("payloadFingerprint") !== legacyCurrencyFingerprint(stableInput)) throw new Error("REQUEST_REUSE_LEGACY_CURRENCY_CONFLICT");
}

const LEGACY_FURNITURE_OPERATION_KINDS = new Set([
  "grant_owned_furniture", "place_owned_furniture",
  "transition_bag_to_listed", "transition_bag_to_removed",
  "transition_placed_to_bag", "transition_placed_to_removed",
  "transition_listed_to_bag", "transition_listed_to_sold",
]);

export function createLegacyFurniturePayloadFingerprint(operationKind: string, orderedValues: readonly string[]): string {
  if (typeof operationKind !== "string") return failCanonical();
  const stableValues = snapshotCanonicalValue(orderedValues);
  if (!Array.isArray(stableValues) || !LEGACY_FURNITURE_OPERATION_KINDS.has(operationKind) || stableValues.length !== 3 || stableValues.some((value) => typeof value !== "string") || stableValues[0]?.length === 0 || stableValues[1]?.length === 0) throw new Error("REQUEST_REUSE_LEGACY_FURNITURE_SHAPE_INVALID");
  return sha256(JSON.stringify([operationKind, ...stableValues]));
}

export function assertLegacyFurnitureReplay(
  stored: { readonly operationKind: string; readonly payloadFingerprint: string },
  input: { readonly operationKind: string; readonly orderedValues: readonly string[] },
): void {
  const storedFields = exactDataFields(stored, ["operationKind", "payloadFingerprint"]);
  const inputFields = exactDataFields(input, ["operationKind", "orderedValues"]);
  const operationKind = inputFields.get("operationKind"), orderedValues = inputFields.get("orderedValues");
  if (typeof operationKind !== "string" || !Array.isArray(orderedValues)) return failCanonical();
  if (storedFields.get("operationKind") !== operationKind || storedFields.get("payloadFingerprint") !== createLegacyFurniturePayloadFingerprint(operationKind, orderedValues as readonly string[])) throw new Error("REQUEST_REUSE_LEGACY_FURNITURE_CONFLICT");
}

export function createLegacyAppWiringFingerprints(input: { readonly requestNamespace: string; readonly entrypointKind: string; readonly externalRequestId: string; readonly normalizedPayload: unknown }): { readonly requestIdentityFingerprint: string; readonly payloadFingerprint: string } {
  const fields = exactDataFields(input, ["requestNamespace", "entrypointKind", "externalRequestId", "normalizedPayload"]);
  const requestNamespace = fields.get("requestNamespace"), entrypointKind = fields.get("entrypointKind"), externalRequestId = fields.get("externalRequestId");
  if (typeof requestNamespace !== "string" || typeof entrypointKind !== "string" || typeof externalRequestId !== "string" || requestNamespace.length === 0 || !/^(IRIS|AUTOMATIC|ADMIN|WEB)$/.test(entrypointKind) || externalRequestId.length === 0) throw new Error("REQUEST_REUSE_LEGACY_APP_WIRING_SHAPE_INVALID");
  const normalizedPayload = snapshotCanonicalValue(fields.get("normalizedPayload"), new WeakSet<object>(), 0, true);
  return Object.freeze({
    requestIdentityFingerprint: sha256(JSON.stringify([requestNamespace, entrypointKind, externalRequestId])),
    payloadFingerprint: sha256(legacyCanonicalJson(normalizedPayload)),
  });
}

export function assertLegacyAppWiringReplay(
  stored: { readonly requestIdentityFingerprint: string; readonly payloadFingerprint: string },
  input: { readonly requestNamespace: string; readonly entrypointKind: string; readonly externalRequestId: string; readonly normalizedPayload: unknown },
): void {
  const storedFields = exactDataFields(stored, ["requestIdentityFingerprint", "payloadFingerprint"]);
  const expected = createLegacyAppWiringFingerprints(input);
  if (storedFields.get("requestIdentityFingerprint") !== expected.requestIdentityFingerprint || storedFields.get("payloadFingerprint") !== expected.payloadFingerprint) throw new Error("REQUEST_REUSE_LEGACY_APP_WIRING_CONFLICT");
}
