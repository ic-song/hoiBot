import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { PointShopCatalogError } from "./point-shop-catalog-command.js";
import type {
  PointShopCatalogMutationRequest,
  PointShopCatalogMutationResult,
  PointShopCatalogRepository,
} from "./point-shop-catalog-service.js";

interface ReplayRow { result_json: string }

// 운영자 역할과 개인 allow/deny를 transaction 내부에서 판정합니다.
async function requirePointShopPermission(transaction: DatabaseTransaction, operatorId: string): Promise<void> {
  const operators = await transaction.query<Array<{ status: string }>>("SELECT status FROM admin_operators WHERE id=?", [operatorId]);
  if (operators[0]?.status !== "active") throw new PointShopCatalogError("FORBIDDEN", "상점 관리 권한이 없습니다.");
  const overrides = await transaction.query<Array<{ effect: "allow" | "deny" }>>(
    "SELECT effect FROM admin_operator_permission_overrides WHERE operator_id=? AND permission_code='point_shop.catalog.manage' LIMIT 1",
    [operatorId],
  );
  if (overrides[0]?.effect === "deny") throw new PointShopCatalogError("FORBIDDEN", "상점 관리 권한이 없습니다.");
  if (overrides[0]?.effect === "allow") return;
  const roles = await transaction.query<Array<{ allowed: number }>>(
    `SELECT 1 AS allowed FROM admin_operator_roles operator_role
     JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
     JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
     WHERE operator_role.operator_id=? AND permission.permission_code='point_shop.catalog.manage' LIMIT 1`,
    [operatorId],
  );
  if (!roles[0]) throw new PointShopCatalogError("FORBIDDEN", "상점 관리 권한이 없습니다.");
}

export class MariaPointShopCatalogRepository implements PointShopCatalogRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // 완료된 request 결과를 mutation 재실행 전에 조회합니다.
  public async findReplay(requestKey: string): Promise<PointShopCatalogMutationResult | undefined> {
    const rows = await this.database.query<ReplayRow[]>("SELECT result_json FROM point_shop_catalog_mutations WHERE request_key=?", [requestKey]);
    if (!rows[0]) return undefined;
    const saved = JSON.parse(rows[0].result_json) as Omit<PointShopCatalogMutationResult, "catalogVersion"> & { catalogVersion: string };
    return { ...saved, catalogVersion: BigInt(saved.catalogVersion), replayed: true };
  }

  // stable 표시 순서와 포인트 가격, 성 세율·성주 길드 projection을 조회합니다.
  public async readSnapshot() {
    const [heads, entries, states] = await Promise.all([
      this.database.query<Array<{ version: bigint }>>("SELECT version FROM point_shop_catalog_heads WHERE catalog_key='POINT_SHOP'"),
      this.database.query<Array<{ product_id: string; product_key: string; display_name: string; display_order: number; price: bigint; row_version: bigint }>>(
        `SELECT product_id,product_key,display_name,display_order,price,row_version
         FROM point_shop_catalog WHERE enabled=1 AND deleted_at IS NULL ORDER BY display_order,product_id`,
      ),
      this.database.query<Array<{ tax_rate_basis_points: number; lord_guild_name: string | null }>>(
        "SELECT tax_rate_basis_points,lord_guild_name FROM castle_state WHERE state_code='HOI_CASTLE'",
      ),
    ]);
    if (!heads[0]) throw new Error("POINT_SHOP_CATALOG_HEAD_NOT_FOUND");
    return {
      catalogVersion: heads[0].version,
      taxRateBasisPoints: states[0]?.tax_rate_basis_points ?? 0,
      lordGuildName: states[0]?.lord_guild_name ?? undefined,
      entries: entries.map((entry) => ({
        productId: entry.product_id,
        productKey: entry.product_key,
        displayName: entry.display_name,
        displayOrder: entry.display_order,
        price: BigInt(entry.price),
        rowVersion: entry.row_version,
      })),
    };
  }

  // 권한·head lock·stable 상품 변경·감사·outbox를 하나의 transaction으로 커밋합니다.
  public async mutate(request: PointShopCatalogMutationRequest): Promise<PointShopCatalogMutationResult> {
    try {
      return await this.database.withTransaction(async (transaction) => {
        const replay = await transaction.query<ReplayRow[]>("SELECT result_json FROM point_shop_catalog_mutations WHERE request_key=? FOR UPDATE", [request.requestKey]);
        if (replay[0]) {
          const saved = JSON.parse(replay[0].result_json) as Omit<PointShopCatalogMutationResult, "catalogVersion"> & { catalogVersion: string };
          return { ...saved, catalogVersion: BigInt(saved.catalogVersion), replayed: true };
        }
        await requirePointShopPermission(transaction, request.actorOperatorId);
        const heads = await transaction.query<Array<{ version: bigint }>>(
          "SELECT version FROM point_shop_catalog_heads WHERE catalog_key='POINT_SHOP' FOR UPDATE",
        );
        const currentVersion = heads[0]?.version;
        if (currentVersion === undefined) throw new Error("POINT_SHOP_CATALOG_HEAD_NOT_FOUND");
        if (currentVersion !== request.expectedCatalogVersion) {
          throw new PointShopCatalogError("POINT_SHOP_VERSION_CONFLICT", "상점 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
        }
        const nextVersion = currentVersion + 1n;
        const operation = await transaction.execute(
          `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status)
           VALUES (?, 'point_shop.catalog.admin', ?, 'admin', ?, 'iris', 'processing')`,
          [randomUUID(), request.requestKey, request.actorOperatorId],
        );
        let productId: string;
        let message: string;
        if (request.mutation.action === "UPSERT") {
          const existing = await transaction.query<Array<{ product_id: string; display_order: number; deleted_at: Date | null }>>(
            "SELECT product_id,display_order,deleted_at FROM point_shop_catalog WHERE display_name=? ORDER BY deleted_at IS NULL DESC,product_id LIMIT 1 FOR UPDATE",
            [request.mutation.displayName],
          );
          if (existing[0]) {
            productId = existing[0].product_id;
            const displayOrder = existing[0].deleted_at === null ? existing[0].display_order : request.mutation.displayOrder;
            await transaction.execute(
              `UPDATE point_shop_catalog SET price=?,display_order=?,enabled=1,deleted_at=NULL,deleted_by=NULL,
               catalog_version=?,row_version=row_version+1 WHERE product_id=?`,
              [request.mutation.price, displayOrder, nextVersion, productId],
            );
          } else {
            productId = `PS-${randomUUID()}`;
            const productKey = `POINT-SHOP-${nextVersion.toString().padStart(8, "0")}`;
            await transaction.execute(
              `INSERT INTO point_shop_catalog
               (product_id,product_key,display_name,price,display_order,catalog_version,enabled,row_version)
               VALUES (?,?,?,?,?,?,1,1)`,
              [productId, productKey, request.mutation.displayName, request.mutation.price, request.mutation.displayOrder, nextVersion],
            );
          }
          message = `✅ [${request.mutation.displayName}] 상품이 ${request.mutation.price.toString()} Point로 저장되었습니다.`;
        } else {
          const targets = await transaction.query<Array<{ display_name: string; display_order: number; deleted_at: Date | null }>>(
            "SELECT display_name,display_order,deleted_at FROM point_shop_catalog WHERE product_id=? FOR UPDATE",
            [request.mutation.productId],
          );
          const target = targets[0];
          if (!target || target.deleted_at) throw new PointShopCatalogError("POINT_SHOP_PRODUCT_NOT_FOUND", "상점 번호를 확인해 주세요.");
          productId = request.mutation.productId;
          await transaction.execute(
            "UPDATE point_shop_catalog SET enabled=0,deleted_at=UTC_TIMESTAMP(3),deleted_by=?,catalog_version=?,row_version=row_version+1 WHERE product_id=?",
            [request.actorOperatorId, nextVersion, productId],
          );
          await transaction.execute(
            "UPDATE point_shop_catalog SET display_order=display_order-1,catalog_version=?,row_version=row_version+1 WHERE enabled=1 AND deleted_at IS NULL AND display_order>?",
            [nextVersion, target.display_order],
          );
          message = `✅ [${target.display_name}] 상품이 상점에서 삭제되었습니다.`;
        }
        await transaction.execute(
          "UPDATE point_shop_catalog_heads SET version=?,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE catalog_key='POINT_SHOP'",
          [nextVersion, request.actorOperatorId],
        );
        let result: PointShopCatalogMutationResult = { replayed: false, catalogVersion: nextVersion, productId, message };
        await transaction.execute(
          `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,completed_at)
           VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3))`,
          [request.requestKey, request.commandCode, operation.insertId],
        );
        await transaction.execute(
          `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json)
           VALUES (?,'admin',?,'point_shop_catalog',NULL,?,'success',?)`,
          [operation.insertId, request.actorOperatorId, request.commandCode, JSON.stringify({ productId, catalogVersion: nextVersion.toString(), mutation: request.mutation.action })],
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
          `INSERT INTO point_shop_catalog_mutations
           (request_key,operation_id,command_code,product_id,actor_operator_id,catalog_version,action_code,result_json)
           VALUES (?,?,?,?,?,?,?,?)`,
          [request.requestKey, operation.insertId, request.commandCode, productId, request.actorOperatorId, nextVersion, request.mutation.action, JSON.stringify({ ...result, catalogVersion: nextVersion.toString() })],
        );
        await transaction.execute(
          "UPDATE operations SET status='committed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
          [JSON.stringify({ ...result, catalogVersion: nextVersion.toString() }), operation.insertId],
        );
        return result;
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
        throw new PointShopCatalogError("POINT_SHOP_VERSION_CONFLICT", "상점 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
      }
      throw error;
    }
  }
}
