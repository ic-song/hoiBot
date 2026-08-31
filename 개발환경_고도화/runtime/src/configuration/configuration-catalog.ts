import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/application-error.js";

export const CONFIGURATION_VALUE_TYPES = ["string", "integer", "decimal", "boolean", "json"] as const;
export type ConfigurationValueType = typeof CONFIGURATION_VALUE_TYPES[number];
export type ConfigurationSetStatus = "draft" | "active" | "retired";

export interface ConfigurationValueSource {
  file: string;
  path: string;
  hash: string;
}

export interface ConfigurationValueValidation {
  min?: string;
  max?: string;
  step?: string;
  minLength?: number;
  maxLength?: number;
  enum?: readonly string[];
}

export interface ConfigurationKeyDefinition {
  key: string;
  label: string;
  type: ConfigurationValueType;
  required: boolean;
  editable: boolean;
  validation?: ConfigurationValueValidation;
  source: ConfigurationValueSource;
}

export interface ConfigurationSetDefinition {
  setCode: string;
  label: string;
  keys: readonly ConfigurationKeyDefinition[];
}

export interface ConfigurationValueInput {
  key: string;
  value: unknown;
}

export interface NormalizedConfigurationValue {
  key: string;
  type: ConfigurationValueType;
  value: string | boolean | Record<string, unknown> | readonly unknown[] | null;
  validation: ConfigurationValueValidation;
  source: ConfigurationValueSource;
}

export interface ConfigurationSnapshot {
  id: string;
  setCode: string;
  version: string;
  status: ConfigurationSetStatus;
  values: readonly NormalizedConfigurationValue[];
  contentHash: string;
}

interface MutationBase {
  setCode: string;
  actorId: string;
  idempotencyKey: string;
  reason: string;
}

export interface CreateConfigurationDraftInput extends MutationBase {
  expectedActiveVersion: string;
  baseVersion?: string;
  changes: readonly ConfigurationValueInput[];
}

export interface PublishConfigurationDraftInput extends MutationBase {
  expectedActiveVersion: string;
  draftVersion: string;
}

export interface RollbackConfigurationInput extends MutationBase {
  expectedActiveVersion: string;
  targetVersion: string;
}

export interface RetireConfigurationInput extends MutationBase {
  expectedActiveVersion: string;
}

export interface DiscardConfigurationDraftInput extends MutationBase {
  draftVersion: string;
}

export interface ConfigurationMutationResult {
  action: "draft" | "publish" | "rollback" | "retire" | "discard";
  setCode: string;
  beforeVersion: string;
  version: string;
  targetVersion: string | null;
  snapshot: ConfigurationSnapshot | null;
  operationId: string;
  auditId: string;
  outboxId: string;
  replayed: boolean;
}

export interface ConfigurationCatalogRepository {
  readCurrent(definition: ConfigurationSetDefinition): Promise<ConfigurationSnapshot | null>;
  readVersion(definition: ConfigurationSetDefinition, version: string): Promise<ConfigurationSnapshot | null>;
  createDraft(definition: ConfigurationSetDefinition, input: CreateConfigurationDraftInput, changes: readonly NormalizedConfigurationValue[]): Promise<ConfigurationMutationResult>;
  publish(definition: ConfigurationSetDefinition, input: PublishConfigurationDraftInput): Promise<ConfigurationMutationResult>;
  rollback(definition: ConfigurationSetDefinition, input: RollbackConfigurationInput): Promise<ConfigurationMutationResult>;
  retire(definition: ConfigurationSetDefinition, input: RetireConfigurationInput): Promise<ConfigurationMutationResult>;
  discardDraft(definition: ConfigurationSetDefinition, input: DiscardConfigurationDraftInput): Promise<ConfigurationMutationResult>;
}

const STABLE_CODE = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/;
const HASH = /^[a-f0-9]{64}$/;

function fail(code: string, message: string, statusCode = 422): never {
  throw new ApplicationError(code, message, statusCode);
}

function version(value: string, field: string): string {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail("CONFIGURATION_VERSION_INVALID", `${field}은 0 이상의 정수 문자열이어야 합니다.`);
  return value;
}

function actor(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) fail("CONFIGURATION_ACTOR_INVALID", "actorId가 올바르지 않습니다.");
  return value;
}

function idempotency(value: string): string {
  if (value.trim() === "") fail("CONFIGURATION_IDEMPOTENCY_REQUIRED", "Idempotency-Key가 필요합니다.");
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function reason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 5 || normalized.length > 500 || /[\u0000-\u001f]/.test(normalized)) {
    fail("CONFIGURATION_REASON_INVALID", "변경 사유는 제어문자 없이 5~500자로 입력해주세요.");
  }
  return normalized;
}

function decimal(value: unknown, field: string): string {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    fail("CONFIGURATION_VALUE_INVALID", `${field} 값은 십진 문자열이어야 합니다.`);
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (whole.length + fraction.length > 30 || fraction.length > 3) {
    fail("CONFIGURATION_VALUE_PRECISION", `${field} 값은 DECIMAL(30,3) 범위여야 합니다.`);
  }
  const trimmed = fraction.replace(/0+$/, "");
  const normalized = trimmed === "" ? whole! : `${whole}.${trimmed}`;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

function integer(value: unknown, field: string): string {
  const normalized = decimal(value, field);
  if (normalized.includes(".")) fail("CONFIGURATION_VALUE_INTEGER", `${field} 값은 정수여야 합니다.`);
  const parsed = BigInt(normalized);
  if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) {
    fail("CONFIGURATION_VALUE_INTEGER_RANGE", `${field} 값은 BIGINT 범위여야 합니다.`);
  }
  return normalized;
}

function scaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const result = BigInt(whole!) * (10n ** BigInt(scale)) + BigInt(fraction.padEnd(scale, "0"));
  return negative ? -result : result;
}

function compare(left: string, right: string): number {
  const scale = Math.max(left.split(".")[1]?.length ?? 0, right.split(".")[1]?.length ?? 0);
  const difference = scaled(left, scale) - scaled(right, scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function validateNumeric(value: string, rule: ConfigurationValueValidation, key: string): void {
  if (rule.min !== undefined && compare(value, decimal(rule.min, `${key}.min`)) < 0) fail("CONFIGURATION_VALUE_MIN", `${key} 최솟값을 확인해주세요.`);
  if (rule.max !== undefined && compare(value, decimal(rule.max, `${key}.max`)) > 0) fail("CONFIGURATION_VALUE_MAX", `${key} 최댓값을 확인해주세요.`);
  if (rule.step !== undefined) {
    const min = decimal(rule.min ?? "0", `${key}.min`);
    const step = decimal(rule.step, `${key}.step`);
    const scale = Math.max(value.split(".")[1]?.length ?? 0, min.split(".")[1]?.length ?? 0, step.split(".")[1]?.length ?? 0);
    const unit = scaled(step, scale);
    if (unit <= 0n || (scaled(value, scale) - scaled(min, scale)) % unit !== 0n) fail("CONFIGURATION_VALUE_STEP", `${key} 변경 단위를 확인해주세요.`);
  }
}

function stableJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("CONFIGURATION_VALUE_JSON", "JSON 숫자는 유한해야 합니다.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") fail("CONFIGURATION_VALUE_JSON", "JSON 값이 올바르지 않습니다.");
  if (ancestors.has(value)) fail("CONFIGURATION_VALUE_JSON", "JSON 값에 순환 참조를 사용할 수 없습니다.");
  ancestors.add(value);
  if (Array.isArray(value)) {
    const serialized = `[${value.map((entry) => stableJson(entry, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("CONFIGURATION_VALUE_JSON", "JSON 객체 형식이 올바르지 않습니다.");
  const record = value as Record<string, unknown>;
  const serialized = `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key], ancestors)}`).join(",")}}`;
  ancestors.delete(value);
  return serialized;
}

function normalizeValue(definition: ConfigurationKeyDefinition, input: ConfigurationValueInput): NormalizedConfigurationValue {
  let value: NormalizedConfigurationValue["value"];
  const validation = definition.validation ?? {};
  if (definition.type === "string") {
    if (typeof input.value !== "string" || input.value.includes("\0")) fail("CONFIGURATION_VALUE_INVALID", `${definition.key} 문자열 값이 올바르지 않습니다.`);
    if (validation.minLength !== undefined && input.value.length < validation.minLength) fail("CONFIGURATION_VALUE_MIN_LENGTH", `${definition.key} 최소 길이를 확인해주세요.`);
    if (validation.maxLength !== undefined && input.value.length > validation.maxLength) fail("CONFIGURATION_VALUE_MAX_LENGTH", `${definition.key} 최대 길이를 확인해주세요.`);
    if (validation.enum !== undefined && !validation.enum.includes(input.value)) fail("CONFIGURATION_VALUE_ENUM", `${definition.key} 허용값을 확인해주세요.`);
    value = input.value;
  } else if (definition.type === "integer") {
    const normalized = integer(input.value, definition.key);
    validateNumeric(normalized, validation, definition.key);
    value = normalized;
  } else if (definition.type === "decimal") {
    const normalized = decimal(input.value, definition.key);
    validateNumeric(normalized, validation, definition.key);
    value = normalized;
  } else if (definition.type === "boolean") {
    if (typeof input.value !== "boolean") fail("CONFIGURATION_VALUE_BOOLEAN", `${definition.key} 값은 boolean이어야 합니다.`);
    value = input.value;
  } else {
    stableJson(input.value);
    value = input.value as NormalizedConfigurationValue["value"];
  }
  return { key: definition.key, type: definition.type, value, validation, source: definition.source };
}

// 설정 정의와 source binding을 중복 없이 검증합니다.
export function validateConfigurationDefinition(definition: ConfigurationSetDefinition): ConfigurationSetDefinition {
  if (!STABLE_CODE.test(definition.setCode) || definition.setCode.length > 128) fail("CONFIGURATION_SET_CODE_INVALID", "setCode 형식이 올바르지 않습니다.");
  if (definition.label.trim() === "" || definition.label.length > 191) fail("CONFIGURATION_SET_LABEL_INVALID", "설정 이름이 올바르지 않습니다.");
  if (definition.keys.length === 0 || definition.keys.length > 5_000) fail("CONFIGURATION_KEYS_INVALID", "설정 key 수가 올바르지 않습니다.");
  const seen = new Set<string>();
  for (const key of definition.keys) {
    if (!STABLE_CODE.test(key.key) || key.key.length > 191 || seen.has(key.key)) fail("CONFIGURATION_KEY_INVALID", `설정 key가 올바르지 않습니다: ${key.key}`);
    seen.add(key.key);
    if (!CONFIGURATION_VALUE_TYPES.includes(key.type)) fail("CONFIGURATION_TYPE_INVALID", `${key.key} value type이 올바르지 않습니다.`);
    if (key.label.trim() === "" || key.label.length > 191) fail("CONFIGURATION_KEY_LABEL_INVALID", `${key.key} 표시명이 올바르지 않습니다.`);
    if (key.source.file.trim() === "" || key.source.path.trim() === "" || !HASH.test(key.source.hash)) fail("CONFIGURATION_SOURCE_INVALID", `${key.key} source binding이 올바르지 않습니다.`);
  }
  return definition;
}

// 허용된 설정 key만 typed 값으로 정규화합니다.
export function normalizeConfigurationChanges(definition: ConfigurationSetDefinition, changes: readonly ConfigurationValueInput[]): readonly NormalizedConfigurationValue[] {
  validateConfigurationDefinition(definition);
  if (changes.length === 0 || changes.length > 5_000) fail("CONFIGURATION_CHANGES_INVALID", "변경 항목 수가 올바르지 않습니다.");
  const definitions = new Map(definition.keys.map((entry) => [entry.key, entry]));
  const seen = new Set<string>();
  return changes.map((change) => {
    if (seen.has(change.key)) fail("CONFIGURATION_CHANGE_DUPLICATE", `중복 변경 key입니다: ${change.key}`);
    seen.add(change.key);
    const key = definitions.get(change.key);
    if (key === undefined || !key.editable) fail("CONFIGURATION_KEY_NOT_EDITABLE", `변경할 수 없는 key입니다: ${change.key}`);
    return normalizeValue(key, change);
  }).sort((left, right) => left.key.localeCompare(right.key));
}

// snapshot의 required key, type, value와 source binding을 정의에 맞게 검증합니다.
export function validateConfigurationSnapshot(definition: ConfigurationSetDefinition, values: readonly NormalizedConfigurationValue[]): void {
  validateConfigurationDefinition(definition);
  const byKey = new Map<string, NormalizedConfigurationValue>();
  for (const value of values) {
    if (byKey.has(value.key)) fail("CONFIGURATION_SNAPSHOT_DUPLICATE", `snapshot 중복 key입니다: ${value.key}`, 409);
    const key = definition.keys.find((entry) => entry.key === value.key);
    if (key === undefined || key.type !== value.type) fail("CONFIGURATION_SNAPSHOT_SHAPE", `snapshot key/type이 정의와 다릅니다: ${value.key}`, 409);
    const normalized = normalizeValue(key, { key: value.key, value: value.value });
    if (stableJson(normalized.value) !== stableJson(value.value)) fail("CONFIGURATION_SNAPSHOT_VALUE", `snapshot 값이 정규형이 아닙니다: ${value.key}`, 409);
    if (stableJson(value.validation) !== stableJson(key.validation ?? {}) || stableJson(value.source) !== stableJson(key.source)) {
      fail("CONFIGURATION_SNAPSHOT_BINDING", `snapshot 검증/source binding이 정의와 다릅니다: ${value.key}`, 409);
    }
    byKey.set(value.key, value);
  }
  for (const key of definition.keys) if (key.required && !byKey.has(key.key)) fail("CONFIGURATION_REQUIRED_MISSING", `필수 설정이 없습니다: ${key.key}`, 409);
}

// 정렬된 typed snapshot의 content hash를 계산합니다.
export function configurationContentHash(values: readonly NormalizedConfigurationValue[]): string {
  const payload = values.slice().sort((left, right) => left.key.localeCompare(right.key)).map((entry) => ({
    key: entry.key, type: entry.type, value: entry.value, validation: entry.validation, source: entry.source,
  }));
  return createHash("sha256").update(stableJson(payload), "utf8").digest("hex");
}

export class ConfigurationCatalogRegistry {
  private readonly definitions = new Map<string, ConfigurationSetDefinition>();

  public constructor(definitions: readonly ConfigurationSetDefinition[]) {
    for (const definition of definitions) {
      validateConfigurationDefinition(definition);
      if (this.definitions.has(definition.setCode)) fail("CONFIGURATION_SET_DUPLICATE", `중복 setCode입니다: ${definition.setCode}`);
      const keys = definition.keys.map((key) => Object.freeze({
        ...key,
        ...(key.validation === undefined ? {} : { validation: Object.freeze({
          ...key.validation,
          ...(key.validation.enum === undefined ? {} : { enum: Object.freeze([...key.validation.enum]) }),
        }) }),
        source: Object.freeze({ ...key.source }),
      }));
      this.definitions.set(definition.setCode, Object.freeze({ ...definition, keys: Object.freeze(keys) }));
    }
  }

  public list(): readonly ConfigurationSetDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.setCode.localeCompare(right.setCode));
  }

  public require(setCode: string): ConfigurationSetDefinition {
    const definition = this.definitions.get(setCode);
    if (definition === undefined) fail("CONFIGURATION_SET_NOT_MANAGED", `관리 대상으로 등록되지 않은 설정입니다: ${setCode}`, 404);
    return definition;
  }
}

export class ConfigurationCatalogProvider {
  public constructor(private readonly registry: ConfigurationCatalogRegistry, private readonly repository: ConfigurationCatalogRepository) {}

  public async readCurrent(setCode: string): Promise<ConfigurationSnapshot | null> {
    return this.repository.readCurrent(this.registry.require(setCode));
  }

  public listManagedSets(): readonly ConfigurationSetDefinition[] {
    return this.registry.list();
  }

  public async readVersion(setCode: string, targetVersion: string): Promise<ConfigurationSnapshot | null> {
    return this.repository.readVersion(this.registry.require(setCode), version(targetVersion, "version"));
  }

  public async createDraft(input: CreateConfigurationDraftInput): Promise<ConfigurationMutationResult> {
    const definition = this.registry.require(input.setCode);
    const normalized = normalizeConfigurationChanges(definition, input.changes);
    return this.repository.createDraft(definition, {
      ...input, actorId: actor(input.actorId), idempotencyKey: idempotency(input.idempotencyKey), reason: reason(input.reason),
      expectedActiveVersion: version(input.expectedActiveVersion, "expectedActiveVersion"),
      baseVersion: input.baseVersion === undefined ? undefined : version(input.baseVersion, "baseVersion"),
    }, normalized);
  }

  public async publish(input: PublishConfigurationDraftInput): Promise<ConfigurationMutationResult> {
    return this.repository.publish(this.registry.require(input.setCode), {
      ...input, actorId: actor(input.actorId), idempotencyKey: idempotency(input.idempotencyKey), reason: reason(input.reason),
      expectedActiveVersion: version(input.expectedActiveVersion, "expectedActiveVersion"), draftVersion: version(input.draftVersion, "draftVersion"),
    });
  }

  public async rollback(input: RollbackConfigurationInput): Promise<ConfigurationMutationResult> {
    return this.repository.rollback(this.registry.require(input.setCode), {
      ...input, actorId: actor(input.actorId), idempotencyKey: idempotency(input.idempotencyKey), reason: reason(input.reason),
      expectedActiveVersion: version(input.expectedActiveVersion, "expectedActiveVersion"), targetVersion: version(input.targetVersion, "targetVersion"),
    });
  }

  public async retire(input: RetireConfigurationInput): Promise<ConfigurationMutationResult> {
    return this.repository.retire(this.registry.require(input.setCode), {
      ...input, actorId: actor(input.actorId), idempotencyKey: idempotency(input.idempotencyKey), reason: reason(input.reason),
      expectedActiveVersion: version(input.expectedActiveVersion, "expectedActiveVersion"),
    });
  }

  public async discardDraft(input: DiscardConfigurationDraftInput): Promise<ConfigurationMutationResult> {
    return this.repository.discardDraft(this.registry.require(input.setCode), {
      ...input, actorId: actor(input.actorId), idempotencyKey: idempotency(input.idempotencyKey), reason: reason(input.reason),
      draftVersion: version(input.draftVersion, "draftVersion"),
    });
  }
}
