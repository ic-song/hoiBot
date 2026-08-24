import type { ItemType } from "./item-provider.js";
import type { PackageTransaction } from "./package-provider.js";

export type PackageRewardRuleMode = "ALL" | "WEIGHTED_ONE" | "UNIFORM_RANGE" | "DYNAMIC_ITEM";
export type PackageRewardOperation = "ADD" | "REMOVE" | "REPLACE" | "NONE" | "BY_SIGN";
export type PackageRewardOwnerScope = "USER" | "GUILD" | "TARGET_PET";

export interface PackageRewardRule {
  ruleId: string;
  packageId: string;
  rewardOrder: number;
  groupCode: string;
  ruleMode: PackageRewardRuleMode;
  operation: PackageRewardOperation;
  ownerScope?: PackageRewardOwnerScope;
  itemId: string | null;
  quantity: bigint;
  weight: number | null;
  rangeMin: bigint | null;
  rangeMax: bigint | null;
  rangeStep: bigint | null;
  targetSelector: string | null;
  metadataOverride: Readonly<Record<string, unknown>> | null;
  selector: Readonly<Record<string, unknown>> | null;
}

export interface DynamicRewardItem {
  itemId: string;
  itemType: ItemType;
  metadata: Readonly<Record<string, unknown>>;
  gradeCode?: string | null;
  gradeWeight?: number | null;
  itemWeight?: number | null;
}

export interface PackageRewardBundleItem extends PackageRewardMutation {
  bundleItemId: string;
  parentRuleId: string;
  rewardOrder: number;
}

export interface PackageRewardMutation {
  operation: "ADD" | "REMOVE" | "REPLACE";
  ownerScope?: PackageRewardOwnerScope;
  itemId: string;
  quantity: bigint;
  targetSelector: string | null;
  metadataOverride: Readonly<Record<string, unknown>> | null;
}

export interface PackageRewardRuleRepository {
  listRewardRules(packageId: string, transaction: PackageTransaction): Promise<readonly PackageRewardRule[]>;
  listDynamicRewardItems(
    selector: Readonly<Record<string, unknown>>,
    transaction: PackageTransaction
  ): Promise<readonly DynamicRewardItem[]>;
  listRewardBundleItems?(
    parentRuleId: string,
    transaction: PackageTransaction
  ): Promise<readonly PackageRewardBundleItem[]>;
  getRemainingItemCapacity?(
    ownerType: "USER" | "GUILD" | "PET",
    ownerId: string,
    itemType: ItemType,
    transaction: PackageTransaction
  ): Promise<bigint>;
}

export interface PackageRewardResolutionContext {
  userId: string;
  guildId?: string;
  petInstanceId?: string;
}

export interface PackageRewardPlan {
  mutations: readonly PackageRewardMutation[];
  consumeCountOverride?: number;
}

type RandomSource = () => number;

// JSON 객체를 순서와 무관한 변경 병합 키로 변환합니다.
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "undefined" : encoded;
  }
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + stableJson(object[key])).join(",") + "}";
}

// 동일 아이템 변경을 합쳐 누적 제거량까지 소비 전에 검증할 수 있게 합니다.
export function coalesceRewardMutations(
  mutations: readonly PackageRewardMutation[]
): readonly PackageRewardMutation[] {
  const merged = new Map<string, PackageRewardMutation>();
  const replacements: PackageRewardMutation[] = [];
  for (const mutation of mutations) {
    if (mutation.quantity < 1n) throw new Error("PACKAGE_REWARD_QUANTITY_INVALID");
    if (mutation.operation === "REPLACE") {
      replacements.push(mutation);
      continue;
    }
    const key = [mutation.operation, mutation.ownerScope ?? "USER", mutation.itemId, mutation.targetSelector ?? "", stableJson(mutation.metadataOverride)].join("|");
    const current = merged.get(key);
    merged.set(key, current ? { ...current, quantity: current.quantity + mutation.quantity } : mutation);
  }
  return [...merged.values(), ...replacements];
}

// 닫힌 구간에서 step 단위 값을 균등 선택합니다.
function uniformRange(min: bigint, max: bigint, step: bigint, random: RandomSource): bigint {
  if (step < 1n || max < min || (max - min) % step !== 0n) throw new Error("PACKAGE_REWARD_RANGE_INVALID");
  const count = (max - min) / step + 1n;
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PACKAGE_REWARD_RANGE_TOO_LARGE");
  return min + BigInt(Math.floor(random() * Number(count))) * step;
}

// 선택된 규칙 한 건을 실행 가능한 아이템 변경으로 변환합니다.
function fixedMutation(rule: PackageRewardRule, quantity: bigint): PackageRewardMutation | null {
  if (rule.operation === "NONE") return null;
  if (!rule.itemId) throw new Error("PACKAGE_REWARD_ITEM_REQUIRED");
  let operation: PackageRewardMutation["operation"];
  let absoluteQuantity = quantity;
  if (rule.operation === "BY_SIGN") {
    if (quantity === 0n) return null;
    operation = quantity > 0n ? "ADD" : "REMOVE";
    absoluteQuantity = quantity > 0n ? quantity : -quantity;
  } else {
    operation = rule.operation;
  }
  if (absoluteQuantity < 1n) throw new Error("PACKAGE_REWARD_QUANTITY_INVALID");
  return {
    operation,
    ownerScope: rule.ownerScope ?? "USER",
    itemId: rule.itemId,
    quantity: absoluteQuantity,
    targetSelector: rule.targetSelector,
    metadataOverride: rule.metadataOverride
  };
}

// 가중치 그룹에서 무보상 행을 포함해 정확히 한 행을 선택합니다.
function chooseWeighted(rules: readonly PackageRewardRule[], random: RandomSource): PackageRewardRule {
  if (rules.length === 0) throw new Error("PACKAGE_REWARD_WEIGHT_GROUP_EMPTY");
  let total = 0;
  for (const rule of rules) {
    if (rule.weight === null || !Number.isFinite(rule.weight) || rule.weight <= 0) {
      throw new Error("PACKAGE_REWARD_WEIGHT_INVALID");
    }
    total += rule.weight;
  }
  let cursor = random() * total;
  for (const rule of rules) {
    cursor -= rule.weight as number;
    if (cursor < 0) return rule;
  }
  return rules[rules.length - 1]!;
}

// 숫자 가중치 목록에서 정확히 한 원소를 선택합니다.
function chooseWeightedValue<T>(values: readonly T[], weightOf: (value: T) => number, random: RandomSource): T {
  if (values.length === 0) throw new Error("PACKAGE_REWARD_WEIGHT_GROUP_EMPTY");
  let total = 0;
  for (const value of values) {
    const weight = weightOf(value);
    if (!Number.isFinite(weight) || weight <= 0) throw new Error("PACKAGE_REWARD_WEIGHT_INVALID");
    total += weight;
  }
  const sampled = random();
  if (!Number.isFinite(sampled) || sampled < 0 || sampled >= 1) throw new Error("PACKAGE_RANDOM_SOURCE_INVALID");
  let cursor = sampled * total;
  for (const value of values) {
    cursor -= weightOf(value);
    if (cursor < 0) return value;
  }
  return values[values.length - 1]!;
}

interface DynamicSelector {
  catalogCode: string | null;
  respectCapacity: boolean;
  consumeOnlyGranted: boolean;
}

// selector_json에서 허용된 동적 실행 옵션만 읽습니다.
function parseDynamicSelector(selector: Readonly<Record<string, unknown>>): DynamicSelector {
  const catalogCode = selector.catalogCode;
  if (catalogCode !== undefined && (typeof catalogCode !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(catalogCode))) {
    throw new Error("PACKAGE_DYNAMIC_CATALOG_CODE_INVALID");
  }
  for (const key of ["respectCapacity", "consumeOnlyGranted"] as const) {
    if (selector[key] !== undefined && typeof selector[key] !== "boolean") {
      throw new Error("PACKAGE_DYNAMIC_SELECTOR_OPTION_INVALID");
    }
  }
  return {
    catalogCode: typeof catalogCode === "string" ? catalogCode : null,
    respectCapacity: selector.respectCapacity === true,
    consumeOnlyGranted: selector.consumeOnlyGranted === true
  };
}

// 카탈로그 후보를 등급 가중치, 같은 등급의 개체 가중치 순서로 선택합니다.
function chooseDynamicCatalogItem(candidates: readonly DynamicRewardItem[], random: RandomSource): DynamicRewardItem {
  const gradeMap = new Map<string, { weight: number; items: DynamicRewardItem[] }>();
  for (const candidate of candidates) {
    if (!candidate.gradeCode || candidate.gradeWeight === null || candidate.gradeWeight === undefined || candidate.itemWeight === null || candidate.itemWeight === undefined) {
      throw new Error("PACKAGE_DYNAMIC_CATALOG_ENTRY_INVALID");
    }
    const current = gradeMap.get(candidate.gradeCode);
    if (current && current.weight !== candidate.gradeWeight) throw new Error("PACKAGE_DYNAMIC_GRADE_WEIGHT_CONFLICT");
    if (current) current.items.push(candidate);
    else gradeMap.set(candidate.gradeCode, { weight: candidate.gradeWeight, items: [candidate] });
  }
  const grade = chooseWeightedValue([...gradeMap.values()], (entry) => entry.weight, random);
  return chooseWeightedValue(grade.items, (entry) => entry.itemWeight as number, random);
}

// 용량 검사에 사용할 실제 소유자를 보상 범위에서 결정합니다.
function capacityOwner(rule: PackageRewardRule, context: PackageRewardResolutionContext): { type: "USER" | "GUILD" | "PET"; id: string } {
  const scope = rule.ownerScope ?? "USER";
  if (scope === "GUILD") {
    if (!context.guildId) throw new Error("PACKAGE_GUILD_REQUIRED");
    return { type: "GUILD", id: context.guildId };
  }
  if (scope === "TARGET_PET") {
    if (!context.petInstanceId) throw new Error("PACKAGE_REWARD_TARGET_REQUIRED");
    return { type: "PET", id: context.petInstanceId };
  }
  return { type: "USER", id: context.userId };
}

// DB 규칙을 보상 변경과 실제 소비 수량이 포함된 실행 계획으로 변환합니다.
export async function resolvePackageRewardPlan(
  repository: PackageRewardRuleRepository,
  packageId: string,
  openCount: number,
  transaction: PackageTransaction,
  context?: PackageRewardResolutionContext,
  random: RandomSource = Math.random
): Promise<PackageRewardPlan> {
  const rules = [...await repository.listRewardRules(packageId, transaction)].sort((a, b) => a.rewardOrder - b.rewardOrder);
  if (rules.length === 0) throw new Error("PACKAGE_REWARD_NOT_DEFINED");
  const mutations: PackageRewardMutation[] = [];
  const completedGroups = new Set<string>();
  const bundleCache = new Map<string, readonly PackageRewardBundleItem[]>();
  let consumeCountOverride: number | undefined;

  const appendBundle = async (rule: PackageRewardRule): Promise<void> => {
    if (!repository.listRewardBundleItems) return;
    let bundle = bundleCache.get(rule.ruleId);
    if (!bundle) {
      bundle = await repository.listRewardBundleItems(rule.ruleId, transaction);
      bundleCache.set(rule.ruleId, bundle);
    }
    for (const item of bundle) mutations.push(item);
  };

  for (const rule of rules) {
    if (rule.ruleMode === "WEIGHTED_ONE") {
      if (completedGroups.has(rule.groupCode)) continue;
      completedGroups.add(rule.groupCode);
      const group = rules.filter((candidate) => candidate.ruleMode === "WEIGHTED_ONE" && candidate.groupCode === rule.groupCode);
      for (let opened = 0; opened < openCount; opened++) {
        const selected = chooseWeighted(group, random);
        const mutation = fixedMutation(selected, selected.quantity);
        if (mutation) mutations.push(mutation);
        await appendBundle(selected);
      }
      continue;
    }
    if (rule.ruleMode === "ALL") {
      const mutation = fixedMutation(rule, rule.quantity * BigInt(openCount));
      if (mutation) mutations.push(mutation);
      continue;
    }
    if (rule.ruleMode === "UNIFORM_RANGE") {
      if (rule.rangeMin === null || rule.rangeMax === null || rule.rangeStep === null) {
        throw new Error("PACKAGE_REWARD_RANGE_REQUIRED");
      }
      for (let opened = 0; opened < openCount; opened++) {
        const mutation = fixedMutation(rule, uniformRange(rule.rangeMin, rule.rangeMax, rule.rangeStep, random));
        if (mutation) mutations.push(mutation);
      }
      continue;
    }
    if (rule.ruleMode === "DYNAMIC_ITEM") {
      if (!rule.selector || rule.operation === "NONE" || rule.operation === "BY_SIGN") {
        throw new Error("PACKAGE_DYNAMIC_REWARD_INVALID");
      }
      const selector = parseDynamicSelector(rule.selector);
      if (selector.consumeOnlyGranted && (rule.quantity !== 1n || rules.length !== 1 || consumeCountOverride !== undefined)) {
        throw new Error("PACKAGE_DYNAMIC_CONSUME_OVERRIDE_INVALID");
      }
      const candidates = await repository.listDynamicRewardItems(rule.selector, transaction);
      if (candidates.length === 0) throw new Error("PACKAGE_DYNAMIC_REWARD_EMPTY");
      const itemTypes = new Set(candidates.map((candidate) => candidate.itemType));
      if (itemTypes.size !== 1) throw new Error("PACKAGE_DYNAMIC_ITEM_TYPE_MIXED");
      let drawCount = rule.quantity * BigInt(openCount);
      if (drawCount > 10000n) throw new Error("PACKAGE_DYNAMIC_REWARD_TOO_LARGE");
      if (selector.respectCapacity) {
        if (!context || !repository.getRemainingItemCapacity) throw new Error("PACKAGE_DYNAMIC_CAPACITY_UNAVAILABLE");
        const owner = capacityOwner(rule, context);
        const remaining = await repository.getRemainingItemCapacity(owner.type, owner.id, candidates[0]!.itemType, transaction);
        if (remaining < drawCount) drawCount = remaining;
      }
      if (selector.consumeOnlyGranted) consumeCountOverride = Number(drawCount);
      for (let draw = 0n; draw < drawCount; draw++) {
        const selected = selector.catalogCode
          ? chooseDynamicCatalogItem(candidates, random)
          : candidates[Math.floor(random() * candidates.length)]!;
        mutations.push({
          operation: rule.operation,
          ownerScope: rule.ownerScope ?? "USER",
          itemId: selected.itemId,
          quantity: 1n,
          targetSelector: rule.targetSelector,
          metadataOverride: rule.metadataOverride
        });
      }
      continue;
    }
    throw new Error("PACKAGE_REWARD_RULE_MODE_INVALID");
  }
  return { mutations: coalesceRewardMutations(mutations), consumeCountOverride };
}

// DB 규칙을 허용된 선택 방식만으로 해석하고 실제 보상 변경 목록을 만듭니다.
export async function resolvePackageRewardMutations(
  repository: PackageRewardRuleRepository,
  packageId: string,
  openCount: number,
  transaction: PackageTransaction,
  random: RandomSource = Math.random
): Promise<readonly PackageRewardMutation[]> {
  return (await resolvePackageRewardPlan(repository, packageId, openCount, transaction, undefined, random)).mutations;
}
