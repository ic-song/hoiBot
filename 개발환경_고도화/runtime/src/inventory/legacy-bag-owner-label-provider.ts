import type { PlayerContext } from "../account-platform/player-context-provider.js";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";

const MARKERS = [
  ["CASTLE_LORD", "🏰"], ["STAR", "💞"], ["CARROT", "🥕"], ["THERMO", "🌡"],
  ["MINI_PET", "✨"], ["TOP_LEVEL", "🌟"], ["MC", "💬"], ["INTIMACY", "🍼"],
] as const;
export const LEGACY_GUILD_RANK_SYMBOLS = ["☬", "♔", "♛", "♕", "⚝", "❁", "⌺", "⍌", "⍫", "⚔︎", "⚚", "✥", "❖", "◈", "◉", "◍", "◌", "△", "◇", "◻︎"] as const;

interface MarkerRow { marker_kind: string; marker_priority: number; assignment_status: string; player_id: string | null; legacy_player_id: bigint | number | string | null; source_fingerprint: string; revision: bigint | number | string; }
interface MembershipRow { player_id: bigint | number | string; guild_id: bigint | number | string; ordinal_value: number | null; snapshot_id: bigint | number | string | null; current_snapshot_id: bigint | number | string | null; }

function validProjection(row: MarkerRow, index: number): boolean {
  const assigned = row.assignment_status === "ASSIGNED" && row.player_id !== null && row.legacy_player_id !== null;
  const unassigned = row.assignment_status === "UNASSIGNED" && row.player_id === null && row.legacy_player_id === null;
  return row.marker_kind === MARKERS[index]?.[0] && Number(row.marker_priority) === index + 1
    && /^(?:[0-9a-f]{64})$/.test(row.source_fingerprint) && BigInt(row.revision) >= 1n && (assigned || unassigned);
}

// main.js checkRank의 marker 우선순위와 guild suffix를 검증된 기존 projection에서 재현합니다.
export class LegacyBagOwnerLabelProvider {
  async resolve(database: AppWiringReadParticipant, context: PlayerContext): Promise<string | null> {
    if (context.rankEmoji === null) return null;
    const markers = await database.query<MarkerRow[]>(
      `SELECT marker.marker_kind,marker.marker_priority,marker.assignment_status,marker.player_id,
              CASE WHEN canonical_player.source_system='LEGACY_DB' AND canonical_player.source_identifier REGEXP '^(0|[1-9][0-9]{0,19})$'
                   THEN CAST(canonical_player.source_identifier AS UNSIGNED) ELSE NULL END legacy_player_id,
              marker.source_fingerprint,marker.revision
         FROM player_pet_skill_rank_marker_projections marker
         LEFT JOIN canonical_players canonical_player ON canonical_player.player_id=marker.player_id
        WHERE marker.active_flag=TRUE
        ORDER BY marker.marker_priority,marker.player_pet_skill_rank_marker_projection_id`,
    );
    if (markers.length !== MARKERS.length || markers.some((row, index) => !validProjection(row, index))) return null;
    const lordLegacyId = markers[0]!.legacy_player_id;
    const memberships = await database.query<MembershipRow[]>(
      `SELECT member.player_id,member.guild_id,rank_projection.ordinal_value,rank_projection.snapshot_id,
              current_rank.snapshot_id AS current_snapshot_id
         FROM guild_members member
         JOIN guilds guild ON guild.id=member.guild_id AND guild.status='active'
         LEFT JOIN guild_rank_snapshot_current current_rank ON current_rank.policy_key='default'
         LEFT JOIN guild_rank_current_projections rank_projection ON rank_projection.guild_id=member.guild_id
        WHERE member.player_id IN (?,?) ORDER BY member.player_id`,
      [context.legacyPlayerId, lordLegacyId ?? context.legacyPlayerId],
    );
    const own = memberships.filter((row) => String(row.player_id) === context.legacyPlayerId);
    const lord = lordLegacyId === null ? [] : memberships.filter((row) => String(row.player_id) === String(lordLegacyId));
    if (own.length > 1 || lord.length !== (markers[0]!.assignment_status === "ASSIGNED" ? 1 : 0)) return null;
    let prefix = context.rankEmoji;
    if (own.length === 1 && lord.length === 1 && String(own[0]!.guild_id) === String(lord[0]!.guild_id)) prefix = "🏰";
    else {
      const direct = markers.slice(1).find((row) => row.player_id === context.canonicalPlayerId);
      if (direct !== undefined) prefix = MARKERS[Number(direct.marker_priority) - 1]![1];
    }
    let suffix = "";
    if (own.length === 1) {
      const membership = own[0]!;
      const ordinal = membership.ordinal_value;
      if (ordinal === null || ordinal < 1 || ordinal > 20 || membership.snapshot_id === null
        || membership.current_snapshot_id === null || String(membership.snapshot_id) !== String(membership.current_snapshot_id)) return null;
      suffix = `_${LEGACY_GUILD_RANK_SYMBOLS[ordinal - 1]}`;
    }
    return `${prefix}${context.displayName}${suffix}`;
  }
}
