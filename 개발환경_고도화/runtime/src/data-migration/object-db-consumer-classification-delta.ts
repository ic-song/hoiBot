import { createHash } from "node:crypto";
import type { ConsumerManifest, DerivedConsumer } from "./object-db-consumer-transition-audit.js";
import type { HttpRouteCompositionBindingEvidence } from "./http-route-composition-binding-audit.js";

export const OBJECT_DB_CONSUMER_DELTA_FORMAT = "hoibot-object-db-consumer-classification-delta-v1" as const;
export const OBJECT_DB_CONSUMER_DELTA_SCHEMA_VERSION = "object-db-consumer-delta-v1" as const;

export interface ObjectDbConsumerReplacement {
  operation: "REPLACE";
  consumerId: string;
  beforeSha256: string;
  afterSha256: string;
  before: DerivedConsumer;
  after: DerivedConsumer;
}

export interface ObjectDbConsumerClassificationDelta {
  format: typeof OBJECT_DB_CONSUMER_DELTA_FORMAT;
  evidenceSchemaVersion: typeof OBJECT_DB_CONSUMER_DELTA_SCHEMA_VERSION;
  baseCatalogVersion: string;
  deltaId: string;
  sourceManifest: { consumerCount: number; consumerSetSha256: string; consumerIdSetSha256: string; nonHttpConsumersSha256: string; sha256: string };
  scope: { kind: "HTTP_WEB_ROUTE"; routeCount: number; registrarCounts: Record<string, number> };
  audit: {
    resolvedCount: number;
    unresolvedCount: number;
    registrarResults: Array<{ registrar: string; total: number; resolved: number; unresolved: number; reasons: Record<string, number> }>;
    entries: HttpRouteCompositionBindingEvidence[];
  };
  operations: ObjectDbConsumerReplacement[];
  preservation: {
    receiptCount: 352;
    wave27PrefixCount: 324;
    wave27PrefixBytes: 1260829;
    wave27PrefixSha256: "72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb";
  };
  deltaSha256: string;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function sha256ConsumerSet(consumers: readonly DerivedConsumer[]): string {
  return createHash("sha256").update(JSON.stringify(consumers), "utf8").digest("hex");
}

export function sealObjectDbConsumerClassificationDelta(
  payload: Omit<ObjectDbConsumerClassificationDelta, "deltaSha256">,
): ObjectDbConsumerClassificationDelta {
  return { ...payload, deltaSha256: sha256CanonicalJson(payload) };
}

export function applyObjectDbConsumerClassificationDelta(
  base: ConsumerManifest,
  delta: ObjectDbConsumerClassificationDelta,
): ConsumerManifest {
  if (delta.format !== OBJECT_DB_CONSUMER_DELTA_FORMAT || delta.evidenceSchemaVersion !== OBJECT_DB_CONSUMER_DELTA_SCHEMA_VERSION) {
    throw new Error("OBJECT_DB_CONSUMER_DELTA_SCHEMA_MISMATCH");
  }
  const { deltaSha256, ...payload } = delta;
  if (sha256CanonicalJson(payload) !== deltaSha256) throw new Error("OBJECT_DB_CONSUMER_DELTA_HASH_MISMATCH");
  if (delta.sourceManifest.consumerCount !== base.consumers.length
    || delta.sourceManifest.consumerSetSha256 !== base.consumerSetSha256
    || delta.sourceManifest.consumerIdSetSha256 !== sha256CanonicalJson(base.consumers.map(({ consumerId }) => consumerId).sort())
    || delta.sourceManifest.nonHttpConsumersSha256 !== sha256CanonicalJson(base.consumers.filter(({ kind }) => kind !== "HTTP_WEB_ROUTE"))
    || delta.sourceManifest.sha256 !== sha256CanonicalJson(base)) throw new Error("OBJECT_DB_CONSUMER_DELTA_BASE_DRIFT");
  if (delta.scope.kind !== "HTTP_WEB_ROUTE" || delta.scope.routeCount !== 81 || delta.audit.entries.length !== 81) {
    throw new Error("OBJECT_DB_CONSUMER_DELTA_SCOPE_MISMATCH");
  }
  const auditByKey = new Map(delta.audit.entries.map((entry) => [entry.endpointKey, entry]));
  if (auditByKey.size !== 81 || delta.audit.resolvedCount + delta.audit.unresolvedCount !== 81) {
    throw new Error("OBJECT_DB_CONSUMER_DELTA_AUDIT_DUPLICATE");
  }
  const replacements = new Map<string, ObjectDbConsumerReplacement>();
  for (const operation of delta.operations) {
    if (operation.operation !== "REPLACE" || replacements.has(operation.consumerId)) throw new Error("OBJECT_DB_CONSUMER_DELTA_OPERATION_INVALID");
    const baseConsumer = base.consumers.find(({ consumerId }) => consumerId === operation.consumerId);
    if (baseConsumer === undefined || baseConsumer.kind !== "HTTP_WEB_ROUTE" || operation.before.kind !== "HTTP_WEB_ROUTE"
      || operation.after.kind !== "HTTP_WEB_ROUTE" || operation.after.consumerId !== operation.consumerId) {
      throw new Error(`OBJECT_DB_CONSUMER_DELTA_TARGET_INVALID:${operation.consumerId}`);
    }
    if (sha256CanonicalJson(baseConsumer) !== operation.beforeSha256 || sha256CanonicalJson(operation.before) !== operation.beforeSha256
      || sha256CanonicalJson(operation.after) !== operation.afterSha256) throw new Error(`OBJECT_DB_CONSUMER_DELTA_REPLACEMENT_DRIFT:${operation.consumerId}`);
    const evidence = auditByKey.get(operation.after.triggerOrPredicate);
    if (evidence?.resolved !== true || operation.before.unresolvedDynamicCallCount !== 1
      || operation.after.unresolvedDynamicCallCount !== 0 || operation.after.targetUsageMode !== "CURRENT_SQL"
      || operation.after.sqlTables.length === 0 || operation.after.interfaceId === ""
      || operation.after.observedSqlReadTables.length + operation.after.observedSqlWriteTables.length === 0) {
      throw new Error(`OBJECT_DB_CONSUMER_DELTA_RESOLUTION_INCOMPLETE:${operation.consumerId}`);
    }
    replacements.set(operation.consumerId, operation);
  }
  if (replacements.size !== delta.audit.resolvedCount) throw new Error("OBJECT_DB_CONSUMER_DELTA_RESOLVED_OPERATION_COUNT_MISMATCH");
  for (const evidence of delta.audit.entries.filter(({ resolved }) => !resolved)) {
    if (evidence.unresolvedReasons.length === 0) throw new Error(`OBJECT_DB_CONSUMER_DELTA_FAIL_OPEN:${evidence.endpointKey}`);
  }
  const consumers = base.consumers.map((consumer) => replacements.get(consumer.consumerId)?.after ?? consumer);
  const applied = { ...base, consumers, consumerSetSha256: sha256ConsumerSet(consumers) };
  if (sha256CanonicalJson(applied.consumers.filter(({ kind }) => kind !== "HTTP_WEB_ROUTE")) !== delta.sourceManifest.nonHttpConsumersSha256) {
    throw new Error("OBJECT_DB_CONSUMER_DELTA_NON_HTTP_DRIFT");
  }
  for (const evidence of delta.audit.entries.filter(({ resolved }) => !resolved)) {
    const before = base.consumers.find(({ kind, triggerOrPredicate }) => kind === "HTTP_WEB_ROUTE" && triggerOrPredicate === evidence.endpointKey);
    const after = applied.consumers.find(({ consumerId }) => consumerId === before?.consumerId);
    if (before === undefined || after === undefined || sha256CanonicalJson(before) !== sha256CanonicalJson(after)) {
      throw new Error(`OBJECT_DB_CONSUMER_DELTA_UNRESOLVED_CHANGED:${evidence.endpointKey}`);
    }
  }
  return applied;
}
