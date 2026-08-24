import { createHash, randomUUID } from "node:crypto";
import mariadb, { type Pool, type PoolConnection } from "mariadb";
import { ItemProvider, type ItemDefinition, type ItemDefinitionRepository, type ItemMutationContext, type ItemTypeHandler } from "./item-provider.js";
import type { PackageCatalogEntry, PackageCatalogSnapshot, PackageRewardEntry } from "./package-catalog.js";
import { PackageProvider, RepositoryPackageCatalogProvider, type PackageCatalogRepository, type PackageTransactionManager, type PackageUseOperationRepository, type PackageUseRequest, type PackageUseResult } from "./package-provider.js";
import type {
  DynamicRewardItem,
  PackageRewardBundleItem,
  PackageRewardOperation,
  PackageRewardOwnerScope,
  PackageRewardRule,
  PackageRewardRuleMode,
  PackageRewardRuleRepository
} from "./package-reward-rules.js";
import type { PackageTransaction } from "./package-provider.js";

export interface MariaDbPackageConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

type SqlRow = Record<string, unknown>;

function parseJson(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function connectionOf(context: ItemMutationContext): PoolConnection {
  if (!context.transactionHandle) throw new Error("ITEM_TRANSACTION_REQUIRED");
  return context.transactionHandle as PoolConnection;
}

// 멱등성 비교에 사용할 요청 payload 지문을 안정적으로 생성합니다.
function requestFingerprint(request: PackageUseRequest): string {
  const payload = JSON.stringify({
    userId: request.userId,
    packageId: request.packageId,
    openCount: request.openCount,
    guildId: request.guildId ?? null,
    petInstanceId: request.petInstanceId ?? request.targetSelector ?? null
  });
  return createHash("sha256").update(payload).digest("hex");
}

export class MariaDbPackageCatalogRepository implements PackageCatalogRepository, PackageRewardRuleRepository, PackageUseOperationRepository {
  constructor(private readonly pool: Pool) {}

  async getSnapshot(): Promise<PackageCatalogSnapshot> {
    const rows = await this.pool.query<SqlRow[]>(
      "SELECT package_id, catalog_version, display_name, consume_item_id, definition_status, enabled, max_open_count FROM package_catalog ORDER BY package_id"
    );
    const packages = rows.map((row) => this.mapPackage(row));
    return { version: String(packages[0]?.catalogVersion ?? "EMPTY"), packages };
  }

  async findById(packageId: string): Promise<PackageCatalogEntry | undefined> {
    const rows = await this.pool.query<SqlRow[]>(
      "SELECT package_id, catalog_version, display_name, consume_item_id, definition_status, enabled, max_open_count FROM package_catalog WHERE package_id = ?",
      [packageId]
    );
    return rows[0] ? this.mapPackage(rows[0]) : undefined;
  }

  async findByIdForUpdate(packageId: string, transaction: PackageTransaction): Promise<PackageCatalogEntry | undefined> {
    const rows = await connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext).query<SqlRow[]>(
      "SELECT package_id, catalog_version, display_name, consume_item_id, definition_status, enabled, max_open_count FROM package_catalog WHERE package_id = ? FOR UPDATE",
      [packageId]
    );
    return rows[0] ? this.mapPackage(rows[0]) : undefined;
  }

  async findByLegacyCommand(command: string): Promise<PackageCatalogEntry | undefined> {
    const rows = await this.pool.query<SqlRow[]>(
      "SELECT p.package_id, p.catalog_version, p.display_name, p.consume_item_id, p.definition_status, p.enabled, p.max_open_count, a.command_text FROM package_command_aliases a JOIN package_catalog p ON p.package_id = a.package_id WHERE a.command_text = ? AND a.active = 1",
      [command]
    );
    return rows[0] ? this.mapPackage(rows[0], command) : undefined;
  }

  async listRewards(packageId: string): Promise<readonly PackageRewardEntry[]> {
    const rows = await this.pool.query<SqlRow[]>(
      "SELECT package_id, reward_order, item_id, quantity, probability, target_selector, metadata_override_json FROM package_rewards WHERE package_id = ? ORDER BY reward_order",
      [packageId]
    );
    return rows.map((row) => ({
      packageId: String(row.package_id),
      rewardOrder: Number(row.reward_order),
      itemId: String(row.item_id),
      quantity: BigInt(String(row.quantity)),
      probability: row.probability === null ? null : Number(row.probability),
      targetSelector: row.target_selector === null ? null : String(row.target_selector),
      metadataOverride: row.metadata_override_json === null ? null : parseJson(row.metadata_override_json)
    }));
  }

  async listRewardRules(packageId: string, transaction: PackageTransaction): Promise<readonly PackageRewardRule[]> {
    const rows = await connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext).query<SqlRow[]>(
      "SELECT rule_id, package_id, reward_order, group_code, rule_mode, operation, owner_scope, item_id, quantity, weight, range_min, range_max, range_step, target_selector, metadata_override_json, selector_json FROM package_reward_rules WHERE package_id = ? AND enabled = 1 ORDER BY reward_order, rule_id FOR UPDATE",
      [packageId]
    );
    return rows.map((row) => ({
      ruleId: String(row.rule_id),
      packageId: String(row.package_id),
      rewardOrder: Number(row.reward_order),
      groupCode: String(row.group_code),
      ruleMode: String(row.rule_mode) as PackageRewardRuleMode,
      operation: String(row.operation) as PackageRewardOperation,
      ownerScope: String(row.owner_scope) as PackageRewardOwnerScope,
      itemId: row.item_id === null ? null : String(row.item_id),
      quantity: BigInt(String(row.quantity)),
      weight: row.weight === null ? null : Number(row.weight),
      rangeMin: row.range_min === null ? null : BigInt(String(row.range_min)),
      rangeMax: row.range_max === null ? null : BigInt(String(row.range_max)),
      rangeStep: row.range_step === null ? null : BigInt(String(row.range_step)),
      targetSelector: row.target_selector === null ? null : String(row.target_selector),
      metadataOverride: row.metadata_override_json === null ? null : parseJson(row.metadata_override_json),
      selector: row.selector_json === null ? null : parseJson(row.selector_json)
    }));
  }

  async listDynamicRewardItems(
    selector: Readonly<Record<string, unknown>>,
    transaction: PackageTransaction
  ): Promise<readonly DynamicRewardItem[]> {
    const catalogCode = selector.catalogCode;
    if (catalogCode !== undefined) {
      if (typeof catalogCode !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(catalogCode)) {
        throw new Error("PACKAGE_DYNAMIC_CATALOG_CODE_INVALID");
      }
      const rows = await connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext).query<SqlRow[]>(
        "SELECT e.item_id, e.grade_code, e.grade_weight, e.item_weight, d.item_type, d.metadata_json FROM dynamic_item_catalog_entries e JOIN package_item_definitions d ON d.item_id = e.item_id WHERE e.catalog_code = ? AND e.enabled = 1 AND d.enabled = 1 ORDER BY e.grade_code, e.item_id FOR UPDATE",
        [catalogCode]
      );
      return rows.map((row) => ({
        itemId: String(row.item_id),
        itemType: String(row.item_type) as DynamicRewardItem["itemType"],
        metadata: parseJson(row.metadata_json),
        gradeCode: String(row.grade_code),
        gradeWeight: Number(row.grade_weight),
        itemWeight: Number(row.item_weight)
      }));
    }
    const itemType = selector.itemType;
    if (typeof itemType !== "string" || !["PET", "MINI_PET", "FURNITURE", "MEMBER_TITLE", "PET_TITLE", "PET_APPEARANCE", "STACK", "POINT", "GUILD_RESOURCE"].includes(itemType)) {
      throw new Error("PACKAGE_DYNAMIC_ITEM_TYPE_INVALID");
    }
    const metadataEquals = selector.metadataEquals;
    if (metadataEquals !== undefined && (metadataEquals === null || typeof metadataEquals !== "object" || Array.isArray(metadataEquals))) {
      throw new Error("PACKAGE_DYNAMIC_METADATA_INVALID");
    }
    const expected = (metadataEquals ?? {}) as Readonly<Record<string, unknown>>;
    for (const value of Object.values(expected)) {
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        throw new Error("PACKAGE_DYNAMIC_METADATA_VALUE_INVALID");
      }
    }
    const rows = await connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext).query<SqlRow[]>(
      "SELECT item_id, item_type, metadata_json FROM package_item_definitions WHERE enabled = 1 AND item_type = ? ORDER BY item_id FOR UPDATE",
      [itemType]
    );
    return rows.map((row) => ({
      itemId: String(row.item_id),
      itemType: String(row.item_type) as DynamicRewardItem["itemType"],
      metadata: parseJson(row.metadata_json)
    })).filter((item) => Object.keys(expected).every((key) => item.metadata[key] === expected[key]));
  }

  async listRewardBundleItems(parentRuleId: string, transaction: PackageTransaction): Promise<readonly PackageRewardBundleItem[]> {
    const rows = await connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext).query<SqlRow[]>(
      "SELECT bundle_item_id, parent_rule_id, reward_order, operation, owner_scope, item_id, quantity, target_selector, metadata_override_json FROM package_reward_bundle_items WHERE parent_rule_id = ? AND enabled = 1 ORDER BY reward_order, bundle_item_id FOR UPDATE",
      [parentRuleId]
    );
    return rows.map((row) => ({
      bundleItemId: String(row.bundle_item_id),
      parentRuleId: String(row.parent_rule_id),
      rewardOrder: Number(row.reward_order),
      operation: String(row.operation) as PackageRewardBundleItem["operation"],
      ownerScope: String(row.owner_scope) as PackageRewardOwnerScope,
      itemId: String(row.item_id),
      quantity: BigInt(String(row.quantity)),
      targetSelector: row.target_selector === null ? null : String(row.target_selector),
      metadataOverride: row.metadata_override_json === null ? null : parseJson(row.metadata_override_json)
    }));
  }

  async getRemainingItemCapacity(
    ownerType: "USER" | "GUILD" | "PET",
    ownerId: string,
    itemType: DynamicRewardItem["itemType"],
    transaction: PackageTransaction
  ): Promise<bigint> {
    const db = connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext);
    const capacityRows = await db.query<SqlRow[]>(
      "SELECT capacity FROM owner_item_capacities WHERE owner_type = ? AND owner_id = ? AND item_type = ? FOR UPDATE",
      [ownerType, ownerId, itemType]
    );
    if (!capacityRows[0]) throw new Error("PACKAGE_ITEM_CAPACITY_NOT_DEFINED");
    const activeRows = await db.query<SqlRow[]>(
      "SELECT i.instance_id FROM package_item_instances i JOIN package_item_definitions d ON d.item_id = i.item_id WHERE i.owner_type = ? AND i.owner_id = ? AND d.item_type = ? AND i.removed_at IS NULL ORDER BY i.instance_id FOR UPDATE",
      [ownerType, ownerId, itemType]
    );
    const remaining = BigInt(String(capacityRows[0].capacity)) - BigInt(activeRows.length);
    return remaining > 0n ? remaining : 0n;
  }

  async beginPackageUse(
    request: PackageUseRequest,
    catalogVersion: string,
    transaction: PackageTransaction
  ): Promise<void | PackageUseResult> {
    const fingerprint = requestFingerprint(request);
    try {
      await connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext).query(
        "INSERT INTO package_use_operations(operation_id, request_key, request_fingerprint, user_id, package_id, open_count, catalog_version, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING')",
        [transaction.id, request.requestKey, fingerprint, request.userId, request.packageId, request.openCount, catalogVersion]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        const committed = await this.findPackageUseResult(request, transaction);
        if (committed) return committed;
        throw new Error("PACKAGE_REQUEST_IN_PROGRESS");
      }
      throw error;
    }
  }

  async findPackageUseResult(
    request: PackageUseRequest,
    transaction: PackageTransaction
  ): Promise<PackageUseResult | undefined> {
    const rows = await connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext).query<SqlRow[]>(
      "SELECT request_fingerprint, status, result_json FROM package_use_operations WHERE request_key = ? FOR UPDATE",
      [request.requestKey]
    );
    const row = rows[0];
    if (!row) return undefined;
    if (String(row.request_fingerprint) !== requestFingerprint(request)) {
      throw new Error("PACKAGE_REQUEST_PAYLOAD_MISMATCH");
    }
    if (String(row.status) !== "COMMITTED" || row.result_json === null) {
      throw new Error("PACKAGE_REQUEST_IN_PROGRESS");
    }
    return parseJson(row.result_json) as unknown as PackageUseResult;
  }

  async completePackageUse(requestKey: string, result: PackageUseResult, transaction: PackageTransaction): Promise<void> {
    const update = await connectionOf({ transactionHandle: transaction.handle } as ItemMutationContext).query(
      "UPDATE package_use_operations SET status = 'COMMITTED', result_json = ?, committed_at = CURRENT_TIMESTAMP(3) WHERE request_key = ? AND operation_id = ? AND status = 'PROCESSING'",
      [JSON.stringify(result), requestKey, transaction.id]
    ) as { affectedRows: number };
    if (update.affectedRows !== 1) throw new Error("PACKAGE_OPERATION_STATE_INVALID");
  }

  private mapPackage(row: SqlRow, command: string | null = null): PackageCatalogEntry {
    return {
      id: String(row.package_id),
      catalogVersion: String(row.catalog_version),
      displayName: String(row.display_name),
      legacyCommand: command,
      consumeItemId: String(row.consume_item_id),
      definitionStatus: String(row.definition_status) as PackageCatalogEntry["definitionStatus"],
      enabled: Boolean(row.enabled),
      maxOpenCount: Number(row.max_open_count)
    };
  }
}

export class MariaDbItemDefinitionRepository implements ItemDefinitionRepository {
  constructor(private readonly pool: Pool) {}
  async findById(itemId: string, transactionHandle?: unknown): Promise<ItemDefinition | undefined> {
    const db = transactionHandle ? transactionHandle as PoolConnection : this.pool;
    const rows = await db.query<SqlRow[]>(
      "SELECT item_id, item_type, item_name, stackable, metadata_json, enabled FROM package_item_definitions WHERE item_id = ?" + (transactionHandle ? " FOR UPDATE" : ""),
      [itemId]
    );
    const row = rows[0];
    return row ? {
      id: String(row.item_id),
      type: String(row.item_type) as ItemDefinition["type"],
      name: String(row.item_name),
      stackable: Boolean(row.stackable),
      metadata: parseJson(row.metadata_json),
      enabled: Boolean(row.enabled)
    } : undefined;
  }
}

export class MariaDbTransactionManager implements PackageTransactionManager {
  constructor(private readonly pool: Pool) {}
  async run<T>(work: (transaction: { id: string; handle: PoolConnection }) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work({ id: randomUUID(), handle: connection });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export class MariaDbStackItemHandler implements ItemTypeHandler {
  async checkAdd(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    this.validateOwner(definition, context);
    if (context.operation === "REPLACE") throw new Error("ITEM_REPLACE_TYPE_INVALID");
    await this.assertAddCapacity(definition, quantity, context);
  }
  async checkRemove(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    this.validateOwner(definition, context);
    const rows = await connectionOf(context).query<SqlRow[]>(
      "SELECT quantity FROM package_item_balances WHERE owner_type = ? AND owner_id = ? AND item_id = ? FOR UPDATE",
      [context.ownerType, context.ownerId, definition.id]
    );
    if (!rows[0] || BigInt(String(rows[0].quantity)) < quantity) throw new Error("ITEM_QUANTITY_INSUFFICIENT");
  }
  async add(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const db = connectionOf(context);
    this.validateOwner(definition, context);
    if (context.operation === "REPLACE") throw new Error("ITEM_REPLACE_TYPE_INVALID");
    await this.assertAddCapacity(definition, quantity, context);
    await db.query(
      "INSERT INTO package_item_balances(owner_type, owner_id, item_id, quantity) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), row_version = row_version + 1",
      [context.ownerType, context.ownerId, definition.id, quantity.toString()]
    );
    await this.ledger(db, definition.id, quantity, context);
  }
  async remove(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const db = connectionOf(context);
    this.validateOwner(definition, context);
    const result = await db.query(
      "UPDATE package_item_balances SET quantity = quantity - ?, row_version = row_version + 1 WHERE owner_type = ? AND owner_id = ? AND item_id = ? AND quantity >= ?",
      [quantity.toString(), context.ownerType, context.ownerId, definition.id, quantity.toString()]
    ) as { affectedRows: number };
    if (result.affectedRows !== 1) throw new Error("ITEM_QUANTITY_INSUFFICIENT");
    await this.ledger(db, definition.id, -quantity, context);
  }
  private async ledger(db: PoolConnection, itemId: string, delta: bigint, context: ItemMutationContext): Promise<void> {
    await db.query(
      "INSERT INTO package_item_ledger(ledger_id, operation_id, owner_type, owner_id, item_id, quantity_delta) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), context.transactionId, context.ownerType, context.ownerId, itemId, delta.toString()]
    );
  }
  private async assertAddCapacity(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const max = 9223372036854775807n;
    if (quantity > max) throw new Error("ITEM_QUANTITY_OVERFLOW");
    const rows = await connectionOf(context).query<SqlRow[]>(
      "SELECT quantity FROM package_item_balances WHERE owner_type = ? AND owner_id = ? AND item_id = ? FOR UPDATE",
      [context.ownerType, context.ownerId, definition.id]
    );
    const current = rows[0] ? BigInt(String(rows[0].quantity)) : 0n;
    if (current < 0n || current > max - quantity) throw new Error("ITEM_QUANTITY_OVERFLOW");
  }
  private validateOwner(definition: ItemDefinition, context: ItemMutationContext): void {
    if (definition.type === "GUILD_RESOURCE" && context.ownerType !== "GUILD") {
      throw new Error("GUILD_RESOURCE_OWNER_INVALID");
    }
    if (definition.type !== "GUILD_RESOURCE" && context.ownerType === "GUILD") {
      throw new Error("GUILD_ITEM_TYPE_INVALID");
    }
  }
}

export class MariaDbInstanceItemHandler implements ItemTypeHandler {
  async checkAdd(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    if (quantity > 10000n) throw new Error("ITEM_INSTANCE_BATCH_TOO_LARGE");
    if (context.operation === "REPLACE" && definition.type !== "PET_APPEARANCE") {
      throw new Error("ITEM_REPLACE_TYPE_INVALID");
    }
    if (definition.type === "PET_TITLE" || definition.type === "PET_APPEARANCE") {
      await this.validatePetTarget(definition, context);
    }
    if (definition.type === "PET_APPEARANCE") {
      if (context.operation !== "REPLACE" || quantity !== 1n) throw new Error("PET_APPEARANCE_REPLACE_REQUIRED");
      await connectionOf(context).query(
        "SELECT instance_id FROM package_item_instances WHERE owner_type = ? AND owner_id = ? AND target_instance_id = ? AND removed_at IS NULL AND item_id IN (SELECT item_id FROM package_item_definitions WHERE item_type = 'PET_APPEARANCE') FOR UPDATE",
        [context.ownerType, context.ownerId, context.targetSelector]
      );
    }
  }
  async checkRemove(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    if (definition.type === "PET_TITLE" || definition.type === "PET_APPEARANCE") {
      await this.validatePetTarget(definition, context);
    }
    const rows = await connectionOf(context).query<SqlRow[]>(
      "SELECT COUNT(*) AS count FROM package_item_instances WHERE owner_type = ? AND owner_id = ? AND item_id = ? AND removed_at IS NULL FOR UPDATE",
      [context.ownerType, context.ownerId, definition.id]
    );
    if (BigInt(String(rows[0]?.count ?? 0)) < quantity) throw new Error("ITEM_INSTANCE_INSUFFICIENT");
  }
  async add(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const db = connectionOf(context);
    if (context.operation === "REPLACE" && definition.type !== "PET_APPEARANCE") {
      throw new Error("ITEM_REPLACE_TYPE_INVALID");
    }
    if (definition.type === "PET_TITLE" || definition.type === "PET_APPEARANCE") {
      await this.validatePetTarget(definition, context);
    }
    if (definition.type === "PET_APPEARANCE") {
      if (context.operation !== "REPLACE" || quantity !== 1n || !context.targetSelector) {
        throw new Error("PET_APPEARANCE_REPLACE_REQUIRED");
      }
      const previous = await db.query<SqlRow[]>(
        "SELECT instance_id, item_id FROM package_item_instances WHERE owner_type = ? AND owner_id = ? AND target_instance_id = ? AND removed_at IS NULL AND item_id IN (SELECT item_id FROM package_item_definitions WHERE item_type = 'PET_APPEARANCE') FOR UPDATE",
        [context.ownerType, context.ownerId, context.targetSelector]
      );
      for (const row of previous) {
        await db.query("UPDATE package_item_instances SET removed_at = CURRENT_TIMESTAMP(3) WHERE instance_id = ?", [row.instance_id]);
        await db.query(
          "INSERT INTO package_item_ledger(ledger_id, operation_id, owner_type, owner_id, item_id, quantity_delta, instance_id) VALUES (?, ?, ?, ?, ?, -1, ?)",
          [randomUUID(), context.transactionId, context.ownerType, context.ownerId, row.item_id, row.instance_id]
        );
      }
    }
    for (let i = 0n; i < quantity; i++) {
      const instanceId = randomUUID();
      const metadata = { ...definition.metadata, ...(context.metadataOverride ?? {}) };
      await db.query(
        "INSERT INTO package_item_instances(instance_id, owner_type, owner_id, item_id, target_instance_id, instance_metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
        [instanceId, context.ownerType, context.ownerId, definition.id, context.targetSelector ?? null, JSON.stringify(metadata)]
      );
      await db.query(
        "INSERT INTO package_item_ledger(ledger_id, operation_id, owner_type, owner_id, item_id, quantity_delta, instance_id) VALUES (?, ?, ?, ?, ?, 1, ?)",
        [randomUUID(), context.transactionId, context.ownerType, context.ownerId, definition.id, instanceId]
      );
    }
  }
  async remove(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const db = connectionOf(context);
    if (definition.type === "PET_TITLE" || definition.type === "PET_APPEARANCE") {
      await this.validatePetTarget(definition, context);
    }
    const rows = await db.query<SqlRow[]>(
      "SELECT instance_id FROM package_item_instances WHERE owner_type = ? AND owner_id = ? AND item_id = ? AND removed_at IS NULL ORDER BY created_at LIMIT ? FOR UPDATE",
      [context.ownerType, context.ownerId, definition.id, Number(quantity)]
    );
    if (rows.length < Number(quantity)) throw new Error("ITEM_INSTANCE_INSUFFICIENT");
    for (const row of rows) {
      await db.query("UPDATE package_item_instances SET removed_at = CURRENT_TIMESTAMP(3) WHERE instance_id = ?", [row.instance_id]);
      await db.query(
        "INSERT INTO package_item_ledger(ledger_id, operation_id, owner_type, owner_id, item_id, quantity_delta, instance_id) VALUES (?, ?, ?, ?, ?, -1, ?)",
        [randomUUID(), context.transactionId, context.ownerType, context.ownerId, definition.id, row.instance_id]
      );
    }
  }
  private async validatePetTarget(definition: ItemDefinition, context: ItemMutationContext): Promise<void> {
    if (context.ownerType !== "PET" || !context.actorUserId || !context.targetSelector || context.ownerId !== context.targetSelector) {
      throw new Error(definition.type === "PET_TITLE" ? "PET_TITLE_TARGET_REQUIRED" : "PET_APPEARANCE_TARGET_REQUIRED");
    }
    const rows = await connectionOf(context).query<SqlRow[]>(
      "SELECT i.instance_id FROM package_item_instances i JOIN package_item_definitions d ON d.item_id = i.item_id WHERE i.instance_id = ? AND i.owner_type = 'USER' AND i.owner_id = ? AND i.removed_at IS NULL AND d.item_type IN ('PET', 'MINI_PET') FOR UPDATE",
      [context.targetSelector, context.actorUserId]
    );
    if (!rows[0]) throw new Error(definition.type === "PET_TITLE" ? "PET_TITLE_TARGET_NOT_FOUND" : "PET_APPEARANCE_TARGET_NOT_FOUND");
  }
}

export function createMariaDbPackageRuntime(config: MariaDbPackageConfig) {
  const pool = mariadb.createPool({ ...config, connectionLimit: config.connectionLimit ?? 5, bigIntAsNumber: false });
  const repository = new MariaDbPackageCatalogRepository(pool);
  const items = new ItemProvider(new MariaDbItemDefinitionRepository(pool));
  const stack = new MariaDbStackItemHandler();
  const instance = new MariaDbInstanceItemHandler();
  for (const type of ["STACK", "POINT", "GUILD_RESOURCE"] as const) items.register(type, stack);
  for (const type of ["PET", "MINI_PET", "FURNITURE", "MEMBER_TITLE", "PET_TITLE", "PET_APPEARANCE"] as const) items.register(type, instance);
  return {
    pool,
    catalog: new RepositoryPackageCatalogProvider(repository),
    packages: new PackageProvider(repository, items, new MariaDbTransactionManager(pool))
  };
}

