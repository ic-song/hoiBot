import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

type Numeric = bigint | number | string;
type GuildShopCommand =
  | { kind: "LIST"; commandCode: "GUILD_SHOP_LIST" }
  | { kind: "ADD"; commandCode: "GUILD_SHOP_ADD"; displayName: string; price: bigint }
  | { kind: "DELETE"; commandCode: "GUILD_SHOP_DELETE"; selector: string };

interface ActorRow { identity_id: Numeric; player_id: Numeric; }
interface OperatorRow { operator_id: Numeric; }
interface RolloutRow { rollout_state: string; enabled: number; }
interface StateRow { configuration_set_id: Numeric; catalog_version: Numeric; tax_rate_basis_points: number | null; lord_guild_name: string | null; }
interface ItemRow { product_id: string; item_id: Numeric | null; display_name: string; price: Numeric; daily_limit: number | null; display_order: number; version: Numeric; }

export interface GuildShopCatalogItem {
  productId: string;
  itemId: string | null;
  displayName: string;
  price: bigint;
  dailyLimit: number | null;
  displayOrder: number;
  version: bigint;
}

export interface GuildShopCatalogSnapshot {
  catalogVersion: bigint;
  taxRateBasisPoints: number;
  lordGuildName: string | null;
  items: readonly GuildShopCatalogItem[];
}

export interface GuildShopCatalogResult {
  status: "listed" | "added" | "updated" | "deleted";
  replayed: boolean;
  catalogVersion: string;
  productId: string | null;
  data: string;
  outboxId: string;
  auditId: string;
}

export interface LockedGuildShopItem {
  catalogVersion: bigint;
  item: GuildShopCatalogItem;
}

const MAX_PRICE = 999999999999999999999999999n;

// 길드상점 exact 명령과 인자 명령 후보만 공용 dispatch에 전달합니다.
export function isGuildShopCatalogCommandCandidate(message: string | undefined): boolean {
  return message === "/길드상점"
    || (message !== undefined && /^\/길드상점추가\s+.+$/.test(message))
    || (message !== undefined && /^\/길드상점삭제\s+.+$/.test(message));
}

// 레거시의 `상품명, 가격` 및 번호·이름 삭제 입력을 엄격한 명령으로 변환합니다.
export function parseGuildShopCatalogCommand(message: string | undefined): GuildShopCommand | null {
  if (message === "/길드상점") return { kind: "LIST", commandCode: "GUILD_SHOP_LIST" };
  if (message === undefined) return null;
  const add = /^\/길드상점추가\s+([^,\r\n]+), ([1-9]\d{0,26})$/.exec(message);
  if (add !== null) {
    const displayName = add[1]!.trim();
    const price = BigInt(add[2]!);
    if (displayName.length === 0 || price > MAX_PRICE) return null;
    return { kind: "ADD", commandCode: "GUILD_SHOP_ADD", displayName, price };
  }
  const remove = /^\/길드상점삭제\s+(.+\S|\S)$/.exec(message);
  if (remove !== null) return { kind: "DELETE", commandCode: "GUILD_SHOP_DELETE", selector: remove[1]!.trim() };
  return null;
}

// 큰 정수를 locale 의존성 없이 3자리 쉼표 문자열로 표시합니다.
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// basis point 세율을 레거시 사용자 표시용 퍼센트로 변환합니다.
function taxPercent(value: number): string { return (value / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"); }

// 안정된 display_order를 번호로 투영해 기존 길드상점 목록 의미를 유지합니다.
export function formatGuildShopCatalog(snapshot: GuildShopCatalogSnapshot): string {
  const lines = snapshot.items.length === 0
    ? "등록된 상품이 없습니다."
    : snapshot.items.map((item, index) => `${index + 1}. ${item.displayName} : ${commas(item.price)} Point${item.dailyLimit === null ? "" : ` (일일 ${item.dailyLimit}개)`}`).join("\n");
  return `🏪 길드 상점\n${lines}\n\n세율 : ${taxPercent(snapshot.taxRateBasisPoints)}%\n성주 길드 : ${snapshot.lordGuildName ?? "없음"}`;
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | GuildShopCatalogResult): GuildShopCatalogResult {
  return typeof value === "string" ? JSON.parse(value) as GuildShopCatalogResult : value;
}

// DB 숫자 행을 구매·표시가 공유하는 고정 상품 모델로 변환합니다.
function item(row: ItemRow): GuildShopCatalogItem {
  return { productId: row.product_id, itemId: row.item_id === null ? null : String(row.item_id), displayName: row.display_name,
    price: BigInt(row.price), dailyLimit: row.daily_limit, displayOrder: row.display_order, version: BigInt(row.version) };
}

// 전역 길드상점 카탈로그의 조회·관리 변경과 구매 잠금 경계를 제공합니다.
export class GuildShopCatalogService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<GuildShopCatalogResult | null> {
    if (!isGuildShopCatalogCommandCandidate(input.message)) return null;
    const command = parseGuildShopCatalogCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_GUILD_SHOP_COMMAND", "길드상점 명령 형식이 올바르지 않습니다.", 422);
    const rollout = (await this.database.query<RolloutRow[]>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [command.commandCode]))[0];
    if (rollout === undefined || rollout.enabled !== 1 || rollout.rollout_state !== "ACTIVE") return null;
    const actor = (await this.database.query<ActorRow[]>(
      "SELECT identity.id identity_id,identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL LIMIT 1",
      [input.externalUserId]
    ))[0];
    if (actor === undefined) return null;
    return command.kind === "LIST" ? this.list(input, actor, command) : this.mutate(input, actor, command);
  }

  // 구매 서비스가 같은 catalog lock 안에서 가격·한도·상품 ID를 소비하도록 합니다.
  async withLockedPurchaseItem<T>(input: { productId: string; expectedCatalogVersion: bigint }, work: (transaction: DatabaseTransaction, locked: LockedGuildShopItem) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => {
      const state = (await transaction.query<Array<{ catalog_version: Numeric }>>("SELECT catalog_version FROM guild_shop_catalog_state WHERE singleton_id=1 FOR UPDATE"))[0];
      if (state === undefined) throw new ApplicationError("GUILD_SHOP_CATALOG_REQUIRED", "길드상점 카탈로그가 준비되지 않았습니다.", 409);
      const catalogVersion = BigInt(state.catalog_version);
      if (catalogVersion !== input.expectedCatalogVersion) throw new ApplicationError("GUILD_SHOP_CATALOG_CONFLICT", "길드상점 목록이 변경되었습니다. 다시 확인해주세요.", 409);
      const row = (await transaction.query<ItemRow[]>("SELECT product_id,item_id,display_name,price,daily_limit,display_order,version FROM guild_shop_items WHERE product_id=? AND enabled=TRUE FOR UPDATE", [input.productId]))[0];
      if (row === undefined) throw new ApplicationError("GUILD_SHOP_ITEM_NOT_FOUND", "길드상점 상품을 찾을 수 없습니다.", 404);
      return work(transaction, { catalogVersion, item: item(row) });
    });
  }

  private async list(input: { channelId: string; eventId: string }, actor: ActorRow, command: Extract<GuildShopCommand, { kind: "LIST" }>): Promise<GuildShopCatalogResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | GuildShopCatalogResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='guild.shop.catalog.read' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return { ...stored(prior[0].result_json), replayed: true };
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.shop.catalog.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, actor.identity_id]);
      const state = (await transaction.query<StateRow[]>(`SELECT catalog.configuration_set_id,catalog.catalog_version,castle.tax_rate_basis_points,castle.lord_guild_name FROM guild_shop_catalog_state catalog LEFT JOIN castle_state castle ON castle.state_code='HOI_CASTLE' WHERE catalog.singleton_id=1 FOR UPDATE`))[0];
      if (state === undefined) throw new ApplicationError("GUILD_SHOP_CATALOG_REQUIRED", "길드상점 카탈로그가 준비되지 않았습니다.", 409);
      const rows = await transaction.query<ItemRow[]>("SELECT product_id,item_id,display_name,price,daily_limit,display_order,version FROM guild_shop_items WHERE enabled=TRUE ORDER BY display_order,id");
      const snapshot: GuildShopCatalogSnapshot = { catalogVersion: BigInt(state.catalog_version), taxRateBasisPoints: state.tax_rate_basis_points ?? 0, lordGuildName: state.lord_guild_name, items: rows.map(item) };
      const data = formatGuildShopCatalog(snapshot);
      return this.complete(transaction, input, operation.insertId, actor.identity_id, "external_identity", command.commandCode, "guild.shop.catalog.read", "listed", data, null, snapshot.catalogVersion, { itemCount: rows.length, domainMutation: false });
    });
  }

  private async mutate(input: { externalUserId: string; channelId: string; eventId: string }, actor: ActorRow, command: Exclude<GuildShopCommand, { kind: "LIST" }>): Promise<GuildShopCatalogResult> {
    return this.database.withTransaction(async (transaction) => {
      const operator = (await transaction.query<OperatorRow[]>(`SELECT mapping.operator_id FROM admin_operator_external_identities mapping JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE WHERE mapping.external_identity_id=? LIMIT 1`, [actor.identity_id]))[0];
      if (operator === undefined) throw new ApplicationError("GUILD_SHOP_ADMIN_REQUIRED", "❌ 길드상점 관리 권한이 없습니다.", 403);
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | GuildShopCatalogResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='guild.shop.catalog.mutate' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return { ...stored(prior[0].result_json), replayed: true };
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.shop.catalog.mutate',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, operator.operator_id]);
      const state = (await transaction.query<StateRow[]>("SELECT configuration_set_id,catalog_version,NULL tax_rate_basis_points,NULL lord_guild_name FROM guild_shop_catalog_state WHERE singleton_id=1 FOR UPDATE"))[0];
      if (state === undefined) throw new ApplicationError("GUILD_SHOP_CATALOG_REQUIRED", "길드상점 카탈로그가 준비되지 않았습니다.", 409);
      const beforeVersion = BigInt(state.catalog_version);
      let productId: string, status: GuildShopCatalogResult["status"], data: string;
      let previous: Record<string, unknown> | null = null, current: Record<string, unknown> | null = null;
      if (command.kind === "ADD") {
        const existing = (await transaction.query<ItemRow[]>("SELECT product_id,item_id,display_name,price,daily_limit,display_order,version FROM guild_shop_items WHERE display_name=? FOR UPDATE", [command.displayName]))[0];
        const dailyLimit = command.displayName.indexOf("메달") >= 0 ? 1 : null;
        if (existing === undefined) {
          const order = (await transaction.query<Array<{ next_order: Numeric }>>("SELECT COALESCE(MAX(display_order),0)+1 next_order FROM guild_shop_items FOR UPDATE"))[0]!.next_order;
          productId = randomUUID();
          await transaction.execute("INSERT INTO guild_shop_items(product_id,display_name,price,daily_limit,display_order,enabled,version) VALUES (?,?,?,?,?,TRUE,1)", [productId, command.displayName, command.price, dailyLimit, order]);
          status = "added"; data = `길드상점에 [${command.displayName}] 상품을 추가했습니다.`;
        } else {
          productId = existing.product_id;
          previous = { displayName: existing.display_name, price: String(existing.price), dailyLimit: existing.daily_limit, enabled: true, version: String(existing.version) };
          await transaction.execute("UPDATE guild_shop_items SET price=?,daily_limit=?,enabled=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE product_id=?", [command.price, dailyLimit, productId]);
          status = "updated"; data = `길드상점 [${command.displayName}] 상품 가격을 변경했습니다.`;
        }
        current = { displayName: command.displayName, price: command.price.toString(), dailyLimit, enabled: true };
      } else {
        const rows = await transaction.query<ItemRow[]>("SELECT product_id,item_id,display_name,price,daily_limit,display_order,version FROM guild_shop_items WHERE enabled=TRUE ORDER BY display_order,id FOR UPDATE");
        const selected = /^\d+$/.test(command.selector) ? rows[Number(command.selector) - 1] : rows.find((row) => row.display_name === command.selector);
        if (selected === undefined) throw new ApplicationError("GUILD_SHOP_ITEM_NOT_FOUND", "삭제할 길드상점 상품을 찾을 수 없습니다.", 404);
        productId = selected.product_id;
        previous = { displayName: selected.display_name, price: String(selected.price), dailyLimit: selected.daily_limit, enabled: true, version: String(selected.version) };
        await transaction.execute("UPDATE guild_shop_items SET enabled=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE product_id=?", [productId]);
        status = "deleted"; data = `길드상점에서 [${selected.display_name}] 상품을 삭제했습니다.`;
        current = { ...previous, enabled: false };
      }
      const updated = await transaction.execute("UPDATE guild_shop_catalog_state SET catalog_version=catalog_version+1,updated_at=UTC_TIMESTAMP(3) WHERE singleton_id=1 AND catalog_version=?", [beforeVersion]);
      if (updated.affectedRows !== 1n) throw new ApplicationError("GUILD_SHOP_CATALOG_CONFLICT", "길드상점 목록이 먼저 변경되었습니다.", 409);
      const afterVersion = beforeVersion + 1n;
      await transaction.execute("INSERT INTO guild_shop_catalog_events(operation_id,product_id,action_code,catalog_version_before,catalog_version_after,previous_json,current_json) VALUES (?,?,?,?,?,?,?)", [operation.insertId, productId, command.kind, beforeVersion, afterVersion, previous === null ? null : JSON.stringify(previous), current === null ? null : JSON.stringify(current)]);
      await transaction.execute("INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json,created_at) VALUES (?,?,?, ?,UTC_TIMESTAMP(3))", [state.configuration_set_id, operator.operator_id, command.kind === "ADD" ? "guild.shop.upsert" : "guild.shop.delete", JSON.stringify({ productId, previous, current, catalogVersionBefore: beforeVersion.toString(), catalogVersionAfter: afterVersion.toString() })]);
      return this.complete(transaction, input, operation.insertId, operator.operator_id, "admin_operator", command.commandCode, command.kind === "ADD" ? "guild.shop.catalog.upsert" : "guild.shop.catalog.delete", status, data, productId, afterVersion, { previous, current });
    });
  }

  private async complete(transaction: DatabaseTransaction, input: { channelId: string; eventId: string }, operationId: bigint, actorId: Numeric, actorType: "external_identity" | "admin_operator", commandCode: string, actionCode: string, status: GuildShopCatalogResult["status"], data: string, productId: string | null, catalogVersion: bigint, change: Record<string, unknown>): Promise<GuildShopCatalogResult> {
    const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.channelId, JSON.stringify({ data })]);
    await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, commandCode, operationId, status]);
    const audit = await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,?,?,'guild_shop_item',NULL,?,?,'Iris 길드상점 카탈로그',?,UTC_TIMESTAMP(3))", [operationId, actorType, actorId, actionCode, status, JSON.stringify({ ...change, productId, catalogVersion: catalogVersion.toString() })]);
    const result: GuildShopCatalogResult = { status, replayed: false, catalogVersion: catalogVersion.toString(), productId, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
    return result;
  }
}
