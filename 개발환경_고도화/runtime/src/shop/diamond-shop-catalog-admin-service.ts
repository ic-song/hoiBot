import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

type Numeric = bigint | number | string;
type DiamondShopCommand =
  | { kind: "ADD"; commandCode: "DIAMOND_SHOP_CATALOG_ADD"; displayName: string; quantity: bigint; price: bigint }
  | { kind: "DELETE"; commandCode: "DIAMOND_SHOP_CATALOG_DELETE"; ordinal: number };
interface ActorRow { identity_id: Numeric; }
interface OperatorRow { operator_id: Numeric; }
interface StateRow { configuration_set_id: Numeric; catalog_version: Numeric; bootstrap_source: string; bootstrap_version: string; bootstrap_status: string; }
interface ItemRow { product_id: string; display_name: string; reward_quantity: Numeric; diamond_price: Numeric; display_order: number; version: Numeric; }

export interface DiamondShopCatalogItem {
  productId: string; displayName: string; quantity: bigint; price: bigint; displayOrder: number; version: bigint;
}
export interface DiamondShopCatalogSnapshot {
  catalogVersion: bigint; bootstrapSource: string; bootstrapVersion: string; bootstrapStatus: string; items: readonly DiamondShopCatalogItem[];
}
export interface DiamondShopCatalogAdminResult {
  status: "added" | "deleted"; replayed: boolean; productId: string; catalogVersion: string; data: string; outboxId: string; auditId: string;
}
export interface LockedDiamondShopProduct { catalogVersion: bigint; product: DiamondShopCatalogItem; }

const MAX_VALUE = 999999999999999999999999999999n;

// 다이아상점 관리자 인자 명령 후보만 공용 dispatch에 전달합니다.
export function isDiamondShopCatalogAdminCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && (/^\/다이아상점추가\s+.+$/.test(message) || /^\/다이아상점삭제\s+\d+$/.test(message));
}

// greedy 상품명과 0을 포함한 레거시 count/price, 숫자 ordinal을 안전한 명령으로 변환합니다.
export function parseDiamondShopCatalogAdminCommand(message: string | undefined): DiamondShopCommand | null {
  if (message === undefined) return null;
  const add = /^\/다이아상점추가\s+(.+)\s+(\d+)\s+(\d+)$/.exec(message);
  if (add !== null) {
    const quantity = BigInt(add[2]!), price = BigInt(add[3]!);
    if (quantity > MAX_VALUE || price > MAX_VALUE) return null;
    return { kind: "ADD", commandCode: "DIAMOND_SHOP_CATALOG_ADD", displayName: add[1]!.trim(), quantity, price };
  }
  const remove = /^\/다이아상점삭제\s+(\d+)$/.exec(message);
  if (remove !== null) {
    const ordinal = Number(remove[1]!);
    if (!Number.isSafeInteger(ordinal)) return null;
    return { kind: "DELETE", commandCode: "DIAMOND_SHOP_CATALOG_DELETE", ordinal };
  }
  return null;
}

function key(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | DiamondShopCatalogAdminResult): DiamondShopCatalogAdminResult {
  return typeof value === "string" ? JSON.parse(value) as DiamondShopCatalogAdminResult : value;
}
function product(row: ItemRow): DiamondShopCatalogItem {
  return { productId: row.product_id, displayName: row.display_name, quantity: BigInt(row.reward_quantity), price: BigInt(row.diamond_price), displayOrder: row.display_order, version: BigInt(row.version) };
}

// 다이아 상점 추가·삭제와 구매 소비자가 공유하는 versioned catalog lock을 제공합니다.
export class DiamondShopCatalogAdminService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<DiamondShopCatalogAdminResult | null> {
    if (!isDiamondShopCatalogAdminCommandCandidate(input.message)) return null;
    const command = parseDiamondShopCatalogAdminCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_DIAMOND_SHOP_CATALOG_COMMAND", "다이아상점 명령 형식이 올바르지 않습니다.", 422);
    const rollout = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [command.commandCode]))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state !== "ACTIVE") return null;
    const actor = (await this.database.query<ActorRow[]>("SELECT id identity_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1", [input.externalUserId]))[0];
    if (actor === undefined) return null;
    return this.mutate(input, actor, command);
  }

  // 구매 서비스가 동일 catalog revision에서 stable product를 잠근 채 소비하도록 합니다.
  async withLockedProduct<T>(input: { productId: string; expectedCatalogVersion: bigint }, work: (transaction: DatabaseTransaction, locked: LockedDiamondShopProduct) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => {
      const state = (await transaction.query<Array<{ catalog_version: Numeric }>>("SELECT catalog_version FROM diamond_shop_catalog_state WHERE singleton_id=1 FOR UPDATE"))[0];
      if (state === undefined) throw new ApplicationError("DIAMOND_SHOP_CATALOG_REQUIRED", "다이아상점 카탈로그가 준비되지 않았습니다.", 409);
      const version = BigInt(state.catalog_version);
      if (version !== input.expectedCatalogVersion) throw new ApplicationError("DIAMOND_SHOP_CATALOG_CONFLICT", "다이아상점 목록이 변경되었습니다.", 409);
      const row = (await transaction.query<ItemRow[]>("SELECT product_id,display_name,reward_quantity,diamond_price,display_order,version FROM diamond_shop_catalog_items WHERE product_id=? AND enabled=TRUE FOR UPDATE", [input.productId]))[0];
      if (row === undefined) throw new ApplicationError("DIAMOND_SHOP_PRODUCT_NOT_FOUND", "다이아상점 상품을 찾을 수 없습니다.", 404);
      return work(transaction, { catalogVersion: version, product: product(row) });
    });
  }

  // 현재 bootstrap 출처와 활성 ordinal projection을 읽습니다.
  async readSnapshot(): Promise<DiamondShopCatalogSnapshot> {
    return this.database.withTransaction(async (transaction) => {
      const state = (await transaction.query<StateRow[]>("SELECT configuration_set_id,catalog_version,bootstrap_source,bootstrap_version,bootstrap_status FROM diamond_shop_catalog_state WHERE singleton_id=1 FOR UPDATE"))[0];
      if (state === undefined) throw new ApplicationError("DIAMOND_SHOP_CATALOG_REQUIRED", "다이아상점 카탈로그가 준비되지 않았습니다.", 409);
      const rows = await transaction.query<ItemRow[]>("SELECT product_id,display_name,reward_quantity,diamond_price,display_order,version FROM diamond_shop_catalog_items WHERE enabled=TRUE ORDER BY display_order,id");
      return { catalogVersion: BigInt(state.catalog_version), bootstrapSource: state.bootstrap_source, bootstrapVersion: state.bootstrap_version, bootstrapStatus: state.bootstrap_status, items: rows.map(product) };
    });
  }

  private async mutate(input: { channelId: string; eventId: string }, actor: ActorRow, command: DiamondShopCommand): Promise<DiamondShopCatalogAdminResult> {
    return this.database.withTransaction(async (transaction) => {
      const operator = (await transaction.query<OperatorRow[]>(`SELECT mapping.operator_id FROM admin_operator_external_identities mapping JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE WHERE mapping.external_identity_id=? LIMIT 1`, [actor.identity_id]))[0];
      if (operator === undefined) throw new ApplicationError("DIAMOND_SHOP_ADMIN_REQUIRED", "❌ 다이아상점 관리 권한이 없습니다.", 403);
      const eventKey = key(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | DiamondShopCatalogAdminResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='diamond.shop.catalog.mutate' AND idempotency_key=? FOR UPDATE", [eventKey]);
      if (prior[0]?.result_json != null) return { ...stored(prior[0].result_json), replayed: true };
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'diamond.shop.catalog.mutate',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), eventKey, operator.operator_id]);
      const state = (await transaction.query<StateRow[]>("SELECT configuration_set_id,catalog_version,bootstrap_source,bootstrap_version,bootstrap_status FROM diamond_shop_catalog_state WHERE singleton_id=1 FOR UPDATE"))[0];
      if (state === undefined) throw new ApplicationError("DIAMOND_SHOP_CATALOG_REQUIRED", "다이아상점 카탈로그가 준비되지 않았습니다.", 409);
      const beforeVersion = BigInt(state.catalog_version);
      let productId: string, data: string, previous: Record<string, unknown> | null = null, current: Record<string, unknown> | null = null;
      if (command.kind === "ADD") {
        const order = (await transaction.query<Array<{ next_order: Numeric }>>("SELECT COALESCE(MAX(display_order),0)+1 next_order FROM diamond_shop_catalog_items FOR UPDATE"))[0]!.next_order;
        productId = randomUUID();
        await transaction.execute("INSERT INTO diamond_shop_catalog_items(product_id,display_name,reward_quantity,diamond_price,display_order,enabled,version) VALUES (?,?,?,?,?,TRUE,1)", [productId, command.displayName, command.quantity, command.price, order]);
        current = { displayName: command.displayName, quantity: command.quantity.toString(), price: command.price.toString(), enabled: true };
        data = `다이아상점에 [${command.displayName}] ${command.quantity}개 · ${command.price}다이아 상품을 추가했습니다.`;
      } else {
        const rows = await transaction.query<ItemRow[]>("SELECT product_id,display_name,reward_quantity,diamond_price,display_order,version FROM diamond_shop_catalog_items WHERE enabled=TRUE ORDER BY display_order,id FOR UPDATE");
        const selected = rows[command.ordinal - 1];
        if (selected === undefined) throw new ApplicationError("DIAMOND_SHOP_PRODUCT_NOT_FOUND", "삭제할 다이아상점 상품 번호가 없습니다.", 404);
        productId = selected.product_id;
        previous = { displayName: selected.display_name, quantity: String(selected.reward_quantity), price: String(selected.diamond_price), enabled: true, version: String(selected.version) };
        current = { ...previous, enabled: false };
        await transaction.execute("UPDATE diamond_shop_catalog_items SET enabled=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE product_id=?", [productId]);
        data = `다이아상점에서 [${selected.display_name}] 상품을 삭제했습니다.`;
      }
      const updated = await transaction.execute("UPDATE diamond_shop_catalog_state SET catalog_version=catalog_version+1,updated_at=UTC_TIMESTAMP(3) WHERE singleton_id=1 AND catalog_version=?", [beforeVersion]);
      if (updated.affectedRows !== 1n) throw new ApplicationError("DIAMOND_SHOP_CATALOG_CONFLICT", "다이아상점 목록이 먼저 변경되었습니다.", 409);
      const afterVersion = beforeVersion + 1n;
      await transaction.execute("INSERT INTO diamond_shop_catalog_events(operation_id,product_id,action_code,catalog_version_before,catalog_version_after,previous_json,current_json) VALUES (?,?,?,?,?,?,?)", [operation.insertId, productId, command.kind, beforeVersion, afterVersion, previous === null ? null : JSON.stringify(previous), current === null ? null : JSON.stringify(current)]);
      await transaction.execute("INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json,created_at) VALUES (?,?,?, ?,UTC_TIMESTAMP(3))", [state.configuration_set_id, operator.operator_id, command.kind === "ADD" ? "diamond.shop.add" : "diamond.shop.delete", JSON.stringify({ productId, previous, current, catalogVersionBefore: beforeVersion.toString(), catalogVersionAfter: afterVersion.toString(), bootstrapSource: state.bootstrap_source, bootstrapVersion: state.bootstrap_version, bootstrapStatus: state.bootstrap_status })]);
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, command.commandCode, operation.insertId, command.kind.toLowerCase()]);
      const audit = await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'diamond_shop_product',NULL,?,?,'Iris 다이아상점 카탈로그',?,UTC_TIMESTAMP(3))", [operation.insertId, operator.operator_id, command.kind === "ADD" ? "diamond.shop.catalog.add" : "diamond.shop.catalog.delete", command.kind.toLowerCase(), JSON.stringify({ productId, previous, current, catalogVersion: afterVersion.toString() })]);
      const result: DiamondShopCatalogAdminResult = { status: command.kind === "ADD" ? "added" : "deleted", replayed: false, productId, catalogVersion: afterVersion.toString(), data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
