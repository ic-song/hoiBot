import type { PlayerContextReadParticipant } from "./player-context-provider.js";

interface CanonicalOwnerRow {
  readonly canonical_player_id: string;
  readonly source_system: string;
  readonly source_identifier: string;
}

interface CrosswalkAuthorityRow {
  readonly canonical_player_id: string;
  readonly canonical_player_identity_crosswalk_id: string;
  readonly crosswalk_status: string;
  readonly legacy_player_id: bigint | number | string | null;
  readonly external_identity_status: string | null;
}

interface LegacyMemberAuthorityRow {
  readonly legacy_player_id: bigint | number | string;
  readonly player_status: string;
  readonly deleted_at: Date | string | null;
  readonly profile_player_id: bigint | number | string | null;
  readonly portal_game_account_link_id: string | null;
  readonly link_status: string | null;
  readonly portal_account_status: string | null;
}

interface ReverseAuthorityRow {
  readonly legacy_player_id: bigint | number | string;
  readonly canonical_player_id: string;
}

export interface ActiveMemberAuthoritySnapshot {
  readonly activeCanonicalPlayerIds: readonly string[];
}

function fail(code: string): never {
  throw new Error(code);
}

function legacySourcePlayerId(row: CanonicalOwnerRow): string | null {
  if (row.source_system !== "LEGACY_DB" || !/^(?:0|[1-9][0-9]{0,19})$/.test(row.source_identifier)) return null;
  const value = BigInt(row.source_identifier);
  return value <= 18_446_744_073_709_551_615n ? value.toString() : fail("ACTIVE_MEMBER_AUTHORITY_DRIFT");
}

// owned PET_TITLE owner만 대상으로 legacy source와 crosswalk를 양방향 대사하고 portal 상태와 무관한 활성 회원 보존 집합을 잠급니다.
export class AccountPlatformActiveMemberAuthorityProvider {
  async lockSnapshot(database: PlayerContextReadParticipant): Promise<ActiveMemberAuthoritySnapshot> {
    const owners = await database.query<CanonicalOwnerRow[]>(
      `SELECT canonical_player.player_id AS canonical_player_id,canonical_player.source_system,canonical_player.source_identifier
         FROM canonical_players canonical_player
        WHERE EXISTS (SELECT 1 FROM canonical_owned_pet_title_instances owned
                       WHERE owned.player_id=canonical_player.player_id AND owned.ownership_status='owned')
        ORDER BY canonical_player.player_id FOR UPDATE`,
    );
    if (owners.length === 0) return Object.freeze({ activeCanonicalPlayerIds: Object.freeze([]) });
    const ownerIds = owners.map((row) => {
      if (!/^[a-z][a-z0-9]{7}$/.test(row.canonical_player_id)) fail("ACTIVE_MEMBER_AUTHORITY_DRIFT");
      return row.canonical_player_id;
    });
    if (new Set(ownerIds).size !== ownerIds.length) fail("ACTIVE_MEMBER_AUTHORITY_DRIFT");
    const placeholders = ownerIds.map(() => "?").join(",");
    const crosswalks = await database.query<CrosswalkAuthorityRow[]>(
      `SELECT crosswalk.player_id AS canonical_player_id,crosswalk.canonical_player_identity_crosswalk_id,
              crosswalk.crosswalk_status,identity_row.player_id AS legacy_player_id,identity_row.status AS external_identity_status
         FROM canonical_player_identity_crosswalks crosswalk
         LEFT JOIN external_identities identity_row
           ON identity_row.provider_code=crosswalk.provider_code AND identity_row.external_user_id=crosswalk.external_user_id
        WHERE crosswalk.player_id IN (${placeholders})
        ORDER BY crosswalk.player_id,crosswalk.canonical_player_identity_crosswalk_id FOR UPDATE`,
      ownerIds,
    );
    const legacyByCanonical = new Map<string, Set<string>>();
    for (const owner of owners) {
      const values = new Set<string>();
      const sourcePlayerId = legacySourcePlayerId(owner);
      if (sourcePlayerId !== null) values.add(sourcePlayerId);
      legacyByCanonical.set(owner.canonical_player_id, values);
    }
    for (const crosswalk of crosswalks) {
      if (!legacyByCanonical.has(crosswalk.canonical_player_id)) fail("ACTIVE_MEMBER_AUTHORITY_DRIFT");
      if (crosswalk.crosswalk_status !== "LINKED") continue;
      if (crosswalk.legacy_player_id === null || crosswalk.external_identity_status !== "linked") fail("ACTIVE_MEMBER_AUTHORITY_CROSSWALK_DRIFT");
      let legacyPlayerId: bigint;
      try { legacyPlayerId = BigInt(crosswalk.legacy_player_id); } catch { return fail("ACTIVE_MEMBER_AUTHORITY_CROSSWALK_DRIFT"); }
      if (legacyPlayerId < 0n) fail("ACTIVE_MEMBER_AUTHORITY_CROSSWALK_DRIFT");
      legacyByCanonical.get(crosswalk.canonical_player_id)!.add(legacyPlayerId.toString());
    }
    const canonicalByLegacy = new Map<string, string>();
    for (const [canonicalPlayerId, legacyPlayerIds] of legacyByCanonical) {
      if (legacyPlayerIds.size === 0) fail("ACTIVE_MEMBER_AUTHORITY_INCOMPLETE");
      if (legacyPlayerIds.size !== 1) fail("ACTIVE_MEMBER_AUTHORITY_AMBIGUOUS");
      const legacyPlayerId = [...legacyPlayerIds][0]!;
      const priorCanonical = canonicalByLegacy.get(legacyPlayerId);
      if (priorCanonical !== undefined && priorCanonical !== canonicalPlayerId) fail("ACTIVE_MEMBER_AUTHORITY_REVERSE_AMBIGUOUS");
      canonicalByLegacy.set(legacyPlayerId, canonicalPlayerId);
    }
    const legacyIds = [...canonicalByLegacy.keys()].sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
    const legacyPlaceholders = legacyIds.map(() => "?").join(",");
    const directReverseRows = await database.query<ReverseAuthorityRow[]>(
      `SELECT CAST(canonical_player.source_identifier AS UNSIGNED) AS legacy_player_id,canonical_player.player_id AS canonical_player_id
         FROM canonical_players canonical_player
        WHERE canonical_player.source_system='LEGACY_DB' AND canonical_player.source_identifier REGEXP '^(0|[1-9][0-9]{0,19})$'
          AND CAST(canonical_player.source_identifier AS UNSIGNED) IN (${legacyPlaceholders})
        ORDER BY canonical_player.source_identifier,canonical_player.player_id FOR UPDATE`,
      legacyIds,
    );
    const crosswalkReverseRows = await database.query<ReverseAuthorityRow[]>(
      `SELECT identity_row.player_id AS legacy_player_id,crosswalk.player_id AS canonical_player_id
         FROM canonical_player_identity_crosswalks crosswalk
         JOIN external_identities identity_row ON identity_row.provider_code=crosswalk.provider_code
          AND identity_row.external_user_id=crosswalk.external_user_id AND identity_row.status='linked'
        WHERE crosswalk.crosswalk_status='LINKED' AND identity_row.player_id IN (${legacyPlaceholders})
        ORDER BY identity_row.player_id,crosswalk.player_id,crosswalk.canonical_player_identity_crosswalk_id FOR UPDATE`,
      legacyIds,
    );
    const reverseRows = [...directReverseRows, ...crosswalkReverseRows];
    const reverseCanonicalByLegacy = new Map<string, Set<string>>();
    for (const row of reverseRows) {
      const key = BigInt(row.legacy_player_id).toString();
      const values = reverseCanonicalByLegacy.get(key) ?? new Set<string>();
      values.add(row.canonical_player_id);
      reverseCanonicalByLegacy.set(key, values);
    }
    for (const [legacyPlayerId, canonicalPlayerId] of canonicalByLegacy) {
      const reverse = reverseCanonicalByLegacy.get(legacyPlayerId) ?? new Set<string>();
      if (reverse.size !== 1 || !reverse.has(canonicalPlayerId)) fail("ACTIVE_MEMBER_AUTHORITY_REVERSE_AMBIGUOUS");
    }
    const members = await database.query<LegacyMemberAuthorityRow[]>(
      `SELECT player.id AS legacy_player_id,player.status AS player_status,player.deleted_at,
              profile.player_id AS profile_player_id,link.portal_game_account_link_id,link.link_status,portal.portal_account_status
         FROM players player
         LEFT JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN portal_game_account_links link ON link.player_id=player.id
         LEFT JOIN canonical_portal_accounts portal ON portal.portal_account_id=link.portal_account_id
        WHERE player.id IN (${legacyPlaceholders})
        ORDER BY player.id,link.portal_game_account_link_id FOR UPDATE`,
      legacyIds,
    );
    const memberRows = new Map<string, LegacyMemberAuthorityRow[]>();
    for (const row of members) {
      const key = BigInt(row.legacy_player_id).toString();
      const current = memberRows.get(key) ?? [];
      current.push(row);
      memberRows.set(key, current);
    }
    const activeCanonicalPlayerIds: string[] = [];
    for (const [legacyPlayerId, canonicalPlayerId] of canonicalByLegacy) {
      const rows = memberRows.get(legacyPlayerId) ?? [];
      if (rows.length === 0) fail("ACTIVE_MEMBER_AUTHORITY_INCOMPLETE");
      if (rows.some((row) => row.profile_player_id === null)) fail("ACTIVE_MEMBER_AUTHORITY_PROFILE_DRIFT");
      const activeLinks = rows.filter((row) => row.link_status === "ACTIVE");
      if (activeLinks.length > 1) fail("ACTIVE_MEMBER_AUTHORITY_PORTAL_AMBIGUOUS");
      if (activeLinks.some((row) => row.portal_account_status !== "ACTIVE" && row.portal_account_status !== "SUSPENDED")) fail("ACTIVE_MEMBER_AUTHORITY_PORTAL_DRIFT");
      const playerActive = rows.every((row) => row.player_status === "active" && row.deleted_at === null);
      if (playerActive) activeCanonicalPlayerIds.push(canonicalPlayerId);
    }
    return Object.freeze({ activeCanonicalPlayerIds: Object.freeze(activeCanonicalPlayerIds.sort()) });
  }
}
