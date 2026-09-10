import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

interface PlayerRow {
  player_id: bigint;
}

interface AccountLinkRow {
  player_role: string;
  link_status: string;
  portal_account_status: string;
  login_id: string | null;
  platform_code: string | null;
  context_type: string | null;
  selection_status: string | null;
  external_user_key: string | null;
}

export interface AdminAccountLinkReadModel {
  playerId: string;
  playerRole: string;
  linkStatus: string;
  portalAccountStatus: string;
  maskedLoginId: string | null;
  platformCode: string | null;
  contextType: string | null;
  selectionStatus: string | null;
  maskedExternalUserKey: string | null;
}

// 조회 DTO에서 로그인·외부 사용자 식별자의 원문을 숨깁니다.
function maskIdentifier(value: string | null): string | null {
  if (value === null || value === "") return null;
  if (value.length === 1) return "*";
  if (value.length === 2) return `${value[0]}*`;
  return `${value[0]}${"*".repeat(Math.min(value.length - 2, 8))}${value[value.length - 1]}`;
}

// WBS746 계정·플랫폼 연결을 관리자 조회용 안전 DTO로 읽습니다.
export class AdminAccountLinkReadService {
  constructor(private readonly database: Pick<DatabaseClient, "query">) {}

  async read(playerId: bigint): Promise<AdminAccountLinkReadModel[]> {
    const players = await this.database.query<PlayerRow[]>(
      "SELECT id AS player_id FROM players WHERE id=?",
      [playerId]
    );
    if (players[0] === undefined) {
      throw new ApplicationError("PLAYER_NOT_FOUND", "대상 회원을 찾을 수 없습니다.", 404);
    }

    const rows = await this.database.query<AccountLinkRow[]>(
      `SELECT link.player_role,link.link_status,
              portal.portal_account_status,legacy_account.login_id,identity_row.platform_code,context_row.context_type,
              selection.selection_status,identity_row.external_user_key
       FROM portal_game_account_links link
       JOIN canonical_portal_accounts portal ON portal.portal_account_id=link.portal_account_id
       LEFT JOIN user_accounts legacy_account ON legacy_account.id=portal.legacy_user_account_id
       LEFT JOIN account_platform_identities identity_row ON identity_row.portal_account_id=portal.portal_account_id
       LEFT JOIN account_platform_context_memberships membership ON membership.platform_identity_id=identity_row.platform_identity_id
       LEFT JOIN account_platform_contexts context_row ON context_row.platform_context_id=membership.platform_context_id
       LEFT JOIN account_platform_active_player_selections selection
         ON selection.platform_context_membership_id=membership.platform_context_membership_id
         AND selection.portal_game_account_link_id=link.portal_game_account_link_id
       WHERE link.player_id=?
       ORDER BY link.registration_sequence,identity_row.platform_code,context_row.context_type,selection.selection_version`,
      [playerId]
    );
    return rows.map((row) => ({
      playerId: playerId.toString(),
      playerRole: row.player_role,
      linkStatus: row.link_status,
      portalAccountStatus: row.portal_account_status,
      maskedLoginId: maskIdentifier(row.login_id),
      platformCode: row.platform_code,
      contextType: row.context_type,
      selectionStatus: row.selection_status,
      maskedExternalUserKey: maskIdentifier(row.external_user_key),
    }));
  }
}
