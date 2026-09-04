export interface PlayerContextReadParticipant {
  query<T>(sql: string, values?: readonly unknown[]): Promise<T>;
}

export interface PlayerContext {
  readonly canonicalPlayerId: string;
  readonly legacyPlayerId: string;
  readonly externalIdentityId: string;
  readonly displayName: string;
  readonly rankEmoji: string | null;
  readonly platformCode: string;
  readonly externalContextId: string;
  readonly selectionSource: "LEGACY_CROSSWALK" | "ACTIVE_CONTEXT";
}

export interface PlayerTarget {
  readonly canonicalPlayerId: string;
  readonly legacyPlayerId: string;
  readonly displayName: string;
  readonly rankEmoji: string | null;
}

export interface PlayerContextPort {
  resolveSelf(database: PlayerContextReadParticipant, input: {
    identityProviderCode: string;
    externalUserId: string;
    externalContextId: string;
  }): Promise<PlayerContext>;
  resolveUniqueLegacyDisplayTarget(database: PlayerContextReadParticipant, input: { targetKey: string }): Promise<PlayerTarget>;
}

interface PlayerContextRow {
  legacy_player_id: bigint | number | string | null;
  canonical_player_id: string | null;
  external_identity_id: bigint | number | string | null;
  display_name: string | null;
  rank_emoji: string | null;
  provider_code: string | null;
}

function fail(code: string): never {
  throw new Error(code);
}

// provider와 context 입력을 저장 계약의 플랫폼·범위 값으로 변환합니다.
function normalizeSelfLocator(input: { identityProviderCode: string; externalUserId: string; externalContextId: string }): {
  providerCode: string;
  platformCode: "KAKAO" | "DISCORD";
  contextType: "ROOM" | "SERVER";
  identityScopeKey: string;
} {
  const providerCode = input.identityProviderCode.toLowerCase();
  if (input.externalUserId.length === 0 || input.externalUserId.length > 191
    || input.externalContextId.length === 0 || input.externalContextId.length > 191) {
    fail("PLAYER_CONTEXT_LOCATOR_INVALID");
  }
  if (providerCode === "kakao") {
    return { providerCode, platformCode: "KAKAO", contextType: "ROOM", identityScopeKey: input.externalContextId };
  }
  if (providerCode === "discord") {
    return { providerCode, platformCode: "DISCORD", contextType: "SERVER", identityScopeKey: "PLATFORM_ACCOUNT" };
  }
  return fail("PLAYER_CONTEXT_PROVIDER_UNSUPPORTED");
}

// 중복 identity 행은 player 쌍으로 접고 누락·복수 canonical 매핑은 차단합니다.
function collapsePlayerContext(
  rows: readonly PlayerContextRow[],
  input: { selectionSource: PlayerContext["selectionSource"]; platformCode?: string; externalContextId: string }
): PlayerContext {
  if (rows.length === 0) fail("PLAYER_CONTEXT_MAPPING_REQUIRED");
  const pairs = new Map<string, { row: PlayerContextRow; identityId: bigint }>();
  for (const row of rows) {
    if (row.legacy_player_id === null || row.external_identity_id === null || row.canonical_player_id === null
      || row.display_name === null || row.provider_code === null || !/^[a-z][a-z0-9]{7}$/.test(row.canonical_player_id)) {
      fail("PLAYER_CONTEXT_MAPPING_DRIFT");
    }
    let legacyPlayerId: bigint;
    let externalIdentityId: bigint;
    try {
      legacyPlayerId = BigInt(row.legacy_player_id);
      externalIdentityId = BigInt(row.external_identity_id);
    } catch {
      return fail("PLAYER_CONTEXT_MAPPING_DRIFT");
    }
    if (legacyPlayerId < 0n || externalIdentityId < 0n) fail("PLAYER_CONTEXT_MAPPING_DRIFT");
    const pairKey = `${legacyPlayerId.toString()}:${row.canonical_player_id}`;
    const current = pairs.get(pairKey);
    if (current === undefined || externalIdentityId < current.identityId) pairs.set(pairKey, { row, identityId: externalIdentityId });
  }
  if (pairs.size !== 1) fail("PLAYER_CONTEXT_MAPPING_AMBIGUOUS");
  const selected = [...pairs.values()][0]!;
  return Object.freeze({
    canonicalPlayerId: selected.row.canonical_player_id!,
    legacyPlayerId: BigInt(selected.row.legacy_player_id!).toString(),
    externalIdentityId: selected.identityId.toString(),
    displayName: selected.row.display_name!,
    rankEmoji: selected.row.rank_emoji,
    platformCode: input.platformCode ?? selected.row.provider_code!,
    externalContextId: input.externalContextId,
    selectionSource: input.selectionSource
  });
}

// 대상 조회는 identity·context를 임의 대표값으로 고르지 않고 유일한 player 쌍만 반환합니다.
function collapsePlayerTarget(rows: readonly PlayerContextRow[]): PlayerTarget {
  if (rows.length === 0) fail("PLAYER_CONTEXT_MAPPING_REQUIRED");
  const pairs = new Map<string, PlayerContextRow>();
  for (const row of rows) {
    if (row.legacy_player_id === null || row.canonical_player_id === null || row.display_name === null
      || !/^[a-z][a-z0-9]{7}$/.test(row.canonical_player_id)) fail("PLAYER_CONTEXT_MAPPING_DRIFT");
    let legacyPlayerId: bigint;
    try {
      legacyPlayerId = BigInt(row.legacy_player_id);
    } catch {
      return fail("PLAYER_CONTEXT_MAPPING_DRIFT");
    }
    if (legacyPlayerId < 0n) fail("PLAYER_CONTEXT_MAPPING_DRIFT");
    pairs.set(`${legacyPlayerId.toString()}:${row.canonical_player_id}`, row);
  }
  if (pairs.size !== 1) fail("PLAYER_CONTEXT_MAPPING_AMBIGUOUS");
  const selected = [...pairs.values()][0]!;
  return Object.freeze({
    canonicalPlayerId: selected.canonical_player_id!,
    legacyPlayerId: BigInt(selected.legacy_player_id!).toString(),
    displayName: selected.display_name!,
    rankEmoji: selected.rank_emoji
  });
}

// 방·서버의 활성 player를 우선하고 미선택 상태에서만 기존 identity crosswalk로 해석합니다.
export class MariaPlayerContextProvider implements PlayerContextPort {
  async resolveSelf(database: PlayerContextReadParticipant, input: {
    identityProviderCode: string;
    externalUserId: string;
    externalContextId: string;
  }): Promise<PlayerContext> {
    const locator = normalizeSelfLocator(input);
    const activeRows = await database.query<PlayerContextRow[]>(
      `SELECT selection.active_player_id AS legacy_player_id,canonical_player.player_id AS canonical_player_id,
              caller_identity.id AS external_identity_id,profile.current_display_name AS display_name,
              rank_profile.rank_emoji,caller_identity.provider_code
         FROM account_platform_identities platform_identity
         JOIN account_platform_context_memberships membership
           ON membership.platform_identity_id=platform_identity.platform_identity_id AND membership.membership_status='ACTIVE'
         JOIN account_platform_contexts context_row
           ON context_row.platform_context_id=membership.platform_context_id AND context_row.context_status='ACTIVE'
         JOIN account_platform_active_player_selections selection
           ON selection.platform_context_membership_id=membership.platform_context_membership_id AND selection.selection_status='ACTIVE'
         JOIN portal_game_account_links account_link
           ON account_link.portal_game_account_link_id=selection.portal_game_account_link_id
          AND account_link.portal_account_id=platform_identity.portal_account_id
          AND account_link.player_id=selection.active_player_id AND account_link.link_status='ACTIVE'
         JOIN players player ON player.id=selection.active_player_id AND player.status='active' AND player.deleted_at IS NULL
         JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
         JOIN external_identities caller_identity
           ON caller_identity.provider_code=? AND caller_identity.external_user_id=? AND caller_identity.status='linked'
         JOIN portal_game_account_links caller_link
           ON caller_link.portal_account_id=platform_identity.portal_account_id
          AND caller_link.player_id=caller_identity.player_id AND caller_link.link_status='ACTIVE'
         LEFT JOIN external_identities selected_identity
           ON selected_identity.player_id=player.id AND selected_identity.status='linked'
         LEFT JOIN canonical_player_identity_crosswalks crosswalk
           ON crosswalk.provider_code=selected_identity.provider_code
          AND crosswalk.external_user_id=selected_identity.external_user_id AND crosswalk.crosswalk_status='LINKED'
         LEFT JOIN canonical_players canonical_player ON canonical_player.player_id=crosswalk.player_id
        WHERE platform_identity.platform_code=? AND platform_identity.identity_scope_key=?
          AND platform_identity.external_user_key=? AND platform_identity.identity_status='ACTIVE'
          AND context_row.context_type=? AND context_row.external_context_key=?`,
      [locator.providerCode, input.externalUserId, locator.platformCode, locator.identityScopeKey,
        input.externalUserId, locator.contextType, input.externalContextId]
    );
    if (activeRows.length > 0) {
      return collapsePlayerContext(activeRows, {
        selectionSource: "ACTIVE_CONTEXT",
        platformCode: locator.providerCode,
        externalContextId: input.externalContextId
      });
    }

    const legacyRows = await database.query<PlayerContextRow[]>(
      `SELECT identity_row.player_id AS legacy_player_id,canonical_player.player_id AS canonical_player_id,
              identity_row.id AS external_identity_id,profile.current_display_name AS display_name,
              rank_profile.rank_emoji,identity_row.provider_code
         FROM external_identities identity_row
         LEFT JOIN canonical_player_identity_crosswalks crosswalk
           ON crosswalk.provider_code=identity_row.provider_code
          AND crosswalk.external_user_id=identity_row.external_user_id AND crosswalk.crosswalk_status='LINKED'
         LEFT JOIN canonical_players canonical_player ON canonical_player.player_id=crosswalk.player_id
         LEFT JOIN players player ON player.id=identity_row.player_id AND player.status='active' AND player.deleted_at IS NULL
         LEFT JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
        WHERE identity_row.provider_code=? AND identity_row.external_user_id=? AND identity_row.status='linked'`,
      [locator.providerCode, input.externalUserId]
    );
    return collapsePlayerContext(legacyRows, {
      selectionSource: "LEGACY_CROSSWALK",
      platformCode: locator.providerCode,
      externalContextId: input.externalContextId
    });
  }

  // JavaScript에서 이미 slice(0,4)된 레거시 key를 SQL 변형 없이 정확히 조회합니다.
  async resolveUniqueLegacyDisplayTarget(database: PlayerContextReadParticipant, input: { targetKey: string }): Promise<PlayerTarget> {
    if (input.targetKey.length === 0 || input.targetKey.length > 191) fail("PLAYER_CONTEXT_TARGET_INVALID");
    const rows = await database.query<PlayerContextRow[]>(
      `SELECT player.id AS legacy_player_id,canonical_player.player_id AS canonical_player_id,
              identity_row.id AS external_identity_id,profile.current_display_name AS display_name,
              rank_profile.rank_emoji,identity_row.provider_code
         FROM player_profiles profile
         JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
         LEFT JOIN external_identities identity_row ON identity_row.player_id=player.id AND identity_row.status='linked'
         LEFT JOIN canonical_player_identity_crosswalks crosswalk
           ON crosswalk.provider_code=identity_row.provider_code
          AND crosswalk.external_user_id=identity_row.external_user_id AND crosswalk.crosswalk_status='LINKED'
         LEFT JOIN canonical_players canonical_player ON canonical_player.player_id=crosswalk.player_id
        WHERE BINARY profile.current_display_name=BINARY ?`,
      [input.targetKey]
    );
    return collapsePlayerTarget(rows);
  }
}
