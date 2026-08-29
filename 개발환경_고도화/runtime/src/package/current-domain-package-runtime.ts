import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import {
  ItemProvider,
  type ItemDefinition,
  type ItemMutationContext,
  type ItemType,
  type ItemTypeHandler,
} from "./item-provider.js";
import {
  PackageProvider,
  type PackageCatalogRepository,
  type PackageTransaction,
  type PackageTransactionManager,
} from "./package-provider.js";
import type {
  PackageCatalogEntry,
  PackageDefinitionStatus,
  PackageRewardEntry,
} from "./package-catalog.js";
import type {
  DynamicRewardItem,
  PackageRewardBundleItem,
  PackageRewardRule,
  PackageRewardRuleRepository,
} from "./package-reward-rules.js";
import {
  PackageDomainItemMutationStore,
  type PackageDomainItemDefinition,
  type PackageDomainMutation,
  type PackageDomainTransaction,
  type PackageDomainSqlResult,
} from "./domain-item-provider.js";
import { PackageRewardTargetRegistry } from "./reward-target-registry.js";

interface CatalogRow {
  package_id: string;
  catalog_version: string;
  display_name: string;
  command_text: string | null;
  consume_item_id: string;
  definition_status: PackageDefinitionStatus;
  enabled: number;
  max_open_count: number;
}

interface RewardRow {
  package_id: string;
  reward_order: number;
  item_id: string;
  quantity: string;
  probability: string | null;
  target_selector: string | null;
  metadata_override_json: string | Record<string, unknown> | null;
}

interface DefinitionRow {
  item_id: string;
  item_type: ItemType;
  item_name: string;
  stackable: number;
  metadata_json: string | Record<string, unknown>;
  enabled: number;
}

interface RuleRow {
  rule_id: string;
  package_id: string;
  reward_order: number;
  group_code: string;
  rule_mode: PackageRewardRule["ruleMode"];
  operation: PackageRewardRule["operation"];
  owner_scope: PackageRewardRule["ownerScope"];
  item_id: string | null;
  quantity: string;
  weight: string | null;
  range_min: string | null;
  range_max: string | null;
  range_step: string | null;
  target_selector: string | null;
  metadata_override_json: string | Record<string, unknown> | null;
  selector_json: string | Record<string, unknown> | null;
}

interface BundleRow {
  bundle_item_id: string;
  parent_rule_id: string;
  reward_order: number;
  operation: PackageRewardBundleItem["operation"];
  owner_scope: PackageRewardBundleItem["ownerScope"];
  item_id: string;
  quantity: string;
  target_selector: string | null;
  metadata_override_json: string | Record<string, unknown> | null;
}

interface DynamicItemRow {
  item_id: string;
  item_type: ItemType;
  metadata_json: string | Record<string, unknown>;
  grade_code: string | null;
  grade_weight: string | null;
  item_weight: string | null;
}

interface DomainPackageTransaction extends PackageTransaction {
  databaseTransaction: DatabaseTransaction;
  operationId?: string;
  requestKey?: string;
  playerId?: string;
  sequenceNo: number;
}

interface CommittedUseRow {
  result_json: string | Record<string, unknown>;
}

interface OperationRow {
  operation_id: string;
}

class PackageReplay extends Error {
  public constructor(public readonly result: unknown) {
    super("PACKAGE_REQUEST_REPLAY");
  }
}

// 현재 DatabaseTransaction을 패키지 도메인 Provider의 SQL 계약으로 변환
class DomainTransactionAdapter implements PackageDomainTransaction {
  public constructor(private readonly transaction: DatabaseTransaction) {}

  public query<T>(sql: string, parameters: readonly unknown[] = []): Promise<T[]> {
    return this.transaction.query<T[]>(sql, parameters);
  }

  public async execute(sql: string, parameters: readonly unknown[] = []): Promise<PackageDomainSqlResult> {
    const result = await this.transaction.execute(sql, parameters);
    return { affectedRows: result.affectedRows, insertId: result.insertId };
  }
}

// 패키지 카탈로그와 동적 보상 규칙을 현재 MariaDB에서 조회
class CurrentPackageCatalogRepository implements PackageCatalogRepository, PackageRewardRuleRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async getSnapshot(): Promise<{ version: string; packages: PackageCatalogEntry[] }> {
    const rows = await this.database.query<CatalogRow[]>(this.catalogSql(""));
    return {
      version: rows[0]?.catalog_version ?? "unversioned",
      packages: rows.map((row) => this.toCatalog(row)),
    };
  }

  public async findByLegacyCommand(command: string): Promise<PackageCatalogEntry | undefined> {
    const rows = await this.database.query<CatalogRow[]>(
      this.catalogSql("WHERE package_command_aliases.command_text = ? AND package_command_aliases.active = 1"),
      [command],
    );
    return rows[0] === undefined ? undefined : this.toCatalog(rows[0]);
  }

  public async findById(id: string): Promise<PackageCatalogEntry | undefined> {
    const rows = await this.database.query<CatalogRow[]>(this.catalogSql("WHERE package_catalog.package_id = ?"), [id]);
    return rows[0] === undefined ? undefined : this.toCatalog(rows[0]);
  }

  public async listRewards(packageId: string): Promise<PackageRewardEntry[]> {
    const rows = await this.database.query<RewardRow[]>(
      `SELECT package_id,reward_order,item_id,quantity,probability,target_selector,metadata_override_json
       FROM package_rewards WHERE package_id = ? AND enabled = 1 ORDER BY reward_order`,
      [packageId],
    );
    return rows.map((row) => ({
      packageId: row.package_id,
      rewardOrder: row.reward_order,
      itemId: row.item_id,
      quantity: BigInt(row.quantity),
      probability: row.probability === null ? null : Number(row.probability),
      targetSelector: row.target_selector,
      metadataOverride: this.jsonObject(row.metadata_override_json),
    }));
  }

  public async listRewardRules(packageId: string): Promise<PackageRewardRule[]> {
    const rows = await this.database.query<RuleRow[]>(
      `SELECT rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,
              quantity,weight,range_min,range_max,range_step,target_selector,metadata_override_json,selector_json
       FROM package_reward_rules WHERE package_id = ? AND enabled = 1 ORDER BY reward_order,rule_id`,
      [packageId],
    );
    return rows.map((row) => ({
      ruleId: row.rule_id,
      packageId: row.package_id,
      rewardOrder: row.reward_order,
      groupCode: row.group_code,
      ruleMode: row.rule_mode,
      operation: row.operation,
      ownerScope: row.owner_scope,
      itemId: row.item_id,
      quantity: BigInt(row.quantity),
      weight: row.weight === null ? null : Number(row.weight),
      rangeMin: row.range_min === null ? null : BigInt(row.range_min),
      rangeMax: row.range_max === null ? null : BigInt(row.range_max),
      rangeStep: row.range_step === null ? null : BigInt(row.range_step),
      targetSelector: row.target_selector,
      metadataOverride: this.jsonObject(row.metadata_override_json),
      selector: this.jsonObject(row.selector_json),
    }));
  }

  public async listRewardBundleItems(parentRuleId: string): Promise<PackageRewardBundleItem[]> {
    const rows = await this.database.query<BundleRow[]>(
      `SELECT bundle_item_id,parent_rule_id,reward_order,operation,owner_scope,item_id,quantity,
              target_selector,metadata_override_json
       FROM package_reward_bundle_items WHERE parent_rule_id = ? AND enabled = 1 ORDER BY reward_order,bundle_item_id`,
      [parentRuleId],
    );
    return rows.map((row) => ({
      bundleItemId: row.bundle_item_id,
      parentRuleId: row.parent_rule_id,
      rewardOrder: row.reward_order,
      operation: row.operation,
      ownerScope: row.owner_scope,
      itemId: row.item_id,
      quantity: BigInt(row.quantity),
      targetSelector: row.target_selector,
      metadataOverride: this.jsonObject(row.metadata_override_json),
    }));
  }

  public async listDynamicRewardItems(selector: Record<string, unknown>): Promise<DynamicRewardItem[]> {
    const catalogCode = typeof selector.catalogCode === "string" ? selector.catalogCode : null;
    const itemType = typeof selector.itemType === "string" ? selector.itemType : null;
    const rows = await this.database.query<DynamicItemRow[]>(
      `SELECT entry.item_id,definition_row.item_type,definition_row.metadata_json,
              entry.grade_code,entry.grade_weight,entry.item_weight
       FROM dynamic_item_catalog_entries entry
       JOIN package_item_definitions definition_row ON definition_row.item_id = entry.item_id
       WHERE entry.enabled = 1 AND definition_row.enabled = 1
         AND (? IS NULL OR entry.catalog_code = ?)
         AND (? IS NULL OR definition_row.item_type = ?)
       ORDER BY entry.catalog_code,entry.grade_code,entry.item_id`,
      [catalogCode, catalogCode, itemType, itemType],
    );
    return rows.map((row) => ({
      itemId: row.item_id,
      itemType: row.item_type,
      metadata: this.jsonObject(row.metadata_json) ?? {},
      gradeCode: row.grade_code,
      gradeWeight: row.grade_weight === null ? undefined : Number(row.grade_weight),
      itemWeight: row.item_weight === null ? undefined : Number(row.item_weight),
    }));
  }

  public async getRemainingItemCapacity(ownerType: string, ownerId: string, itemType: string): Promise<bigint> {
    if (ownerType !== "USER" || itemType !== "MINI_PET") return 9_223_372_036_854_775_807n;
    const rows = await this.database.query<Array<{ remaining: string }>>(
      `SELECT GREATEST(capacity.capacity - COUNT(owned_mini_pets.id), 0) AS remaining
       FROM owner_item_capacities capacity
       LEFT JOIN owned_mini_pets ON owned_mini_pets.player_id = ?
       WHERE capacity.owner_type = 'USER' AND capacity.owner_id = ? AND capacity.item_type = 'MINI_PET'
       GROUP BY capacity.capacity`,
      [ownerId, ownerId],
    );
    return BigInt(rows[0]?.remaining ?? "9223372036854775807");
  }

  private catalogSql(where: string): string {
    return `SELECT package_catalog.package_id,package_catalog.catalog_version,package_catalog.display_name,
                   package_command_aliases.command_text,package_catalog.consume_item_id,
                   package_catalog.definition_status,package_catalog.enabled,package_catalog.max_open_count
            FROM package_catalog
            LEFT JOIN package_command_aliases ON package_command_aliases.package_id = package_catalog.package_id
              AND package_command_aliases.active = 1
            ${where}
            ORDER BY package_catalog.package_id`;
  }

  private toCatalog(row: CatalogRow): PackageCatalogEntry {
    return {
      id: row.package_id,
      catalogVersion: row.catalog_version,
      displayName: row.display_name,
      legacyCommand: row.command_text ?? "",
      consumeItemId: row.consume_item_id,
      definitionStatus: row.definition_status,
      enabled: row.enabled === 1,
      maxOpenCount: row.max_open_count,
    };
  }

  private jsonObject(value: string | Record<string, unknown> | null): Record<string, unknown> | null {
    if (value === null) return null;
    return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
  }
}

// 패키지 item 정의를 현재 도메인 Provider 형식으로 변환하는 Repository
class CurrentPackageItemDefinitionRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async findById(id: string): Promise<ItemDefinition | undefined> {
    const rows = await this.database.query<DefinitionRow[]>(
      `SELECT item_id,item_type,item_name,stackable,metadata_json,enabled
       FROM package_item_definitions WHERE item_id = ?`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.item_id,
      type: row.item_type,
      name: row.item_name,
      stackable: row.stackable === 1,
      metadata: typeof row.metadata_json === "string"
        ? JSON.parse(row.metadata_json) as Record<string, unknown>
        : row.metadata_json,
      enabled: row.enabled === 1,
    };
  }
}

// PackageProvider 트랜잭션을 현재 operations와 package_domain_uses에 결합
class CurrentPackageTransactionManager implements PackageTransactionManager {
  public constructor(private readonly database: DatabaseClient) {}

  public run<T>(work: (transaction: PackageTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (databaseTransaction) => {
      const transaction: DomainPackageTransaction = {
        id: randomUUID(),
        databaseTransaction,
        sequenceNo: 0,
      };
      Object.defineProperty(transaction, "handle", { value: transaction, enumerable: true });
      try {
        const result = await work(transaction);
        if (transaction.operationId !== undefined && transaction.requestKey !== undefined) {
          const packageResult = result as { packageId?: string; openCount?: number; rewardCount?: number };
          await databaseTransaction.execute(
            `UPDATE package_domain_uses
             SET committed_open_count = ?, reward_count = ?, status = 'COMMITTED', result_json = ?, completed_at = UTC_TIMESTAMP(3)
             WHERE request_key = ?`,
            [packageResult.openCount ?? null, packageResult.rewardCount ?? null, JSON.stringify(result), transaction.requestKey],
          );
          await databaseTransaction.execute(
            "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
            [JSON.stringify(result), transaction.operationId],
          );
        }
        return result;
      } catch (error) {
        if (error instanceof PackageReplay) return error.result as T;
        throw error;
      }
    });
  }
}

// PackageProvider의 ItemTypeHandler를 실제 도메인 테이블 변경으로 연결
class CurrentDomainItemTypeHandler implements ItemTypeHandler {
  public constructor(private readonly domainItems: PackageDomainItemMutationStore) {}

  public async checkAdd(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    this.assertQuantity(quantity);
    await this.prepareOperation(context);
    if (!definition.enabled) throw new Error("PACKAGE_ITEM_DISABLED");
  }

  public async checkRemove(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    this.assertQuantity(quantity);
    const state = await this.prepareOperation(context, definition, quantity);
    const hasItem = await this.domainItems.has(
      new DomainTransactionAdapter(state.databaseTransaction),
      this.definition(definition),
      this.mutation(context, quantity, state, false),
    );
    if (!hasItem) throw new Error("ITEM_BALANCE_INSUFFICIENT");
  }

  public async add(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const state = await this.prepareOperation(context);
    await this.domainItems.add(
      new DomainTransactionAdapter(state.databaseTransaction),
      this.definition(definition),
      this.mutation(context, quantity, state, true),
    );
  }

  public async remove(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const state = await this.prepareOperation(context);
    await this.domainItems.remove(
      new DomainTransactionAdapter(state.databaseTransaction),
      this.definition(definition),
      this.mutation(context, quantity, state, true),
    );
  }

  private async prepareOperation(
    context: ItemMutationContext,
    consumerDefinition?: ItemDefinition,
    requestedOpenCount?: bigint,
  ): Promise<DomainPackageTransaction> {
    const raw = context as ItemMutationContext & { transactionHandle?: DomainPackageTransaction };
    const state = raw.transactionHandle;
    if (state === undefined) throw new Error("PACKAGE_TRANSACTION_HANDLE_REQUIRED");
    const playerId = raw.actorUserId ?? raw.ownerId;
    if (state.operationId !== undefined) return state;

    const committed = await state.databaseTransaction.query<CommittedUseRow[]>(
      "SELECT result_json FROM package_domain_uses WHERE request_key = ? AND status = 'COMMITTED' FOR UPDATE",
      [raw.requestKey],
    );
    if (committed[0] !== undefined) {
      const result = typeof committed[0].result_json === "string"
        ? JSON.parse(committed[0].result_json) as unknown
        : committed[0].result_json;
      throw new PackageReplay(result);
    }

    const operation = await state.databaseTransaction.execute(
      `INSERT INTO operations
         (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
       SELECT ?, 'package.use', ?, 'player', players.id, 'iris', 'processing', UTC_TIMESTAMP(3)
       FROM players WHERE players.id = ?`,
      [state.id, raw.requestKey, playerId],
    );
    if (operation.affectedRows !== 1n) throw new Error("PACKAGE_PLAYER_NOT_FOUND");
    state.operationId = operation.insertId.toString();
    state.requestKey = raw.requestKey;
    state.playerId = playerId;
    if (consumerDefinition === undefined || requestedOpenCount === undefined) {
      throw new Error("PACKAGE_CONSUMER_CONTEXT_REQUIRED");
    }
    const packageUse = await state.databaseTransaction.execute(
      `INSERT INTO package_domain_uses
         (request_key,operation_id,player_id,package_id,requested_open_count,status)
       SELECT ?, ?, ?, package_id, ?, 'PROCESSING'
       FROM package_catalog
       WHERE consume_item_id = ? AND definition_status = 'READY' AND enabled = 1`,
      [raw.requestKey, state.operationId, playerId, requestedOpenCount.toString(), consumerDefinition.id],
    );
    if (packageUse.affectedRows !== 1n) throw new Error("PACKAGE_READY_CATALOG_NOT_FOUND");
    return state;
  }

  private definition(definition: ItemDefinition): PackageDomainItemDefinition {
    return { id: definition.id, type: definition.type, displayName: definition.name, metadata: definition.metadata };
  }

  private mutation(
    context: ItemMutationContext,
    quantity: bigint,
    state: DomainPackageTransaction,
    advanceSequence: boolean,
  ): PackageDomainMutation {
    const raw = context;
    if (advanceSequence) state.sequenceNo += 1;
    return {
      operationId: state.operationId!,
      sequenceNo: Math.max(state.sequenceNo, 1),
      playerId: raw.actorUserId ?? raw.ownerId,
      quantity: Number(quantity),
      targetId: typeof raw.targetSelector === "string" && /^\d+$/.test(raw.targetSelector)
        ? raw.targetSelector
        : undefined,
      guildId: raw.ownerType === "GUILD" ? raw.ownerId : undefined,
      reasonCode: "PACKAGE_USE",
    };
  }

  private assertQuantity(quantity: bigint): void {
    if (quantity <= 0n || quantity > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("PACKAGE_ITEM_QUANTITY_INVALID");
    }
  }
}

export interface CurrentDomainPackageRuntime {
  packages: PackageProvider;
  catalog: PackageCatalogRepository;
}

// 검증된 패키지 규칙 엔진과 현재 도메인 Provider를 조립
export function createCurrentDomainPackageRuntime(database: DatabaseClient): CurrentDomainPackageRuntime {
  const catalog = new CurrentPackageCatalogRepository(database);
  const items = new ItemProvider(
    new CurrentPackageItemDefinitionRepository(database),
    new PackageRewardTargetRegistry(),
  );
  const handler = new CurrentDomainItemTypeHandler(new PackageDomainItemMutationStore());
  const itemTypes: ItemType[] = [
    "STACK", "POINT", "PET", "MINI_PET", "FURNITURE", "MEMBER_TITLE",
    "PET_TITLE", "PET_APPEARANCE", "GUILD_RESOURCE",
  ];
  for (const itemType of itemTypes) items.register(itemType, handler);
  return {
    catalog,
    packages: new PackageProvider(catalog, items, new CurrentPackageTransactionManager(database)),
  };
}
