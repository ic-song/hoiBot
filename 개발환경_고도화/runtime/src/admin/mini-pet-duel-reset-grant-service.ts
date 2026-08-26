import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const ITEM_CODE = "ITEM-MINI-PET-DUEL-RESET-TICKET";
const ITEM_NAME = "미니펫대전리셋권🐹";
export type MiniPetDuelResetGrantCommand = { amount: bigint; targetLegacyKey: string } | { amount: 0n; targetLegacyKey: string } | null;
export type MiniPetDuelResetGrantResult = { status: "granted" | "usage" | "invalid_amount" | "no_target"; data: string; outboxId: string; quantity?: string };

// 레거시 `/대전[수량], 대상키` 전체 형식만 관리자 지급 후보로 허용합니다.
export function isMiniPetDuelResetGrantCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/대전\d*,.*$/.test(message);
}

// 레거시 기본 수량 1과 쉼표 뒤 회원 키를 보존해 파싱합니다.
export function parseMiniPetDuelResetGrantCommand(message: string): MiniPetDuelResetGrantCommand {
  const match = /^\/대전(\d*)?,\s*(.+)$/.exec(message);
  if (match === null) return null;
  const amount = BigInt(match[1] == null || match[1] === "" ? "1" : match[1]);
  return { amount, targetLegacyKey: match[2]!.trim() };
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; operatorId: string; targetId: bigint | null;
  resultCode: string; data: string; result: Omit<MiniPetDuelResetGrantResult, "outboxId">; summary: Record<string, unknown>;
}): Promise<MiniPetDuelResetGrantResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId,input.destinationId,JSON.stringify({ data: input.data })]
  );
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_MINI_PET_DUEL_RESET_GRANT',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'inventory.mini_pet_duel_reset.grant',?,'Iris 총괄 운영자 /대전',?,UTC_TIMESTAMP(3))", [input.operationId,input.operatorId,input.targetId,input.resultCode,JSON.stringify(input.summary)]);
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),input.operationId]);
  return result;
}

// 총괄 운영자의 미니펫 대전 리셋권 stack 지급과 응답 원장을 원자 처리합니다.
export class MiniPetDuelResetGrantService {
  constructor(private readonly database: DatabaseClient) {}

  async grant(input: { eventId: string; destinationId: string; operatorId: string; message: string }): Promise<MiniPetDuelResetGrantResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | MiniPetDuelResetGrantResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='admin.mini_pet_duel_reset.grant' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as MiniPetDuelResetGrantResult : prior[0].result_json;
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'admin.mini_pet_duel_reset.grant',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(),key,input.operatorId]);
      const command = parseMiniPetDuelResetGrantCommand(input.message);
      if (command === null) return complete(transaction,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,targetId:null,resultCode:"usage",data:"올바른 형식으로 입력해 주세요. 예: /대전10, 유저아이디",result:{status:"usage",data:""},summary:{mutation:false} });
      if (command.amount === 0n) return complete(transaction,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,targetId:null,resultCode:"invalid_amount",data:"지급 개수는 1개 이상이어야 합니다.",result:{status:"invalid_amount",data:""},summary:{mutation:false,amount:"0"} });
      const targets = await transaction.query<Array<{ player_id: bigint }>>(
        `SELECT candidate.player_id FROM (
           SELECT map.player_id,0 priority FROM legacy_identity_map map WHERE map.legacy_key=?
           UNION ALL SELECT profile.player_id,1 priority FROM player_profiles profile WHERE profile.current_display_name=?
         ) candidate JOIN players player ON player.id=candidate.player_id AND player.status='active'
         GROUP BY candidate.player_id ORDER BY MIN(candidate.priority),candidate.player_id LIMIT 2 FOR UPDATE`,
        [command.targetLegacyKey,command.targetLegacyKey]
      );
      if (targets.length !== 1) return complete(transaction,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,targetId:null,resultCode:"no_target",data:"유저 아이디를 확인해 주세요.",result:{status:"no_target",data:""},summary:{mutation:false,targetLegacyKey:command.targetLegacyKey,matchCount:targets.length} });
      const target = targets[0]!;
      const definitions = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE LIMIT 1 FOR UPDATE", [ITEM_CODE]);
      const definition = definitions[0];
      if (definition === undefined) throw new Error("미니펫 대전 리셋권 DB 정의가 필요합니다.");
      await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)", [target.player_id,definition.id]);
      const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [target.player_id,definition.id]);
      const nextQuantity = stacks[0]!.quantity + command.amount;
      await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=?", [nextQuantity,target.player_id,definition.id]);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'ADMIN_MINI_PET_DUEL_RESET_GRANT')", [operation.insertId,target.player_id,definition.id,command.amount]);
      const data = `${command.targetLegacyKey}님에게 ${ITEM_NAME} ${command.amount.toString()}개를 지급했습니다.`;
      return complete(transaction,{ operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,targetId:target.player_id,resultCode:"granted",data,result:{status:"granted",data:"",quantity:nextQuantity.toString()},summary:{targetLegacyKey:command.targetLegacyKey,itemCode:ITEM_CODE,amount:command.amount.toString(),quantity:nextQuantity.toString()} });
    });
  }
}
