import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readCanonicalObjectDbConsumerSource } from "./object-db-consumer-baseline.js";

export type StableConsumerIdentity = {
  kind: string;
  file: string;
  symbol: string;
  triggerOrPredicate: string;
};

export type ConsumerIdRegistryEntry = {
  logicalKey: string;
  consumerId: string;
  state: "ACTIVE" | "TOMBSTONE";
};

export type ConsumerIdRegistry = {
  format: "hoibot-object-db-consumer-id-registry-v1";
  logicalKeyVersion: "consumer-logical-key-v1";
  newConsumerIdVersion: "consumer-logical-id-v2";
  baseCommit: string;
  sourceManifestConsumerSetSha256: string;
  entries: ConsumerIdRegistryEntry[];
};

// Immutable provenance of the accepted 1,092-ID seed. This is intentionally
// independent from later manifest consumerSetSha256 values, which include
// mutable sourceSpan evidence and other current-source classifications.
export const OBJECT_DB_CONSUMER_ID_REGISTRY_SEED_SHA256 = "59ec618ab69de51a161e59171275f6d7f96567128960a8dec57613ca5b04ea85" as const;

const ID_PATTERN = /^(?:legacy|automatic-callback|runtime-dispatch|admin-command|http-web-route|app-wiring|sql-repository)-[a-f0-9]{16}$/;
const CONSUMER_ID_PREFIX: Record<string, string> = {
  LEGACY_COMMAND: "legacy",
  AUTOMATIC_CALLBACK: "automatic-callback",
  RUNTIME_DISPATCH: "runtime-dispatch",
  ADMIN_COMMAND: "admin-command",
  HTTP_WEB_ROUTE: "http-web-route",
  APP_WIRING: "app-wiring",
  SQL_REPOSITORY: "sql-repository"
};

export function normalizeConsumerIdentityTrigger(kind: string, triggerOrPredicate: string): string {
  if (kind === "AUTOMATIC_CALLBACK" && /^TIMER:setInterval@\d+$/.test(triggerOrPredicate)) return "TIMER:setInterval";
  if (kind === "RUNTIME_DISPATCH") return triggerOrPredicate.replace(/message-guard@\d+/g, "message-guard");
  return triggerOrPredicate;
}

export function deriveConsumerLogicalKey(identity: StableConsumerIdentity): string {
  const symbol = identity.kind === "RUNTIME_DISPATCH"
    ? identity.symbol.replace(/message-guard@\d+/g, "message-guard")
    : identity.symbol;
  return JSON.stringify([
    identity.kind,
    identity.file,
    symbol,
    normalizeConsumerIdentityTrigger(identity.kind, identity.triggerOrPredicate)
  ]);
}

export function parseConsumerIdRegistry(value: unknown, expectedBaseCommit?: string): ConsumerIdRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("consumer ID registry must be an object");
  const raw = value as Partial<ConsumerIdRegistry>;
  if (raw.format !== "hoibot-object-db-consumer-id-registry-v1") throw new Error("unsupported consumer ID registry format");
  if (raw.logicalKeyVersion !== "consumer-logical-key-v1") throw new Error("unsupported consumer logical key version");
  if (raw.newConsumerIdVersion !== "consumer-logical-id-v2") throw new Error("unsupported new consumer ID version");
  if (typeof raw.baseCommit !== "string" || !/^[a-f0-9]{40}$/.test(raw.baseCommit)) throw new Error("invalid consumer ID registry baseCommit");
  if (expectedBaseCommit !== undefined && raw.baseCommit !== expectedBaseCommit) throw new Error("consumer ID registry baseCommit mismatch");
  if (raw.sourceManifestConsumerSetSha256 !== OBJECT_DB_CONSUMER_ID_REGISTRY_SEED_SHA256) throw new Error("consumer ID registry seed manifest hash mismatch");
  if (!Array.isArray(raw.entries)) throw new Error("consumer ID registry entries must be an array");
  const logicalKeys = new Set<string>();
  const consumerIds = new Set<string>();
  const entries = raw.entries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`invalid consumer ID registry entry at ${index}`);
    const candidate = entry as Partial<ConsumerIdRegistryEntry>;
    if (typeof candidate.logicalKey !== "string" || candidate.logicalKey.length === 0) throw new Error(`invalid consumer ID registry logicalKey at ${index}`);
    if (typeof candidate.consumerId !== "string" || !ID_PATTERN.test(candidate.consumerId)) throw new Error(`invalid consumer ID registry consumerId at ${index}`);
    if (candidate.state !== "ACTIVE" && candidate.state !== "TOMBSTONE") throw new Error(`invalid consumer ID registry state at ${index}`);
    let logicalIdentity: unknown;
    try { logicalIdentity = JSON.parse(candidate.logicalKey); } catch { throw new Error(`invalid consumer ID registry logicalKey encoding at ${index}`); }
    if (!Array.isArray(logicalIdentity) || logicalIdentity.length !== 4 || logicalIdentity.some((part) => typeof part !== "string")) throw new Error(`invalid consumer ID registry logicalKey shape at ${index}`);
    const [kind, file, symbol, triggerOrPredicate] = logicalIdentity as [string, string, string, string];
    if (deriveConsumerLogicalKey({ kind, file, symbol, triggerOrPredicate }) !== candidate.logicalKey) throw new Error(`non-canonical consumer ID registry logicalKey at ${index}`);
    const expectedPrefix = CONSUMER_ID_PREFIX[kind];
    if (expectedPrefix === undefined || !candidate.consumerId.startsWith(`${expectedPrefix}-`)) throw new Error(`consumer ID registry kind/prefix conflict at ${index}`);
    if (logicalKeys.has(candidate.logicalKey)) throw new Error(`duplicate consumer ID registry logicalKey: ${candidate.logicalKey}`);
    if (consumerIds.has(candidate.consumerId)) throw new Error(`duplicate consumer ID registry consumerId: ${candidate.consumerId}`);
    logicalKeys.add(candidate.logicalKey);
    consumerIds.add(candidate.consumerId);
    return { logicalKey: candidate.logicalKey, consumerId: candidate.consumerId, state: candidate.state };
  });
  return {
    format: raw.format,
    logicalKeyVersion: raw.logicalKeyVersion,
    newConsumerIdVersion: raw.newConsumerIdVersion,
    baseCommit: raw.baseCommit,
    sourceManifestConsumerSetSha256: raw.sourceManifestConsumerSetSha256,
    entries
  };
}

export function loadConsumerIdRegistry(repoRoot: string, expectedBaseCommit: string): ConsumerIdRegistry {
  const path = resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-id-registry.v1.json");
  return parseConsumerIdRegistry(JSON.parse(readCanonicalObjectDbConsumerSource(path)), expectedBaseCommit);
}

export function createConsumerIdResolver(registry: ConsumerIdRegistry): (identity: StableConsumerIdentity) => string {
  const parsed = parseConsumerIdRegistry(registry, registry.baseCommit);
  const byLogicalKey = new Map(parsed.entries.map((entry) => [entry.logicalKey, entry]));
  const reservedIds = new Set(parsed.entries.map((entry) => entry.consumerId));
  const newMappings = new Map<string, string>();
  const newIds = new Map<string, string>();
  return (identity) => {
    const logicalKey = deriveConsumerLogicalKey(identity);
    const registered = byLogicalKey.get(logicalKey);
    if (registered?.state === "TOMBSTONE") throw new Error(`consumer logicalKey is tombstoned: ${logicalKey}`);
    if (registered !== undefined) return registered.consumerId;
    const existing = newMappings.get(logicalKey);
    if (existing !== undefined) return existing;
    const prefix = CONSUMER_ID_PREFIX[identity.kind];
    if (prefix === undefined) throw new Error(`unsupported consumer kind for stable ID: ${identity.kind}`);
    const consumerId = `${prefix}-${createHash("sha256").update(`consumer-logical-id-v2|${logicalKey}`).digest("hex").slice(0, 16)}`;
    if (reservedIds.has(consumerId)) throw new Error(`new consumer ID collides with registry: ${consumerId}`);
    const conflictingKey = newIds.get(consumerId);
    if (conflictingKey !== undefined && conflictingKey !== logicalKey) throw new Error(`new consumer ID collision: ${consumerId}`);
    newMappings.set(logicalKey, consumerId);
    newIds.set(consumerId, logicalKey);
    return consumerId;
  };
}
