import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface MiniPetBulkSaleCommand {
  externalUserId: string; channelId: string; eventId: string; message: string; environmentCode: "prod" | "dev";
}
export interface MiniPetBulkSaleResult {
  status: "sold" | "invalid_command" | "invalid_range" | "ignored_missing_member" | "snapshot_required" | "sale_blocked";
  data?: string; playerId?: string; stableOwnedIds?: string[]; soldCount?: number;
  pointDelta?: string; pointBalance?: string; outboxId?: string; replayed?: boolean;
}
interface TargetRow {
  owned_mini_pet_id: bigint; mini_pet_definition_id: bigint; stable_owned_id: string; sort_index: number;
  state_code: string | null; protected: number; locked: number; bound: number; listed: number; equipped: number;
  title_count: bigint; display_name: string; point_price: string | null; sellable: number | null;
}

// 기본 사용법 또는 완전한 양수 범위 명령만 후보로 인정합니다.
export function isMiniPetBulkSaleCommand(message: string | undefined): boolean {
  return message === "/미니펫지정판매"
    || (message !== undefined && /^\/미니펫지정판매\s+[1-9][0-9]*\s+[1-9][0-9]*$/.test(message));
}

// 시작·끝 가방번호를 분리하고 역방향 범위를 별도 상태로 남깁니다.
export function parseMiniPetBulkSaleCommand(message: string): { start: number; end: number } | null {
  const match = /^\/미니펫지정판매\s+([1-9][0-9]*)\s+([1-9][0-9]*)$/.exec(message);
  return match === null ? null : { start: Number(match[1]), end: Number(match[2]) };
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function stored(value: string | MiniPetBulkSaleResult): MiniPetBulkSaleResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetBulkSaleResult : value;
}

export class MiniPetBulkSaleService {
  constructor(private readonly database: DatabaseClient) {}

  // 범위 대상 전체를 검증한 뒤 lifecycle·재화·이벤트를 all-or-nothing으로 기록합니다.
  async execute(command: MiniPetBulkSaleCommand): Promise<MiniPetBulkSaleResult> {
    const range = parseMiniPetBulkSaleCommand(command.message);
    if (range === null) return { status: "invalid_command", data: "사용법: /미니펫지정판매 [시작번호] [끝번호]" };
    if (range.start > range.end || range.end > 100) {
      return { status: "invalid_range", data: "시작번호는 끝번호보다 작거나 같고, 범위는 1~100이어야 합니다." };
    }
    return this.database.withTransaction(async (tx) => {
      const environment = await tx.query<Array<{ environment_code: string }>>(
        "SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id = 1 FOR UPDATE"
      );
      if (environment[0]?.environment_code !== command.environmentCode) {
        throw new ApplicationError("MINIPET_BULK_SALE_ENVIRONMENT_MISMATCH", "요청 환경과 DB 환경이 일치하지 않습니다.", 409);
      }
      const owners = await tx.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        "SELECT id identity_id, player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL LIMIT 1 FOR UPDATE",
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_missing_member" };
      const scope = `mini_pet.bulk_sale:${owner.player_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | MiniPetBulkSaleResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
      );
      if (prior[0] !== undefined) {
        if (prior[0].result_json === null) throw new ApplicationError("MINIPET_BULK_SALE_PROCESSING", "일괄 판매가 진행 중입니다.", 409);
        return { ...stored(prior[0].result_json), replayed: true };
      }
      const targets = await tx.query<TargetRow[]>(
        `SELECT owned.id owned_mini_pet_id, owned.mini_pet_definition_id, state.stable_owned_id, state.sort_index,
          lifecycle.state_code, COALESCE(lifecycle.protected,FALSE) protected, COALESCE(lifecycle.locked,FALSE) locked,
          COALESCE(lifecycle.bound,FALSE) bound, COALESCE(lifecycle.listed,FALSE) listed, owned.equipped,
          (SELECT COUNT(*) FROM mini_pet_title_assignments title WHERE title.owned_mini_pet_id=owned.id) title_count,
          COALESCE(owned.custom_name,definition.display_name) display_name, policy.point_price, policy.sellable
         FROM mini_pet_inventory_owned_states state
         JOIN owned_mini_pets owned ON owned.id=state.owned_mini_pet_id AND owned.player_id=state.player_id
         JOIN mini_pet_definitions definition ON definition.id=owned.mini_pet_definition_id
         LEFT JOIN mini_pet_owned_lifecycle lifecycle ON lifecycle.owned_mini_pet_id=owned.id
         LEFT JOIN mini_pet_sale_policies policy ON policy.mini_pet_definition_id=owned.mini_pet_definition_id
         WHERE state.player_id=? AND state.sort_index BETWEEN ? AND ?
         ORDER BY state.sort_index FOR UPDATE`, [owner.player_id, range.start, range.end]
      );
      if (targets.length === 0) return { status: "snapshot_required", data: "미니펫 가방을 다시 확인한 뒤 판매해 주세요." };
      const blocked = targets.find(target => target.state_code === "sold" || Boolean(target.equipped)
        || Boolean(target.protected) || Boolean(target.locked) || Boolean(target.bound) || Boolean(target.listed)
        || target.title_count > 0n || target.sellable !== 1 || target.point_price === null);
      if (blocked !== undefined) return { status: "sale_blocked", data: `${blocked.display_name} 때문에 범위 전체를 판매하지 않았습니다.` };

      await tx.execute("INSERT IGNORE INTO currency_accounts (player_id,currency_code,balance,version) VALUES (?,'point',0,1)", [owner.player_id]);
      const accounts = await tx.query<Array<{ balance: string; version: bigint }>>(
        "SELECT balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [owner.player_id]
      );
      const account = accounts[0]!;
      const pointDelta = targets.reduce((sum, target) => sum + BigInt(target.point_price!.split(".")[0] ?? "0"), 0n);
      const balance = BigInt(account.balance.split(".")[0] ?? "0") + pointDelta;
      const operation = await tx.execute(
        "INSERT INTO operations (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      await tx.execute(
        "INSERT INTO mini_pet_bulk_sale_events (operation_id,player_id,start_sort_index,end_sort_index,sold_count,point_proceeds) VALUES (?,?,?,?,?,?)",
        [operation.insertId, owner.player_id, range.start, range.end, targets.length, pointDelta]
      );
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]!;
        await tx.execute("INSERT INTO mini_pet_owned_lifecycle (owned_mini_pet_id,player_id,state_code,version) VALUES (?,?,'active',1) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)", [target.owned_mini_pet_id, owner.player_id]);
        const changed = await tx.execute(
          "UPDATE mini_pet_owned_lifecycle SET state_code='sold',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE owned_mini_pet_id=? AND player_id=? AND state_code='active' AND protected=FALSE AND locked=FALSE AND bound=FALSE AND listed=FALSE",
          [target.owned_mini_pet_id, owner.player_id]
        );
        if (changed.affectedRows !== 1n) throw new ApplicationError("MINIPET_BULK_SALE_CONFLICT", "대상 상태가 변경되어 전체 판매를 취소했습니다.", 409);
        await tx.execute(
          "INSERT INTO mini_pet_bulk_sale_entries (operation_id,ordinal,owned_mini_pet_id,stable_owned_id,mini_pet_definition_id,point_proceeds) VALUES (?,?,?,?,?,?)",
          [operation.insertId, index + 1, target.owned_mini_pet_id, target.stable_owned_id, target.mini_pet_definition_id, target.point_price]
        );
      }
      const remaining = await tx.query<Array<{ owned_mini_pet_id: bigint }>>(
        `SELECT state.owned_mini_pet_id FROM mini_pet_inventory_owned_states state
         LEFT JOIN mini_pet_owned_lifecycle lifecycle ON lifecycle.owned_mini_pet_id=state.owned_mini_pet_id
         WHERE state.player_id=? AND COALESCE(lifecycle.state_code,'active')='active'
         ORDER BY state.sort_index, state.owned_mini_pet_id FOR UPDATE`, [owner.player_id]
      );
      await tx.execute("UPDATE mini_pet_inventory_owned_states SET sort_index=NULL,version=version+1 WHERE player_id=? AND sort_index IS NOT NULL", [owner.player_id]);
      for (let index = 0; index < remaining.length; index += 1) {
        await tx.execute("UPDATE mini_pet_inventory_owned_states SET sort_index=?,version=version+1 WHERE owned_mini_pet_id=?", [index + 1, remaining[index]!.owned_mini_pet_id]);
      }
      const currency = await tx.execute(
        "UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",
        [balance, owner.player_id, account.version]
      );
      if (currency.affectedRows !== 1n) throw new Error("Mini-pet bulk sale point version conflict.");
      await tx.execute("INSERT INTO currency_ledger (operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'mini_pet_bulk_sale')", [operation.insertId, owner.player_id, pointDelta, balance]);
      const data = `미니펫 ${targets.length}마리를 판매했습니다.\n획득 포인트: ${pointDelta.toLocaleString("ko-KR")}P`;
      const outbox = await tx.execute("INSERT INTO outbox_messages (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, command.channelId, JSON.stringify({ data })]);
      await tx.execute("INSERT INTO command_executions (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'mini_pet_bulk_sale',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [command.eventId, operation.insertId]);
      await tx.execute("INSERT INTO command_audit (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'mini_pet.bulk_sale','success','Iris /미니펫지정판매',?,UTC_TIMESTAMP(3))", [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ range, stableOwnedIds: targets.map(target=>target.stable_owned_id), pointDelta: pointDelta.toString() })]);
      const result: MiniPetBulkSaleResult = { status:"sold", data, playerId:owner.player_id.toString(),
        stableOwnedIds:targets.map(target=>target.stable_owned_id), soldCount:targets.length,
        pointDelta:pointDelta.toString(), pointBalance:balance.toString(), outboxId:outbox.insertId.toString(), replayed:false };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
