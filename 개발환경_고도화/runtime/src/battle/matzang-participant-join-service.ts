import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

export type MatzangParticipantJoinStatus = "joined" | "inactive" | "already_joined" | "complete";
export type MatzangParticipantSnapshot = { displayName: string; totalExp: number; petType: string | null; upgradeLevel: number };
export type MatzangParticipantJoinResult = {
  status: MatzangParticipantJoinStatus;
  data: string;
  outboxId: string;
  remaining: number;
  participantCount: number;
  mutated: boolean;
};
export type MatzangParticipantJoinHandleResult = MatzangParticipantJoinResult | { status: "shadow" | "legacy_fallback" | "handled_no_reply" };

const ALL_SEE = "​".repeat(500);
const eventKey = (value: string) => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;

// 레거시와 동일하게 /참여와 ㅊㅇ 완전 일치 입력만 분류합니다.
export function isMatzangParticipantJoinCommand(message: string | undefined): boolean {
  return message === "/참여" || message === "ㅊㅇ";
}

// 참여 상태와 현재 참여자 목록을 레거시 안내 순서로 구성합니다.
export function formatMatzangParticipantJoin(input: {
  status: MatzangParticipantJoinStatus;
  displayName: string;
  remaining: number;
  maxCount: number;
  pt: string;
  resting: boolean;
  participantNames: string[];
}): string {
  if (input.status === "inactive") return "현재 맞짱필드👊가 진행 중이 아닙니다.";
  if (input.status === "complete") return `[✅완료]\n[${input.displayName}] 님은 맞짱필드👊 ${input.maxCount}회를 모두 소진했습니다.`;
  if (input.status === "already_joined") return `[${input.displayName}] 님은 이미 맞짱필드👊에 참여 중입니다.\n대전방법: /맞짱 or ㅁㅁ`;
  const lines = input.participantNames.map((name, index) => `${index + 1}. [${name}]`);
  return [
    ...(input.resting ? ["※ 현재 맞짱필드👊 휴식 시간입니다."] : []),
    "👊 맞짱필드 입장 완료 👊",
    `[남은 횟수: ${input.remaining} / ${input.maxCount}] [누적: ${input.pt}pt]`,
    "━━━━━━━━━━━━",
    `[${input.displayName}] 님이 맞짱필드에 참여했습니다.`,
    "",
    `두들겨 맞기 전에 후리세요!\n선 빵 필 승🍞${ALL_SEE}`,
    "",
    `━━━━━━━━━━━━\n👥 현재 참여자: ${lines.length}명\n참여자 목록 보기📋`,
    "",
    ...lines
  ].join("\n");
}

// 맞짱 참여 rollout과 참여 시점 전투 스냅샷을 하나의 DB transaction으로 기록합니다.
export class MatzangParticipantJoinService {
  constructor(private readonly db: DatabaseClient) {}

  async handle(input: {
    eventId: string;
    destinationId: string;
    playerId: string;
    message: string;
    snapshot: MatzangParticipantSnapshot;
    fieldKey?: string;
  }): Promise<MatzangParticipantJoinHandleResult> {
    if (!isMatzangParticipantJoinCommand(input.message)) return { status: "handled_no_reply" };
    this.validateSnapshot(input.snapshot);
    const definition = (await this.db.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code='MATZZANG_PARTICIPANT_JOIN' LIMIT 1"
    ))[0];
    const dispatch = new MariaCommandDispatchRepository(this.db);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.playerId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: "MATZZANG_PARTICIPANT_JOIN", handlerKey: "matzang_participant_join" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state !== "ACTIVE") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.playerId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "MATZZANG_PARTICIPANT_JOIN", handlerKey: "matzang_participant_join" });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.playerId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: "MATZZANG_PARTICIPANT_JOIN", handlerKey: "matzang_participant_join" });
    return this.db.withTransaction((transaction) => this.join(transaction, input));
  }

  private validateSnapshot(snapshot: MatzangParticipantSnapshot): void {
    if (snapshot.displayName.trim().length === 0) throw new Error("displayName is required");
    if (!Number.isSafeInteger(snapshot.totalExp) || snapshot.totalExp < 0) throw new Error("invalid totalExp");
    if (!Number.isSafeInteger(snapshot.upgradeLevel) || snapshot.upgradeLevel < 0) throw new Error("invalid upgradeLevel");
  }

  private async join(transaction: DatabaseTransaction, input: {
    eventId: string;
    destinationId: string;
    playerId: string;
    snapshot: MatzangParticipantSnapshot;
    fieldKey?: string;
  }): Promise<MatzangParticipantJoinResult> {
    const scope = "matzang.participant.join";
    const key = eventKey(input.eventId);
    const prior = await transaction.query<Array<{ result_json: string | MatzangParticipantJoinResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
    );
    if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
    const operation = await transaction.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status) VALUES (?,?,?,'player',?,'iris','processing')",
      [randomUUID(), scope, key, input.playerId]
    );
    const fieldKey = input.fieldKey ?? "current";
    const field = (await transaction.query<Array<{ active: number; resting: number; max_count: number }>>(
      "SELECT active,resting,max_count FROM matzang_fields WHERE field_key=? FOR UPDATE", [fieldKey]
    ))[0];
    if (field === undefined) throw new Error(`matzang field not found: ${fieldKey}`);
    const participant = (await transaction.query<Array<{ active: number; match_count: number; pt: bigint }>>(
      "SELECT active,match_count,pt FROM matzang_participants WHERE field_key=? AND player_id=? FOR UPDATE", [fieldKey, input.playerId]
    ))[0];
    let status: MatzangParticipantJoinStatus;
    let mutated = false;
    if (field.active !== 1) status = "inactive";
    else if ((participant?.match_count ?? 0) >= field.max_count) status = "complete";
    else if (participant?.active === 1) status = "already_joined";
    else {
      status = "joined";
      mutated = true;
      await transaction.execute(
        `INSERT INTO matzang_participants(field_key,player_id,display_name,active,eliminated,match_count,pt,wins,losses,total_exp,pet_type,upgrade_level,total_exp_updated_at,version)
         VALUES (?,?,?,TRUE,FALSE,0,0,0,0,?,?,?,UTC_TIMESTAMP(3),1)
         ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE,eliminated=FALSE,total_exp=VALUES(total_exp),pet_type=VALUES(pet_type),upgrade_level=VALUES(upgrade_level),total_exp_updated_at=UTC_TIMESTAMP(3),version=version+1`,
        [fieldKey, input.playerId, input.snapshot.displayName, input.snapshot.totalExp, input.snapshot.petType, input.snapshot.upgradeLevel]
      );
    }
    const current = (await transaction.query<Array<{ match_count: number; pt: bigint }>>(
      "SELECT match_count,pt FROM matzang_participants WHERE field_key=? AND player_id=?", [fieldKey, input.playerId]
    ))[0];
    const remaining = Math.max(0, field.max_count - (current?.match_count ?? 0));
    const participants = await transaction.query<Array<{ display_name: string }>>(
      "SELECT display_name FROM matzang_participants WHERE field_key=? AND active=TRUE AND match_count<? ORDER BY player_id", [fieldKey, field.max_count]
    );
    const data = formatMatzangParticipantJoin({ status, displayName: input.snapshot.displayName, remaining, maxCount: field.max_count,
      pt: (current?.pt ?? 0n).toString(), resting: field.resting === 1, participantNames: participants.map((row) => row.display_name) });
    await transaction.execute(
      "INSERT INTO matzang_participant_join_events(operation_id,field_key,player_id,result_code,snapshot_total_exp,snapshot_pet_type,snapshot_upgrade_level,remaining_count,participant_count) VALUES (?,?,?,?,?,?,?,?,?)",
      [operation.insertId, fieldKey, input.playerId, status, input.snapshot.totalExp, input.snapshot.petType, input.snapshot.upgradeLevel, remaining, participants.length]
    );
    const outbox = await transaction.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status) VALUES (?,'iris',?,'text',?,'pending')",
      [operation.insertId, input.destinationId, JSON.stringify({ data })]
    );
    await transaction.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MATZZANG_PARTICIPANT_JOIN',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [input.eventId, operation.insertId, status]
    );
    await transaction.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json) VALUES (?,'player',?,'matzang_participant',?,'matzang.participant.join',?,'Iris /참여',?)",
      [operation.insertId, input.playerId, input.playerId, status, JSON.stringify({ status, mutated, remaining, participantCount: participants.length, snapshot: input.snapshot })]
    );
    const result: MatzangParticipantJoinResult = { status, data, outboxId: outbox.insertId.toString(), remaining, participantCount: participants.length, mutated };
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
    return result;
  }
}
