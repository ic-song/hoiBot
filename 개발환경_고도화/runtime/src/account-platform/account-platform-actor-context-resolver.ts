import type { DatabaseClient } from "../database.js";
import { AccountPlatformService, type AccountPlatformContextInput } from "./account-platform-service.js";
import { MariaAccountPlatformRepository } from "./maria-account-platform-repository.js";

export interface ResolvedAccountPlatformActorContext {
  playerId: string;
  source: "ACCOUNT_PLATFORM_CONTEXT" | "LEGACY_EXTERNAL_IDENTITY";
  portalAccountId?: string;
  platformContextMembershipId?: string;
  selectionVersion?: number;
}

interface LegacyPlayerRow {
  player_id: bigint;
}

// 명령 시작 시 현대 context selection을 우선하고 미이관 legacy player만 호환 조회합니다.
export class AccountPlatformActorContextResolver {
  private readonly accountPlatform: AccountPlatformService;

  constructor(private readonly database: DatabaseClient) {
    this.accountPlatform = new AccountPlatformService(new MariaAccountPlatformRepository(database));
  }

  async resolve(input: AccountPlatformContextInput): Promise<ResolvedAccountPlatformActorContext | null> {
    const active = await this.accountPlatform.resolveActivePlayer(input);
    if (active !== null) {
      return {
        playerId: active.playerId,
        source: "ACCOUNT_PLATFORM_CONTEXT",
        portalAccountId: active.portalAccountId,
        platformContextMembershipId: active.platformContextMembershipId,
        selectionVersion: active.selectionVersion
      };
    }

    const legacy = (await this.database.query<LegacyPlayerRow[]>(
      `SELECT identity_row.player_id FROM external_identities identity_row
       JOIN players player ON player.id=identity_row.player_id AND player.status='active'
       LEFT JOIN portal_game_account_links link ON link.player_id=identity_row.player_id AND link.link_status='ACTIVE'
       WHERE identity_row.provider_code=? AND identity_row.external_user_id=?
         AND identity_row.status='linked' AND identity_row.player_id IS NOT NULL
         AND link.portal_game_account_link_id IS NULL
       LIMIT 1`,
      [input.platformCode.toLowerCase(), input.externalUserKey]
    ))[0];
    return legacy === undefined
      ? null
      : { playerId: legacy.player_id.toString(), source: "LEGACY_EXTERNAL_IDENTITY" };
  }
}
