import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const REBIRTH_MUSHROOM = "환생버섯🍄";

export type PetRebirthCommand = { kind: "self" } | { kind: "admin"; targetName: string };

export interface PetRebirthResult {
  status: "reborn" | "requirement_missing";
  playerId: string;
  previousLevel: string;
  accumulatedLevel: string;
  rebirthCount: string;
  mushroomConsumed: boolean;
  replies: Array<{ outboxId: string; room: string; data: string }>;
}

interface ProfileRow {
  player_id: bigint;
  current_display_name: string;
  level: bigint;
  accumulated_level_offset: bigint;
  rebirth_count: bigint;
  version: bigint;
  rank_emoji: string | null;
}

// 일반 exact 명령과 총괄 운영자 대상 명령만 완전 패턴으로 구분합니다.
export function parsePetRebirthCommand(message: string | undefined): PetRebirthCommand | null {
  if (message === "/환생") return { kind: "self" };
  const match = /^\/환생\s+(.+)$/.exec(message ?? "");
  return match === null ? null : { kind: "admin", targetName: match[1]! };
}

// 인자형 총괄 명령을 DB의 고정 별칭으로 정규화합니다.
export function normalizePetRebirthDispatchMessage(message: string): string {
  return parsePetRebirthCommand(message)?.kind === "admin" ? "/환생 [유저명]" : message;
}

// 레거시 환생 guard를 통과하는 메시지만 부분 dispatch 후보로 올립니다.
export function isPetRebirthCommandCandidate(message: string | undefined): boolean {
  return parsePetRebirthCommand(message) !== null;
}

// 레벨·누적 레벨·환생 횟수의 BIGINT-safe 다음 상태를 계산합니다.
export function calculatePetRebirth(profile: Pick<ProfileRow, "level" | "accumulated_level_offset" | "rebirth_count">) {
  return { level: 1n, accumulatedLevel: profile.accumulated_level_offset + profile.level, rebirthCount: profile.rebirth_count + 1n };
}

function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored(value: string | PetRebirthResult): PetRebirthResult {
  return typeof value === "string" ? JSON.parse(value) as PetRebirthResult : value;
}

// 일반·강제 환생과 버섯 차감·snapshot·감사·다중방 공지를 원자 처리합니다.
export class PetRebirthService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string; broadcastDestinationIds: readonly string[] }): Promise<PetRebirthResult> {
    const command = parsePetRebirthCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_PET_REBIRTH_COMMAND", "올바른 명령어 형식: /환생 또는 /환생 [유저명]", 422);
    return this.database.withTransaction(async (transaction) => {
      const identities = await transaction.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        `SELECT identity.id AS identity_id,identity.player_id FROM external_identities identity
          JOIN players player ON player.id=identity.player_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
           AND player.status='active' AND player.deleted_at IS NULL FOR UPDATE`, [input.externalUserId],
      );
      const identity = identities[0];
      if (identity === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      let operatorId: bigint | null = null;
      if (command.kind === "admin") {
        const operators = await transaction.query<Array<{ operator_id: bigint }>>(
          `SELECT mapping.operator_id FROM admin_operator_external_identities mapping
            JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
            JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
            JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
           WHERE mapping.external_identity_id=? LIMIT 1 FOR UPDATE`, [identity.identity_id],
        );
        operatorId = operators[0]?.operator_id ?? null;
        if (operatorId === null) throw new ApplicationError("PET_REBIRTH_FORBIDDEN", "강제 환생 권한이 없습니다.", 403);
      }

      const profiles = await transaction.query<ProfileRow[]>(
        `SELECT profile.player_id,profile.current_display_name,profile.level,profile.accumulated_level_offset,
                profile.rebirth_count,profile.version,rank_profile.rank_emoji
           FROM player_profiles profile JOIN players player ON player.id=profile.player_id
           LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=profile.player_id
          WHERE ${command.kind === "self" ? "profile.player_id=?" : "profile.current_display_name=?"}
            AND player.status='active' AND player.deleted_at IS NULL ORDER BY profile.player_id LIMIT 2 FOR UPDATE`,
        [command.kind === "self" ? identity.player_id : command.targetName],
      );
      if (profiles.length === 0) throw new ApplicationError("PET_REBIRTH_TARGET_NOT_FOUND", command.kind === "self" ? "가입된 회원 정보를 찾을 수 없습니다." : "해당 유저가 존재하지 않습니다.", 404);
      if (profiles.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 사용자가 여러 명입니다.", 409);
      const profile = profiles[0]!;
      const scope = `pet.rebirth.${command.kind}:${operatorId ?? identity.identity_id}`;
      const key = normalizeEventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetRebirthResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key],
      );
      if (prior[0]?.result_json != null) return parseStored(prior[0].result_json);

      const mushrooms = command.kind === "self" ? await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id,stack.quantity,stack.version FROM item_definitions item
          JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=?
         WHERE item.display_name=? AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`, [profile.player_id, REBIRTH_MUSHROOM],
      ) : [];
      const mushroom = mushrooms[0];
      const eligible = command.kind === "admin" || profile.level > 299n || (mushroom?.quantity ?? 0n) > 0n;
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,?,?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, key, operatorId === null ? "external_identity" : "admin_operator", operatorId ?? identity.identity_id],
      );
      const rankName = `${profile.rank_emoji ?? ""}${profile.current_display_name}`;
      let result: PetRebirthResult;
      if (!eligible) {
        const data = "현재 ✨️레벨 300 이상 또는\n환생버섯🍄이 필요합니다.";
        const outbox = await this.queue(transaction, operation.insertId, input.destinationId, data);
        result = { status: "requirement_missing", playerId: profile.player_id.toString(), previousLevel: profile.level.toString(), accumulatedLevel: profile.accumulated_level_offset.toString(), rebirthCount: profile.rebirth_count.toString(), mushroomConsumed: false, replies: [{ outboxId: outbox.toString(), room: input.destinationId, data }] };
      } else {
        const next = calculatePetRebirth(profile);
        const consumeMushroom = command.kind === "self" && profile.level <= 299n;
        if (consumeMushroom && mushroom !== undefined) {
          const changed = await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>0", [profile.player_id, mushroom.item_id, mushroom.version]);
          if (changed.affectedRows !== 1n) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
          await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,-1,'pet_rebirth_mushroom_used')", [operation.insertId, profile.player_id, mushroom.item_id]);
        }
        const changed = await transaction.execute(
          "UPDATE player_profiles SET level=1,accumulated_level_offset=?,rebirth_count=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",
          [next.accumulatedLevel, next.rebirthCount, profile.player_id, profile.version],
        );
        if (changed.affectedRows !== 1n) throw new ApplicationError("PLAYER_PROFILE_VERSION_CONFLICT", "회원 정보가 먼저 변경되었습니다.", 409);
        await transaction.execute(
          `INSERT INTO player_rebirth_events(operation_id,player_id,previous_level,next_level,previous_accumulated_level,next_accumulated_level,previous_rebirth_count,next_rebirth_count,forced,mushroom_consumed,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
          [operation.insertId, profile.player_id, profile.level, 1, profile.accumulated_level_offset, next.accumulatedLevel, profile.rebirth_count, next.rebirthCount, command.kind === "admin", consumeMushroom],
        );
        const mainData = command.kind === "self" ? `[${rankName}] 님이 환생하여\n레벨이 1로 감소되었습니다.🍼` : "내게 강 같은 평화! 내가 강 같은 평화! 넘치네!! 호렐루야!\n호신의 축복을 받고 다시 태어납니다.\n환생 완료!";
        const broadcast = `내게 호강 같은 평화! 넘치네!!\n호렐루야! [${rankName}] 님이\n호신의 축복을 받고 다시 태어납니다.\n환생 완료!`;
        const replies: PetRebirthResult["replies"] = [];
        const mainOutbox = await this.queue(transaction, operation.insertId, input.destinationId, mainData);
        replies.push({ outboxId: mainOutbox.toString(), room: input.destinationId, data: mainData });
        for (const room of [...new Set(input.broadcastDestinationIds)]) {
          const outbox = await this.queue(transaction, operation.insertId, room, broadcast);
          replies.push({ outboxId: outbox.toString(), room, data: broadcast });
        }
        result = { status: "reborn", playerId: profile.player_id.toString(), previousLevel: profile.level.toString(), accumulatedLevel: next.accumulatedLevel.toString(), rebirthCount: next.rebirthCount.toString(), mushroomConsumed: consumeMushroom, replies };
      }
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, command.kind === "self" ? "PET_REBIRTH" : "ADMIN_PET_REBIRTH", operation.insertId, result.status],
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,?,?,?,?,'pet.rebirth',?,?,?,UTC_TIMESTAMP(3))`,
        [operation.insertId, operatorId === null ? "external_identity" : "admin_operator", operatorId ?? identity.identity_id, "player", profile.player_id, result.status === "reborn" ? "success" : "denied", `Iris ${input.message}`, JSON.stringify({ previousLevel: profile.level.toString(), accumulatedLevel: result.accumulatedLevel, rebirthCount: result.rebirthCount, forced: command.kind === "admin", mushroomConsumed: result.mushroomConsumed })],
      );
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async queue(transaction: DatabaseTransaction, operationId: bigint, room: string, data: string): Promise<bigint> {
    return (await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, room, JSON.stringify({ data })])).insertId;
  }
}
