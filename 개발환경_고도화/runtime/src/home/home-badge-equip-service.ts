import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseHomeBadgeEquipCommand } from "./home-badge-equip-command.js";

export type HomeBadgeEquipDefinition = {
  definition_version_id: bigint;
  ordinal: number;
  badge_code: string;
  emoji_value: string;
  display_name: string;
};

export type HomeBadgeEquipResult = {
  message: string;
  outboxId: string;
  replayed: boolean;
  definitionVersionId: string;
  badgeCode: string | null;
  ordinal: number | null;
  resultCode: string;
  stateVersion: string;
};

const SCOPE = "home.badge.equip";
const requestKey = (value: string): string => value.length <= 191
  ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const parseJson = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;

// 고정 definition 순서와 실제 보유 상태를 함께 사용해 번호 또는 ID를 해석합니다.
export function resolveOwnedHomeBadge(
  selection: string,
  definitions: HomeBadgeEquipDefinition[],
  ownedCodes: Set<string>
): HomeBadgeEquipDefinition | null {
  const owned = definitions.filter((definition) => ownedCodes.has(definition.badge_code));
  if (/^\d+$/.test(selection)) return owned[Number.parseInt(selection, 10) - 1] ?? null;
  const code = selection.toUpperCase();
  return owned.find((definition) => definition.badge_code === code) ?? null;
}

async function loadOwnedState(tx: DatabaseTransaction, playerId: bigint): Promise<{
  ownedCodes: Set<string>;
  equippedCode: string | null;
  stateVersion: bigint;
}> {
  const assignments = await tx.query<Array<{ badge_code: string }>>(
    "SELECT badge_code FROM player_badge_assignments WHERE player_id=? ORDER BY priority,badge_code FOR UPDATE",
    [playerId]
  );
  const states = await tx.query<Array<{ badge_code: string; owned: number; equipped: number }>>(
    "SELECT badge_code,owned,equipped FROM player_home_badges WHERE player_id=? ORDER BY badge_code FOR UPDATE",
    [playerId]
  );
  const exclusions = await tx.query<Array<{ badge_code: string }>>(
    "SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=? ORDER BY badge_code FOR UPDATE",
    [playerId]
  );
  const equipment = (await tx.query<Array<{ equipped_badge_code: string | null; version: bigint }>>(
    "SELECT equipped_badge_code,version FROM player_badge_equipment WHERE player_id=?",
    [playerId]
  ))[0];
  const ownedCodes = new Set(assignments.map((row) => row.badge_code));
  states.forEach((row) => { if (row.owned === 1) ownedCodes.add(row.badge_code); });
  exclusions.forEach((row) => ownedCodes.delete(row.badge_code));
  const rowEquipped = states.find((row) => row.owned === 1 && row.equipped === 1)?.badge_code ?? null;
  return {
    ownedCodes,
    equippedCode: equipment?.equipped_badge_code ?? rowEquipped,
    stateVersion: equipment?.version ?? 0n
  };
}

async function persistEquipment(
  tx: DatabaseTransaction,
  playerId: bigint,
  badgeCode: string | null
): Promise<void> {
  await tx.execute(
    "UPDATE player_home_badges SET equipped=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND equipped=TRUE",
    [playerId]
  );
  await tx.execute(
    "UPDATE player_home_badge_cubes SET equipped=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND equipped=TRUE",
    [playerId]
  );
  if (badgeCode !== null) {
    await tx.execute(
      "UPDATE player_home_badges SET equipped=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND badge_code=? AND owned=TRUE",
      [playerId, badgeCode]
    );
    await tx.execute(
      "UPDATE player_home_badge_cubes SET equipped=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND badge_code=?",
      [playerId, badgeCode]
    );
  }
  await tx.execute(
    `INSERT INTO player_badge_equipment(player_id,equipped_badge_code,version,updated_at)
     VALUES (?,?,1,UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE equipped_badge_code=VALUES(equipped_badge_code),version=version+1,updated_at=UTC_TIMESTAMP(3)`,
    [playerId, badgeCode]
  );
}

// player lock 이후 definition pin·소유 검증·상태 변경·증거/outbox를 한 transaction으로 처리합니다.
export class HomeBadgeEquipService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(input: {
    eventId: string;
    externalUserId: string;
    destinationId: string;
    message: string;
  }): Promise<HomeBadgeEquipResult> {
    const command = parseHomeBadgeEquipCommand(input.message);
    if (command === null) throw new ApplicationError("HOME_BADGE_EQUIP_COMMAND_INVALID", "홈뱃지 장착 명령 형식을 확인해 주세요.", 422);
    const actor = (await this.database.query<Array<{ player_id: bigint; display_name: string }>>(
      `SELECT identity.player_id,profile.current_display_name display_name
       FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
       JOIN player_profiles profile ON profile.player_id=player.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,
      [input.externalUserId]
    ))[0];
    if (actor === undefined) throw new ApplicationError("HOME_BADGE_EQUIP_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);

    return this.database.withTransaction(async (tx) => {
      const key = requestKey(input.eventId);
      await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
      const prior = (await tx.query<Array<{ result_json: string | HomeBadgeEquipResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?",
        [SCOPE, key]
      ))[0];
      if (prior?.result_json != null) return { ...parseJson<HomeBadgeEquipResult>(prior.result_json), replayed: true };

      const version = (await tx.query<Array<{ id: bigint }>>(
        "SELECT id FROM home_badge_definition_versions WHERE status='shadow' AND effective_at<=UTC_TIMESTAMP(3) ORDER BY effective_at DESC,id DESC LIMIT 1"
      ))[0];
      if (version === undefined) throw new ApplicationError("HOME_BADGE_DEFINITION_MISSING", "홈뱃지 기준정보를 찾을 수 없습니다.", 500);
      const definitions = await tx.query<HomeBadgeEquipDefinition[]>(
        "SELECT definition_version_id,ordinal,badge_code,emoji_value,display_name FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal",
        [version.id]
      );
      if (definitions.length !== 204) throw new ApplicationError("HOME_BADGE_DEFINITION_COUNT_INVALID", `홈뱃지 기준정보가 204종이 아닙니다. (${definitions.length}종)`, 500);

      const state = await loadOwnedState(tx, actor.player_id);
      const selected = command.kind === "equip"
        ? resolveOwnedHomeBadge(command.selection, definitions, state.ownedCodes) : null;
      const ownedOrdinal = selected === null ? null
        : definitions.filter((definition) => state.ownedCodes.has(definition.badge_code))
          .findIndex((definition) => definition.badge_code === selected.badge_code) + 1;
      let resultCode = "success";
      let afterCode = state.equippedCode;
      let message: string;
      if (command.kind === "equip" && selected === null) {
        resultCode = "invalid_selection";
        message = "❌ 보유한 홈뱃지 번호 또는 ID를 확인해 주세요.";
      } else if (command.kind === "equip" && selected!.badge_code === state.equippedCode) {
        resultCode = "already_equipped";
        message = "⚠️ 이미 대표뱃지로 장착 중입니다.";
      } else if (command.kind === "equip") {
        afterCode = selected!.badge_code;
        await persistEquipment(tx, actor.player_id, afterCode);
        message = `✅ [${ownedOrdinal}번] 홈뱃지를 대표뱃지로 장착했습니다.`;
      } else {
        afterCode = null;
        await persistEquipment(tx, actor.player_id, null);
        message = "✅ 대표뱃지를 해제했습니다.";
      }

      const nextVersion = resultCode === "success" ? state.stateVersion + 1n : state.stateVersion;
      const operationId = (await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, key, actor.player_id]
      )).insertId;
      const outboxId = (await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data: message })]
      )).insertId;
      await tx.execute(
        `INSERT INTO home_badge_equipment_mutations(operation_id,player_id,definition_version_id,command_kind,selection_text,before_badge_code,after_badge_code,result_code,state_version)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [operationId, actor.player_id, version.id, command.kind, command.kind === "equip" ? command.selection : null,
          state.equippedCode, afterCode, resultCode, nextVersion]
      );
      const result: HomeBadgeEquipResult = {
        message,
        outboxId: outboxId.toString(),
        replayed: false,
        definitionVersionId: version.id.toString(),
        badgeCode: selected?.badge_code ?? null,
        ordinal: ownedOrdinal,
        resultCode,
        stateVersion: nextVersion.toString()
      };
      const commandCode = command.kind === "equip" ? "HOME_BADGE_EQUIP" : "HOME_BADGE_UNEQUIP";
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, commandCode, operationId, resultCode]
      );
      await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'player',?,'home_badge',?,'home_badge_equipment_mutate',?,?,UTC_TIMESTAMP(3))",
        [operationId, actor.player_id, actor.player_id, resultCode,
          JSON.stringify({ command: command.kind, selection: command.kind === "equip" ? command.selection : null,
            before: state.equippedCode, after: afterCode, definitionVersionId: version.id.toString(), stateVersion: nextVersion.toString() })]
      );
      await tx.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operationId]
      );
      return result;
    });
  }
}
