import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { PackageCatalogCommandError } from "./package-catalog-admin-command.js";
import type {
  PackageCatalogAdminRepository,
  PackageCatalogMutationRequest,
  PackageCatalogMutationResult,
  PackageCatalogProjectionEntry,
} from "./package-catalog-admin-service.js";
import type {
  PackageCatalogWebAdapterRepository,
  PackageCatalogWebMutationRequest,
} from "./package-catalog-web-adapter.js";

interface MutationReplayRow {
  result_json: string;
}

interface HeadRow {
  version: bigint;
}

interface RewardDefinitionRow {
  item_id: string;
}

interface WebOperationRow {
  result_json: string | StoredWebMutation | null;
}

interface StoredWebMutation {
  payloadFingerprint: string;
  result: Omit<PackageCatalogMutationResult, "catalogVersion"> & { catalogVersion: string };
}

// 관리자 역할 권한과 개인 allow/deny를 transaction 안에서 판정합니다.
async function requireCatalogPermission(transaction: DatabaseTransaction, operatorId: string): Promise<void> {
  const operators = await transaction.query<Array<{ status: string }>>("SELECT status FROM admin_operators WHERE id=?", [operatorId]);
  if (operators[0]?.status !== "active") throw new PackageCatalogCommandError("FORBIDDEN", "패키지 관리 권한이 없습니다.");
  const overrides = await transaction.query<Array<{ effect: "allow" | "deny" }>>(
    "SELECT effect FROM admin_operator_permission_overrides WHERE operator_id=? AND permission_code='package.catalog.manage' LIMIT 1",
    [operatorId],
  );
  if (overrides[0]?.effect === "deny") throw new PackageCatalogCommandError("FORBIDDEN", "패키지 관리 권한이 없습니다.");
  if (overrides[0]?.effect === "allow") return;
  const roles = await transaction.query<Array<{ allowed: number }>>(
    `SELECT 1 AS allowed FROM admin_operator_roles operator_role
     JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
     JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
     WHERE operator_role.operator_id=? AND permission.permission_code='package.catalog.manage' LIMIT 1`,
    [operatorId],
  );
  if (roles[0] === undefined) throw new PackageCatalogCommandError("FORBIDDEN", "패키지 관리 권한이 없습니다.");
}

// 보상 이름 또는 stable code를 활성 package item definition으로 해석합니다.
async function resolveRewardItem(transaction: DatabaseTransaction, assetCode: string): Promise<string> {
  const rows = await transaction.query<RewardDefinitionRow[]>(
    `SELECT item_id FROM package_item_definitions
     WHERE enabled=1 AND (item_id=? OR item_name=?) ORDER BY item_id LIMIT 2 FOR UPDATE`,
    [assetCode, assetCode],
  );
  if (rows.length !== 1) throw new PackageCatalogCommandError("PACKAGE_REWARD_ITEM_INVALID", "보상 아이템을 하나로 확인할 수 없습니다.");
  return rows[0]!.item_id;
}

// package reward 규칙을 기존 순서 그대로 교체합니다.
async function replaceRewards(transaction: DatabaseTransaction, packageId: string, rewards: PackageCatalogMutationRequest["mutation"] extends never ? never : readonly { rewardType: "POINT" | "ITEM"; assetCode: string; quantity: bigint }[]): Promise<void> {
  await transaction.execute("DELETE FROM package_reward_rules WHERE package_id=?", [packageId]);
  for (let index = 0; index < rewards.length; index += 1) {
    const reward = rewards[index]!;
    const itemId = await resolveRewardItem(transaction, reward.assetCode);
    await transaction.execute(
      `INSERT INTO package_reward_rules
       (rule_id,package_id,reward_order,group_code,rule_mode,operation,owner_scope,item_id,quantity,enabled)
       VALUES (?,?,?,?, 'ALL','ADD','USER',?,?,1)`,
      [`${packageId}-ADMIN-${index + 1}`, packageId, index + 1, "ALL", itemId, reward.quantity],
    );
  }
}

export class MariaPackageCatalogAdminRepository implements PackageCatalogAdminRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // service validation 전에 완료된 request 결과를 멱등 재생합니다.
  public async findReplay(requestKey: string): Promise<PackageCatalogMutationResult | undefined> {
    const rows = await this.database.query<MutationReplayRow[]>(
      "SELECT result_json FROM package_catalog_mutations WHERE request_key=?",
      [requestKey],
    );
    if (!rows[0]) return undefined;
    const saved = JSON.parse(rows[0].result_json) as Omit<PackageCatalogMutationResult, "catalogVersion"> & { catalogVersion: string };
    return { ...saved, catalogVersion: BigInt(saved.catalogVersion), replayed: true };
  }

  // 활성 projection과 현재 catalog head version을 조회합니다.
  public async readSnapshot() {
    const [heads, entries] = await Promise.all([
      this.database.query<HeadRow[]>("SELECT version FROM package_catalog_heads WHERE catalog_key='PACKAGE_CATALOG'"),
      this.database.query<Array<{ package_id: string; display_name: string; display_order: number; enabled: number; row_version: bigint }>>(
        `SELECT package_id,display_name,display_order,enabled,row_version FROM package_catalog
         WHERE deleted_at IS NULL ORDER BY display_order,package_id`,
      ),
    ]);
    if (heads[0] === undefined) throw new Error("PACKAGE_CATALOG_HEAD_NOT_FOUND");
    const projection: PackageCatalogProjectionEntry[] = entries.map((entry) => ({
      packageId: entry.package_id,
      displayName: entry.display_name,
      displayOrder: entry.display_order,
      active: Boolean(entry.enabled),
      rowVersion: entry.row_version,
    }));
    return { catalogVersion: heads[0].version, entries: projection };
  }

  // 권한·version lock·catalog 변경·audit·outbox를 하나의 transaction으로 커밋합니다.
  public async mutate(request: PackageCatalogMutationRequest): Promise<PackageCatalogMutationResult> {
    try {
      return await this.database.withTransaction(async (transaction) => {
      const replay = await transaction.query<MutationReplayRow[]>(
        "SELECT result_json FROM package_catalog_mutations WHERE request_key=? FOR UPDATE",
        [request.requestKey],
      );
      if (replay[0]) {
        const saved = JSON.parse(replay[0].result_json) as Omit<PackageCatalogMutationResult, "catalogVersion"> & { catalogVersion: string };
        return { ...saved, catalogVersion: BigInt(saved.catalogVersion), replayed: true };
      }
      await requireCatalogPermission(transaction, request.actorOperatorId);
      const heads = await transaction.query<HeadRow[]>(
        "SELECT version FROM package_catalog_heads WHERE catalog_key='PACKAGE_CATALOG' FOR UPDATE",
      );
      const currentVersion = heads[0]?.version;
      if (currentVersion === undefined) throw new Error("PACKAGE_CATALOG_HEAD_NOT_FOUND");
      if (currentVersion !== request.expectedCatalogVersion) {
        throw new PackageCatalogCommandError("PACKAGE_CATALOG_VERSION_CONFLICT", "패키지 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
      }
      const nextVersion = currentVersion + 1n;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status)
         VALUES (?, 'package.catalog.admin', ?, 'admin', ?, 'iris', 'processing')`,
        [randomUUID(), request.requestKey, request.actorOperatorId],
      );
      let packageId: string;
      let message: string;
      const mutation = request.mutation;
      if (mutation.action === "ADD") {
        const suffix = nextVersion.toString().padStart(6, "0");
        packageId = `PKG-CUSTOM-${suffix}`;
        const consumeItemId = `ITEM-PACKAGE-CUSTOM-${suffix}`;
        await transaction.execute(
          "INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version) VALUES (?,'PACKAGE',?,1,'{}',1,1)",
          [consumeItemId, mutation.displayName],
        );
        await transaction.execute(
          "INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,?,'PACKAGE',1,'{}',1,1)",
          [consumeItemId, mutation.displayName],
        );
        await transaction.execute(
          `INSERT INTO package_catalog
           (package_id,catalog_version,display_name,description,consume_item_id,display_order,max_open_count,block_castle,definition_status,enabled,row_version)
           VALUES (?,?,?,?,?,?,1000,FALSE,'READY',1,1)`,
          [packageId, nextVersion.toString(), mutation.displayName, mutation.description, consumeItemId, mutation.displayOrder],
        );
        await replaceRewards(transaction, packageId, mutation.rewards);
        message = `✅ [${mutation.displayName}] 패키지가 ${mutation.displayOrder}번으로 추가되었습니다.`;
      } else {
        packageId = mutation.packageId;
        const rows = await transaction.query<Array<{ display_name: string; display_order: number; deleted_at: Date | null }>>(
          "SELECT display_name,display_order,deleted_at FROM package_catalog WHERE package_id=? FOR UPDATE",
          [packageId],
        );
        const target = rows[0];
        if (!target || target.deleted_at) throw new PackageCatalogCommandError("PACKAGE_NOT_FOUND", "패키지 번호를 확인해 주세요.");
        if (mutation.action === "EDIT") {
          await replaceRewards(transaction, packageId, mutation.rewards);
          await transaction.execute("UPDATE package_catalog SET max_open_count=1000,row_version=row_version+1,catalog_version=? WHERE package_id=?", [nextVersion.toString(), packageId]);
          message = `✅ [${target.display_name}] 패키지 보상이 수정되었습니다.`;
        } else if (mutation.action === "REMOVE") {
          await transaction.execute("UPDATE package_catalog SET enabled=0,deleted_at=UTC_TIMESTAMP(3),deleted_by=?,row_version=row_version+1,catalog_version=? WHERE package_id=?", [request.actorOperatorId, nextVersion.toString(), packageId]);
          await transaction.execute("UPDATE package_catalog SET display_order=display_order-1,row_version=row_version+1,catalog_version=? WHERE deleted_at IS NULL AND display_order>?", [nextVersion.toString(), target.display_order]);
          message = `✅ [${target.display_name}] 패키지가 목록에서 제거되었습니다.`;
        } else {
          await transaction.execute("UPDATE package_catalog SET enabled=1,row_version=row_version+1,catalog_version=? WHERE package_id=?", [nextVersion.toString(), packageId]);
          message = `✅ [${target.display_name}] 패키지가 활성화되었습니다.`;
        }
      }
      await transaction.execute("UPDATE package_catalog_heads SET version=?,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE catalog_key='PACKAGE_CATALOG'", [nextVersion, request.actorOperatorId]);
      let result: PackageCatalogMutationResult = { replayed: false, catalogVersion: nextVersion, packageId, message };
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,completed_at)
         VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3))`,
        [request.requestKey, request.commandCode, operation.insertId],
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json)
         VALUES (?,'admin',?,'package_catalog',NULL,?,'success',NULL,?)`,
        [operation.insertId, request.actorOperatorId, request.commandCode, JSON.stringify({ packageId, catalogVersion: nextVersion.toString(), mutation: mutation.action })],
      );
      if (request.replyDestinationId) {
        const outbox = await transaction.execute(
          `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status)
           VALUES (?,'iris',?,'text',?,'pending')`,
          [operation.insertId, request.replyDestinationId, JSON.stringify({ room: request.replyDestinationId, data: message })],
        );
        result = { ...result, outboxId: outbox.insertId.toString() };
      }
      await transaction.execute(
        `INSERT INTO package_catalog_mutations
         (request_key,operation_id,command_code,package_id,actor_operator_id,catalog_version,action_code,result_json)
         VALUES (?,?,?,?,?,?,?,?)`,
        [request.requestKey, operation.insertId, request.commandCode, packageId, request.actorOperatorId, nextVersion, mutation.action, JSON.stringify({ ...result, catalogVersion: nextVersion.toString() })],
      );
      await transaction.execute("UPDATE operations SET status='committed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify({ ...result, catalogVersion: nextVersion.toString() }), operation.insertId]);
        return result;
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
        throw new PackageCatalogCommandError("PACKAGE_CATALOG_VERSION_CONFLICT", "패키지 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
      }
      throw error;
    }
  }
}

// 웹 operation result에 저장된 fingerprint와 bigint 직렬화 결과를 복원합니다.
function storedWebMutation(value: string | StoredWebMutation): StoredWebMutation {
  return typeof value === "string" ? JSON.parse(value) as StoredWebMutation : value;
}

// configuration change log가 참조할 패키지 카탈로그 설정 집합을 transaction 안에서 확보합니다.
async function packageConfigurationSetId(transaction: DatabaseTransaction): Promise<bigint> {
  const inserted = await transaction.execute(
    `INSERT INTO configuration_sets(set_code,version,status,effective_from)
     VALUES ('package_catalog',1,'active',UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
  );
  if (inserted.insertId !== 0n) return inserted.insertId;
  const rows = await transaction.query<Array<{ id: bigint }>>(
    "SELECT id FROM configuration_sets WHERE set_code='package_catalog' AND version=1 FOR UPDATE",
  );
  if (rows[0] === undefined) throw new Error("PACKAGE_CATALOG_CONFIGURATION_SET_NOT_FOUND");
  return rows[0].id;
}

// 웹 adapter action을 기존 command/evidence code로 변환합니다.
function webCommandCode(action: PackageCatalogWebMutationRequest["mutation"]["action"]): PackageCatalogMutationRequest["commandCode"] {
  return `PACKAGE_CATALOG_${action}`;
}

export class MariaPackageCatalogWebAdapterRepository implements PackageCatalogWebAdapterRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // 권한·replay fingerprint·catalog version·감사 기록을 단일 transaction으로 처리합니다.
  public async mutateForOperator(request: PackageCatalogWebMutationRequest): Promise<PackageCatalogMutationResult> {
    try {
      return await this.database.withTransaction(async (transaction) => {
        await requireCatalogPermission(transaction, request.actorOperatorId);
        const operationWrite = await transaction.execute(
          `INSERT INTO operations
           (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
           VALUES (?,'package.catalog.web',?,'admin_operator',?,?, 'processing',UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
          [randomUUID(), request.requestKey, request.actorOperatorId, request.sourceCode],
        );
        const operationId = operationWrite.insertId;
        const operations = await transaction.query<WebOperationRow[]>(
          "SELECT result_json FROM operations WHERE id=? FOR UPDATE",
          [operationId],
        );
        const prior = operations[0]?.result_json;
        if (prior !== null && prior !== undefined) {
          const saved = storedWebMutation(prior);
          if (saved.payloadFingerprint !== request.payloadFingerprint) {
            throw new PackageCatalogCommandError("PACKAGE_CATALOG_IDEMPOTENCY_CONFLICT", "같은 멱등성 키에 다른 변경 요청이 사용되었습니다.");
          }
          return { ...saved.result, catalogVersion: BigInt(saved.result.catalogVersion), replayed: true };
        }
        if (operationWrite.affectedRows !== 1n) {
          throw new PackageCatalogCommandError("PACKAGE_CATALOG_REQUEST_IN_PROGRESS", "동일한 패키지 변경 요청을 처리 중입니다.");
        }

        const heads = await transaction.query<HeadRow[]>(
          "SELECT version FROM package_catalog_heads WHERE catalog_key='PACKAGE_CATALOG' FOR UPDATE",
        );
        const currentVersion = heads[0]?.version;
        if (currentVersion === undefined) throw new Error("PACKAGE_CATALOG_HEAD_NOT_FOUND");
        if (currentVersion !== request.expectedCatalogVersion) {
          throw new PackageCatalogCommandError("PACKAGE_CATALOG_VERSION_CONFLICT", "패키지 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
        }
        const configurationSetId = await packageConfigurationSetId(transaction);
        const nextVersion = currentVersion + 1n;
        const mutation = request.mutation;
        let packageId: string;
        let message: string;
        let previous: Record<string, unknown> | null = null;
        let current: Record<string, unknown>;

        if (mutation.action === "ADD") {
          const duplicates = await transaction.query<Array<{ package_id: string }>>(
            "SELECT package_id FROM package_catalog WHERE deleted_at IS NULL AND display_name=? LIMIT 1 FOR UPDATE",
            [mutation.displayName],
          );
          if (duplicates[0] !== undefined) {
            throw new PackageCatalogCommandError("PACKAGE_NAME_DUPLICATE", "같은 이름의 패키지가 이미 있습니다.");
          }
          const orders = await transaction.query<Array<{ next_order: bigint | number }>>(
            "SELECT COALESCE(MAX(display_order),0)+1 AS next_order FROM package_catalog WHERE deleted_at IS NULL FOR UPDATE",
          );
          const displayOrder = Number(orders[0]?.next_order ?? 1);
          const suffix = nextVersion.toString().padStart(6, "0");
          packageId = `PKG-CUSTOM-${suffix}`;
          const consumeItemId = `ITEM-PACKAGE-CUSTOM-${suffix}`;
          await transaction.execute(
            "INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version) VALUES (?,'PACKAGE',?,1,'{}',1,1)",
            [consumeItemId, mutation.displayName],
          );
          await transaction.execute(
            "INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,?,'PACKAGE',1,'{}',1,1)",
            [consumeItemId, mutation.displayName],
          );
          await transaction.execute(
            `INSERT INTO package_catalog
             (package_id,catalog_version,display_name,description,consume_item_id,display_order,max_open_count,block_castle,definition_status,enabled,row_version)
             VALUES (?,?,?,?,?,?,1000,FALSE,'READY',1,1)`,
            [packageId, nextVersion.toString(), mutation.displayName, mutation.description, consumeItemId, displayOrder],
          );
          await replaceRewards(transaction, packageId, mutation.rewards);
          current = { displayName: mutation.displayName, description: mutation.description, displayOrder, enabled: true };
          message = `✅ [${mutation.displayName}] 패키지가 ${displayOrder}번으로 추가되었습니다.`;
        } else {
          packageId = mutation.packageId;
          const rows = await transaction.query<Array<{
            display_name: string;
            description: string;
            display_order: number;
            enabled: number;
            deleted_at: Date | null;
            row_version: bigint;
          }>>(
            "SELECT display_name,description,display_order,enabled,deleted_at,row_version FROM package_catalog WHERE package_id=? FOR UPDATE",
            [packageId],
          );
          const target = rows[0];
          if (target === undefined || target.deleted_at !== null) {
            throw new PackageCatalogCommandError("PACKAGE_NOT_FOUND", "패키지 식별자를 확인해 주세요.");
          }
          previous = {
            displayName: target.display_name,
            description: target.description,
            displayOrder: target.display_order,
            enabled: Boolean(target.enabled),
            rowVersion: target.row_version.toString(),
          };
          if (mutation.action === "EDIT") {
            await replaceRewards(transaction, packageId, mutation.rewards);
            await transaction.execute(
              "UPDATE package_catalog SET max_open_count=1000,row_version=row_version+1,catalog_version=? WHERE package_id=?",
              [nextVersion.toString(), packageId],
            );
            current = { ...previous, rowVersion: (target.row_version + 1n).toString() };
            message = `✅ [${target.display_name}] 패키지 보상이 수정되었습니다.`;
          } else if (mutation.action === "REMOVE") {
            await transaction.execute(
              "UPDATE package_catalog SET enabled=0,deleted_at=UTC_TIMESTAMP(3),deleted_by=?,row_version=row_version+1,catalog_version=? WHERE package_id=?",
              [request.actorOperatorId, nextVersion.toString(), packageId],
            );
            await transaction.execute(
              "UPDATE package_catalog SET display_order=display_order-1,row_version=row_version+1,catalog_version=? WHERE deleted_at IS NULL AND display_order>?",
              [nextVersion.toString(), target.display_order],
            );
            current = { ...previous, enabled: false, deleted: true, rowVersion: (target.row_version + 1n).toString() };
            message = `✅ [${target.display_name}] 패키지가 목록에서 제거되었습니다.`;
          } else {
            await transaction.execute(
              "UPDATE package_catalog SET enabled=1,row_version=row_version+1,catalog_version=? WHERE package_id=?",
              [nextVersion.toString(), packageId],
            );
            current = { ...previous, enabled: true, rowVersion: (target.row_version + 1n).toString() };
            message = `✅ [${target.display_name}] 패키지가 활성화되었습니다.`;
          }
        }

        await transaction.execute(
          "UPDATE package_catalog_heads SET version=?,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE catalog_key='PACKAGE_CATALOG'",
          [nextVersion, request.actorOperatorId],
        );
        const result: PackageCatalogMutationResult = { replayed: false, catalogVersion: nextVersion, packageId, message };
        const actionCode = `package.catalog.${mutation.action.toLowerCase()}`;
        const requestedMutation = mutation.action === "ADD"
          ? {
              action: mutation.action,
              displayName: mutation.displayName,
              description: mutation.description,
              rewards: mutation.rewards.map((reward) => ({ ...reward, quantity: reward.quantity.toString() })),
            }
          : mutation.action === "EDIT"
            ? {
                action: mutation.action,
                packageId: mutation.packageId,
                rewards: mutation.rewards.map((reward) => ({ ...reward, quantity: reward.quantity.toString() })),
              }
            : { action: mutation.action, packageId: mutation.packageId };
        const change = {
          packageId,
          sourceCode: request.sourceCode,
          reason: request.reason,
          requestedMutation,
          previous,
          current,
          catalogVersionBefore: currentVersion.toString(),
          catalogVersionAfter: nextVersion.toString(),
        };
        await transaction.execute(
          `INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json,created_at)
           VALUES (?,?,?,?,UTC_TIMESTAMP(3))`,
          [configurationSetId, request.actorOperatorId, actionCode, JSON.stringify(change)],
        );
        await transaction.execute(
          `INSERT INTO command_audit
           (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
           VALUES (?,'admin_operator',?,'package_catalog',NULL,?,'success',?,?,UTC_TIMESTAMP(3))`,
          [operationId, request.actorOperatorId, actionCode, request.reason, JSON.stringify(change)],
        );
        const serializedResult = { ...result, catalogVersion: result.catalogVersion.toString() };
        await transaction.execute(
          `INSERT INTO package_catalog_mutations
           (request_key,operation_id,command_code,package_id,actor_operator_id,catalog_version,action_code,result_json)
           VALUES (?,?,?,?,?,?,?,?)`,
          [request.requestKey, operationId, webCommandCode(mutation.action), packageId, request.actorOperatorId, nextVersion, mutation.action, JSON.stringify(serializedResult)],
        );
        const stored: StoredWebMutation = { payloadFingerprint: request.payloadFingerprint, result: serializedResult };
        await transaction.execute(
          "UPDATE operations SET status='committed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
          [JSON.stringify(stored), operationId],
        );
        return result;
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
        throw new PackageCatalogCommandError("PACKAGE_CATALOG_VERSION_CONFLICT", "패키지 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
      }
      throw error;
    }
  }
}
