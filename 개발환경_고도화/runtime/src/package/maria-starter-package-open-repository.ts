import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { StarterPackageDefinition, StarterRewardDefinition } from "./starter-package-open-policy.js";
import type {
  StarterPackageActor,
  StarterPackageCatalog,
  StarterPackageCommandRecord,
  StarterPackageItemState,
  StarterPackageLockedState,
  StarterPackageOpenRepository,
  StarterPackageOpenTransaction,
  StarterPackageStoredResult
} from "./starter-package-open-repository.js";

interface PackageRow { id: bigint; active: number | boolean; }
interface ContentRow { sequence_no: number; asset_type_code: string; asset_code: string; quantity: string; }
interface ItemRow { item_id: bigint; code: string; display_name: string; metadata_json: string | Record<string, unknown> | null; active: number | boolean; stackable: number | boolean; quantity: bigint | null; version: bigint | null; }
const MAX_POINT_BALANCE = 999999999999999999999999999n;

function integerDecimal(value: string, errorCode: string): bigint {
  if (!/^\d+(?:\.0{1,3})?$/.test(value)) throw new ApplicationError(errorCode, "초보 패키지 수량 설정이 올바르지 않습니다.", 409);
  return BigInt(value.split(".")[0]!);
}

function metadata(value: ItemRow["metadata_json"]): Record<string, unknown> {
  if (value === null) return {};
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
}

class MariaStarterPackageOpenTransaction implements StarterPackageOpenTransaction {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async findActor(externalUserId: string): Promise<StarterPackageActor | null> {
    const rows = await this.transaction.query<Array<{ identity_id: bigint; player_id: bigint; rank_label: string }>>(
      `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name AS rank_label
       FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
         AND identity.player_id IS NOT NULL FOR UPDATE`, [externalUserId]
    );
    const row = rows[0];
    return row === undefined ? null : {
      identityId: row.identity_id.toString(), playerId: row.player_id.toString(), rankLabel: row.rank_label
    };
  }

  async findStoredResult(scope: string, key: string): Promise<StarterPackageStoredResult | null> {
    const rows = await this.transaction.query<Array<{ result_json: string | StarterPackageStoredResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
    );
    const value = rows[0]?.result_json;
    if (value === undefined || value === null) return null;
    return typeof value === "string" ? JSON.parse(value) as StarterPackageStoredResult : value;
  }

  async isCastleSiegeActive(): Promise<boolean> {
    const rows = await this.transaction.query<Array<{ active_count: bigint }>>(
      "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
    );
    return (rows[0]?.active_count ?? 0n) > 0n;
  }

  async lockCatalog(definition: StarterPackageDefinition): Promise<StarterPackageCatalog> {
    const packages = await this.transaction.query<PackageRow[]>(
      "SELECT id, active FROM package_definitions WHERE code = ? FOR UPDATE", [definition.packageCode]
    );
    const packageRow = packages[0];
    if (packageRow === undefined) {
      throw new ApplicationError("STARTER_PACKAGE_DEFINITION_REQUIRED", `초보 패키지 정의를 찾을 수 없습니다: ${definition.packageCode}`, 409);
    }
    if (!Boolean(packageRow.active)) {
      throw new ApplicationError("STARTER_PACKAGE_DEFINITION_DISABLED", `초보 패키지 정의가 비활성 상태입니다: ${definition.packageCode}`, 409);
    }
    const contents = await this.transaction.query<ContentRow[]>(
      `SELECT sequence_no, asset_type_code, asset_code, CAST(quantity AS CHAR) AS quantity
       FROM package_contents WHERE package_id = ? ORDER BY sequence_no FOR UPDATE`, [packageRow.id]
    );
    const expected = [
      ...definition.rewards.map((reward) => ({ type: "item", code: reward.code, quantity: reward.quantity })),
      { type: "currency", code: "point", quantity: definition.pointQuantity }
    ];
    if (contents.length !== expected.length || contents.some((content, index) => {
      const value = expected[index]!;
      return content.sequence_no !== index + 1 || content.asset_type_code !== value.type
        || content.asset_code !== value.code || integerDecimal(content.quantity, "STARTER_PACKAGE_CONTENT_INVALID") !== value.quantity;
    })) {
      throw new ApplicationError("STARTER_PACKAGE_CONTENT_INVALID", `초보 패키지 보상 설정이 현행 순서와 다릅니다: ${definition.packageCode}`, 409);
    }
    return { packageId: packageRow.id.toString(), definition, rewards: definition.rewards };
  }

  async lockState(actor: StarterPackageActor, catalog: StarterPackageCatalog): Promise<StarterPackageLockedState> {
    const codes = [catalog.definition.consumerCode, ...catalog.rewards.map(({ code }) => code)].sort();
    const rows = await this.transaction.query<ItemRow[]>(
      `SELECT item.id AS item_id, item.code, item.display_name, item.metadata_json, item.active, item.stackable,
         stack.quantity, stack.version
       FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
       WHERE item.code IN (${codes.map(() => "?").join(", ")}) ORDER BY item.code FOR UPDATE`, [actor.playerId, ...codes]
    );
    const found = new Map(rows.map((row) => [row.code, row]));
    const missing = codes.filter((code) => !found.has(code));
    if (missing.length > 0) {
      throw new ApplicationError("STARTER_PACKAGE_ITEM_DEFINITION_REQUIRED", `초보 패키지 아이템 정의를 찾을 수 없습니다: ${missing.join(", ")}`, 409);
    }
    const items = new Map<string, StarterPackageItemState>();
    for (const code of codes) {
      const row = found.get(code)!;
      if (!Boolean(row.active) || !Boolean(row.stackable)) {
        throw new ApplicationError("STARTER_PACKAGE_ITEM_DEFINITION_DISABLED", `초보 패키지 아이템 정의가 비활성 또는 비스택 상태입니다: ${code}`, 409);
      }
      items.set(code, { itemId: row.item_id.toString(), quantity: row.quantity ?? 0n, version: row.version, stackExists: row.quantity !== null });
    }
    const consumer = found.get(catalog.definition.consumerCode)!;
    const consumerMetadata = metadata(consumer.metadata_json);
    if (consumerMetadata.packageCode !== catalog.definition.packageCode
      || consumerMetadata.legacyBagKey !== catalog.definition.consumerDisplayName) {
      throw new ApplicationError("STARTER_PACKAGE_ITEM_LINK_INVALID", `초보 패키지 소비 아이템 연결이 올바르지 않습니다: ${catalog.definition.packageCode}`, 409);
    }
    const accounts = await this.transaction.query<Array<{ balance: string; version: bigint }>>(
      "SELECT CAST(balance AS CHAR) AS balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE",
      [actor.playerId]
    );
    const account = accounts[0];
    if (account === undefined) {
      throw new ApplicationError("STARTER_PACKAGE_POINT_ACCOUNT_REQUIRED", "포인트 계정이 초기화되지 않았습니다.", 409);
    }
    const pointBalance = integerDecimal(account.balance, "STARTER_PACKAGE_POINT_BALANCE_INVALID");
    if (pointBalance + catalog.definition.pointQuantity > MAX_POINT_BALANCE) {
      throw new ApplicationError("STARTER_PACKAGE_POINT_BALANCE_RANGE", "포인트 잔액이 저장 범위를 초과합니다.", 409);
    }
    return { items, pointBalance, pointVersion: account.version };
  }

  async persistRequired(actor: StarterPackageActor, scope: string, key: string, command: StarterPackageCommandRecord,
    catalog: StarterPackageCatalog, state: StarterPackageLockedState, data: string): Promise<StarterPackageStoredResult> {
    const operation = await this.insertOperation(actor, scope, key, catalog.definition.stage);
    await this.insertExecution(operation, command.eventId, catalog.definition.commandCode, "package_required");
    const auditId = await this.insertAudit(operation, actor, catalog.definition, "package_required", {
      packageCode: catalog.definition.packageCode, packageQuantity: "0"
    });
    const outboxId = await this.insertOutbox(operation, command.channelId, data);
    const result: StarterPackageStoredResult = {
      status: "package_required", playerId: actor.playerId, commandCode: catalog.definition.commandCode,
      stage: catalog.definition.stage, data, outboxId, auditId, packageBefore: "0", packageAfter: "0",
      pointBefore: state.pointBalance.toString(), pointAfter: state.pointBalance.toString(), rewards: []
    };
    await this.completeOperation(operation, result);
    return result;
  }

  async persistOpened(actor: StarterPackageActor, scope: string, key: string, command: StarterPackageCommandRecord,
    catalog: StarterPackageCatalog, state: StarterPackageLockedState, data: string): Promise<StarterPackageStoredResult> {
    const operation = await this.insertOperation(actor, scope, key, catalog.definition.stage);
    const consumer = state.items.get(catalog.definition.consumerCode)!;
    if (consumer.version === null || consumer.quantity === 0n) {
      throw new ApplicationError("STARTER_PACKAGE_INVENTORY_CONFLICT", "초보 패키지 수량이 먼저 변경되었습니다.", 409);
    }
    const packageAfter = consumer.quantity - 1n;
    if (packageAfter === 0n) {
      const write = await this.transaction.execute(
        "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
        [actor.playerId, consumer.itemId, consumer.version]
      );
      if (write.affectedRows !== 1n) throw new ApplicationError("STARTER_PACKAGE_INVENTORY_CONFLICT", "초보 패키지 수량이 먼저 변경되었습니다.", 409);
    } else {
      const write = await this.transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [packageAfter, actor.playerId, consumer.itemId, consumer.version]
      );
      if (write.affectedRows !== 1n) throw new ApplicationError("STARTER_PACKAGE_INVENTORY_CONFLICT", "초보 패키지 수량이 먼저 변경되었습니다.", 409);
    }
    let inventorySequence = 1;
    await this.transaction.execute(
      "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, -1, 'starter_package_consume')",
      [operation, inventorySequence++, actor.playerId, consumer.itemId]
    );
    for (const reward of catalog.rewards) {
      const itemState = state.items.get(reward.code)!;
      const after = itemState.quantity + reward.quantity;
      if (!itemState.stackExists) {
        await this.transaction.execute(
          "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
          [actor.playerId, itemState.itemId, after]
        );
      } else {
        const write = await this.transaction.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [after, actor.playerId, itemState.itemId, itemState.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("STARTER_PACKAGE_INVENTORY_CONFLICT", "보상 아이템 수량이 먼저 변경되었습니다.", 409);
      }
      await this.transaction.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'starter_package_reward')",
        [operation, inventorySequence++, actor.playerId, itemState.itemId, reward.quantity]
      );
    }
    const pointAfter = state.pointBalance + catalog.definition.pointQuantity;
    const pointWrite = await this.transaction.execute(
      "UPDATE currency_accounts SET balance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND currency_code = 'point' AND version = ?",
      [`${pointAfter}.000`, actor.playerId, state.pointVersion]
    );
    if (pointWrite.affectedRows !== 1n) throw new ApplicationError("STARTER_PACKAGE_POINT_CONFLICT", "포인트 잔액이 먼저 변경되었습니다.", 409);
    await this.transaction.execute(
      "INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES (?, 1, ?, 'point', ?, ?, 'starter_package_reward')",
      [operation, actor.playerId, `${catalog.definition.pointQuantity}.000`, `${pointAfter}.000`]
    );
    await this.insertExecution(operation, command.eventId, catalog.definition.commandCode, "reply_queued");
    const auditId = await this.insertAudit(operation, actor, catalog.definition, "success", {
      packageCode: catalog.definition.packageCode, packageBefore: consumer.quantity.toString(), packageAfter: packageAfter.toString(),
      pointBefore: state.pointBalance.toString(), pointAfter: pointAfter.toString(),
      rewards: catalog.rewards.map((reward) => ({ code: reward.code, quantity: reward.quantity.toString() }))
    });
    const outboxId = await this.insertOutbox(operation, command.channelId, data);
    const result: StarterPackageStoredResult = {
      status: "opened", playerId: actor.playerId, commandCode: catalog.definition.commandCode,
      stage: catalog.definition.stage, data, outboxId, auditId,
      packageBefore: consumer.quantity.toString(), packageAfter: packageAfter.toString(),
      pointBefore: state.pointBalance.toString(), pointAfter: pointAfter.toString(),
      rewards: catalog.rewards.map((reward) => ({ code: reward.code, displayName: reward.displayName, quantity: reward.quantity.toString() }))
    };
    await this.completeOperation(operation, result);
    return result;
  }

  private async insertOperation(actor: StarterPackageActor, scope: string, key: string, stage: number): Promise<bigint> {
    const operation = await this.transaction.execute(
      `INSERT INTO operations
         (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at)
       VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', ?, UTC_TIMESTAMP(3))`,
      [randomUUID(), scope, key, actor.identityId, JSON.stringify({ stage })]
    );
    return operation.insertId;
  }

  private async insertAudit(operation: bigint, actor: StarterPackageActor, definition: StarterPackageDefinition,
    resultCode: string, summary: Record<string, unknown>): Promise<string> {
    const audit = await this.transaction.execute(
      `INSERT INTO command_audit
         (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'external_identity', ?, 'player', ?, 'package.starter_open', ?, ?, ?, UTC_TIMESTAMP(3))`,
      [operation, actor.identityId, actor.playerId, resultCode, `Iris ${definition.command}`, JSON.stringify(summary)]
    );
    return audit.insertId.toString();
  }

  private async insertOutbox(operation: bigint, channelId: string, data: string): Promise<string> {
    const outbox = await this.transaction.execute(
      `INSERT INTO outbox_messages
         (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operation, channelId, JSON.stringify({ data, sequence: 1, kind: "starter_package_result" })]
    );
    return outbox.insertId.toString();
  }

  private async insertExecution(operation: bigint, eventId: string, commandCode: string, resultCode: string): Promise<void> {
    await this.transaction.execute(
      `INSERT INTO command_executions
         (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [eventId, commandCode, operation, resultCode]
    );
  }

  private async completeOperation(operation: bigint, result: StarterPackageStoredResult): Promise<void> {
    await this.transaction.execute(
      "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(result), operation]
    );
  }
}

export class MariaStarterPackageOpenRepository implements StarterPackageOpenRepository {
  constructor(private readonly database: DatabaseClient) {}
  async withTransaction<T>(work: (transaction: StarterPackageOpenTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction((transaction) => work(new MariaStarterPackageOpenTransaction(transaction)));
  }
}
