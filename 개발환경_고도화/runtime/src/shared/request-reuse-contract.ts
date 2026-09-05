import { createHash } from "node:crypto";

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

// 타입 태그로 bigint/string/number/null을 구별하고 object key만 정렬합니다. 배열 순서는 업무 의미이므로 보존합니다.
export function serializeRequestReuseValue(value: RequestReuseValue): string {
  const ancestors = new WeakSet<object>();
  const visit = (current: RequestReuseValue, depth: number): string => {
    if (depth > 64) return failCanonical();
    if (current === null) return '["null"]';
    if (typeof current === "string") return `["string",${JSON.stringify(current)}]`;
    if (typeof current === "boolean") return `["boolean",${current ? "true" : "false"}]`;
    if (typeof current === "bigint") return `["bigint",${JSON.stringify(current.toString())}]`;
    if (typeof current === "number") {
      if (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current))) return failCanonical();
      return `["number",${JSON.stringify(Object.is(current, -0) ? 0 : current)}]`;
    }
    if (typeof current !== "object") return failCanonical();
    if (ancestors.has(current)) return failCanonical();
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
          items.push(visit(descriptor.value as RequestReuseValue, depth + 1));
        }
        return `["array",[${items.join(",")}]]`;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return failCanonical();
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) return failCanonical();
      const entries: string[] = [];
      for (const key of (keys as string[]).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return failCanonical();
        entries.push(`[${JSON.stringify(key)},${visit(descriptor.value as RequestReuseValue, depth + 1)}]`);
      }
      return `["object",[${entries.join(",")}]]`;
    } finally {
      ancestors.delete(current);
    }
  };
  return visit(value, 0);
}

function requiredText(value: string, name: string, maximum: number): string {
  if (value.trim() === "" || value.length > maximum) throw new Error(`REQUEST_REUSE_${name}_INVALID`);
  return value;
}

function identityValue(input: RequestReuseInput): RequestReuseValue {
  return {
    contractVersion: REQUEST_REUSE_CONTRACT_VERSION,
    scope: requiredText(input.scope, "SCOPE", 191),
    requestKey: requiredText(input.requestKey, "REQUEST_KEY", 191),
    sourceEventId: requiredText(input.sourceEventId, "SOURCE_EVENT_ID", 191),
    actor: {
      actorType: requiredText(input.actor.actorType, "ACTOR_TYPE", 100),
      actorId: requiredText(input.actor.actorId, "ACTOR_ID", 191),
      playerId: input.actor.playerId === null ? null : requiredText(input.actor.playerId, "PLAYER_ID", 191),
    },
    operationKind: requiredText(input.operationKind, "OPERATION_KIND", 100),
    targetType: requiredText(input.targetType, "TARGET_TYPE", 100),
    targetId: input.targetId === null ? null : requiredText(input.targetId, "TARGET_ID", 191),
  };
}

function snapshotRequestReuseInput(input: RequestReuseInput): RequestReuseInput {
  // 모든 필드를 첫 await 전에 한 번 읽고 검증해 caller mutation이 lock 대기 중 계약을 바꾸지 못하게 합니다.
  const identity = identityValue(input) as {
    scope: string; requestKey: string; sourceEventId: string;
    actor: { actorType: string; actorId: string; playerId: string | null };
    operationKind: string; targetType: string; targetId: string | null;
  };
  return Object.freeze({
    scope: identity.scope,
    requestKey: identity.requestKey,
    sourceEventId: identity.sourceEventId,
    actor: Object.freeze({ ...identity.actor }),
    operationKind: identity.operationKind,
    targetType: identity.targetType,
    targetId: identity.targetId,
    payload: cloneFrozenValue(input.payload),
  });
}

export function createRequestReuseEnvelope(input: RequestReuseInput): RequestReuseEnvelope {
  const identityFingerprint = sha256(serializeRequestReuseValue(identityValue(input)));
  const payloadFingerprint = sha256(serializeRequestReuseValue(input.payload));
  return Object.freeze({
    contractVersion: REQUEST_REUSE_CONTRACT_VERSION,
    requestKey: input.requestKey,
    identityFingerprint,
    payloadFingerprint,
    requestFingerprint: sha256(serializeRequestReuseValue({ contractVersion: REQUEST_REUSE_CONTRACT_VERSION, identityFingerprint, payloadFingerprint })),
  });
}

export function createRequestReuseTerminalReceipt<TResult extends RequestReuseValue>(input: RequestReuseInput, result: TResult): RequestReuseTerminalReceipt<TResult> {
  const storedResult = cloneFrozenValue(result) as TResult;
  return Object.freeze({ ...createRequestReuseEnvelope(input), resultFingerprint: sha256(serializeRequestReuseValue(storedResult)), result: storedResult });
}

export function replayRequestReuseTerminal<TResult extends RequestReuseValue>(input: RequestReuseInput, receipt: RequestReuseTerminalReceipt<TResult>): TResult {
  if (receipt.contractVersion !== REQUEST_REUSE_CONTRACT_VERSION || receipt.requestKey !== input.requestKey) throw new Error("REQUEST_REUSE_CONTRACT_CONFLICT");
  const expected = createRequestReuseEnvelope(input);
  if (receipt.identityFingerprint !== expected.identityFingerprint) throw new Error("REQUEST_REUSE_IDENTITY_CONFLICT");
  if (receipt.payloadFingerprint !== expected.payloadFingerprint || receipt.requestFingerprint !== expected.requestFingerprint) throw new Error("REQUEST_REUSE_PAYLOAD_CONFLICT");
  if (receipt.resultFingerprint !== sha256(serializeRequestReuseValue(receipt.result))) throw new Error("REQUEST_REUSE_RESULT_CONFLICT");
  return cloneFrozenValue(receipt.result) as TResult;
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
        const result = replayRequestReuseTerminal(stableInput, prior);
        return Object.freeze({ result, receipt: createRequestReuseTerminalReceipt(stableInput, result), replayed: true });
      }
      const result = await effect(session.context);
      const receipt = createRequestReuseTerminalReceipt(stableInput, result);
      await session.persistTerminal(receipt);
      return Object.freeze({ result: receipt.result, receipt, replayed: false });
    });
  }
}

function cloneFrozenValue(value: RequestReuseValue): RequestReuseValue {
  // serialize 검증을 먼저 수행해 accessor, sparse array, symbol, cycle과 지원하지 않는 prototype을 차단합니다.
  serializeRequestReuseValue(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => cloneFrozenValue(entry)));
  const record = value as { readonly [key: string]: RequestReuseValue };
  const copy = Object.create(Object.getPrototypeOf(record)) as Record<string, RequestReuseValue>;
  for (const key of Object.keys(record).sort()) Object.defineProperty(copy, key, { value: cloneFrozenValue(record[key]!), enumerable: true, configurable: false, writable: false });
  return Object.freeze(copy);
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
  return sha256(JSON.stringify([["currencyId", input.currencyId], ["deltaMinorAmount", input.deltaMinorAmount.toString()], ["operationKind", input.operationKind], ["reasonKey", input.reasonKey]]));
}

export function assertLegacyCurrencyReplay(
  stored: { readonly operationKind: string; readonly payloadFingerprint: string },
  input: { readonly currencyId: string; readonly deltaMinorAmount: bigint; readonly operationKind: string; readonly reasonKey: string },
): void {
  if (stored.operationKind !== input.operationKind || stored.payloadFingerprint !== createLegacyCurrencyPayloadFingerprint(input)) throw new Error("REQUEST_REUSE_LEGACY_CURRENCY_CONFLICT");
}

const LEGACY_FURNITURE_OPERATION_KINDS = new Set([
  "grant_owned_furniture", "place_owned_furniture",
  "transition_bag_to_listed", "transition_bag_to_removed",
  "transition_placed_to_bag", "transition_placed_to_removed",
  "transition_listed_to_bag", "transition_listed_to_sold",
]);

export function createLegacyFurniturePayloadFingerprint(operationKind: string, orderedValues: readonly string[]): string {
  if (!LEGACY_FURNITURE_OPERATION_KINDS.has(operationKind) || orderedValues.length !== 3 || orderedValues[0]?.length === 0 || orderedValues[1]?.length === 0) throw new Error("REQUEST_REUSE_LEGACY_FURNITURE_SHAPE_INVALID");
  return sha256(JSON.stringify([operationKind, ...orderedValues]));
}

export function assertLegacyFurnitureReplay(
  stored: { readonly operationKind: string; readonly payloadFingerprint: string },
  input: { readonly operationKind: string; readonly orderedValues: readonly string[] },
): void {
  if (stored.operationKind !== input.operationKind || stored.payloadFingerprint !== createLegacyFurniturePayloadFingerprint(input.operationKind, input.orderedValues)) throw new Error("REQUEST_REUSE_LEGACY_FURNITURE_CONFLICT");
}

export function createLegacyAppWiringFingerprints(input: { readonly requestNamespace: string; readonly entrypointKind: string; readonly externalRequestId: string; readonly normalizedPayload: unknown }): { readonly requestIdentityFingerprint: string; readonly payloadFingerprint: string } {
  if (input.requestNamespace.length === 0 || !/^(IRIS|AUTOMATIC|ADMIN|WEB)$/.test(input.entrypointKind) || input.externalRequestId.length === 0) throw new Error("REQUEST_REUSE_LEGACY_APP_WIRING_SHAPE_INVALID");
  return Object.freeze({
    requestIdentityFingerprint: sha256(JSON.stringify([input.requestNamespace, input.entrypointKind, input.externalRequestId])),
    payloadFingerprint: sha256(legacyCanonicalJson(input.normalizedPayload)),
  });
}

export function assertLegacyAppWiringReplay(
  stored: { readonly requestIdentityFingerprint: string; readonly payloadFingerprint: string },
  input: { readonly requestNamespace: string; readonly entrypointKind: string; readonly externalRequestId: string; readonly normalizedPayload: unknown },
): void {
  const expected = createLegacyAppWiringFingerprints(input);
  if (stored.requestIdentityFingerprint !== expected.requestIdentityFingerprint || stored.payloadFingerprint !== expected.payloadFingerprint) throw new Error("REQUEST_REUSE_LEGACY_APP_WIRING_CONFLICT");
}
