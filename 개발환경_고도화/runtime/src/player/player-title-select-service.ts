import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { lockPlayerTitleOwnedProjection, type PlayerTitleOwnedProjection } from "./player-title-owned-projection.js";

interface PlayerTitleOwnerRow {
  externalIdentityId: bigint;
  playerId: bigint;
  displayName: string;
  rankEmoji: string | null;
}

type OwnedTitleRow = PlayerTitleOwnedProjection;

export interface PlayerTitleSelectResult {
  status: "selected" | "invalid_format" | "player_not_found" | "title_not_found";
  data: string;
  playerId: string | null;
  selectedTitleId: string | null;
  selectedTitleName: string | null;
  selectedIndex: number | null;
  outboxId: string;
}

// 레거시 `/타이틀 ` 실행 분기만 후보로 인정해 쉼표형 운영 지급 명령과 분리합니다.
export function isPlayerTitleSelectCandidate(message: string | undefined): boolean {
  return message !== undefined && message.startsWith("/타이틀 ");
}

// 인자형 타이틀 선택 명령을 공용 dispatch 별칭으로 정규화합니다.
export function normalizePlayerTitleSelectDispatchMessage(message: string): string {
  return isPlayerTitleSelectCandidate(message) ? "/타이틀" : message;
}

// 레거시와 동일한 양의 정수 타이틀 번호를 추출합니다.
export function parsePlayerTitleSelectIndex(message: string): number | null {
  const match = message.match(/^\/타이틀\s+(\d+)\s*$/u);
  if (match === null) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index > 0 ? index : null;
}

// 고정 표시 순서로 보유 타이틀 하나를 선택하고 감사·outbox를 원자 기록합니다.
export class PlayerTitleSelectService {
  constructor(private readonly database: DatabaseClient) {}

  async select(input: { eventId: string; externalUserId: string; destinationId: string; message: string; senderDisplayName: string }): Promise<PlayerTitleSelectResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `player.title.select:${input.externalUserId}`;
      const idempotencyKey = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const owner = (await transaction.query<Array<{
        external_identity_id: bigint;
        player_id: bigint;
        current_display_name: string;
        rank_emoji: string | null;
      }>>(
        `SELECT identity.id external_identity_id,player.id player_id,
                profile.current_display_name,rank_profile.rank_emoji
           FROM external_identities identity
           JOIN players player ON player.id=identity.player_id
           JOIN player_profiles profile ON profile.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
          WHERE identity.provider_code='kakao' AND identity.external_user_id=?
            AND identity.status='linked' AND player.status='active' AND player.deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [input.externalUserId]
      ))[0];
      const mappedOwner: PlayerTitleOwnerRow | undefined = owner === undefined ? undefined : {
        externalIdentityId: owner.external_identity_id,
        playerId: owner.player_id,
        displayName: owner.current_display_name,
        rankEmoji: owner.rank_emoji
      };

      await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
        [randomUUID(), scope, idempotencyKey, mappedOwner?.externalIdentityId ?? null]
      );
      const operation = (await transaction.query<Array<{ id: bigint; result_json: string | PlayerTitleSelectResult | null }>>(
        "SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, idempotencyKey]
      ))[0];
      if (operation === undefined) throw new Error("Player title select operation claim failed.");
      if (operation.result_json !== null) {
        return typeof operation.result_json === "string" ? JSON.parse(operation.result_json) : operation.result_json;
      }

      const requestedIndex = parsePlayerTitleSelectIndex(input.message);
      let status: PlayerTitleSelectResult["status"];
      let data: string;
      let selected: OwnedTitleRow | undefined;
      let titles: OwnedTitleRow[] = [];
      if (mappedOwner === undefined) {
        status = "player_not_found";
        data = `${input.senderDisplayName}는(은) 존재하지 않는 사용자입니다.`;
      } else if (requestedIndex === null) {
        status = "invalid_format";
        data = "올바른 타이틀 설정 명령어 형식을 사용해주세요. 예: /타이틀 [번호]";
      } else {
        titles = await lockPlayerTitleOwnedProjection(transaction,mappedOwner.playerId);
        selected = titles[requestedIndex - 1];
        if (selected === undefined) {
          status = "title_not_found";
          data = "해당 번호의 타이틀이 존재하지 않습니다.";
        } else {
          await transaction.execute("UPDATE player_title_instances SET equipped=(id=?) WHERE player_id=? AND status='owned'", [selected.instanceId, mappedOwner.playerId]);
          await transaction.execute("UPDATE player_titles SET equipped=(title_id=?) WHERE player_id=?", [selected.titleId, mappedOwner.playerId]);
          status = "selected";
          const rankAndName = `${mappedOwner.rankEmoji ?? ""}${mappedOwner.displayName}`;
          data = `[${rankAndName}] 님의 타이틀이\n[${selected.displayName}] (으)로 적용되었습니다.`;
        }
      }

      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.id, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PLAYER_TITLE_SELECT',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.id, status]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player_title',?,'player.title.select',?,'Iris /타이틀',?,UTC_TIMESTAMP(3))",
        [operation.id, mappedOwner?.externalIdentityId ?? null, selected?.titleId ?? null, status, JSON.stringify({ playerId: mappedOwner?.playerId.toString() ?? null, requestedIndex, selectedTitleId: selected?.titleId.toString() ?? null, selectedInstanceId: selected?.instanceId?.toString() ?? null, selectedTitleName: selected?.displayName ?? null, ownedTitleCount: titles.length, fixedDisplayOrder: selected?.displayOrder?.toString() ?? null })]
      );
      const result: PlayerTitleSelectResult = {
        status,
        data,
        playerId: mappedOwner?.playerId.toString() ?? null,
        selectedTitleId: selected?.titleId.toString() ?? null,
        selectedTitleName: selected?.displayName ?? null,
        selectedIndex: selected === undefined ? null : requestedIndex,
        outboxId: outbox.insertId.toString()
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.id]);
      return result;
    });
  }
}
