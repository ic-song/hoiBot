import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface MiniPetForceUnequipCommand {
  externalUserId: string;
  channelId: string;
  eventId: string;
  message: string;
  environmentCode: "prod" | "dev";
}

export interface MiniPetForceUnequipResult {
  status: "unequipped" | "invalid_command" | "no_equipped" | "snapshot_required";
  data?: string;
  playerId?: string;
  stableOwnedId?: string;
  afterSortIndex?: number;
  outboxId?: string;
  replayed?: boolean;
}

interface EquippedRow {
  owned_mini_pet_id: bigint;
  stable_owned_id: string | null;
  sort_index: number | null;
  display_name: string;
  state_code: string | null;
}

// 기본 사용법 또는 공백 없는 양끝을 가진 대상 표시명 명령만 후보로 인정합니다.
export function isMiniPetForceUnequipCommand(message: string | undefined): boolean {
  return message === "/미니펫해제"
    || (message !== undefined && /^\/미니펫해제\s+\S(?:.*\S)?$/.test(message));
}

// 명령 본문에서 대상 표시명을 정확히 분리합니다.
export function parseMiniPetForceUnequipCommand(message: string): string | null {
  const match = /^\/미니펫해제\s+(\S(?:.*\S)?)$/.exec(message);
  return match?.[1] ?? null;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | MiniPetForceUnequipResult): MiniPetForceUnequipResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetForceUnequipResult : value;
}

export class MiniPetForceUnequipService {
  constructor(private readonly database: DatabaseClient) {}

  // 운영 권한과 가방 불변식을 잠근 뒤 장착 상태·순번·이력·응답을 원자적으로 기록합니다.
  async execute(command: MiniPetForceUnequipCommand): Promise<MiniPetForceUnequipResult> {
    const targetName = parseMiniPetForceUnequipCommand(command.message);
    if (targetName === null) {
      return { status: "invalid_command", data: "사용법: /미니펫해제 [대상명]" };
    }

    return this.database.withTransaction(async (tx) => {
      const environments = await tx.query<Array<{ environment_code: string }>>(
        "SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id=1 FOR UPDATE"
      );
      if (environments[0]?.environment_code !== command.environmentCode) {
        throw new ApplicationError("MINIPET_FORCE_UNEQUIP_ENVIRONMENT_MISMATCH", "요청 환경과 DB 환경이 일치하지 않습니다.", 409);
      }

      const operators = await tx.query<Array<{ operator_id: bigint }>>(
        `SELECT mapping.operator_id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
           AND (EXISTS (
             SELECT 1 FROM admin_operator_roles operator_role
             JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
             JOIN admin_role_permissions permission ON permission.role_id=role.id
             WHERE operator_role.operator_id=operator.id AND permission.permission_code='minipet.force_unequip'
           ) OR EXISTS (
             SELECT 1 FROM admin_operator_permission_overrides permission_override
             WHERE permission_override.operator_id=operator.id
               AND permission_override.permission_code='minipet.force_unequip' AND permission_override.effect='allow'
           ))
           AND NOT EXISTS (
             SELECT 1 FROM admin_operator_permission_overrides permission_override
             WHERE permission_override.operator_id=operator.id
               AND permission_override.permission_code='minipet.force_unequip' AND permission_override.effect='deny'
           )
         LIMIT 1 FOR UPDATE`,
        [command.externalUserId]
      );
      const operator = operators[0];
      if (operator === undefined) throw new ApplicationError("FORBIDDEN", "미니펫 강제 해제 권한이 없습니다.", 403);

      const scope = `mini_pet.force_unequip:${operator.operator_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | MiniPetForceUnequipResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, key]
      );
      if (prior[0] !== undefined) {
        if (prior[0].result_json === null) throw new ApplicationError("MINIPET_FORCE_UNEQUIP_PROCESSING", "미니펫 장착 해제가 진행 중입니다.", 409);
        return { ...stored(prior[0].result_json), replayed: true };
      }

      const targets = await tx.query<Array<{ player_id: bigint; current_display_name: string }>>(
        "SELECT player_id,current_display_name FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 2 FOR UPDATE",
        [targetName]
      );
      if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
      if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 확인이 필요합니다.", 409);
      const target = targets[0]!;

      const inventoryStates = await tx.query<Array<{ capacity_limit: number; bag_shape_code: string }>>(
        "SELECT capacity_limit,bag_shape_code FROM mini_pet_inventory_player_states WHERE player_id=? FOR UPDATE",
        [target.player_id]
      );
      const inventoryState = inventoryStates[0];
      if (inventoryState === undefined || inventoryState.bag_shape_code !== "array") {
        return { status: "snapshot_required", data: "대상의 미니펫 가방을 먼저 확인해 주세요." };
      }

      const equippedRows = await tx.query<EquippedRow[]>(
        `SELECT owned.id owned_mini_pet_id,state.stable_owned_id,state.sort_index,
          COALESCE(owned.custom_name,definition.display_name) display_name,lifecycle.state_code
         FROM owned_mini_pets owned
         JOIN mini_pet_definitions definition ON definition.id=owned.mini_pet_definition_id
         LEFT JOIN mini_pet_inventory_owned_states state ON state.owned_mini_pet_id=owned.id AND state.player_id=owned.player_id
         LEFT JOIN mini_pet_owned_lifecycle lifecycle ON lifecycle.owned_mini_pet_id=owned.id
         WHERE owned.player_id=? AND owned.equipped=TRUE AND COALESCE(lifecycle.state_code,'active')='active'
         ORDER BY owned.id LIMIT 2 FOR UPDATE`,
        [target.player_id]
      );
      if (equippedRows.length === 0) return { status: "no_equipped", data: `[${targetName}] 님은 장착한 미니펫이 없습니다.` };
      if (equippedRows.length > 1) throw new ApplicationError("MINIPET_MULTIPLE_EQUIPPED", "장착 미니펫이 여러 마리라 강제 해제하지 않았습니다.", 409);
      const equipped = equippedRows[0]!;
      if (equipped.stable_owned_id === null || equipped.sort_index !== null) {
        return { status: "snapshot_required", data: "대상의 미니펫 가방 상태를 다시 확인해 주세요." };
      }

      const bagRows = await tx.query<Array<{ owned_mini_pet_id: bigint; sort_index: number | null }>>(
        `SELECT state.owned_mini_pet_id,state.sort_index
         FROM mini_pet_inventory_owned_states state
         JOIN owned_mini_pets owned ON owned.id=state.owned_mini_pet_id AND owned.player_id=state.player_id
         LEFT JOIN mini_pet_owned_lifecycle lifecycle ON lifecycle.owned_mini_pet_id=owned.id
         WHERE state.player_id=? AND owned.equipped=FALSE AND COALESCE(lifecycle.state_code,'active')='active'
         ORDER BY state.sort_index,state.owned_mini_pet_id FOR UPDATE`,
        [target.player_id]
      );
      const contiguous = bagRows.every((row, index) => row.sort_index === index + 1);
      if (!contiguous) return { status: "snapshot_required", data: "대상의 미니펫 가방 순서를 먼저 복구해 주세요." };
      if (bagRows.length >= inventoryState.capacity_limit) {
        throw new ApplicationError("MINIPET_BAG_FULL", "대상의 미니펫 가방이 가득 차 해제하지 않았습니다.", 409);
      }
      const afterSortIndex = bagRows.length + 1;

      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, operator.operator_id]
      );
      const ownedChanged = await tx.execute(
        "UPDATE owned_mini_pets SET equipped=FALSE WHERE id=? AND player_id=? AND equipped=TRUE",
        [equipped.owned_mini_pet_id, target.player_id]
      );
      const stateChanged = await tx.execute(
        "UPDATE mini_pet_inventory_owned_states SET sort_index=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE owned_mini_pet_id=? AND player_id=? AND sort_index IS NULL",
        [afterSortIndex, equipped.owned_mini_pet_id, target.player_id]
      );
      if (ownedChanged.affectedRows !== 1n || stateChanged.affectedRows !== 1n) {
        throw new ApplicationError("MINIPET_FORCE_UNEQUIP_CONFLICT", "장착 상태가 변경되어 해제를 취소했습니다.", 409);
      }
      await tx.execute(
        "INSERT INTO mini_pet_force_unequip_events(operation_id,operator_id,player_id,owned_mini_pet_id,stable_owned_id,after_sort_index,reason) VALUES(?,?,?,?,?,?,?)",
        [operation.insertId, operator.operator_id, target.player_id, equipped.owned_mini_pet_id, equipped.stable_owned_id, afterSortIndex, "Iris /미니펫해제"]
      );
      const data = `✅ [${targetName}] 님의 [${equipped.display_name}] 미니펫 장착을 해제했습니다.`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'mini_pet_force_unequip',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]
      );
      await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'admin_operator',?,'player',?,'mini_pet.force_unequip','success','Iris /미니펫해제',?,UTC_TIMESTAMP(3))",
        [operation.insertId, operator.operator_id, target.player_id, JSON.stringify({ stableOwnedId: equipped.stable_owned_id, afterSortIndex })]
      );
      const result: MiniPetForceUnequipResult = {
        status: "unequipped", data, playerId: target.player_id.toString(), stableOwnedId: equipped.stable_owned_id,
        afterSortIndex, outboxId: outbox.insertId.toString(), replayed: false
      };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
