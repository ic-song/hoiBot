import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseHomeBadgePermanentDeleteCommand } from "./home-badge-permanent-delete-command.js";

export type HomeBadgeDeleteDefinition = {
  definition_version_id: bigint;
  ordinal: number;
  badge_code: string;
};

export type HomeBadgePermanentDeleteResult = {
  message: string;
  outboxId: string;
  replayed: boolean;
  definitionVersionId: string;
  badgeCode: string | null;
  ordinal: number | null;
  resultCode: string;
};

type DeleteState = {
  ownedCodes: Set<string>;
  excludedCodes: Set<string>;
  equippedCode: string | null;
  cubeCodes: Set<string>;
};

const SCOPE = "home.badge.permanent_delete";
const key = (value: string): string => value.length <= 191
  ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const parseJson = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;

// 고정 definition 순서의 실제 보유 목록에서 번호 또는 대소문자 무관 ID를 해석합니다.
export function resolveOwnedBadgeForDelete(
  selection: string,
  definitions: HomeBadgeDeleteDefinition[],
  ownedCodes: Set<string>
): { definition: HomeBadgeDeleteDefinition; ownedOrdinal: number } | null {
  const owned = definitions.filter((definition) => ownedCodes.has(definition.badge_code));
  if (/^\d+$/.test(selection)) {
    const index = Number.parseInt(selection, 10) - 1;
    return owned[index] === undefined ? null : { definition: owned[index], ownedOrdinal: index + 1 };
  }
  const index = owned.findIndex((definition) => definition.badge_code === selection.toUpperCase());
  return index < 0 ? null : { definition: owned[index]!, ownedOrdinal: index + 1 };
}

async function loadDeleteState(tx: DatabaseTransaction, playerId: bigint): Promise<DeleteState> {
  const assignments = await tx.query<Array<{ badge_code: string }>>(
    "SELECT badge_code FROM player_badge_assignments WHERE player_id=? ORDER BY priority,badge_code FOR UPDATE", [playerId]
  );
  const badges = await tx.query<Array<{ badge_code: string; owned: number; equipped: number }>>(
    "SELECT badge_code,owned,equipped FROM player_home_badges WHERE player_id=? ORDER BY badge_code FOR UPDATE", [playerId]
  );
  const exclusions = await tx.query<Array<{ badge_code: string }>>(
    "SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=? ORDER BY badge_code FOR UPDATE", [playerId]
  );
  const cubes = await tx.query<Array<{ badge_code: string; equipped: number }>>(
    "SELECT badge_code,equipped FROM player_home_badge_cubes WHERE player_id=? ORDER BY badge_code FOR UPDATE", [playerId]
  );
  const equipment = (await tx.query<Array<{ equipped_badge_code: string | null }>>(
    "SELECT equipped_badge_code FROM player_badge_equipment WHERE player_id=?", [playerId]
  ))[0];
  const excludedCodes = new Set(exclusions.map((row) => row.badge_code));
  const ownedCodes = new Set(assignments.map((row) => row.badge_code));
  badges.forEach((row) => { if (row.owned === 1) ownedCodes.add(row.badge_code); });
  excludedCodes.forEach((code) => ownedCodes.delete(code));
  return {
    ownedCodes,
    excludedCodes,
    equippedCode: equipment?.equipped_badge_code
      ?? badges.find((row) => row.owned === 1 && row.equipped === 1)?.badge_code
      ?? cubes.find((row) => row.equipped === 1)?.badge_code
      ?? null,
    cubeCodes: new Set(cubes.map((row) => row.badge_code))
  };
}

// player lock 아래 assignment·tombstone·cube·equipment를 하나의 영구삭제 transaction으로 변경합니다.
export class HomeBadgePermanentDeleteService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(input: {
    eventId: string;
    externalUserId: string;
    destinationId: string;
    message: string;
  }): Promise<HomeBadgePermanentDeleteResult> {
    const command = parseHomeBadgePermanentDeleteCommand(input.message);
    if (command === null) throw new ApplicationError("HOME_BADGE_DELETE_COMMAND_INVALID", "홈뱃지 삭제 명령 형식을 확인해 주세요.", 422);
    const actor = (await this.database.query<Array<{ player_id: bigint }>>(
      `SELECT identity.player_id
       FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,
      [input.externalUserId]
    ))[0];
    if (actor === undefined) throw new ApplicationError("HOME_BADGE_DELETE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);

    return this.database.withTransaction(async (tx) => {
      const requestKey = key(input.eventId);
      await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
      const prior = (await tx.query<Array<{ result_json: string | HomeBadgePermanentDeleteResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [SCOPE, requestKey]
      ))[0];
      if (prior?.result_json != null) return { ...parseJson<HomeBadgePermanentDeleteResult>(prior.result_json), replayed: true };
      const version = (await tx.query<Array<{ id: bigint }>>(
        "SELECT id FROM home_badge_definition_versions WHERE status='shadow' AND effective_at<=UTC_TIMESTAMP(3) ORDER BY effective_at DESC,id DESC LIMIT 1"
      ))[0];
      if (version === undefined) throw new ApplicationError("HOME_BADGE_DEFINITION_MISSING", "홈뱃지 기준정보를 찾을 수 없습니다.", 500);
      const definitions = await tx.query<HomeBadgeDeleteDefinition[]>(
        "SELECT definition_version_id,ordinal,badge_code FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal", [version.id]
      );
      if (definitions.length !== 204) throw new ApplicationError("HOME_BADGE_DEFINITION_COUNT_INVALID", `홈뱃지 기준정보가 204종이 아닙니다. (${definitions.length}종)`, 500);
      const state = await loadDeleteState(tx, actor.player_id);
      const resolved = resolveOwnedBadgeForDelete(command.selection, definitions, state.ownedCodes);
      const resultCode = resolved === null ? "not_owned_or_deleted" : "success";
      const targetCode = resolved?.definition.badge_code ?? null;
      const operationId = (await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, requestKey, actor.player_id]
      )).insertId;
      let assignmentRemoved = false, tombstoneWritten = false, cubeRemoved = false, equipmentCleared = false;
      if (targetCode !== null) {
        assignmentRemoved = (await tx.execute(
          "DELETE FROM player_badge_assignments WHERE player_id=? AND badge_code=?", [actor.player_id, targetCode]
        )).affectedRows > 0n;
        await tx.execute(
          `INSERT INTO player_home_badge_exclusions(player_id,badge_code,reason_code,created_at)
           VALUES (?,?,'user_permanent_delete',UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE reason_code=VALUES(reason_code)`,
          [actor.player_id, targetCode]
        );
        tombstoneWritten = true;
        await tx.execute(
          "UPDATE player_home_badges SET owned=FALSE,equipped=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND badge_code=?",
          [actor.player_id, targetCode]
        );
        cubeRemoved = (await tx.execute(
          "DELETE FROM player_home_badge_cubes WHERE player_id=? AND badge_code=?", [actor.player_id, targetCode]
        )).affectedRows > 0n;
        if (state.equippedCode === targetCode) {
          await tx.execute(
            `INSERT INTO player_badge_equipment(player_id,equipped_badge_code,version,updated_at)
             VALUES (?,NULL,1,UTC_TIMESTAMP(3))
             ON DUPLICATE KEY UPDATE equipped_badge_code=NULL,version=version+1,updated_at=UTC_TIMESTAMP(3)`,
            [actor.player_id]
          );
          equipmentCleared = true;
        }
      }
      const message = resolved === null
        ? "❌ 보유 중인 홈뱃지가 아니거나 이미 영구 삭제되었습니다."
        : `✅ [${resolved.ownedOrdinal}번] 홈뱃지를 영구 삭제했습니다.`;
      const outboxId = (await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data: message })]
      )).insertId;
      await tx.execute(
        `INSERT INTO home_badge_permanent_deletions(operation_id,player_id,definition_version_id,badge_code,selection_text,owned_ordinal,assignment_removed,tombstone_written,cube_removed,equipment_cleared,result_code)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [operationId, actor.player_id, version.id, targetCode, command.selection, resolved?.ownedOrdinal ?? null,
          assignmentRemoved, tombstoneWritten, cubeRemoved, equipmentCleared, resultCode]
      );
      const result: HomeBadgePermanentDeleteResult = {
        message,
        outboxId: outboxId.toString(),
        replayed: false,
        definitionVersionId: version.id.toString(),
        badgeCode: targetCode,
        ordinal: resolved?.ownedOrdinal ?? null,
        resultCode
      };
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_BADGE_PERMANENT_DELETE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operationId, resultCode]
      );
      await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'player',?,'home_badge',?,'home_badge_permanent_delete',?,?,UTC_TIMESTAMP(3))",
        [operationId, actor.player_id, actor.player_id, resultCode,
          JSON.stringify({ selection: command.selection, badgeCode: targetCode, ownedOrdinal: resolved?.ownedOrdinal ?? null,
            definitionVersionId: version.id.toString(), assignmentRemoved, tombstoneWritten, cubeRemoved, equipmentCleared,
            policy: "absolute_tombstone_explicit_restore_only" })]
      );
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}
