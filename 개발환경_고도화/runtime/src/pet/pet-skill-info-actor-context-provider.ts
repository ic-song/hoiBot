import { MariaPlayerContextProvider, type PlayerContext, type PlayerContextReadParticipant } from "../account-platform/player-context-provider.js";

export interface PetSkillInfoActorContext {
  readonly selectionSource: PlayerContext["selectionSource"];
  readonly platformCode: "kakao" | "discord";
  readonly externalContextId: string;
  readonly externalIdentityId: string;
  readonly selectedLegacyPlayerId: string;
  readonly selectedCanonicalPlayerId: string;
  readonly entitlementLegacyPlayerId: string;
  readonly portalAccountId: string | null;
  readonly platformContextMembershipId: string | null;
  readonly selectionVersion: string | null;
}

interface ActiveAuthorityRow {
  portal_account_id: string | null;
  platform_context_membership_id: string | null;
  selection_version: bigint | number | string | null;
  representative_player_id: bigint | number | string | null;
}

function fail(code: string): never { throw new Error(code); }
function positiveBigInt(value: bigint | number | string | null): string {
  if (value === null) return fail("PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT");
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) return fail("PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT");
    return parsed.toString();
  } catch { return fail("PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT"); }
}

function locator(input: { identityProviderCode: string; externalContextId: string }): {
  providerCode: "kakao" | "discord";
  platformCode: "KAKAO" | "DISCORD";
  identityScopeKey: string;
  contextType: "ROOM" | "SERVER";
} {
  const providerCode = input.identityProviderCode.toLowerCase();
  if (providerCode === "kakao") return { providerCode, platformCode: "KAKAO", identityScopeKey: input.externalContextId, contextType: "ROOM" };
  if (providerCode === "discord") return { providerCode, platformCode: "DISCORD", identityScopeKey: "PLATFORM_ACCOUNT", contextType: "SERVER" };
  return fail("PLAYER_CONTEXT_PROVIDER_UNSUPPORTED");
}

// 선택된 게임계정과 대표계정의 이용권 권위를 동일 읽기 스냅샷에서 함께 고정합니다.
export class MariaPetSkillInfoActorContextProvider {
  public constructor(private readonly players: Pick<MariaPlayerContextProvider, "resolveSelf"> = new MariaPlayerContextProvider()) {}

  public async resolve(transaction: PlayerContextReadParticipant, input: {
    identityProviderCode: string;
    externalUserId: string;
    externalContextId: string;
  }): Promise<PetSkillInfoActorContext> {
    const selected = await this.players.resolveSelf(transaction, input);
    const normalized = locator(input);
    if (selected.platformCode !== normalized.providerCode || selected.externalContextId !== input.externalContextId) fail("PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT");
    if (selected.selectionSource === "LEGACY_CROSSWALK") {
      return Object.freeze({
        selectionSource: selected.selectionSource,
        platformCode: normalized.providerCode,
        externalContextId: selected.externalContextId,
        externalIdentityId: selected.externalIdentityId,
        selectedLegacyPlayerId: selected.legacyPlayerId,
        selectedCanonicalPlayerId: selected.canonicalPlayerId,
        entitlementLegacyPlayerId: selected.legacyPlayerId,
        portalAccountId: null,
        platformContextMembershipId: null,
        selectionVersion: null
      });
    }
    const rows = await transaction.query<ActiveAuthorityRow[]>(
      `SELECT RTRIM(platform_identity.portal_account_id) AS portal_account_id,
              RTRIM(membership.platform_context_membership_id) AS platform_context_membership_id,
              selection.selection_version,representative_link.player_id AS representative_player_id
         FROM account_platform_identities platform_identity
         JOIN account_platform_context_memberships membership
           ON membership.platform_identity_id=platform_identity.platform_identity_id AND membership.membership_status='ACTIVE'
         JOIN account_platform_contexts context_row
           ON context_row.platform_context_id=membership.platform_context_id
          AND context_row.platform_code=platform_identity.platform_code AND context_row.context_status='ACTIVE'
         JOIN account_platform_active_player_selections selection
           ON selection.platform_context_membership_id=membership.platform_context_membership_id AND selection.selection_status='ACTIVE'
         JOIN portal_game_account_links selected_link
           ON selected_link.portal_game_account_link_id=selection.portal_game_account_link_id
          AND selected_link.portal_account_id=platform_identity.portal_account_id
          AND selected_link.player_id=selection.active_player_id AND selected_link.link_status='ACTIVE'
         JOIN canonical_portal_accounts portal_account
           ON portal_account.portal_account_id=platform_identity.portal_account_id AND portal_account.portal_account_status='ACTIVE'
         JOIN portal_game_account_links representative_link
           ON representative_link.portal_account_id=platform_identity.portal_account_id
          AND representative_link.player_role='REPRESENTATIVE' AND representative_link.link_status='ACTIVE'
         JOIN players representative_player
           ON representative_player.id=representative_link.player_id AND representative_player.status='active' AND representative_player.deleted_at IS NULL
        WHERE platform_identity.platform_code=? AND platform_identity.identity_scope_key=?
          AND platform_identity.external_user_key=? AND platform_identity.identity_status='ACTIVE'
          AND context_row.context_type=? AND context_row.external_context_key=?
          AND selection.active_player_id=?`,
      [normalized.platformCode, normalized.identityScopeKey, input.externalUserId, normalized.contextType, input.externalContextId, selected.legacyPlayerId]
    );
    if (rows.length !== 1) fail(rows.length === 0 ? "PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT" : "PET_SKILL_INFO_ACTOR_CONTEXT_AMBIGUOUS");
    const row = rows[0]!;
    const portalAccountId = row.portal_account_id?.trim() ?? "";
    const membershipId = row.platform_context_membership_id?.trim() ?? "";
    if (!/^[a-z][a-z0-9]{7}$/.test(portalAccountId) || !/^[a-z][a-z0-9]{7}$/.test(membershipId)) fail("PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT");
    return Object.freeze({
      selectionSource: selected.selectionSource,
      platformCode: normalized.providerCode,
      externalContextId: selected.externalContextId,
      externalIdentityId: selected.externalIdentityId,
      selectedLegacyPlayerId: selected.legacyPlayerId,
      selectedCanonicalPlayerId: selected.canonicalPlayerId,
      entitlementLegacyPlayerId: positiveBigInt(row.representative_player_id),
      portalAccountId,
      platformContextMembershipId: membershipId,
      selectionVersion: positiveBigInt(row.selection_version)
    });
  }
}
