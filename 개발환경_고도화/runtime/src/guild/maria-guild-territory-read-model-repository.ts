import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type {
  GuildTerritoryGuildProjection,
  GuildTerritoryPlayerProjection,
  GuildTerritoryReadModel,
  GuildTerritoryReadModelRepository,
  GuildTerritoryReadRequest,
  GuildTerritoryRememberPreference,
  GuildTerritoryRewardGuide,
  SetGuildTerritoryRememberPreference
} from "./guild-territory-read-model-repository.js";

interface SeasonRow {
  id: bigint;
  season_key: string;
  state_code: "active" | "pending";
  published_snapshot_version: bigint | null;
  starts_at: string | null;
  ends_at: string | null;
}

interface SnapshotRow {
  season_id: bigint;
  snapshot_version: bigint;
  rule_scope_code: string;
  rule_version: bigint;
  captured_at: string;
}

interface GuildRow {
  guild_id: bigint;
  display_name: string | null;
  mark: string | null;
}

interface TurnOrderRow extends GuildRow {
  ordinal: number;
  player_id: bigint | null;
  player_status: string | null;
  player_display_name: string | null;
  rank_label: string | null;
  rank_source_code: string | null;
  rank_projection_version: bigint | null;
  user_eliminated: number;
  guild_eliminated: number;
  exclusion_reason_code: string | null;
  turn_state_code: "active" | "pending" | "completed" | "skipped";
  scheduled_at: string | null;
}

interface RankingRow extends GuildRow {
  ordinal: number;
  server_code: string | null;
  level: number;
  master_player_id: bigint | null;
  master_status: string | null;
  master_display_name: string | null;
  master_rank_label: string | null;
  master_rank_source_code: string | null;
  master_rank_projection_version: bigint | null;
  score: bigint;
  last_scored_at: string;
}

// A nullable joined guild is represented explicitly instead of dropping its projection row.
function projectGuild(row: GuildRow): GuildTerritoryGuildProjection | null {
  return row.display_name === null ? null : { guildId: row.guild_id.toString(), displayName: row.display_name, mark: row.mark };
}

// Turn-order player identity is omitted when the active profile projection is unavailable.
function projectPlayer(row: TurnOrderRow): GuildTerritoryPlayerProjection | null {
  return row.player_id === null || row.player_status !== "active" || row.player_display_name === null
    ? null
    : {
      playerId: row.player_id.toString(),
      displayName: row.player_display_name,
      rankProjection: row.rank_label === null || row.rank_source_code === null || row.rank_projection_version === null
        ? null
        : { label: row.rank_label, sourceCode: row.rank_source_code, version: row.rank_projection_version }
    };
}

// Visibility makes legacy user/guild elimination and missing projections explicit to consumers.
function projectTurnOrder(row: TurnOrderRow) {
  const guild = projectGuild(row);
  const player = projectPlayer(row);
  const userEliminated = Boolean(row.user_eliminated);
  const guildEliminated = Boolean(row.guild_eliminated);
  const projectionIssue = player === null ? "missing-player" : guild === null ? "missing-guild" : null;
  return {
    ordinal: row.ordinal,
    guild,
    player,
    visibility: {
      visible: !userEliminated && !guildEliminated && projectionIssue === null,
      userEliminated,
      guildEliminated,
      exclusionReasonCode: row.exclusion_reason_code,
      projectionIssue
    },
    turnState: row.turn_state_code,
    scheduledAt: row.scheduled_at
  };
}

// Ranking guild details preserve the authoritative guild leader and optional complete rank projection.
function projectRankingGuild(row: RankingRow) {
  const guild = projectGuild(row);
  if (guild === null) return null;
  const master = row.master_player_id === null || row.master_status !== "active" || row.master_display_name === null
    ? null
    : {
      playerId: row.master_player_id.toString(),
      displayName: row.master_display_name,
      rankProjection: row.master_rank_label === null || row.master_rank_source_code === null || row.master_rank_projection_version === null
        ? null
        : { label: row.master_rank_label, sourceCode: row.master_rank_source_code, version: row.master_rank_projection_version }
    };
  return { ...guild, serverCode: row.server_code, level: row.level, master };
}

// MariaDB JSON columns may arrive as text or as a decoded value depending on the driver configuration.
function parseJson(value: string | unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

// Guild territory read-model contracts are loaded in one database transaction; payout mutation is intentionally absent.
export class MariaGuildTerritoryReadModelRepository implements GuildTerritoryReadModelRepository {
  constructor(private readonly database: DatabaseClient) {}

  async readConsistent(request: GuildTerritoryReadRequest): Promise<GuildTerritoryReadModel> {
    return this.database.withTransaction(async (transaction) => {
      const season = await this.readSeason(transaction, request);
      const rememberPreference = await this.readRememberPreference(transaction, request);
      if (season === null) {
        const rewardGuide = request.rulePin === undefined ? null : await this.readRewardGuide(transaction, request.rulePin.territoryScope, request.rulePin.ruleVersion);
        return {
          season: { state: "no-war", season: null }, pin: null, turnOrder: [], rankingSnapshot: null,
          rewardGuide, rememberPreference
        };
      }

      const snapshotVersion = request.seasonPin?.snapshotVersion ?? season.published_snapshot_version;
      const seasonProjection = {
        state: season.state_code,
        season: {
          seasonId: season.id.toString(), seasonKey: season.season_key, snapshotVersion,
          startsAt: season.starts_at, endsAt: season.ends_at
        }
      } as const;
      if (snapshotVersion === null) {
        const rewardGuide = request.rulePin === undefined ? null : await this.readRewardGuide(transaction, request.rulePin.territoryScope, request.rulePin.ruleVersion);
        return { season: seasonProjection, pin: null, turnOrder: [], rankingSnapshot: null, rewardGuide, rememberPreference };
      }

      const pin = { seasonId: season.id.toString(), snapshotVersion };
      const snapshot = await this.readSnapshot(transaction, pin.seasonId, pin.snapshotVersion);
      if (snapshot === null) {
        const rewardGuide = request.rulePin === undefined ? null : await this.readRewardGuide(transaction, request.rulePin.territoryScope, request.rulePin.ruleVersion);
        return { season: seasonProjection, pin, turnOrder: [], rankingSnapshot: null, rewardGuide, rememberPreference };
      }

      const [turnOrder, entries] = await Promise.all([
        this.readTurnOrder(transaction, pin.seasonId, pin.snapshotVersion),
        this.readRanking(transaction, pin.seasonId, pin.snapshotVersion)
      ]);
      const ruleScope = request.rulePin?.territoryScope ?? snapshot.rule_scope_code;
      const ruleVersion = request.rulePin?.ruleVersion ?? snapshot.rule_version;
      const rewardGuide = await this.readRewardGuide(transaction, ruleScope, ruleVersion);
      return {
        season: seasonProjection,
        pin,
        turnOrder,
        rankingSnapshot: {
          pin,
          rulePin: { territoryScope: snapshot.rule_scope_code, ruleVersion: snapshot.rule_version },
          capturedAt: snapshot.captured_at,
          entries
        },
        rewardGuide,
        rememberPreference
      };
    });
  }

  async setRememberPreference(command: SetGuildTerritoryRememberPreference): Promise<GuildTerritoryRememberPreference> {
    return this.database.withTransaction(async (transaction) => {
      await transaction.execute(
        `INSERT INTO guild_territory_remember_preferences
          (territory_scope_code, operator_player_id, player_id, desired_state, version, updated_at)
         VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE desired_state = VALUES(desired_state), version = version + 1, updated_at = UTC_TIMESTAMP(3)`,
        [command.territoryScope, command.operatorPlayerId, command.playerId, command.desiredState]
      );
      const preference = await this.queryRememberPreference(transaction, command.territoryScope, command.operatorPlayerId, command.playerId);
      if (preference === null) throw new Error("Guild territory remember preference was not persisted.");
      return preference;
    });
  }

  private async readSeason(transaction: DatabaseTransaction, request: GuildTerritoryReadRequest): Promise<SeasonRow | null> {
    const rows = request.seasonPin === undefined
      ? await transaction.query<SeasonRow[]>(
        `SELECT id, season_key, state_code, published_snapshot_version, starts_at, ends_at
         FROM guild_territory_seasons
         WHERE territory_scope_code = ? AND state_code IN ('active', 'pending')
         ORDER BY FIELD(state_code, 'active', 'pending'), starts_at, id LIMIT 1`, [request.territoryScope])
      : await transaction.query<SeasonRow[]>(
        `SELECT id, season_key, state_code, published_snapshot_version, starts_at, ends_at
         FROM guild_territory_seasons WHERE id = ? AND territory_scope_code = ? LIMIT 1`,
        [request.seasonPin.seasonId, request.territoryScope]);
    return rows[0] ?? null;
  }

  private async readSnapshot(transaction: DatabaseTransaction, seasonId: string, snapshotVersion: bigint): Promise<SnapshotRow | null> {
    const rows = await transaction.query<SnapshotRow[]>(
      `SELECT season_id, snapshot_version, rule_scope_code, rule_version, captured_at
       FROM guild_territory_ranking_snapshots WHERE season_id = ? AND snapshot_version = ?`, [seasonId, snapshotVersion]);
    return rows[0] ?? null;
  }

  private async readTurnOrder(transaction: DatabaseTransaction, seasonId: string, snapshotVersion: bigint) {
    const rows = await transaction.query<TurnOrderRow[]>(
      `SELECT entry.ordinal, entry.guild_id, guild.display_name, guild.mark,
        entry.player_id, player.status AS player_status, profile.current_display_name AS player_display_name,
        rank_projection.rank_label, rank_projection.source_code AS rank_source_code,
        rank_projection.version AS rank_projection_version,
        entry.user_eliminated, entry.guild_eliminated, entry.exclusion_reason_code,
        entry.turn_state_code, entry.scheduled_at
       FROM guild_territory_turn_order_entries entry
       LEFT JOIN guilds guild ON guild.id = entry.guild_id AND guild.status = 'active'
       LEFT JOIN players player ON player.id = entry.player_id AND player.status = 'active'
       LEFT JOIN player_profiles profile ON profile.player_id = player.id
       LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = player.id
       WHERE entry.season_id = ? AND entry.snapshot_version = ?
       ORDER BY entry.ordinal ASC, entry.guild_id ASC`, [seasonId, snapshotVersion]);
    return rows.map(projectTurnOrder);
  }

  private async readRanking(transaction: DatabaseTransaction, seasonId: string, snapshotVersion: bigint) {
    const rows = await transaction.query<RankingRow[]>(
      `SELECT entry.ordinal, entry.guild_id, guild.display_name, guild.mark, guild.server_code, guild.level,
        master_player.id AS master_player_id, master_player.status AS master_status,
        master_profile.current_display_name AS master_display_name,
        master_rank.rank_label AS master_rank_label, master_rank.source_code AS master_rank_source_code,
        master_rank.version AS master_rank_projection_version,
        entry.score, entry.last_scored_at
       FROM guild_territory_ranking_entries entry
       LEFT JOIN guilds guild ON guild.id = entry.guild_id AND guild.status = 'active'
       LEFT JOIN guild_members master_member ON master_member.guild_id = guild.id AND master_member.role_code = 'leader'
       LEFT JOIN players master_player ON master_player.id = master_member.player_id AND master_player.status = 'active'
       LEFT JOIN player_profiles master_profile ON master_profile.player_id = master_player.id
       LEFT JOIN player_rank_projections master_rank ON master_rank.player_id = master_player.id
       WHERE entry.season_id = ? AND entry.snapshot_version = ?
       ORDER BY entry.score DESC, guild.level DESC,
         guild.display_name COLLATE utf8mb4_unicode_ci ASC, entry.guild_id ASC`, [seasonId, snapshotVersion]);
    return rows.map((row) => ({ ordinal: row.ordinal, guild: projectRankingGuild(row), score: row.score, lastScoredAt: row.last_scored_at }));
  }

  private async readRewardGuide(transaction: DatabaseTransaction, scope: string, version: bigint): Promise<GuildTerritoryRewardGuide | null> {
    const versions = await transaction.query<Array<{ effective_from: string | null }>>(
      `SELECT effective_from FROM guild_territory_reward_rule_versions
       WHERE territory_scope_code = ? AND rule_version = ? AND status IN ('published', 'retired')`, [scope, version]);
    if (versions[0] === undefined) return null;
    const tiers = await transaction.query<Array<{ rank_from: number; rank_to: number; reward_json: string | unknown; guide_text: string }>>(
      `SELECT rank_from, rank_to, reward_json, guide_text FROM guild_territory_reward_rule_tiers
       WHERE territory_scope_code = ? AND rule_version = ? ORDER BY rank_from ASC`, [scope, version]);
    return {
      pin: { territoryScope: scope, ruleVersion: version }, effectiveFrom: versions[0].effective_from,
      tiers: tiers.map((row) => ({ rankFrom: row.rank_from, rankTo: row.rank_to, reward: parseJson(row.reward_json), guideText: row.guide_text }))
    };
  }

  private async readRememberPreference(transaction: DatabaseTransaction, request: GuildTerritoryReadRequest): Promise<GuildTerritoryRememberPreference | null> {
    return request.remember === undefined ? null : this.queryRememberPreference(
      transaction, request.territoryScope, request.remember.operatorPlayerId, request.remember.playerId
    );
  }

  private async queryRememberPreference(transaction: DatabaseTransaction, scope: string, operatorPlayerId: string, playerId: string): Promise<GuildTerritoryRememberPreference | null> {
    const rows = await transaction.query<Array<{ desired_state: number; version: bigint }>>(
      `SELECT desired_state, version FROM guild_territory_remember_preferences
       WHERE territory_scope_code = ? AND operator_player_id = ? AND player_id = ?`, [scope, operatorPlayerId, playerId]);
    return rows[0] === undefined ? null : {
      territoryScope: scope, operatorPlayerId, playerId, desiredState: Boolean(rows[0].desired_state), version: rows[0].version
    };
  }
}
