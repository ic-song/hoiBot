import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const MAX_GRANT_QUANTITY = 9_223_372_036_854_775_807n;
const MAX_TARGET_COUNT = 100;

export interface SupportGrantManualCommand {
  targetNames: string[];
  itemReference: string;
  quantity: bigint;
}

export interface SupportGrantManualResult {
  data: string;
  outboxId: string;
  itemCode: string;
  itemDisplayName: string;
  quantity: string;
  targets: Array<{ playerId: string; displayName: string }>;
}

// 후원지급 후보를 대상·아이템·수량의 전체 형식으로 제한합니다.
export function isSupportGrantManualCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/후원지급\s+.+\/.+\/\d{1,20}$/.test(message);
}

// 쉼표 대상 목록을 중복 제거하고 아이템 표현 및 수량을 분리합니다.
export function parseSupportGrantManualCommand(message: string): SupportGrantManualCommand | null {
  const match = /^\/후원지급\s+(.+?)\/(.+)\/(\d{1,20})$/.exec(message);
  if (match === null) return null;
  const targetNames: string[] = [];
  const seen = new Set<string>();
  for (const rawName of match[1]!.split(",")) {
    const name = rawName.trim();
    if (name !== "" && !seen.has(name)) {
      seen.add(name);
      targetNames.push(name);
    }
  }
  return { targetNames, itemReference: match[2]!.trim(), quantity: BigInt(match[3]!) };
}

// 등록된 stack 아이템을 여러 회원에게 감사·원장·응답과 함께 원자 지급합니다.
export class SupportGrantManualService {
  constructor(private readonly database: DatabaseClient) {}

  async grant(input: { message: string; idempotencyKey: string; sourceEventId: string; destinationId: string; operatorId: string; operatorDisplayName: string }): Promise<SupportGrantManualResult> {
    const command = parseSupportGrantManualCommand(input.message);
    if (command === null || command.targetNames.length === 0 || command.itemReference === "") {
      throw new ApplicationError("INVALID_SUPPORT_GRANT_COMMAND", "올바른 형식으로 입력해 주세요. 예: /후원지급 회원1,회원2/아이템코드/3", 422);
    }
    if (command.targetNames.length > MAX_TARGET_COUNT) throw new ApplicationError("TOO_MANY_SUPPORT_GRANT_TARGETS", "한 번에 최대 100명까지 지급할 수 있습니다.", 422);
    if (command.quantity < 1n || command.quantity > MAX_GRANT_QUANTITY) throw new ApplicationError("INVALID_SUPPORT_GRANT_QUANTITY", "지급 수량은 1 이상이어야 합니다.", 422);

    const scope = "inventory.support.grant";
    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | SupportGrantManualResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.idempotencyKey]
      );
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;

      const codeMatches = await transaction.query<Array<{ id: bigint; code: string; display_name: string; stackable: number }>>(
        "SELECT id,code,display_name,stackable FROM item_definitions WHERE active=TRUE AND code=? LIMIT 1", [command.itemReference]
      );
      let item = codeMatches[0];
      if (item === undefined) {
        const nameMatches = await transaction.query<Array<{ id: bigint; code: string; display_name: string; stackable: number }>>(
          "SELECT id,code,display_name,stackable FROM item_definitions WHERE active=TRUE AND display_name=? ORDER BY code LIMIT 2", [command.itemReference]
        );
        if (nameMatches.length > 1) throw new ApplicationError("SUPPORT_GRANT_ITEM_AMBIGUOUS", "동일 표시명의 아이템이 여러 개입니다. 아이템 코드를 입력해 주세요.", 409);
        item = nameMatches[0];
      }
      if (item === undefined) throw new ApplicationError("SUPPORT_GRANT_ITEM_NOT_FOUND", "등록된 활성 아이템을 찾을 수 없습니다.", 404);
      if (item.stackable !== 1) throw new ApplicationError("SUPPORT_GRANT_ITEM_NOT_STACKABLE", "이 명령은 수량형 가방 아이템만 지급할 수 있습니다.", 422);

      const targets: Array<{ playerId: bigint; displayName: string }> = [];
      const playerIds = new Set<string>();
      for (const requestedName of command.targetNames) {
        const matches = await transaction.query<Array<{ player_id: bigint; display_name: string }>>(
          `SELECT DISTINCT resolved.player_id,profile.current_display_name display_name
           FROM (
             SELECT player_id FROM legacy_identity_map WHERE legacy_key=?
             UNION
             SELECT player_id FROM player_profiles WHERE current_display_name=?
           ) resolved
           JOIN players player ON player.id=resolved.player_id AND player.status='active'
           JOIN player_profiles profile ON profile.player_id=resolved.player_id
           ORDER BY resolved.player_id LIMIT 2`,
          [requestedName, requestedName]
        );
        if (matches.length === 0) throw new ApplicationError("SUPPORT_GRANT_TARGET_NOT_FOUND", `❌ [${requestedName}] 님은 존재하지 않습니다.`, 404);
        if (matches.length > 1) throw new ApplicationError("SUPPORT_GRANT_TARGET_AMBIGUOUS", `❌ [${requestedName}] 이름과 일치하는 회원이 여러 명입니다.`, 409);
        const target = matches[0]!;
        if (!playerIds.has(target.player_id.toString())) {
          playerIds.add(target.player_id.toString());
          targets.push({ playerId: target.player_id, displayName: target.display_name });
        }
      }
      if (targets.length === 0) throw new ApplicationError("SUPPORT_GRANT_TARGET_NOT_FOUND", "지급할 회원을 찾을 수 없습니다.", 404);

      for (const target of targets) {
        const stacks = await transaction.query<Array<{ quantity: bigint }>>(
          "SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [target.playerId, item.id]
        );
        const current = stacks[0]?.quantity ?? 0n;
        if (current > MAX_GRANT_QUANTITY - command.quantity) throw new ApplicationError("SUPPORT_GRANT_QUANTITY_OVERFLOW", `❌ [${target.displayName}] 님의 보유 수량이 한도를 초과합니다.`, 409);
      }

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.operatorId]
      );
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]!;
        await transaction.execute(
          `INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)
           ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1`,
          [target.playerId, item.id, command.quantity]
        );
        await transaction.execute(
          `INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code,created_at)
           VALUES (?,?,?,?,?,'SUPPORT_GRANT_MANUAL',UTC_TIMESTAMP(3))`,
          [operation.insertId, index + 1, target.playerId, item.id, command.quantity]
        );
        await transaction.execute(
          "INSERT INTO admin_support_grant_targets(operation_id,target_order,player_id,quantity) VALUES (?,?,?,?)",
          [operation.insertId, index + 1, target.playerId, command.quantity]
        );
      }

      const resultTargets = targets.map((target) => ({ playerId: target.playerId.toString(), displayName: target.displayName }));
      const data = `✅ 후원 아이템 지급을 완료했습니다.\n━━━━━━━━━━━━\n대상: ${resultTargets.map((target) => target.displayName).join(", ")}\n아이템: ${item.display_name} [${item.code}]\n수량: 각 ${command.quantity.toString()}개\n처리 관리자: ${input.operatorDisplayName}`;
      const result: SupportGrantManualResult = { data, outboxId: "", itemCode: item.code, itemDisplayName: item.display_name, quantity: command.quantity.toString(), targets: resultTargets };
      await transaction.execute(
        `INSERT INTO admin_support_grant_events(operation_id,operator_id,item_id,quantity,target_count,request_json,result_json)
         VALUES (?,?,?,?,?,?,?)`,
        [operation.insertId, input.operatorId, item.id, command.quantity, targets.length, JSON.stringify(command, (_key, value) => typeof value === "bigint" ? value.toString() : value), JSON.stringify(result)]
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player_group',NULL,'inventory.support.grant','success','Iris 운영자 /후원지급',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, JSON.stringify({ itemCode: item.code, quantity: command.quantity.toString(), targetPlayerIds: resultTargets.map((target) => target.playerId) })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'SUPPORT_GRANT_MANUAL',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      result.outboxId = outbox.insertId.toString();
      await transaction.execute("UPDATE admin_support_grant_events SET result_json=? WHERE operation_id=?", [JSON.stringify(result), operation.insertId]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
