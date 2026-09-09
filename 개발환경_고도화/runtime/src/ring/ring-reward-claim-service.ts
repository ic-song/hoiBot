import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

const COMMAND_CODE = "RING_REWARD_CLAIM";
const HANDLER_KEY = "ring_reward_claim";
const REWARD_ITEM_CODE = "ITEM-RING-CHARM-REWARD";
const REWARD_ITEM_NAME = "반지매력보상🎁(/보상받기)";
const MAX_LEDGER_QUANTITY = 9223372036854775807n;

export interface RingRewardClaimResult {
  status: "claimed" | "already_claimed" | "missing_pet" | "missing_ring" | "empty_reward";
  data: string;
  outboxId: string;
  auditId: string;
  rewardQuantity: string;
}

// 반지 보상 수령은 인자나 접미 문구가 없는 정확 명령만 허용합니다.
export function isRingRewardClaimCommand(message: string | undefined): boolean {
  return message === "/반지보상받기";
}

// 긴 Iris event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// bigint 보상 수량을 기존 세 자리 쉼표 형식으로 표시합니다.
function formatQuantity(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | RingRewardClaimResult): RingRewardClaimResult {
  return typeof value === "string" ? JSON.parse(value) as RingRewardClaimResult : value;
}

// 레거시 ring snapshot을 보상권 stack·ledger·claim 기록으로 원자 전환합니다.
export class RingRewardClaimService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "shadow" };
    }
    const identities = await this.database.query<Array<{ id: bigint; player_id: bigint | null }>>(
      "SELECT id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1", [input.externalUserId]
    );
    const identity = identities[0];
    if (identity === undefined || identity.player_id === null) {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "IDENTITY_NOT_VERIFIED", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "legacy_fallback" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
    const result = await this.claim({ playerId: identity.player_id.toString(), identityId: identity.id.toString(), destinationId: input.channelId, sourceEventId: input.eventId, idempotencyKey: input.eventId });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async claim(input: { playerId: string; identityId: string; destinationId: string; sourceEventId: string; idempotencyKey: string }): Promise<RingRewardClaimResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `ring.reward_claim:${input.playerId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | RingRewardClaimResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const pets = await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM player_pets WHERE player_id=? AND display_name IS NOT NULL FOR UPDATE", [input.playerId]
      );
      const snapshots = await transaction.query<Array<{
        ring_name: string; ring_grade: string; enhancement_level: bigint; raid_charm: bigint;
        castle_charm: bigint; claim_status: "pending" | "claimed"; reward_quantity: bigint | null;
      }>>(
        "SELECT ring_name,ring_grade,enhancement_level,raid_charm,castle_charm,claim_status,reward_quantity FROM player_legacy_ring_reward_snapshots WHERE player_id=? FOR UPDATE", [input.playerId]
      );
      const snapshot = snapshots[0];
      let status: RingRewardClaimResult["status"];
      let data: string;
      let rewardQuantity = 0n;
      if (pets[0] === undefined) {
        status = "missing_pet";
        data = "펫을 먼저 생성해주세요.";
      } else if (snapshot?.claim_status === "claimed") {
        status = "already_claimed";
        data = "이미 반지 매력 보상을 받았습니다.";
      } else if (snapshot === undefined) {
        status = "missing_ring";
        data = "보상받을 반지 정보가 없습니다.";
      } else {
        rewardQuantity = BigInt(snapshot.raid_charm) + BigInt(snapshot.castle_charm);
        if (rewardQuantity <= 0n) {
          status = "empty_reward";
          data = "반지 매력 보상으로 지급할 수량이 없습니다.";
        } else {
          if (rewardQuantity > MAX_LEDGER_QUANTITY) throw new Error("Ring reward quantity exceeds inventory ledger range.");
          status = "claimed";
          data = `✅ 반지 매력 보상 지급 완료!\n기존 반지: ${snapshot.ring_name}[${snapshot.ring_grade}](+${snapshot.enhancement_level})\n지급: ${REWARD_ITEM_NAME} x${formatQuantity(rewardQuantity)}\n※ 보상 지급과 함께 기존 반지 데이터가 정리되었습니다.\n※ /보상받기 또는 /보상받기 숫자로 매력에 반영할 수 있어요.`;
        }
      }

      const operation = await transaction.execute(
        `INSERT INTO operations (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.identityId]
      );
      if (status === "claimed" && snapshot !== undefined) {
        const items = await transaction.query<Array<{ id: bigint }>>(
          "SELECT id FROM item_definitions WHERE code=? AND active=TRUE FOR UPDATE", [REWARD_ITEM_CODE]
        );
        const item = items[0];
        if (item === undefined) throw new Error("Ring reward item definition is missing.");
        await transaction.execute(
          `INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)
           ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1`,
          [input.playerId, item.id, rewardQuantity]
        );
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'RING_REWARD_CLAIM')",
          [operation.insertId, input.playerId, item.id, rewardQuantity]
        );
        await transaction.execute(
          `UPDATE player_legacy_ring_reward_snapshots SET claim_status='claimed',legacy_ring_present=FALSE,reward_item_id=?,reward_quantity=?,claimed_operation_id=?,claimed_at=UTC_TIMESTAMP(3),version=version+1
           WHERE player_id=? AND claim_status='pending'`,
          [item.id, rewardQuantity, operation.insertId, input.playerId]
        );
      }
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ring_reward_claim',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId, status]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',?,'player',?,'ring.reward_claim',?,'Iris /반지보상받기',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.identityId, input.playerId, status, JSON.stringify({ rewardQuantity: rewardQuantity.toString() })]
      );
      const result: RingRewardClaimResult = { status, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), rewardQuantity: rewardQuantity.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
