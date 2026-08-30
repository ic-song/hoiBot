import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  DiamondShopCatalogAdminService,
  type DiamondShopCatalogSnapshot,
} from "./diamond-shop-catalog-admin-service.js";

type Numeric = bigint | number | string;
type CatalogReader = Pick<DiamondShopCatalogAdminService, "readSnapshot">;

interface WebRequestBase {
  source: string;
  operatorId: string;
  idempotencyKey: string;
  expectedVersion: bigint;
  reason: string;
}

export interface DiamondShopCatalogWebAddRequest extends WebRequestBase {
  displayName: string;
  quantity: bigint;
  price: bigint;
}

export interface DiamondShopCatalogWebSoftDisableRequest extends WebRequestBase {
  productId: string;
}

export interface DiamondShopCatalogWebMutationResult {
  status: "added" | "disabled";
  replayed: boolean;
  productId: string;
  catalogVersion: string;
  operationId: string;
  auditId: string;
}

type NormalizedMutation =
  | (WebRequestBase & { action: "ADD"; displayName: string; quantity: bigint; price: bigint })
  | (WebRequestBase & { action: "DISABLE"; productId: string });

interface StateRow {
  configuration_set_id: Numeric;
  catalog_version: Numeric;
  bootstrap_source: string;
  bootstrap_version: string;
  bootstrap_status: string;
}

interface ItemRow {
  product_id: string;
  display_name: string;
  reward_quantity: Numeric;
  diamond_price: Numeric;
  display_order: number;
  version: Numeric;
}

interface OperationRow {
  id: Numeric;
  result_json: string | StoredMutationEnvelope | null;
}

interface StoredMutationEnvelope {
  payloadFingerprint: string;
  result: DiamondShopCatalogWebMutationResult;
}

const IDEMPOTENCY_SCOPE = "diamond.shop.catalog.web";
const SOURCE_CODE = "admin_web";
const MAX_VALUE = 999999999999999999999999999999n;

function applicationError(code: string, message: string, statusCode: number): ApplicationError {
  return new ApplicationError(code, message, statusCode);
}

function nonempty(value: string, code: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw applicationError(code, `${label} 값이 올바르지 않습니다.`, 422);
  }
  return normalized;
}

function normalizeBase(input: WebRequestBase): WebRequestBase {
  const operatorId = nonempty(input.operatorId, "DIAMOND_SHOP_OPERATOR_INVALID", "operatorId", 20);
  if (!/^\d+$/.test(operatorId)) {
    throw applicationError("DIAMOND_SHOP_OPERATOR_INVALID", "operatorId 값이 올바르지 않습니다.", 422);
  }
  if (input.expectedVersion < 0n) {
    throw applicationError("DIAMOND_SHOP_CATALOG_VERSION_INVALID", "expectedVersion 값이 올바르지 않습니다.", 422);
  }
  return {
    source: nonempty(input.source, "DIAMOND_SHOP_SOURCE_INVALID", "source", 191),
    operatorId,
    idempotencyKey: nonempty(input.idempotencyKey, "DIAMOND_SHOP_IDEMPOTENCY_KEY_INVALID", "idempotencyKey", 500),
    expectedVersion: input.expectedVersion,
    reason: nonempty(input.reason, "DIAMOND_SHOP_REASON_REQUIRED", "reason", 500),
  };
}

function normalizeAdd(input: DiamondShopCatalogWebAddRequest): NormalizedMutation {
  const base = normalizeBase(input);
  if (input.quantity < 0n || input.quantity > MAX_VALUE || input.price < 0n || input.price > MAX_VALUE) {
    throw applicationError("DIAMOND_SHOP_PRODUCT_VALUE_INVALID", "상품 수량 또는 가격이 올바르지 않습니다.", 422);
  }
  return {
    ...base,
    action: "ADD",
    displayName: nonempty(input.displayName, "DIAMOND_SHOP_PRODUCT_NAME_INVALID", "displayName", 191),
    quantity: input.quantity,
    price: input.price,
  };
}

function normalizeDisable(input: DiamondShopCatalogWebSoftDisableRequest): NormalizedMutation {
  return {
    ...normalizeBase(input),
    action: "DISABLE",
    productId: nonempty(input.productId, "DIAMOND_SHOP_PRODUCT_ID_INVALID", "productId", 36),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function namespacedKey(input: NormalizedMutation): string {
  return `sha256:${sha256(JSON.stringify([input.source, input.operatorId, input.idempotencyKey]))}`;
}

function payloadFingerprint(input: NormalizedMutation): string {
  const payload = input.action === "ADD"
    ? {
        action: input.action,
        expectedVersion: input.expectedVersion.toString(),
        reason: input.reason,
        displayName: input.displayName,
        quantity: input.quantity.toString(),
        price: input.price.toString(),
      }
    : {
        action: input.action,
        expectedVersion: input.expectedVersion.toString(),
        reason: input.reason,
        productId: input.productId,
      };
  return sha256(JSON.stringify(payload));
}

function storedEnvelope(value: string | StoredMutationEnvelope): StoredMutationEnvelope {
  return typeof value === "string" ? JSON.parse(value) as StoredMutationEnvelope : value;
}

// web mutation 시점에 활성 operator와 manager/super_admin 역할을 transaction 내부에서 다시 확인합니다.
async function requireOperator(transaction: DatabaseTransaction, operatorId: string): Promise<void> {
  const rows = await transaction.query<Array<{ operator_id: Numeric }>>(
    `SELECT operator.id operator_id FROM admin_operators operator
     JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
     JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
     WHERE operator.id=? AND operator.status='active' AND role.code IN ('manager','super_admin') LIMIT 1`,
    [operatorId],
  );
  if (rows[0] === undefined) {
    throw applicationError("DIAMOND_SHOP_ADMIN_REQUIRED", "다이아상점 관리 권한이 없습니다.", 403);
  }
}

// 기존 Iris catalog service를 유지하면서 operator 기반 web mutation 경계만 제공합니다.
export class DiamondShopCatalogWebAdapterProvider {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly catalog: CatalogReader = new DiamondShopCatalogAdminService(database),
  ) {}

  public async readSnapshot(): Promise<DiamondShopCatalogSnapshot> {
    return this.catalog.readSnapshot();
  }

  public async add(input: DiamondShopCatalogWebAddRequest): Promise<DiamondShopCatalogWebMutationResult> {
    return this.mutate(normalizeAdd(input));
  }

  public async softDisable(input: DiamondShopCatalogWebSoftDisableRequest): Promise<DiamondShopCatalogWebMutationResult> {
    return this.mutate(normalizeDisable(input));
  }

  // 권한·멱등성·catalog version·변경 event·audit을 하나의 MariaDB transaction으로 커밋합니다.
  private async mutate(input: NormalizedMutation): Promise<DiamondShopCatalogWebMutationResult> {
    const requestKey = namespacedKey(input);
    const fingerprint = payloadFingerprint(input);
    return this.database.withTransaction(async (transaction) => {
      await requireOperator(transaction, input.operatorId);
      const inserted = await transaction.execute(
        `INSERT IGNORE INTO operations
         (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,?,'processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), IDEMPOTENCY_SCOPE, requestKey, input.operatorId, SOURCE_CODE],
      );
      const operation = (await transaction.query<OperationRow[]>(
        "SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [IDEMPOTENCY_SCOPE, requestKey],
      ))[0];
      if (operation === undefined) throw new Error("DIAMOND_SHOP_WEB_OPERATION_NOT_FOUND");
      if (inserted.affectedRows === 0n) {
        if (operation.result_json === null) {
          throw applicationError("DIAMOND_SHOP_IDEMPOTENCY_IN_PROGRESS", "같은 요청을 처리 중입니다.", 409);
        }
        const prior = storedEnvelope(operation.result_json);
        if (prior.payloadFingerprint !== fingerprint) {
          throw applicationError("DIAMOND_SHOP_IDEMPOTENCY_CONFLICT", "같은 idempotency key에 다른 요청 payload를 사용할 수 없습니다.", 409);
        }
        return { ...prior.result, replayed: true };
      }

      const state = (await transaction.query<StateRow[]>(
        `SELECT configuration_set_id,catalog_version,bootstrap_source,bootstrap_version,bootstrap_status
         FROM diamond_shop_catalog_state WHERE singleton_id=1 FOR UPDATE`,
      ))[0];
      if (state === undefined) {
        throw applicationError("DIAMOND_SHOP_CATALOG_REQUIRED", "다이아상점 카탈로그가 준비되지 않았습니다.", 409);
      }
      const beforeVersion = BigInt(state.catalog_version);
      if (beforeVersion !== input.expectedVersion) {
        throw applicationError("DIAMOND_SHOP_CATALOG_CONFLICT", "다이아상점 목록이 먼저 변경되었습니다.", 409);
      }

      let productId: string;
      let previous: Record<string, unknown> | null = null;
      let current: Record<string, unknown>;
      if (input.action === "ADD") {
        const nextOrder = (await transaction.query<Array<{ next_order: Numeric }>>(
          "SELECT COALESCE(MAX(display_order),0)+1 next_order FROM diamond_shop_catalog_items FOR UPDATE",
        ))[0]!.next_order;
        productId = randomUUID();
        await transaction.execute(
          `INSERT INTO diamond_shop_catalog_items
           (product_id,display_name,reward_quantity,diamond_price,display_order,enabled,version)
           VALUES (?,?,?,?,?,TRUE,1)`,
          [productId, input.displayName, input.quantity, input.price, nextOrder],
        );
        current = {
          displayName: input.displayName,
          quantity: input.quantity.toString(),
          price: input.price.toString(),
          enabled: true,
          version: "1",
        };
      } else {
        const selected = (await transaction.query<ItemRow[]>(
          `SELECT product_id,display_name,reward_quantity,diamond_price,display_order,version
           FROM diamond_shop_catalog_items WHERE product_id=? AND enabled=TRUE FOR UPDATE`,
          [input.productId],
        ))[0];
        if (selected === undefined) {
          throw applicationError("DIAMOND_SHOP_PRODUCT_NOT_FOUND", "다이아상점 상품을 찾을 수 없습니다.", 404);
        }
        productId = selected.product_id;
        previous = {
          displayName: selected.display_name,
          quantity: String(selected.reward_quantity),
          price: String(selected.diamond_price),
          displayOrder: selected.display_order,
          enabled: true,
          version: String(selected.version),
        };
        current = { ...previous, enabled: false, version: (BigInt(selected.version) + 1n).toString() };
        const disabled = await transaction.execute(
          `UPDATE diamond_shop_catalog_items SET enabled=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3)
           WHERE product_id=? AND enabled=TRUE AND version=?`,
          [productId, selected.version],
        );
        if (disabled.affectedRows !== 1n) {
          throw applicationError("DIAMOND_SHOP_CATALOG_CONFLICT", "다이아상점 상품이 먼저 변경되었습니다.", 409);
        }
      }

      const updated = await transaction.execute(
        `UPDATE diamond_shop_catalog_state SET catalog_version=catalog_version+1,updated_at=UTC_TIMESTAMP(3)
         WHERE singleton_id=1 AND catalog_version=?`,
        [beforeVersion],
      );
      if (updated.affectedRows !== 1n) {
        throw applicationError("DIAMOND_SHOP_CATALOG_CONFLICT", "다이아상점 목록이 먼저 변경되었습니다.", 409);
      }
      const afterVersion = beforeVersion + 1n;
      await transaction.execute(
        `INSERT INTO diamond_shop_catalog_events
         (operation_id,product_id,action_code,catalog_version_before,catalog_version_after,previous_json,current_json)
         VALUES (?,?,?,?,?,?,?)`,
        [operation.id, productId, input.action === "ADD" ? "ADD" : "DELETE", beforeVersion, afterVersion, previous === null ? null : JSON.stringify(previous), JSON.stringify(current)],
      );
      await transaction.execute(
        `INSERT INTO configuration_change_log
         (configuration_set_id,actor_id,action_code,change_json,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))`,
        [state.configuration_set_id, input.operatorId, input.action === "ADD" ? "diamond.shop.add" : "diamond.shop.delete", JSON.stringify({
          source: input.source,
          productId,
          previous,
          current,
          reason: input.reason,
          catalogVersionBefore: beforeVersion.toString(),
          catalogVersionAfter: afterVersion.toString(),
          bootstrapSource: state.bootstrap_source,
          bootstrapVersion: state.bootstrap_version,
          bootstrapStatus: state.bootstrap_status,
        })],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
         (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'diamond_shop_product',NULL,?,'success',?,?,UTC_TIMESTAMP(3))`,
        [operation.id, input.operatorId, input.action === "ADD" ? "diamond.shop.catalog.web.add" : "diamond.shop.catalog.web.disable", input.reason, JSON.stringify({
          source: input.source,
          productId,
          previous,
          current,
          catalogVersion: afterVersion.toString(),
        })],
      );
      const result: DiamondShopCatalogWebMutationResult = {
        status: input.action === "ADD" ? "added" : "disabled",
        replayed: false,
        productId,
        catalogVersion: afterVersion.toString(),
        operationId: String(operation.id),
        auditId: audit.insertId.toString(),
      };
      const envelope: StoredMutationEnvelope = { payloadFingerprint: fingerprint, result };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(envelope), operation.id],
      );
      return result;
    });
  }
}
