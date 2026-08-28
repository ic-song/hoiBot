import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface DiamondShopReadResult {
  data: string;
  catalogVersion: string;
  rowCount: number;
  replayed: boolean;
  outboxId?: string;
}

interface CatalogItemRow {
  display_name: string;
  reward_quantity: string;
  diamond_price: string;
}

// 다이아 상점 조회 후보를 인자 없는 정확 일치 명령으로 제한합니다.
export function isDiamondShopReadCommandCandidate(message: string | undefined): boolean {
  return message === "/다이아상점";
}

// 다이아 상점 조회 명령을 dispatcher 별칭으로 정규화합니다.
export function normalizeDiamondShopReadDispatchMessage(message: string): string {
  return isDiamondShopReadCommandCandidate(message) ? "/다이아상점" : message;
}

// 활성 사용자에게 현재 고정 카탈로그를 일관된 순서로 조회해 제공합니다.
export class DiamondShopReadService {
  public constructor(private readonly database: DatabaseClient) {}

  public async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<DiamondShopReadResult | null> {
    if (!isDiamondShopReadCommandCandidate(input.message)) return null;
    const eventId = input.eventId.startsWith("iris:") ? input.eventId : `iris:${input.eventId}`;
    return this.database.withTransaction(async (transaction) => {
      const identities = await transaction.query<Array<{ player_id: bigint }>>(
        `SELECT identity.player_id FROM external_identities identity
         JOIN players player ON player.id=identity.player_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=?
           AND identity.status='linked' AND player.status='active'
         ORDER BY identity.id LIMIT 2 FOR UPDATE`,
        [input.externalUserId],
      );
      if (identities.length !== 1) return null;
      const playerId = identities[0]!.player_id;
      const prior = await transaction.query<Array<{ result_json: string | DiamondShopReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='diamond_shop.catalog_read' AND idempotency_key=? FOR UPDATE",
        [eventId],
      );
      if (prior.length === 1 && prior[0]!.result_json) {
        const stored = typeof prior[0]!.result_json === "string" ? JSON.parse(prior[0]!.result_json) as DiamondShopReadResult : prior[0]!.result_json;
        return { ...stored, replayed: true };
      }
      const states = await transaction.query<Array<{ catalog_version: bigint }>>(
        "SELECT catalog_version FROM diamond_shop_catalog_state WHERE singleton_id=1 FOR UPDATE",
      );
      if (states.length !== 1) throw new Error("DIAMOND_SHOP_CATALOG_STATE_MISSING");
      const rows = await transaction.query<CatalogItemRow[]>(
        `SELECT display_name,reward_quantity,diamond_price FROM diamond_shop_catalog_items
         WHERE enabled=TRUE ORDER BY display_order,id FOR UPDATE`,
      );
      const catalogVersion = states[0]!.catalog_version.toString();
      const lines = ["[💎 다이아상점 💎]", `카탈로그 v${catalogVersion}`];
      if (rows.length === 0) lines.push("현재 구매할 수 있는 상품이 없습니다.");
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        lines.push(`${index + 1}. ${row.display_name} x${row.reward_quantity} - 💎${row.diamond_price}`);
      }
      lines.push("", "사용법: /다이아상점구매 [번호] [갯수]");
      const data = lines.join("\n");
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'diamond_shop.catalog_read',?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), eventId, playerId],
      );
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'DIAMOND_SHOP_CATALOG_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [eventId, operation.insertId],
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'diamond_shop_catalog',NULL,'diamond_shop.catalog_read','success','Iris /다이아상점',?,UTC_TIMESTAMP(3))",
        [operation.insertId, playerId, JSON.stringify({ catalogVersion, rowCount: rows.length, mutation: false })],
      );
      const result: DiamondShopReadResult = { data, catalogVersion, rowCount: rows.length, replayed: false, outboxId: outbox.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
