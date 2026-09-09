import type { ItemMutationContext, ItemProvider } from "./item-provider.js";
import type { PackageCatalogEntry, PackageCatalogSnapshot, PackageRewardEntry } from "./package-catalog.js";
import {
  coalesceRewardMutations,
  resolvePackageRewardPlan,
  type PackageRewardMutation,
  type PackageRewardRuleRepository
} from "./package-reward-rules.js";

export interface PackageCatalogRepository {
  getSnapshot(): Promise<PackageCatalogSnapshot>;
  findById(packageId: string): Promise<PackageCatalogEntry | undefined>;
  findByIdForUpdate?(packageId: string, transaction: PackageTransaction): Promise<PackageCatalogEntry | undefined>;
  findByLegacyCommand(command: string): Promise<PackageCatalogEntry | undefined>;
  listRewards(packageId: string): Promise<readonly PackageRewardEntry[]>;
}

export interface PackageTransaction { readonly id: string; readonly handle?: unknown; }
export interface PackageTransactionManager {
  run<T>(work: (transaction: PackageTransaction) => Promise<T>): Promise<T>;
}

export interface PackageUseRequest {
  requestKey: string;
  userId: string;
  packageId: string;
  openCount: number;
  guildId?: string;
  petInstanceId?: string;
  targetSelector?: string;
}

export interface PackageUseResult {
  packageId: string;
  openCount: number;
  rewardCount: number;
}

export interface PackageUseOperationRepository {
  findPackageUseResult?(request: PackageUseRequest, transaction: PackageTransaction): Promise<PackageUseResult | undefined>;
  beginPackageUse(
    request: PackageUseRequest,
    catalogVersion: string,
    transaction: PackageTransaction
  ): Promise<void | PackageUseResult>;
  completePackageUse(requestKey: string, result: PackageUseResult, transaction: PackageTransaction): Promise<void>;
}

// 요청키 기반 실행 기록을 지원하는 저장소인지 판별합니다.
function supportsUseOperations(repository: PackageCatalogRepository): repository is PackageCatalogRepository & PackageUseOperationRepository {
  const candidate = repository as Partial<PackageUseOperationRepository>;
  return typeof candidate.beginPackageUse === "function" && typeof candidate.completePackageUse === "function";
}

// 선택적 DB 규칙 저장소 구현 여부를 공개 API 변경 없이 판별합니다.
function supportsRewardRules(repository: PackageCatalogRepository): repository is PackageCatalogRepository & PackageRewardRuleRepository {
  const candidate = repository as Partial<PackageRewardRuleRepository>;
  return typeof candidate.listRewardRules === "function" && typeof candidate.listDynamicRewardItems === "function";
}

// 기존 고정 보상 행을 새 변경 실행 형식으로 변환합니다.
function legacyRewardMutations(
  rewards: readonly PackageRewardEntry[],
  openCount: number
): readonly PackageRewardMutation[] {
  return coalesceRewardMutations(rewards.map((reward) => ({
    operation: "ADD" as const,
    ownerScope: "USER" as const,
    itemId: reward.itemId,
    quantity: reward.quantity * BigInt(openCount),
    targetSelector: reward.targetSelector,
    metadataOverride: reward.metadataOverride
  })));
}

// DB 카탈로그 조회를 패키지 가방과 관리 API에 제공합니다.
export class RepositoryPackageCatalogProvider {
  constructor(private readonly repository: PackageCatalogRepository) {}
  getSnapshot(): Promise<PackageCatalogSnapshot> { return this.repository.getSnapshot(); }
  findById(id: string): Promise<PackageCatalogEntry | undefined> { return this.repository.findById(id); }
  findByLegacyCommand(command: string): Promise<PackageCatalogEntry | undefined> {
    return this.repository.findByLegacyCommand(command);
  }
}

// DB 연결 전에는 빈 카탈로그만 반환하며 패키지 실행을 열지 않습니다.
export class EmptyPackageCatalogRepository implements PackageCatalogRepository {
  async getSnapshot(): Promise<PackageCatalogSnapshot> { return { version: "UNCONFIGURED", packages: [] }; }
  async findById(): Promise<PackageCatalogEntry | undefined> { return undefined; }
  async findByLegacyCommand(): Promise<PackageCatalogEntry | undefined> { return undefined; }
  async listRewards(): Promise<readonly PackageRewardEntry[]> { return []; }
}

// 패키지 소비와 모든 보상 아이템 지급을 하나의 트랜잭션으로 조정합니다.
export class PackageProvider {
  constructor(
    private readonly repository: PackageCatalogRepository,
    private readonly items: ItemProvider,
    private readonly transactions: PackageTransactionManager
  ) {}

  async use(request: PackageUseRequest): Promise<PackageUseResult> {
    if (!Number.isSafeInteger(request.openCount) || request.openCount < 1) {
      throw new Error("PACKAGE_OPEN_COUNT_INVALID");
    }
    return this.transactions.run(async (transaction) => {
      const usesOperationLog = supportsUseOperations(this.repository);
      if (usesOperationLog && this.repository.findPackageUseResult) {
        const committed = await this.repository.findPackageUseResult(request, transaction);
        if (committed) return committed;
      }
      const packageEntry = this.repository.findByIdForUpdate
        ? await this.repository.findByIdForUpdate(request.packageId, transaction)
        : await this.repository.findById(request.packageId);
      if (!packageEntry || !packageEntry.enabled || packageEntry.definitionStatus !== "READY") {
        throw new Error("PACKAGE_NOT_AVAILABLE");
      }
      if (request.openCount > packageEntry.maxOpenCount) throw new Error("PACKAGE_OPEN_LIMIT_EXCEEDED");
      if (usesOperationLog) {
        const committed = await this.repository.beginPackageUse(request, packageEntry.catalogVersion, transaction);
        if (committed) return committed;
      }
      const context: ItemMutationContext = {
        ownerType: "USER",
        ownerId: request.userId,
        actorUserId: request.userId,
        transactionId: transaction.id,
        transactionHandle: transaction.handle,
        requestKey: request.requestKey
      };
      const usesRewardRules = supportsRewardRules(this.repository);
      const rewardPlan = usesRewardRules
        ? await resolvePackageRewardPlan(this.repository, packageEntry.id, request.openCount, transaction, {
            userId: request.userId,
            guildId: request.guildId,
            petInstanceId: request.petInstanceId ?? request.targetSelector
          })
        : { mutations: legacyRewardMutations(await this.repository.listRewards(packageEntry.id), request.openCount) };
      const consumeCount = rewardPlan.consumeCountOverride ?? request.openCount;
      const consumeQuantity = BigInt(consumeCount);
      const resolvedMutations = rewardPlan.mutations;
      const mutations = resolvedMutations.map((mutation) => ({
        ...mutation,
        targetSelector: mutation.targetSelector === "REQUESTED_PET"
          ? request.petInstanceId ?? request.targetSelector ?? null
          : mutation.targetSelector
      }));
      if (mutations.some((mutation) => mutation.targetSelector === null && mutation.operation === "REPLACE")) {
        throw new Error("PACKAGE_REWARD_TARGET_REQUIRED");
      }
      if (!usesRewardRules && mutations.length === 0) throw new Error("PACKAGE_REWARD_NOT_DEFINED");
      if (consumeQuantity > 0n) await this.items.checkRemove(packageEntry.consumeItemId, consumeQuantity, context);
      for (const mutation of mutations) {
        const mutationContext = this.mutationContext(request, context, mutation);
        if (mutation.operation === "REMOVE") {
          await this.items.checkRemove(mutation.itemId, mutation.quantity, mutationContext);
        } else {
          await this.items.checkAdd(mutation.itemId, mutation.quantity, mutationContext);
        }
      }
      if (consumeQuantity > 0n) await this.items.remove(packageEntry.consumeItemId, consumeQuantity, context);
      for (const mutation of mutations) {
        const mutationContext = this.mutationContext(request, context, mutation);
        if (mutation.operation === "REMOVE") {
          await this.items.remove(mutation.itemId, mutation.quantity, mutationContext);
        } else {
          await this.items.add(mutation.itemId, mutation.quantity, mutationContext);
        }
      }
      const result = { packageId: packageEntry.id, openCount: consumeCount, rewardCount: mutations.length };
      if (usesOperationLog) await this.repository.completePackageUse(request.requestKey, result, transaction);
      return result;
    });
  }

  // 보상 소유 범위를 검증된 DB 소유자 컨텍스트로 변환합니다.
  private mutationContext(
    request: PackageUseRequest,
    base: ItemMutationContext,
    mutation: PackageRewardMutation
  ): ItemMutationContext {
    if (mutation.operation === "REPLACE" && mutation.ownerScope !== "TARGET_PET") {
      throw new Error("PACKAGE_REPLACE_SCOPE_INVALID");
    }
    if (mutation.ownerScope === "GUILD") {
      if (!request.guildId) throw new Error("PACKAGE_GUILD_REQUIRED");
      return {
        ...base,
        ownerType: "GUILD",
        ownerId: request.guildId,
        operation: mutation.operation,
        targetSelector: mutation.targetSelector,
        metadataOverride: mutation.metadataOverride
      };
    }
    if (mutation.ownerScope === "TARGET_PET") {
      const petInstanceId = request.petInstanceId ?? request.targetSelector;
      if (!petInstanceId || mutation.targetSelector !== petInstanceId) {
        throw new Error("PACKAGE_REWARD_TARGET_REQUIRED");
      }
      return {
        ...base,
        ownerType: "PET",
        ownerId: petInstanceId,
        operation: mutation.operation,
        targetSelector: petInstanceId,
        metadataOverride: mutation.metadataOverride
      };
    }
    return {
      ...base,
      operation: mutation.operation,
      targetSelector: mutation.targetSelector,
      metadataOverride: mutation.metadataOverride
    };
  }
}
