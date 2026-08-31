import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { readKakaoVerificationCode } from "../user-auth/policy.js";

const REWARD_ITEM_CODE = "ITEM-RWD-001";
const REWARD_ITEM_QUANTITY = 20n;
const REWARD_POINT_QUANTITY = 5_000_000n;

export interface MemberVoiceAuthRewardResult {
  data: string;
  outboxId: string;
  targetPlayerId: string;
  targetDisplayName: string;
  operatorPlayerId: string;
  itemQuantity: string;
  pointQuantity: string;
  checkCountDelta: string;
}

// 회원 음성 인증 명령은 대상 표시명이 온전히 포함된 형식만 허용합니다.
export function isMemberVoiceAuthRewardCommandCandidate(message: string | undefined): boolean {
  return message !== undefined
    && readKakaoVerificationCode(message) === null
    && /^\/인증\s+\S(?:.*\S)?$/.test(message);
}

// 인자 명령을 공용 command alias와 일치하는 기본 명령으로 정규화합니다.
export function normalizeMemberVoiceAuthRewardDispatchMessage(message: string): string {
  return isMemberVoiceAuthRewardCommandCandidate(message) ? "/인증" : message;
}

// 대상 인증과 실행 관리자 보상 3종을 하나의 원장 트랜잭션으로 처리합니다.
export class MemberVoiceAuthRewardService {
  constructor(private readonly database: DatabaseClient) {}

  async grant(input: {
    message: string;
    idempotencyKey: string;
    sourceEventId: string;
    destinationId: string;
    operatorId: string;
    operatorPlayerId: string;
    operatorDisplayName: string;
  }): Promise<MemberVoiceAuthRewardResult> {
    const scope = "admin.member_voice_auth_reward";
    const targetName = input.message.replace(/^\/인증\s+/, "").trim();
    if (targetName.length === 0) throw new ApplicationError("INVALID_MEMBER_VOICE_AUTH_COMMAND", "인증할 회원을 입력해 주세요.", 422);
    const idempotencyKey = input.idempotencyKey.length <= 191
      ? input.idempotencyKey
      : `sha256:${createHash("sha256").update(input.idempotencyKey).digest("hex")}`;

    return this.database.withTransaction(async (transaction) => {
      const prior = await transaction.query<Array<{ result_json: string | MemberVoiceAuthRewardResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, idempotencyKey]
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      }

      const targets = await transaction.query<Array<{ player_id: bigint; current_display_name: string }>>(
        `SELECT player.id player_id,profile.current_display_name
         FROM player_profiles profile JOIN players player ON player.id=profile.player_id
         WHERE profile.current_display_name=? AND player.status='active' AND player.deleted_at IS NULL
         ORDER BY player.id LIMIT 2 FOR UPDATE`,
        [targetName]
      );
      if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
      if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 확인이 필요합니다.", 409);
      const target = targets[0]!;

      const verified = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM player_verifications WHERE player_id=? AND verification_code='voice' AND status='verified' FOR UPDATE",
        [target.player_id]
      );
      if (verified[0] !== undefined) throw new ApplicationError("PLAYER_ALREADY_VOICE_VERIFIED", `⚠️ [${target.current_display_name}] 님은 이미 인증되었습니다.`, 409);

      const operatorPlayers = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM players WHERE id=? AND status='active' AND deleted_at IS NULL FOR UPDATE",
        [input.operatorPlayerId]
      );
      if (operatorPlayers[0] === undefined) throw new ApplicationError("OPERATOR_PLAYER_NOT_FOUND", "관리자 회원 연결 정보를 확인할 수 없습니다.", 409);

      const items = await transaction.query<Array<{ id: bigint; display_name: string }>>(
        "SELECT id,display_name FROM item_definitions WHERE code=? AND active=TRUE FOR UPDATE",
        [REWARD_ITEM_CODE]
      );
      const item = items[0];
      if (item === undefined) throw new ApplicationError("VOICE_AUTH_REWARD_ITEM_MISSING", "인증 보상 아이템 설정이 없습니다.", 409);

      await transaction.query("SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [input.operatorPlayerId, item.id]);
      await transaction.query("SELECT balance FROM currency_accounts WHERE player_id=? AND currency_code='POINT' FOR UPDATE", [input.operatorPlayerId]);
      await transaction.query("SELECT check_count FROM player_check_counts WHERE player_id=? FOR UPDATE", [input.operatorPlayerId]);

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, idempotencyKey, input.operatorId]
      );

      await transaction.execute(
        `INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)
         ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1`,
        [input.operatorPlayerId, item.id, REWARD_ITEM_QUANTITY]
      );
      await transaction.execute(
        `INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code)
         VALUES (?,1,?,?,NULL,?,'member_voice_auth_reward')`,
        [operation.insertId, input.operatorPlayerId, item.id, REWARD_ITEM_QUANTITY]
      );
      await transaction.execute(
        `INSERT INTO currency_accounts(player_id,currency_code,balance,version,updated_at) VALUES (?,'POINT',?,1,UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance),version=version+1,updated_at=UTC_TIMESTAMP(3)`,
        [input.operatorPlayerId, REWARD_POINT_QUANTITY]
      );
      const balances = await transaction.query<Array<{ balance: string }>>(
        "SELECT CAST(balance AS CHAR) balance FROM currency_accounts WHERE player_id=? AND currency_code='POINT'",
        [input.operatorPlayerId]
      );
      await transaction.execute(
        `INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code)
         VALUES (?,1,?,'POINT',?,?,'member_voice_auth_reward')`,
        [operation.insertId, input.operatorPlayerId, REWARD_POINT_QUANTITY, balances[0]!.balance]
      );
      await transaction.execute(
        `INSERT INTO player_check_counts(player_id,check_count,version,created_at,updated_at) VALUES (?,1,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE check_count=check_count+1,version=version+1,updated_at=UTC_TIMESTAMP(3)`,
        [input.operatorPlayerId]
      );
      await transaction.execute(
        `INSERT INTO player_verifications(player_id,verification_code,status,verified_by_operator_id,operation_id,verified_at,version)
         VALUES (?,'voice','verified',?,?,UTC_TIMESTAMP(3),1)`,
        [target.player_id, input.operatorId, operation.insertId]
      );

      const data = `✅ [${target.current_display_name}] 님의 음성 인증을 완료했습니다.\n관리자 보상: ${item.display_name} 20개 · 포인트 5,000,000 · 인증횟수 1회\n처리 관리자: ${input.operatorDisplayName}`;
      const resultBase = {
        data,
        targetPlayerId: target.player_id.toString(),
        targetDisplayName: target.current_display_name,
        operatorPlayerId: input.operatorPlayerId,
        itemQuantity: REWARD_ITEM_QUANTITY.toString(),
        pointQuantity: REWARD_POINT_QUANTITY.toString(),
        checkCountDelta: "1"
      };
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',?,'player.voice_verification.grant','success','Iris 관리자 /인증',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, target.player_id, JSON.stringify({ ...resultBase, rewardItemCode: REWARD_ITEM_CODE })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ADMIN_MEMBER_VOICE_AUTH_REWARD',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      const result: MemberVoiceAuthRewardResult = { ...resultBase, outboxId: outbox.insertId.toString() };
      await transaction.execute(
        `INSERT INTO admin_member_voice_auth_reward_events(operation_id,operator_id,operator_player_id,target_player_id,item_id,item_quantity,point_quantity,check_count_delta,result_json)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [operation.insertId, input.operatorId, input.operatorPlayerId, target.player_id, item.id, REWARD_ITEM_QUANTITY, REWARD_POINT_QUANTITY, 1, JSON.stringify(result)]
      );
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
