import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/application-error.js";
import {
  ConfigurationCatalogProvider,
  type ConfigurationMutationResult,
  type ConfigurationSetDefinition,
  type ConfigurationSnapshot,
} from "../configuration/configuration-catalog.js";

export const PET_SKILL_CATALOG_SET_CODE = "asset.pet_skill.catalog";
export const PET_SKILL_CATALOG_VERSION = "ASSET-FREEZE-v2.435-8f075b4e-02";

const PET_SKILL_SOURCE_HASH = "435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176";
const PET_SKILL_COMPATIBILITY_HASH = "511611a83b964de78e76a9f454e6dbb22a55b5c2d2c42629485b520cca3e3398";
const PET_SKILL_DRAW_HASH = "87e4cb357b2d14ae9f2dbd5a756ff3bc0869ccbca744a2746482d6f31a2fb2a2";
const PET_SKILL_FREEZE_HASH = "07d3658624168a11e14d0616f648dd4c039fc7d0991c5be9eef997d2482b0288";
const STABLE_CODE = /^[A-Za-z][A-Za-z0-9_]*(?:[.-][A-Za-z0-9_]+)*$/;
const SOURCE_KEY = /^skill_\d{3,}$/;
const HASH = /^[a-f0-9]{64}$/;

export interface PetSkillCatalogDefinition extends Record<string, unknown> {
  code: string;
  name: string;
  grade: string;
  rate?: number;
  sourceKey: string;
  sourceHash: string;
  effect: string;
  active: boolean;
}

export interface PetSkillCompatibilityGroup {
  code: string;
  displayOrder: number;
  active: boolean;
  members: readonly string[];
}

export interface PetSkillDrawPolicy {
  gradeWeightTotals: Readonly<Record<string, number>>;
}

export interface PetSkillCatalogInput {
  catalogVersion: string;
  definitions: readonly PetSkillCatalogDefinition[];
  compatibilityGroups: readonly PetSkillCompatibilityGroup[];
  drawPolicy: PetSkillDrawPolicy;
}

export interface PetSkillCatalogProjectionEntry extends PetSkillCatalogDefinition {
  drawWeight: number;
  actualRate: number;
  effectIdentity: string;
}

export interface PetSkillCatalogSnapshot {
  setCode: typeof PET_SKILL_CATALOG_SET_CODE;
  version: string;
  status: ConfigurationSnapshot["status"];
  catalogVersion: string;
  definitions: readonly PetSkillCatalogProjectionEntry[];
  compatibilityGroups: readonly PetSkillCompatibilityGroup[];
  drawPolicy: PetSkillDrawPolicy;
  contentHash: string;
}

interface MutationMetadata {
  actorId: string;
  idempotencyKey: string;
  reason: string;
}

export interface CreatePetSkillCatalogDraftInput extends MutationMetadata {
  expectedActiveVersion: string;
  baseVersion?: string;
  catalog: PetSkillCatalogInput;
}

export interface PublishPetSkillCatalogInput extends MutationMetadata {
  expectedActiveVersion: string;
  draftVersion: string;
}

export interface RollbackPetSkillCatalogInput extends MutationMetadata {
  expectedActiveVersion: string;
  targetVersion: string;
}

export interface RetirePetSkillCatalogInput extends MutationMetadata {
  expectedActiveVersion: string;
}

export interface DiscardPetSkillCatalogDraftInput extends MutationMetadata {
  draftVersion: string;
}

export const PET_SKILL_CATALOG_CONFIGURATION: ConfigurationSetDefinition = {
  setCode: PET_SKILL_CATALOG_SET_CODE,
  label: "펫스킬 정의·호환·효과·추첨 카탈로그",
  keys: [
    { key: "catalog_version", label: "동결 카탈로그 버전", type: "string", required: true, editable: true, validation: { minLength: 1, maxLength: 191 }, source: { file: "coverage-manifest.json", path: "$.catalogVersion", hash: PET_SKILL_FREEZE_HASH } },
    { key: "compatibility_groups", label: "중복 장착 제한 그룹", type: "json", required: true, editable: true, source: { file: "main.js", path: "PET_SKILL_COMPAT_GROUPS", hash: PET_SKILL_COMPATIBILITY_HASH } },
    { key: "definitions", label: "펫스킬 정의", type: "json", required: true, editable: true, source: { file: "main.js", path: "PET_SKILL_LIST", hash: PET_SKILL_SOURCE_HASH } },
    { key: "draw_policy", label: "펫스킬 추첨 정책", type: "json", required: true, editable: true, source: { file: "main.js", path: "PET_SKILL_EQUAL_GRADE_WEIGHT_TOTALS", hash: PET_SKILL_DRAW_HASH } },
  ],
};

function fail(code: string, message: string, statusCode = 422): never {
  throw new ApplicationError(code, message, statusCode);
}

function finite(value: unknown, field: string, minimum = 0, maximum = Number.POSITIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail("PET_SKILL_CATALOG_NUMBER_INVALID", `${field} 숫자 값이 올바르지 않습니다.`);
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const normalized = finite(value, field, minimum);
  if (!Number.isSafeInteger(normalized)) fail("PET_SKILL_CATALOG_INTEGER_INVALID", `${field} 정수 값이 올바르지 않습니다.`);
  return normalized;
}

function stableJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("PET_SKILL_CATALOG_JSON_INVALID", "카탈로그 JSON 숫자가 올바르지 않습니다.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") fail("PET_SKILL_CATALOG_JSON_INVALID", "카탈로그 JSON 값이 올바르지 않습니다.");
  if (ancestors.has(value)) fail("PET_SKILL_CATALOG_JSON_INVALID", "카탈로그 JSON에 순환 참조를 사용할 수 없습니다.");
  ancestors.add(value);
  if (Array.isArray(value)) {
    const serialized = `[${value.map((entry) => stableJson(entry, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("PET_SKILL_CATALOG_JSON_INVALID", "카탈로그 JSON 객체 형식이 올바르지 않습니다.");
  const record = value as Record<string, unknown>;
  const serialized = `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key], ancestors)}`).join(",")}}`;
  ancestors.delete(value);
  return serialized;
}

function clone<T>(value: T): T {
  return JSON.parse(stableJson(value)) as T;
}

function normalizeDefinition(input: PetSkillCatalogDefinition): PetSkillCatalogDefinition {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail("PET_SKILL_DEFINITION_INVALID", "펫스킬 정의 형식이 올바르지 않습니다.");
  if (!STABLE_CODE.test(input.code) || input.code.length > 128) fail("PET_SKILL_CODE_INVALID", `펫스킬 stable code가 올바르지 않습니다: ${input.code}`);
  if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 191) fail("PET_SKILL_NAME_INVALID", `펫스킬 이름이 올바르지 않습니다: ${input.code}`);
  if (typeof input.grade !== "string" || input.grade.trim() === "" || input.grade.length > 32) fail("PET_SKILL_GRADE_INVALID", `펫스킬 등급이 올바르지 않습니다: ${input.code}`);
  if (input.rate === undefined) {
    if (input.openable !== false) fail("PET_SKILL_RATE_REQUIRED", `오픈 가능한 펫스킬 확률이 없습니다: ${input.code}`);
  } else {
    finite(input.rate, `${input.code}.rate`, 0, 100);
  }
  if (!SOURCE_KEY.test(input.sourceKey)) fail("PET_SKILL_SOURCE_KEY_INVALID", `펫스킬 source key가 올바르지 않습니다: ${input.code}`);
  if (!HASH.test(input.sourceHash)) fail("PET_SKILL_SOURCE_HASH_INVALID", `펫스킬 source hash가 올바르지 않습니다: ${input.code}`);
  if (typeof input.effect !== "string" || input.effect.trim() === "" || input.effect.length > 10_000) fail("PET_SKILL_EFFECT_INVALID", `펫스킬 효과가 올바르지 않습니다: ${input.code}`);
  if (typeof input.active !== "boolean") fail("PET_SKILL_ACTIVE_INVALID", `펫스킬 활성 상태가 올바르지 않습니다: ${input.code}`);
  if (input.fixedRate !== undefined && typeof input.fixedRate !== "boolean") fail("PET_SKILL_FIXED_RATE_INVALID", `펫스킬 고정 확률이 올바르지 않습니다: ${input.code}`);
  if (input.openable !== undefined && typeof input.openable !== "boolean") fail("PET_SKILL_OPENABLE_INVALID", `펫스킬 오픈 허용값이 올바르지 않습니다: ${input.code}`);
  if (input.sourceIndex !== undefined) integer(input.sourceIndex, `${input.code}.sourceIndex`);
  return clone(input);
}

function normalizeDrawPolicy(input: PetSkillDrawPolicy): PetSkillDrawPolicy {
  if (input === null || typeof input !== "object" || Array.isArray(input) || input.gradeWeightTotals === null || typeof input.gradeWeightTotals !== "object" || Array.isArray(input.gradeWeightTotals)) {
    fail("PET_SKILL_DRAW_POLICY_INVALID", "펫스킬 추첨 정책 형식이 올바르지 않습니다.");
  }
  const totals: Record<string, number> = {};
  for (const grade of Object.keys(input.gradeWeightTotals).sort()) {
    if (!/^[A-Za-z0-9_가-힣]+$/.test(grade) || grade.length > 32) fail("PET_SKILL_DRAW_GRADE_INVALID", `추첨 등급이 올바르지 않습니다: ${grade}`);
    totals[grade] = finite(input.gradeWeightTotals[grade], `${grade}.gradeWeightTotal`, 0, 100);
  }
  if (Object.keys(totals).length === 0) fail("PET_SKILL_DRAW_POLICY_REQUIRED", "펫스킬 추첨 정책이 필요합니다.");
  return { gradeWeightTotals: totals };
}

function normalizeGroups(input: readonly PetSkillCompatibilityGroup[], definitions: readonly PetSkillCatalogDefinition[]): readonly PetSkillCompatibilityGroup[] {
  const definitionCodes = new Set(definitions.map((entry) => entry.code));
  const groupCodes = new Set<string>();
  const memberCodes = new Set<string>();
  const displayOrders = new Set<number>();
  return input.map((group) => {
    if (group === null || typeof group !== "object" || Array.isArray(group) || !Array.isArray(group.members)) fail("PET_SKILL_COMPAT_GROUP_INVALID", "호환 그룹 형식이 올바르지 않습니다.");
    if (!STABLE_CODE.test(group.code) || group.code.length > 64 || groupCodes.has(group.code)) fail("PET_SKILL_COMPAT_GROUP_INVALID", `호환 그룹 code가 올바르지 않습니다: ${group.code}`);
    groupCodes.add(group.code);
    const displayOrder = integer(group.displayOrder, `${group.code}.displayOrder`, 1);
    if (displayOrders.has(displayOrder)) fail("PET_SKILL_COMPAT_ORDER_DUPLICATE", `호환 그룹 순서가 중복됩니다: ${displayOrder}`);
    displayOrders.add(displayOrder);
    if (typeof group.active !== "boolean" || group.members.length < 2) fail("PET_SKILL_COMPAT_GROUP_INVALID", `호환 그룹 구성이 올바르지 않습니다: ${group.code}`);
    const members = group.members.map((code) => {
      if (!definitionCodes.has(code)) fail("PET_SKILL_COMPAT_MEMBER_UNKNOWN", `정의되지 않은 호환 멤버입니다: ${code}`);
      if (memberCodes.has(code)) fail("PET_SKILL_COMPAT_MEMBER_DUPLICATE", `여러 호환 그룹에 중복된 펫스킬입니다: ${code}`);
      memberCodes.add(code);
      return code;
    });
    return { code: group.code, displayOrder, active: group.active, members };
  }).sort((left, right) => left.displayOrder - right.displayOrder);
}

function withProjection(definitions: readonly PetSkillCatalogDefinition[], policy: PetSkillDrawPolicy): readonly PetSkillCatalogProjectionEntry[] {
  const gradeStats = new Map<string, { fixedTotal: number; flexibleCount: number }>();
  for (const definition of definitions) {
    if (definition.openable === false || definition.active === false) continue;
    const stats = gradeStats.get(definition.grade) ?? { fixedTotal: 0, flexibleCount: 0 };
    if (definition.fixedRate === true) stats.fixedTotal += definition.rate!;
    else stats.flexibleCount += 1;
    gradeStats.set(definition.grade, stats);
  }
  for (const grade of Object.keys(policy.gradeWeightTotals)) {
    const total = policy.gradeWeightTotals[grade]!;
    const stats = gradeStats.get(grade) ?? { fixedTotal: 0, flexibleCount: 0 };
    if (stats.fixedTotal > total + Number.EPSILON) fail("PET_SKILL_DRAW_FIXED_TOTAL_INVALID", `${grade} 등급 고정 확률 합이 등급 총량보다 큽니다.`, 409);
    if (stats.flexibleCount === 0 && Math.abs(total - stats.fixedTotal) > Number.EPSILON) fail("PET_SKILL_DRAW_WEIGHT_UNASSIGNED", `${grade} 등급 잔여 확률을 배분할 스킬이 없습니다.`, 409);
  }
  const weighted = definitions.map((definition) => {
    const total = policy.gradeWeightTotals[definition.grade];
    const stats = gradeStats.get(definition.grade) ?? { fixedTotal: 0, flexibleCount: 0 };
    let drawWeight = definition.rate ?? 0;
    if (definition.openable === false || definition.active === false) drawWeight = 0;
    else if (total !== undefined) drawWeight = definition.fixedRate === true ? definition.rate! : Math.max(0, total - stats.fixedTotal) / stats.flexibleCount;
    const effectIdentity = createHash("sha256").update(stableJson({ code: definition.code, effect: definition.effect }), "utf8").digest("hex");
    return { ...definition, drawWeight, actualRate: 0, effectIdentity };
  });
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.drawWeight, 0);
  if (!(totalWeight > 0)) fail("PET_SKILL_DRAW_TOTAL_INVALID", "펫스킬 전체 추첨 가중치가 0입니다.", 409);
  return weighted.map((entry) => ({ ...entry, actualRate: entry.drawWeight / totalWeight * 100 }));
}

export function normalizePetSkillCatalog(input: PetSkillCatalogInput): Omit<PetSkillCatalogSnapshot, "setCode" | "version" | "status" | "contentHash"> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail("PET_SKILL_CATALOG_INVALID", "펫스킬 카탈로그 형식이 올바르지 않습니다.");
  if (typeof input.catalogVersion !== "string" || input.catalogVersion.trim() === "" || input.catalogVersion.length > 191) fail("PET_SKILL_CATALOG_VERSION_INVALID", "카탈로그 버전이 올바르지 않습니다.");
  if (!Array.isArray(input.definitions) || input.definitions.length === 0 || input.definitions.length > 5_000) fail("PET_SKILL_DEFINITION_COUNT_INVALID", "펫스킬 정의 수가 올바르지 않습니다.");
  if (!Array.isArray(input.compatibilityGroups)) fail("PET_SKILL_COMPAT_GROUP_INVALID", "호환 그룹 형식이 올바르지 않습니다.");
  const definitions = input.definitions.map(normalizeDefinition);
  const codes = new Set<string>();
  const sourceKeys = new Set<string>();
  for (const definition of definitions) {
    if (codes.has(definition.code)) fail("PET_SKILL_CODE_DUPLICATE", `펫스킬 stable code가 중복됩니다: ${definition.code}`);
    if (sourceKeys.has(definition.sourceKey)) fail("PET_SKILL_SOURCE_KEY_DUPLICATE", `펫스킬 source key가 중복됩니다: ${definition.sourceKey}`);
    codes.add(definition.code);
    sourceKeys.add(definition.sourceKey);
  }
  definitions.sort((left, right) => {
    const leftIndex = typeof left.sourceIndex === "number" ? left.sourceIndex : Number.MAX_SAFE_INTEGER;
    const rightIndex = typeof right.sourceIndex === "number" ? right.sourceIndex : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.code.localeCompare(right.code);
  });
  const drawPolicy = normalizeDrawPolicy(input.drawPolicy);
  const compatibilityGroups = normalizeGroups(input.compatibilityGroups, definitions);
  return { catalogVersion: input.catalogVersion, definitions: withProjection(definitions, drawPolicy), compatibilityGroups, drawPolicy };
}

function value(snapshot: ConfigurationSnapshot, key: string): unknown {
  const found = snapshot.values.find((entry) => entry.key === key);
  if (found === undefined) fail("PET_SKILL_CATALOG_VALUE_MISSING", `펫스킬 카탈로그 값이 없습니다: ${key}`, 500);
  return found.value;
}

function parseSnapshot(snapshot: ConfigurationSnapshot): PetSkillCatalogSnapshot {
  const normalized = normalizePetSkillCatalog({
    catalogVersion: value(snapshot, "catalog_version") as string,
    definitions: value(snapshot, "definitions") as readonly PetSkillCatalogDefinition[],
    compatibilityGroups: value(snapshot, "compatibility_groups") as readonly PetSkillCompatibilityGroup[],
    drawPolicy: value(snapshot, "draw_policy") as PetSkillDrawPolicy,
  });
  return { setCode: PET_SKILL_CATALOG_SET_CODE, version: snapshot.version, status: snapshot.status, ...normalized, contentHash: snapshot.contentHash };
}

// 공용 ConfigurationCatalogProvider에 펫스킬 typed 검증과 projection을 연결합니다.
export class PetSkillCatalogCrudProvider {
  public constructor(private readonly configuration: ConfigurationCatalogProvider) {}

  public async readCurrent(): Promise<PetSkillCatalogSnapshot | null> {
    const snapshot = await this.configuration.readCurrent(PET_SKILL_CATALOG_SET_CODE);
    return snapshot === null ? null : parseSnapshot(snapshot);
  }

  public async readVersion(version: string): Promise<PetSkillCatalogSnapshot | null> {
    const snapshot = await this.configuration.readVersion(PET_SKILL_CATALOG_SET_CODE, version);
    return snapshot === null ? null : parseSnapshot(snapshot);
  }

  public async createDraft(input: CreatePetSkillCatalogDraftInput): Promise<ConfigurationMutationResult> {
    const normalized = normalizePetSkillCatalog(input.catalog);
    return this.configuration.createDraft({
      setCode: PET_SKILL_CATALOG_SET_CODE,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      expectedActiveVersion: input.expectedActiveVersion,
      ...(input.baseVersion === undefined ? {} : { baseVersion: input.baseVersion }),
      changes: [
        { key: "catalog_version", value: normalized.catalogVersion },
        { key: "compatibility_groups", value: normalized.compatibilityGroups },
        { key: "definitions", value: normalized.definitions.map(({ drawWeight: _drawWeight, actualRate: _actualRate, effectIdentity: _effectIdentity, ...definition }) => definition) },
        { key: "draw_policy", value: normalized.drawPolicy },
      ],
    });
  }

  public async publish(input: PublishPetSkillCatalogInput): Promise<ConfigurationMutationResult> {
    const draft = await this.readVersion(input.draftVersion);
    if (draft === null) fail("PET_SKILL_DRAFT_REQUIRED", "게시할 펫스킬 카탈로그 버전이 없습니다.", 409);
    return this.configuration.publish({ setCode: PET_SKILL_CATALOG_SET_CODE, ...input });
  }

  public async rollback(input: RollbackPetSkillCatalogInput): Promise<ConfigurationMutationResult> {
    const target = await this.readVersion(input.targetVersion);
    if (target === null) fail("PET_SKILL_ROLLBACK_TARGET_REQUIRED", "복구할 펫스킬 카탈로그 버전이 없습니다.", 409);
    return this.configuration.rollback({ setCode: PET_SKILL_CATALOG_SET_CODE, ...input });
  }

  public retire(input: RetirePetSkillCatalogInput): Promise<ConfigurationMutationResult> {
    return this.configuration.retire({ setCode: PET_SKILL_CATALOG_SET_CODE, ...input });
  }

  public discardDraft(input: DiscardPetSkillCatalogDraftInput): Promise<ConfigurationMutationResult> {
    return this.configuration.discardDraft({ setCode: PET_SKILL_CATALOG_SET_CODE, ...input });
  }
}

export function petSkillCatalogContentHash(input: PetSkillCatalogInput): string {
  const normalized = normalizePetSkillCatalog(input);
  return createHash("sha256").update(stableJson(normalized), "utf8").digest("hex");
}
