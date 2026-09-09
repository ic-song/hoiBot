import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

type RequiredRole = "none" | "operator" | "super_admin";

export interface RingReadCommand {
  commandCode: string;
  handlerKey: string;
  kind: "stats" | "fixed";
  requiredRole: RequiredRole;
  fixedData?: string;
}

export interface RingRewardStats {
  totalPetUserCount: bigint;
  claimedUserCount: bigint;
  claimedRewardTotal: bigint;
  claimedRewardRemainTotal: bigint;
  pendingRingUserCount: bigint;
  pendingRewardTotal: bigint;
  claimedWithRingCount: bigint;
  rewardCalcErrorCount: bigint;
}

export interface RingReadResult {
  status: "replied";
  data: string;
  outboxId: string;
  auditId: string;
}

// 반지 조회 슬라이스는 인자 없는 세 정확 명령만 후보로 허용합니다.
export function isRingReadCommandCandidate(message: string | undefined): boolean {
  return message === "/반지보상통계" || message === "/반지순위" || message === "/반지정보";
}

// 정확 명령을 안정 command code, 출력 유형과 레거시 권한으로 변환합니다.
export function parseRingReadCommand(message: string): RingReadCommand | null {
  if (message === "/반지보상통계") return { commandCode: "RING_REWARD_STATS", handlerKey: "ring_reward_stats", kind: "stats", requiredRole: "operator" };
  if (message === "/반지순위") return { commandCode: "RING_RANK_RETIRED", handlerKey: "ring_rank_retired", kind: "fixed", requiredRole: "none", fixedData: "반지순위는 펜던트 콘텐츠 전환으로 종료되었습니다." };
  if (message === "/반지정보") return { commandCode: "RING_INFO_RETIRED", handlerKey: "ring_info_retired", kind: "fixed", requiredRole: "super_admin", fixedData: "반지정보 조회는 펜던트 콘텐츠 전환으로 종료되었습니다." };
  return null;
}

// bigint 집계값을 레거시 세 자리 쉼표 형식으로 표시합니다.
function comma(value: bigint): string {
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 레거시 allsee 접기와 항목·줄바꿈 순서를 그대로 구성합니다.
export function buildRingRewardStatsMessage(stats: RingRewardStats): string {
  const claimedRewardTotal = BigInt(stats.claimedRewardTotal);
  const claimedRewardRemainTotal = BigInt(stats.claimedRewardRemainTotal);
  const estimatedUsed = claimedRewardTotal > claimedRewardRemainTotal
    ? claimedRewardTotal - claimedRewardRemainTotal : 0n;
  return `📊 반지 보상 통계\n${"\u200b".repeat(500)}\n전체 펫 유저 : ${comma(stats.totalPetUserCount)}명\n\n`
    + `[보상 완료]\n완료 유저 : ${comma(stats.claimedUserCount)}명\n지급 총수량 : ${comma(stats.claimedRewardTotal)}개\n`
    + `보상권 잔여 : ${comma(stats.claimedRewardRemainTotal)}개\n사용 추정 : ${comma(estimatedUsed)}개\n\n`
    + `[보상 대기]\n반지 보유 유저 : ${comma(stats.pendingRingUserCount)}명\n예상 지급 수량 : ${comma(stats.pendingRewardTotal)}개\n\n`
    + `[점검]\n완료 flag + ring 잔존 : ${comma(stats.claimedWithRingCount)}명\n계산 오류 : ${comma(stats.rewardCalcErrorCount)}명`;
}

// 긴 Iris event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | RingReadResult): RingReadResult {
  return typeof value === "string" ? JSON.parse(value) as RingReadResult : value;
}

// 반지 통계 projection과 종료 안내를 실행·감사·Outbox와 한 transaction에 기록합니다.
export class RingReadService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string }
    | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const command = parseRingReadCommand(input.message);
    if (command === null) return { status: "legacy_fallback" };
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [command.commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: command.commandCode, handlerKey: command.handlerKey });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: command.commandCode, handlerKey: command.handlerKey });
      return { status: "shadow" };
    }
    const identities = await this.database.query<Array<{ id: bigint }>>(
      "SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1", [input.externalUserId]
    );
    const identity = identities[0];
    if (identity === undefined) {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "IDENTITY_NOT_VERIFIED", commandCode: command.commandCode, handlerKey: command.handlerKey });
      return { status: "legacy_fallback" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: command.commandCode, handlerKey: command.handlerKey });
    if (command.requiredRole !== "none") {
      const allowedRoles = command.requiredRole === "super_admin" ? ["super_admin"] : ["super_admin", "manager"];
      const operators = await this.database.query<Array<{ operator_id: bigint }>>(
        `SELECT mapping.operator_id FROM admin_operator_external_identities mapping
         JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
         JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
         JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
         WHERE mapping.external_identity_id=? AND role.code IN (${allowedRoles.map(() => "?").join(",")}) LIMIT 1`,
        [identity.id, ...allowedRoles]
      );
      if (operators[0] === undefined) return { status: "handled_no_reply" };
    }
    const result = await this.reply({ command, actorId: identity.id.toString(), destinationId: input.channelId,
      sourceEventId: input.eventId, idempotencyKey: input.eventId });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async reply(input: { command: RingReadCommand; actorId: string; destinationId: string; sourceEventId: string; idempotencyKey: string }): Promise<RingReadResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `${input.command.handlerKey}:${input.actorId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | RingReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);
      let data = input.command.fixedData ?? "";
      if (input.command.kind === "stats") {
        const rows = await transaction.query<RingRewardStats[]>(
          `SELECT
            (SELECT COUNT(*) FROM player_pets WHERE display_name IS NOT NULL) AS totalPetUserCount,
            (SELECT COUNT(*) FROM player_legacy_ring_reward_snapshots WHERE claim_status='claimed') AS claimedUserCount,
            (SELECT COALESCE(SUM(reward_quantity),0) FROM player_legacy_ring_reward_snapshots WHERE claim_status='claimed') AS claimedRewardTotal,
            (SELECT COALESCE(SUM(stack.quantity),0) FROM player_legacy_ring_reward_snapshots snapshot
              JOIN item_definitions item ON item.code='ITEM-RING-CHARM-REWARD'
              LEFT JOIN inventory_stacks stack ON stack.player_id=snapshot.player_id AND stack.item_id=item.id
              WHERE snapshot.claim_status='claimed') AS claimedRewardRemainTotal,
            (SELECT COUNT(*) FROM player_legacy_ring_reward_snapshots WHERE claim_status='pending' AND legacy_ring_present=TRUE) AS pendingRingUserCount,
            (SELECT COALESCE(SUM(raid_charm+castle_charm),0) FROM player_legacy_ring_reward_snapshots
              WHERE claim_status='pending' AND legacy_ring_present=TRUE AND calculation_error=FALSE) AS pendingRewardTotal,
            (SELECT COUNT(*) FROM player_legacy_ring_reward_snapshots WHERE claim_status='claimed' AND legacy_ring_present=TRUE) AS claimedWithRingCount,
            (SELECT COUNT(*) FROM player_legacy_ring_reward_snapshots WHERE legacy_ring_present=TRUE AND calculation_error=TRUE) AS rewardCalcErrorCount`
        );
        data = buildRingRewardStatsMessage(rows[0] ?? {
          totalPetUserCount: 0n, claimedUserCount: 0n, claimedRewardTotal: 0n, claimedRewardRemainTotal: 0n,
          pendingRingUserCount: 0n, pendingRewardTotal: 0n, claimedWithRingCount: 0n, rewardCalcErrorCount: 0n
        });
      }
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.actorId]
      );
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, input.command.handlerKey, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',?,'ring_projection',NULL,?,'reply_queued','Iris 반지 조회',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.actorId, `ring.read.${input.command.handlerKey}`, JSON.stringify({ commandCode: input.command.commandCode })]
      );
      const result: RingReadResult = { status: "replied", data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
