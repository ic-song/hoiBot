import { createHash, randomUUID } from "node:crypto";

import { createScopedDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { DiamondShopCatalogAdminService } from "./diamond-shop-catalog-admin-service.js";

const COMMAND = "/다이아상점구매";
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const MAX_DECIMAL_30 = 999_999_999_999_999_999_999_999_999_999n;

export type DiamondShopBuyCommand = { kind: "USAGE" } | { kind: "BUY"; listNumber: number; count: bigint };
export interface DiamondShopBuyInput { eventId: string; externalUserId: string; destinationId: string; message: string; }
export interface DiamondShopBuyResult {
  status: "usage" | "purchased" | "insufficient_diamond" | "unavailable" | "ignored_unregistered";
  playerId?: string;
  productId?: string;
  itemId?: string;
  purchaseCount?: string;
  rewardQuantity?: string;
  diamondSpent?: string;
  diamondBalanceAfter?: string;
  catalogVersion?: string;
  data?: string;
  outboxId?: string;
  auditId?: string;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface CatalogSelectionRow {
  product_id: string;
  display_name: string;
  reward_item_id: bigint | null;
  reward_quantity: string;
  diamond_price: string;
  catalog_version: bigint;
}
interface ItemRow { id: bigint; code: string; display_name: string; }

// 다이아상점 구매 명령을 사용법 또는 양의 정수 번호·수량으로만 해석합니다.
export function parseDiamondShopBuyCommand(message: string): DiamondShopBuyCommand | undefined {
  if (message === COMMAND) return { kind: "USAGE" };
  const match = /^\/다이아상점구매\s+([1-9]\d*)\s+([1-9]\d*)$/.exec(message);
  if (!match) return undefined;
  const listNumber = Number(match[1]);
  if (!Number.isSafeInteger(listNumber)) return undefined;
  return { kind: "BUY", listNumber, count: BigInt(match[2]!) };
}

// 인자형 구매 명령을 공용 command_aliases 기본 명령으로 정규화합니다.
export function normalizeDiamondShopBuyDispatchMessage(message: string): string {
  return parseDiamondShopBuyCommand(message) ? COMMAND : message;
}

// 접미 문구·음수·소수를 배제한 다이아상점 구매 후보만 반환합니다.
export function isDiamondShopBuyCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && parseDiamondShopBuyCommand(message) !== undefined;
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// command_executions FK가 참조하는 공용 Iris 수신 이벤트 키를 반환합니다.
function executionEventId(value: string): string {
  return value.startsWith("iris:") ? value : `iris:${value}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | DiamondShopBuyResult): DiamondShopBuyResult {
  return typeof value === "string" ? JSON.parse(value) as DiamondShopBuyResult : value;
}

// DECIMAL 정수 문자열을 손실 없는 bigint로 변환합니다.
function whole(value: string): bigint {
  const match = /^(\d+)(?:\.0+)?$/.exec(value);
  if (!match) throw new ApplicationError("DIAMOND_SHOP_NON_INTEGER", "다이아상점 수량을 정수로 확인할 수 없습니다.", 409);
  return BigInt(match[1]!);
}

// 동시 멱등성 insert 경합인지 확인합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// 다이아 차감·가방 지급·사용 이력·감사·outbox를 한 트랜잭션으로 처리합니다.
export class DiamondShopBuyService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: DiamondShopBuyInput): Promise<DiamondShopBuyResult> {
    const command = parseDiamondShopBuyCommand(input.message);
    if (!command) throw new ApplicationError("INVALID_DIAMOND_SHOP_BUY", "정확한 /다이아상점구매 [번호] [갯수]를 입력해주세요.", 422);
    if (command.kind === "USAGE") {
      return this.completeMessage(input, "usage", "사용법: /다이아상점구매 [번호] [갯수]");
    }
    const selected = (await this.database.query<CatalogSelectionRow[]>(
      `SELECT item.product_id,item.display_name,item.reward_item_id,
              CAST(item.reward_quantity AS CHAR) reward_quantity,CAST(item.diamond_price AS CHAR) diamond_price,
              state.catalog_version
         FROM diamond_shop_catalog_state state
         JOIN diamond_shop_catalog_items item ON item.enabled=TRUE
        WHERE state.singleton_id=1
        ORDER BY item.display_order,item.id LIMIT 1 OFFSET ?`, [command.listNumber - 1]
    ))[0];
    if (!selected) return this.completeMessage(input, "unavailable", "다이아상점 번호를 확인해주세요.");
    const key = eventKey(executionEventId(input.eventId));
    let replayScope: string | undefined;
    try {
      return await this.database.withTransaction(async (tx) => {
        const owner = await this.owner(tx, input.externalUserId);
        if (!owner) return { status: "ignored_unregistered" };
        replayScope = `diamond.shop.buy:${owner.identity_id}`;
        const prior = await tx.query<Array<{ result_json: string | DiamondShopBuyResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [replayScope, key]
        );
        if (prior[0]?.result_json !== undefined && prior[0]?.result_json !== null) return stored(prior[0].result_json);
        const catalog = new DiamondShopCatalogAdminService(createScopedDatabaseClient(tx));
        return catalog.withLockedProduct({ productId: selected.product_id, expectedCatalogVersion: selected.catalog_version }, async (lockedTx) => {
          const current = (await lockedTx.query<CatalogSelectionRow[]>(
            `SELECT product_id,display_name,reward_item_id,CAST(reward_quantity AS CHAR) reward_quantity,
                    CAST(diamond_price AS CHAR) diamond_price,? catalog_version
               FROM diamond_shop_catalog_items WHERE product_id=? AND enabled=TRUE FOR UPDATE`,
            [selected.catalog_version, selected.product_id]
          ))[0];
          if (!current) throw new ApplicationError("DIAMOND_SHOP_PRODUCT_CHANGED", "다이아상점 상품이 변경되었습니다. 다시 확인해주세요.", 409);
          const definitions = current.reward_item_id === null
            ? await lockedTx.query<ItemRow[]>(
              "SELECT id,code,display_name FROM item_definitions WHERE display_name=? AND active=TRUE AND stackable=TRUE ORDER BY id LIMIT 2",
              [current.display_name]
            )
            : await lockedTx.query<ItemRow[]>(
              "SELECT id,code,display_name FROM item_definitions WHERE id=? AND active=TRUE AND stackable=TRUE LIMIT 1",
              [current.reward_item_id]
            );
          const item = definitions.length === 1 ? definitions[0] : undefined;
          if (!item) return this.finishUnavailable(lockedTx, input, owner, replayScope!, key, current, command.count);
          if (current.reward_item_id === null) {
            await lockedTx.execute(
              "UPDATE diamond_shop_catalog_items SET reward_item_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE product_id=? AND reward_item_id IS NULL",
              [item.id, current.product_id]
            );
          }
          const unitReward = whole(current.reward_quantity);
          const unitPrice = whole(current.diamond_price);
          const totalReward = unitReward * command.count;
          const totalPrice = unitPrice * command.count;
          if (totalReward > MAX_UNSIGNED_BIGINT || totalPrice > MAX_DECIMAL_30) {
            throw new ApplicationError("DIAMOND_SHOP_TOTAL_OVERFLOW", "구매 수량이 처리 가능한 범위를 초과합니다.", 422);
          }
          const operation = await lockedTx.execute(
            "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
            [randomUUID(), replayScope, key, owner.identity_id]
          );
          await lockedTx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'diamond',0,0)", [owner.player_id]);
          const account = (await lockedTx.query<Array<{ balance: string; version: bigint }>>(
            "SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='diamond' FOR UPDATE", [owner.player_id]
          ))[0];
          if (!account) throw new ApplicationError("DIAMOND_ACCOUNT_REQUIRED", "다이아 계정을 확인할 수 없습니다.", 409);
          const balanceBefore = whole(account.balance);
          const status: DiamondShopBuyResult["status"] = balanceBefore < totalPrice ? "insufficient_diamond" : "purchased";
          const balanceAfter = status === "purchased" ? balanceBefore - totalPrice : balanceBefore;
          if (status === "purchased") {
            const currencyWrite = await lockedTx.execute(
              "UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='diamond' AND version=?",
              [balanceAfter.toString(), owner.player_id, account.version]
            );
            if (currencyWrite.affectedRows !== 1n) throw new ApplicationError("DIAMOND_SHOP_CONFLICT", "다이아 정보가 먼저 변경되었습니다.", 409);
            await lockedTx.execute(
              "INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'diamond',?,?,'DIAMOND_SHOP_PURCHASE')",
              [operation.insertId, owner.player_id, (-totalPrice).toString(), balanceAfter.toString()]
            );
            if (totalReward > 0n) {
              await lockedTx.execute(
                "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1",
                [owner.player_id, item.id, totalReward.toString()]
              );
              await lockedTx.execute(
                "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'DIAMOND_SHOP_PURCHASE')",
                [operation.insertId, owner.player_id, item.id, totalReward.toString()]
              );
            }
          }
          const data = status === "purchased"
            ? `✅ 다이아상점 구매 완료\n상품: ${current.display_name} x${totalReward}\n구매 수량: ${command.count}\n사용 다이아: ${totalPrice}\n남은 다이아: ${balanceAfter}`
            : "다이아가 부족합니다.";
          return this.finish(lockedTx, input, owner, operation.insertId, current, item.id, command.count, totalReward, totalPrice,
            balanceAfter, status, data);
        });
      });
    } catch (error) {
      if (!isDuplicateKeyError(error) || replayScope === undefined) throw error;
      const prior = await this.database.query<Array<{ result_json: string | DiamondShopBuyResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [replayScope, key]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return stored(prior[0].result_json);
    }
  }

  // 미등록 사용자는 legacy와 동일하게 무응답 처리합니다.
  private async owner(tx: DatabaseTransaction, externalUserId: string): Promise<OwnerRow | undefined> {
    return (await tx.query<OwnerRow[]>(
      `SELECT identity.id identity_id,identity.player_id FROM external_identities identity
        JOIN players player ON player.id=identity.player_id AND player.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND identity.player_id IS NOT NULL FOR UPDATE`, [externalUserId]
    ))[0];
  }

  // 사용법·없는 번호 응답도 멱등 실행·감사·outbox로 기록합니다.
  private async completeMessage(input: DiamondShopBuyInput, status: "usage" | "unavailable", data: string): Promise<DiamondShopBuyResult> {
    const key = eventKey(executionEventId(input.eventId));
    let replayScope: string | undefined;
    try {
      return await this.database.withTransaction(async (tx) => {
        const owner = await this.owner(tx, input.externalUserId);
        if (!owner) return { status: "ignored_unregistered" };
        replayScope = `diamond.shop.buy:${owner.identity_id}`;
        const prior = await tx.query<Array<{ result_json: string | DiamondShopBuyResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [replayScope, key]
        );
        if (prior[0]?.result_json !== undefined && prior[0]?.result_json !== null) return stored(prior[0].result_json);
        const operation = await tx.execute(
          "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
          [randomUUID(), replayScope, key, owner.identity_id]
        );
        return this.finishSimple(tx, input, owner, operation.insertId, status, data);
      });
    } catch (error) {
      if (!isDuplicateKeyError(error) || replayScope === undefined) throw error;
      const prior = await this.database.query<Array<{ result_json: string | DiamondShopBuyResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [replayScope, key]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return stored(prior[0].result_json);
    }
  }

  // 상품 보상 정의가 없거나 중복이면 재화·가방을 건드리지 않고 unavailable을 기록합니다.
  private async finishUnavailable(tx: DatabaseTransaction, input: DiamondShopBuyInput, owner: OwnerRow, scope: string, key: string,
    product: CatalogSelectionRow, count: bigint): Promise<DiamondShopBuyResult> {
    const operation = await tx.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
      [randomUUID(), scope, key, owner.identity_id]
    );
    await tx.execute(
      `INSERT INTO diamond_shop_purchase_events(operation_id,product_id,player_id,reward_item_id,purchase_count,reward_quantity,
        diamond_spent,diamond_balance_after,catalog_version,status_code,legacy_memo)
       VALUES (?,?,?,NULL,?,0,0,0,?,'unavailable',?)`,
      [operation.insertId, product.product_id, owner.player_id, count.toString(), product.catalog_version,
        `상품=${product.display_name}; 사유=보상 아이템 정의 없음 또는 중복`]
    );
    return this.finishSimple(tx, input, owner, operation.insertId, "unavailable", "상품 보상 정보를 확인하고 있습니다. 잠시 후 다시 시도해주세요.");
  }

  // 구매 결과와 표준 실행 증거를 저장하고 outbox 응답을 생성합니다.
  private async finish(tx: DatabaseTransaction, input: DiamondShopBuyInput, owner: OwnerRow, operationId: bigint,
    product: CatalogSelectionRow, itemId: bigint, purchaseCount: bigint, rewardQuantity: bigint, diamondSpent: bigint,
    diamondBalanceAfter: bigint, status: "purchased" | "insufficient_diamond", data: string): Promise<DiamondShopBuyResult> {
    await tx.execute(
      `INSERT INTO diamond_shop_purchase_events(operation_id,product_id,player_id,reward_item_id,purchase_count,reward_quantity,
        diamond_spent,diamond_balance_after,catalog_version,status_code,legacy_memo) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [operationId, product.product_id, owner.player_id, itemId, purchaseCount.toString(), rewardQuantity.toString(),
        diamondSpent.toString(), diamondBalanceAfter.toString(), product.catalog_version, status,
        `상품=${product.display_name}; 구매수량=${purchaseCount}; 지급수량=${rewardQuantity}; 사용다이아=${diamondSpent}`]
    );
    const audit = await tx.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'diamond.shop.buy',?,'Iris /다이아상점구매',?,UTC_TIMESTAMP(3))",
      [operationId, owner.identity_id, owner.player_id, status, JSON.stringify({ productId: product.product_id, itemId: itemId.toString(), purchaseCount: purchaseCount.toString(), rewardQuantity: rewardQuantity.toString(), diamondSpent: diamondSpent.toString(), diamondBalanceAfter: diamondBalanceAfter.toString(), catalogVersion: product.catalog_version.toString() })]
    );
    await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'DIAMOND_SHOP_BUY',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE operation_id=VALUES(operation_id),execution_status='completed',result_code=VALUES(result_code),completed_at=UTC_TIMESTAMP(3)", [executionEventId(input.eventId), operationId, status]);
    const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data })]);
    const result: DiamondShopBuyResult = { status, playerId: owner.player_id.toString(), productId: product.product_id,
      itemId: itemId.toString(), purchaseCount: purchaseCount.toString(), rewardQuantity: rewardQuantity.toString(),
      diamondSpent: diamondSpent.toString(), diamondBalanceAfter: diamondBalanceAfter.toString(), catalogVersion: product.catalog_version.toString(),
      data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
    return result;
  }

  // 비구매 응답의 표준 감사·실행·outbox·멱등 결과를 저장합니다.
  private async finishSimple(tx: DatabaseTransaction, input: DiamondShopBuyInput, owner: OwnerRow, operationId: bigint,
    status: "usage" | "unavailable", data: string): Promise<DiamondShopBuyResult> {
    const audit = await tx.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'diamond.shop.buy',?,'Iris /다이아상점구매',?,UTC_TIMESTAMP(3))",
      [operationId, owner.identity_id, owner.player_id, status, JSON.stringify({ mutation: false, status })]
    );
    await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'DIAMOND_SHOP_BUY',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE operation_id=VALUES(operation_id),execution_status='completed',result_code=VALUES(result_code),completed_at=UTC_TIMESTAMP(3)", [executionEventId(input.eventId), operationId, status]);
    const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data })]);
    const result: DiamondShopBuyResult = { status, playerId: owner.player_id.toString(), data,
      outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
    return result;
  }
}
