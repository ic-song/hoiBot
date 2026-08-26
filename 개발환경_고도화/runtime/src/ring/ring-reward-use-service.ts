import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

const COMMAND_CODE = "RING_REWARD_USE";
const HANDLER_KEY = "ring_reward_use";
const ITEM_CODE = "ITEM-RING-CHARM-REWARD";
const MAX_SIGNED_BIGINT = 9223372036854775807n;
const MAX_UNSIGNED_BIGINT = 18446744073709551615n;

export interface RingRewardUseResult {
  status: "applied" | "missing_pet" | "no_reward" | "invalid_count";
  data: string;
  outboxId: string;
  auditId: string;
  usedQuantity: string;
  currentExperience: string;
}

// 반지 보상권 사용은 인자 없음 또는 하나의 10진 정수 전체 형식만 허용합니다.
export function isRingRewardUseCommand(message: string | undefined): boolean {
  return message === "/보상받기" || (message !== undefined && /^\/보상받기\s+\d+$/.test(message));
}

// 명령의 선택 수량을 bigint로 복원하며 인자 없음은 레거시 기본값 1을 사용합니다.
export function parseRingRewardUseCount(message: string): bigint {
  if (message === "/보상받기") return 1n;
  const match = message.match(/^\/보상받기\s+(\d+)$/);
  return match === null ? 0n : BigInt(match[1]!);
}

// bigint 수량을 레거시 세 자리 쉼표 형식으로 표시합니다.
function comma(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 긴 Iris event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | RingRewardUseResult): RingRewardUseResult {
  return typeof value === "string" ? JSON.parse(value) as RingRewardUseResult : value;
}

// 보상권 stack 차감과 펫 매력 증가를 실행·감사·Outbox와 원자 처리합니다.
export class RingRewardUseService {
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
    const result = await this.consume({ playerId: identity.player_id.toString(), identityId: identity.id.toString(),
      destinationId: input.channelId, sourceEventId: input.eventId, idempotencyKey: input.eventId,
      requestedQuantity: parseRingRewardUseCount(input.message) });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async consume(input: { playerId: string; identityId: string; destinationId: string; sourceEventId: string; idempotencyKey: string; requestedQuantity: bigint }): Promise<RingRewardUseResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `ring.reward_use:${input.playerId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | RingRewardUseResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const pets = await transaction.query<Array<{ id: bigint; experience: bigint; version: bigint }>>(
        "SELECT id,experience,version FROM player_pets WHERE player_id=? AND display_name IS NOT NULL FOR UPDATE", [input.playerId]
      );
      const pet = pets[0];
      let status: RingRewardUseResult["status"];
      let data: string;
      let usedQuantity = 0n;
      let currentExperience = pet === undefined ? 0n : BigInt(pet.experience);
      let itemId: bigint | null = null;
      let ownedQuantity = 0n;
      if (pet === undefined) {
        status = "missing_pet";
        data = "펫을 먼저 생성해주세요.";
      } else {
        const stacks = await transaction.query<Array<{ item_id: bigint; quantity: bigint }>>(
          `SELECT stack.item_id,stack.quantity FROM item_definitions item
           LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=?
           WHERE item.code=? AND item.active=TRUE FOR UPDATE`, [input.playerId, ITEM_CODE]
        );
        const stack = stacks[0];
        itemId = stack?.item_id ?? null;
        ownedQuantity = stack?.quantity === undefined || stack.quantity === null ? 0n : BigInt(stack.quantity);
        if (itemId === null || ownedQuantity <= 0n) {
          status = "no_reward";
          data = "사용할 반지 매력 보상권이 없습니다.";
        } else if (input.requestedQuantity <= 0n) {
          status = "invalid_count";
          data = "사용법: /보상받기 또는 /보상받기 숫자";
        } else {
          usedQuantity = input.requestedQuantity > ownedQuantity ? ownedQuantity : input.requestedQuantity;
          if (usedQuantity > MAX_SIGNED_BIGINT) throw new Error("Ring reward use quantity exceeds inventory ledger range.");
          if (currentExperience > MAX_UNSIGNED_BIGINT - usedQuantity) throw new Error("Pet experience exceeds unsigned bigint range.");
          currentExperience += usedQuantity;
          status = "applied";
          data = `✅ 반지 매력 보상권 사용 완료!\n사용: ${comma(usedQuantity)}개\n매력💕 +${comma(usedQuantity)}\n현재 펫 매력💕: ${comma(currentExperience)}`;
        }
      }

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.identityId]
      );
      if (status === "applied" && pet !== undefined && itemId !== null) {
        if (usedQuantity === ownedQuantity) {
          await transaction.execute("DELETE FROM inventory_stacks WHERE player_id=? AND item_id=?", [input.playerId, itemId]);
        } else {
          await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=?", [usedQuantity, input.playerId, itemId]);
        }
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'RING_REWARD_USE')",
          [operation.insertId, input.playerId, itemId, -usedQuantity]
        );
        await transaction.execute(
          "UPDATE player_pets SET experience=?,version=version+1 WHERE id=? AND version=?",
          [currentExperience, pet.id, pet.version]
        );
      }
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'ring_reward_use',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId, status]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',?,'player',?,'ring.reward_use',?,'Iris /보상받기',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.identityId, input.playerId, status, JSON.stringify({ requestedQuantity: input.requestedQuantity.toString(), usedQuantity: usedQuantity.toString(), currentExperience: currentExperience.toString() })]
      );
      const result: RingRewardUseResult = { status, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(),
        usedQuantity: usedQuantity.toString(), currentExperience: currentExperience.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
