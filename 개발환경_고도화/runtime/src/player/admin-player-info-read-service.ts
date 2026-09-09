import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type { BagView } from "../inventory/bag.js";
import { formatLegacyBag } from "../inventory/legacy-bag-formatter.js";
import { formatLegacyMyProfile } from "./legacy-profile-formatter.js";
import { MariaProfileRepository } from "./maria-profile-repository.js";
import type { ProfileView } from "./profile.js";

interface TitleView {
  displayName: string;
  equipped: boolean;
}

interface PlayerInfoDetails {
  profile: ProfileView;
  bag: BagView;
  titles: TitleView[];
  recentAttendanceAt: Date | null;
  verificationCount: string;
}

export interface AdminPlayerInfoReadResult {
  data: string;
  outboxId: string;
  found: boolean;
  targetPlayerId: string | null;
}

// `/정보`와 공백으로 분리된 대상 사용자 인자만 현대화 dispatch 후보로 허용합니다.
export function isAdminPlayerInfoReadCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/정보(?:\s.*)?$/u.test(message);
}

// 인자형 `/정보`를 DB command alias와 일치하는 대표 명령으로 정규화합니다.
export function normalizeAdminPlayerInfoReadDispatchMessage(message: string): string {
  return isAdminPlayerInfoReadCandidate(message) ? "/정보" : message;
}

// 관리자 정보 조회 인자에서 대상 표시 이름을 추출합니다.
export function parseAdminPlayerInfoTarget(message: string): string {
  return message.slice("/정보".length).trim();
}

// 프로필·가방·타이틀·출석·인증 정보를 레거시 운영 조회 형식으로 묶습니다.
export function formatAdminPlayerInfo(details: PlayerInfoDetails): string {
  const titles = details.titles.length === 0
    ? "   보유 타이틀 없음"
    : details.titles.map((title, index) => `   ${index + 1}. ${title.displayName}${title.equipped ? " ✔" : ""}`).join("\n");
  const attendance = details.recentAttendanceAt === null ? "기록 없음" : details.recentAttendanceAt.toISOString();
  const verification = BigInt(details.verificationCount) > 0n ? `${details.verificationCount}회` : "미완료";
  return `${formatLegacyMyProfile(details.profile)}\n• 최근출석: ${attendance}\n• 보룸인증: ${verification}\n\n${formatLegacyBag(details.bag)}\n\n[${details.profile.displayName}]님의 타이틀🏷️\n${titles}`;
}

// 운영자 권한을 확인하고 대상 사용자의 상세 정보를 읽어 감사·outbox와 원자 기록합니다.
export class AdminPlayerInfoReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<AdminPlayerInfoReadResult | null> {
    const operator = (await this.database.query<Array<{ id: bigint }>>(
      `SELECT operator.id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
         JOIN admin_operators operator ON operator.id = mapping.operator_id
         JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
         JOIN admin_roles role ON role.id = operator_role.role_id
         JOIN admin_role_permissions permission ON permission.role_id = role.id
        WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
          AND identity.status = 'linked' AND operator.status = 'active' AND role.active = TRUE
          AND role.code IN ('super_admin', 'manager') AND permission.permission_code = 'player.info.read'
        LIMIT 1`,
      [input.externalUserId]
    ))[0];
    if (operator === undefined) return null;

    const targetName = parseAdminPlayerInfoTarget(input.message);
    return this.database.withTransaction(async (transaction) => {
      const idempotencyKey = input.eventId.length <= 191
        ? input.eventId
        : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      const previous = (await transaction.query<Array<{ result_json: string | AdminPlayerInfoReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = 'player.info_read' AND idempotency_key = ? FOR UPDATE",
        [idempotencyKey]
      ))[0];
      if (previous?.result_json != null) {
        return typeof previous.result_json === "string" ? JSON.parse(previous.result_json) : previous.result_json;
      }

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'player.info_read',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey, operator.id]
      );
      const target = targetName === "" ? undefined : (await transaction.query<Array<{ player_id: bigint; display_name: string }>>(
        `SELECT player.id AS player_id, profile.current_display_name AS display_name
           FROM players player JOIN player_profiles profile ON profile.player_id = player.id
          WHERE player.status = 'active' AND player.deleted_at IS NULL
            AND BINARY profile.current_display_name = BINARY ?
          ORDER BY player.id LIMIT 1 FOR UPDATE`,
        [targetName]
      ))[0];

      let data: string;
      let targetPlayerId: string | null = null;
      if (target === undefined) {
        data = targetName === "" ? "사용법: /정보 [유저명]" : `[${targetName}] 님은 등록되지 않은 유저입니다.`;
      } else {
        targetPlayerId = target.player_id.toString();
        const details = await this.loadDetails(transaction, target.player_id, target.display_name);
        data = formatAdminPlayerInfo(details);
      }

      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_PLAYER_INFO_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',?,'player.info_read',?,'Iris /정보',?,UTC_TIMESTAMP(3))",
        [operation.insertId, operator.id, targetPlayerId, target === undefined ? "not_found" : "success", JSON.stringify({ targetName, readOnly: true })]
      );
      const result: AdminPlayerInfoReadResult = { data, outboxId: outbox.insertId.toString(), found: target !== undefined, targetPlayerId };
      await transaction.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async loadDetails(transaction: DatabaseTransaction, playerId: bigint, displayName: string): Promise<PlayerInfoDetails> {
    const profile = await new MariaProfileRepository(transaction).findByPlayerId(playerId.toString());
    if (profile === null) throw new Error(`active player profile disappeared: ${playerId.toString()}`);
    const [items, advertisements, titles, attendance, checks] = await Promise.all([
      transaction.query<Array<{ display_name: string; quantity: bigint; legacy_bag_order: string | null }>>(
        `SELECT item.display_name, stack.quantity,
                JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json, '$.legacyBagOrder')) AS legacy_bag_order
           FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id
          WHERE stack.player_id = ? AND stack.quantity > 0 AND item.active = TRUE`,
        [playerId]
      ),
      transaction.query<Array<{ string_value: string }>>(
        `SELECT value.string_value FROM configuration_sets config
           JOIN configuration_values value ON value.configuration_set_id = config.id
          WHERE config.status = 'active' AND value.config_key = 'legacy.bag.advertisement'
          ORDER BY config.version DESC LIMIT 1`
      ),
      transaction.query<Array<{ display_name: string; equipped: number }>>(
        `SELECT definition.display_name, owned.equipped
           FROM player_titles owned JOIN title_definitions definition ON definition.id = owned.title_id
          WHERE owned.player_id = ? AND definition.active = TRUE
          ORDER BY owned.equipped DESC, definition.display_name COLLATE utf8mb4_unicode_ci ASC`,
        [playerId]
      ),
      transaction.query<Array<{ recent_at: Date | null }>>(
        "SELECT MAX(last_attended_at) AS recent_at FROM player_attendance WHERE player_id = ?",
        [playerId]
      ),
      transaction.query<Array<{ check_count: bigint }>>(
        "SELECT check_count FROM player_check_counts WHERE player_id = ?",
        [playerId]
      )
    ]);
    return {
      profile,
      bag: {
        playerId: playerId.toString(),
        ownerLabel: displayName,
        advertisement: advertisements[0]?.string_value ?? "",
        items: items.map((item) => ({
          displayName: item.display_name,
          quantity: item.quantity.toString(),
          legacyBagOrder: item.legacy_bag_order === null ? null : Number(item.legacy_bag_order)
        }))
      },
      titles: titles.map((title) => ({ displayName: title.display_name, equipped: Boolean(title.equipped) })),
      recentAttendanceAt: attendance[0]?.recent_at ?? null,
      verificationCount: (checks[0]?.check_count ?? 0n).toString()
    };
  }
}
