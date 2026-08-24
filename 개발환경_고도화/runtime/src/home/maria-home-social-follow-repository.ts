import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type {
  HomeSocialFollowCommandCode,
  HomeSocialFollowCompletion,
  HomeSocialFollowListRow,
  HomeSocialFollowPlayer,
  HomeSocialFollowRepository,
  HomeSocialFollowResult,
  HomeSocialFollowTransaction,
  HomeSocialTargetMatch
} from "./home-social-follow.js";

interface PlayerRow {
  player_id: bigint;
  display_name: string;
  rank_label: string;
  active_pass: bigint | number;
  premium_pass: bigint | number;
}

interface BadgeDefinitionRow {
  badge_code: string;
  display_name: string;
  criteria_json: string | { stat?: unknown; threshold?: unknown; requiredBadgeIds?: unknown };
}

const PLAYER_LABEL = "COALESCE(rank_projection.rank_label, profile.current_display_name)";

// 긴 이벤트 ID를 operation idempotency key 제한 안에서 충돌 없이 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 서비스 결과로 복원합니다.
function parseResult(value: string | HomeSocialFollowResult): HomeSocialFollowResult {
  return typeof value === "string" ? JSON.parse(value) as HomeSocialFollowResult : value;
}

// DB 행을 팔로우 서비스의 회원 snapshot으로 변환합니다.
function player(row: PlayerRow): HomeSocialFollowPlayer {
  return {
    playerId: row.player_id.toString(), displayName: row.display_name, rankLabel: row.rank_label,
    activePass: BigInt(row.active_pass) > 0n, premiumPass: BigInt(row.premium_pass) > 0n
  };
}

// criteria JSON의 단일 follower/mutual 임계값을 안전하게 읽습니다.
function criteria(value: BadgeDefinitionRow["criteria_json"]): { stat: "followers" | "mutual"; threshold: bigint; requiredBadgeIds: string[] } | null {
  const parsed = typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
  if (parsed.stat !== "followers" && parsed.stat !== "mutual") return null;
  const threshold = BigInt(String(parsed.threshold ?? "0"));
  if (threshold < 1n) return null;
  const requiredBadgeIds = Array.isArray(parsed.requiredBadgeIds)
    ? parsed.requiredBadgeIds.filter((item): item is string => typeof item === "string") : [];
  return { stat: parsed.stat, threshold, requiredBadgeIds };
}

// 팔로우 관계·알림·뱃지·명령 원장을 MariaDB 단일 transaction으로 구현합니다.
export class MariaHomeSocialFollowRepository implements HomeSocialFollowRepository {
  constructor(private readonly database: DatabaseClient) {}

  async runInTransaction<T>(work: (transaction: HomeSocialFollowTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async (transaction) => work(this.bind(transaction)));
  }

  private bind(transaction: DatabaseTransaction): HomeSocialFollowTransaction {
    return {
      resolveActor: async (providerCode, externalUserId) => this.resolveActor(transaction, providerCode, externalUserId),
      findTargetAtStart: async (content) => this.findTargetAtStart(transaction, content),
      lockPlayersOrdered: async (playerIds) => this.readPlayers(transaction, playerIds, true),
      readPriorResult: async (eventId, commandCode, actorPlayerId) => this.readPriorResult(transaction, eventId, commandCode, actorPlayerId),
      startCommand: async (eventId, commandCode, actorPlayerId) => this.startCommand(transaction, eventId, commandCode, actorPlayerId),
      isFollowing: async (followerPlayerId, followedPlayerId) => this.isFollowing(transaction, followerPlayerId, followedPlayerId),
      setFollowing: async (followerPlayerId, followedPlayerId, active) => this.setFollowing(transaction, followerPlayerId, followedPlayerId, active),
      addAlert: async (operationId, targetPlayerId, actorPlayerId, type, mutual) => this.addAlert(transaction, operationId, targetPlayerId, actorPlayerId, type, mutual),
      awardEligibleBadges: async (operationId, playerId) => this.awardEligibleBadges(transaction, operationId, playerId),
      recordActivity: async (operationId, homePlayerId, actorPlayerId, activityCode, detail) => {
        await transaction.execute(
          "INSERT INTO home_activity_events (operation_id, home_player_id, actor_player_id, activity_code, detail_json) VALUES (?, ?, ?, ?, ?)",
          [operationId, homePlayerId, actorPlayerId, activityCode, JSON.stringify(detail)]
        );
      },
      countFollowing: async (playerId) => this.countFollowing(transaction, playerId),
      readList: async (playerId, type) => this.readList(transaction, playerId, type),
      completeCommand: async (operationId, completion, result) => this.complete(transaction, operationId, completion, result)
    };
  }

  private async resolveActor(transaction: DatabaseTransaction, providerCode: string, externalUserId: string): Promise<HomeSocialFollowPlayer | null> {
    const rows = await transaction.query<PlayerRow[]>(
      `SELECT player.id AS player_id, profile.current_display_name AS display_name, ${PLAYER_LABEL} AS rank_label,
        EXISTS(SELECT 1 FROM player_passes pass WHERE pass.player_id = player.id AND pass.enabled = TRUE
          AND pass.pass_code IN ('support', 'beginner', 'premium')
          AND (pass.starts_at IS NULL OR pass.starts_at <= UTC_TIMESTAMP(3))
          AND (pass.permanent = TRUE OR pass.ends_at IS NULL OR pass.ends_at >= UTC_TIMESTAMP(3))) AS active_pass,
        EXISTS(SELECT 1 FROM player_passes pass WHERE pass.player_id = player.id AND pass.enabled = TRUE
          AND pass.pass_code = 'premium' AND (pass.starts_at IS NULL OR pass.starts_at <= UTC_TIMESTAMP(3))
          AND (pass.permanent = TRUE OR pass.ends_at IS NULL OR pass.ends_at >= UTC_TIMESTAMP(3))) AS premium_pass
       FROM external_identities identity_row
       JOIN players player ON player.id = identity_row.player_id AND player.status = 'active'
       JOIN player_profiles profile ON profile.player_id = player.id
       LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = player.id
       WHERE identity_row.provider_code = ? AND identity_row.external_user_id = ?
         AND identity_row.status = 'linked' LIMIT 1`, [providerCode, externalUserId]
    );
    return rows[0] === undefined ? null : player(rows[0]);
  }

  private async findTargetAtStart(transaction: DatabaseTransaction, content: string): Promise<HomeSocialTargetMatch | null> {
    const rows = await transaction.query<PlayerRow[]>(
      `SELECT player.id AS player_id, profile.current_display_name AS display_name, ${PLAYER_LABEL} AS rank_label,
        EXISTS(SELECT 1 FROM player_passes pass WHERE pass.player_id = player.id AND pass.enabled = TRUE
          AND pass.pass_code IN ('support', 'beginner', 'premium')
          AND (pass.starts_at IS NULL OR pass.starts_at <= UTC_TIMESTAMP(3))
          AND (pass.permanent = TRUE OR pass.ends_at IS NULL OR pass.ends_at >= UTC_TIMESTAMP(3))) AS active_pass,
        EXISTS(SELECT 1 FROM player_passes pass WHERE pass.player_id = player.id AND pass.enabled = TRUE
          AND pass.pass_code = 'premium' AND (pass.starts_at IS NULL OR pass.starts_at <= UTC_TIMESTAMP(3))
          AND (pass.permanent = TRUE OR pass.ends_at IS NULL OR pass.ends_at >= UTC_TIMESTAMP(3))) AS premium_pass
       FROM players player
       JOIN player_profiles profile ON profile.player_id = player.id
       LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = player.id
       WHERE player.status = 'active' AND (? = profile.current_display_name OR ? LIKE CONCAT(profile.current_display_name, ' %'))
       ORDER BY CHAR_LENGTH(profile.current_display_name) DESC, player.id LIMIT 1`, [content, content]
    );
    const row = rows[0];
    return row === undefined ? null : { ...player(row), rest: content.slice(row.display_name.length).trim() };
  }

  private async readPlayers(transaction: DatabaseTransaction, playerIds: string[], lock: boolean): Promise<HomeSocialFollowPlayer[]> {
    const ids = [...new Set(playerIds)].sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await transaction.query<PlayerRow[]>(
      `SELECT player.id AS player_id, profile.current_display_name AS display_name, ${PLAYER_LABEL} AS rank_label,
        EXISTS(SELECT 1 FROM player_passes pass WHERE pass.player_id = player.id AND pass.enabled = TRUE
          AND pass.pass_code IN ('support', 'beginner', 'premium')
          AND (pass.starts_at IS NULL OR pass.starts_at <= UTC_TIMESTAMP(3))
          AND (pass.permanent = TRUE OR pass.ends_at IS NULL OR pass.ends_at >= UTC_TIMESTAMP(3))) AS active_pass,
        EXISTS(SELECT 1 FROM player_passes pass WHERE pass.player_id = player.id AND pass.enabled = TRUE
          AND pass.pass_code = 'premium' AND (pass.starts_at IS NULL OR pass.starts_at <= UTC_TIMESTAMP(3))
          AND (pass.permanent = TRUE OR pass.ends_at IS NULL OR pass.ends_at >= UTC_TIMESTAMP(3))) AS premium_pass
       FROM players player JOIN player_profiles profile ON profile.player_id = player.id
       LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = player.id
       WHERE player.status = 'active' AND player.id IN (${placeholders}) ORDER BY player.id ${lock ? "FOR UPDATE" : ""}`, ids
    );
    return rows.map(player);
  }

  private async readPriorResult(transaction: DatabaseTransaction, eventId: string, commandCode: HomeSocialFollowCommandCode, actorPlayerId: string): Promise<HomeSocialFollowResult | null> {
    const rows = await transaction.query<Array<{ result_json: string | HomeSocialFollowResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
      [`home.social:${commandCode}:${actorPlayerId}`, normalizeEventKey(eventId)]
    );
    return rows[0]?.result_json == null ? null : parseResult(rows[0].result_json);
  }

  private async startCommand(transaction: DatabaseTransaction, eventId: string, commandCode: HomeSocialFollowCommandCode, actorPlayerId: string): Promise<string> {
    const result = await transaction.execute(
      `INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
       VALUES (?, ?, ?, 'player', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
      [randomUUID(), `home.social:${commandCode}:${actorPlayerId}`, normalizeEventKey(eventId), actorPlayerId]
    );
    return result.insertId.toString();
  }

  private async isFollowing(transaction: DatabaseTransaction, followerPlayerId: string, followedPlayerId: string): Promise<boolean> {
    const rows = await transaction.query<Array<{ relation_count: bigint }>>(
      "SELECT COUNT(*) AS relation_count FROM home_follow_relationships WHERE follower_player_id = ? AND followed_player_id = ? AND status = 'active'",
      [followerPlayerId, followedPlayerId]
    );
    return (rows[0]?.relation_count ?? 0n) > 0n;
  }

  private async setFollowing(transaction: DatabaseTransaction, followerPlayerId: string, followedPlayerId: string, active: boolean): Promise<void> {
    if (active) {
      await transaction.execute(
        `INSERT INTO home_follow_relationships (followed_player_id, follower_player_id, status, followed_at, updated_at)
         VALUES (?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE status = 'active', followed_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)`,
        [followedPlayerId, followerPlayerId]
      );
    } else {
      await transaction.execute(
        "UPDATE home_follow_relationships SET status = 'removed', updated_at = UTC_TIMESTAMP(3) WHERE follower_player_id = ? AND followed_player_id = ? AND status = 'active'",
        [followerPlayerId, followedPlayerId]
      );
    }
  }

  private async addAlert(transaction: DatabaseTransaction, operationId: string, targetPlayerId: string, actorPlayerId: string, type: "follow" | "unfollow", mutual: boolean): Promise<void> {
    await transaction.execute(
      "INSERT INTO home_activity_alerts (operation_id, target_player_id, actor_player_id, alert_type, mutual) VALUES (?, ?, ?, ?, ?)",
      [operationId, targetPlayerId, actorPlayerId, type, mutual]
    );
  }

  private async awardEligibleBadges(transaction: DatabaseTransaction, operationId: string, playerId: string): Promise<string[]> {
    const stats = await transaction.query<Array<{ followers: bigint; mutual: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM home_follow_relationships relation WHERE relation.followed_player_id = ? AND relation.status = 'active') AS followers,
        (SELECT COUNT(*) FROM home_follow_relationships outgoing
          JOIN home_follow_relationships inverse ON inverse.follower_player_id = outgoing.followed_player_id
            AND inverse.followed_player_id = outgoing.follower_player_id AND inverse.status = 'active'
          WHERE outgoing.follower_player_id = ? AND outgoing.status = 'active') AS mutual`, [playerId, playerId]
    );
    const definitions = await transaction.query<BadgeDefinitionRow[]>(
      "SELECT badge_code, display_name, criteria_json FROM home_badge_definitions WHERE active = TRUE AND criteria_json IS NOT NULL ORDER BY badge_code"
    );
    const assignments = await transaction.query<Array<{ badge_code: string }>>(
      "SELECT badge_code FROM player_badge_assignments WHERE player_id = ? FOR UPDATE", [playerId]
    );
    const owned = new Set(assignments.map((assignment) => assignment.badge_code));
    const awarded: string[] = [];
    for (const definition of definitions) {
      const rule = criteria(definition.criteria_json);
      if (rule === null || owned.has(definition.badge_code) || rule.requiredBadgeIds.some((badge) => !owned.has(badge))) continue;
      if ((stats[0]?.[rule.stat] ?? 0n) < rule.threshold) continue;
      await transaction.execute(
        `INSERT INTO player_badge_assignments (player_id, badge_code, display_value, priority, starts_at, ends_at)
         VALUES (?, ?, ?, 100, UTC_TIMESTAMP(3), NULL)`, [playerId, definition.badge_code, definition.display_name]
      );
      await transaction.execute(
        `INSERT INTO home_activity_alerts (operation_id, target_player_id, actor_player_id, alert_type, badge_code)
         VALUES (?, ?, ?, 'badge_earned', ?)`, [operationId, playerId, playerId, definition.badge_code]
      );
      owned.add(definition.badge_code);
      awarded.push(definition.badge_code);
    }
    return awarded;
  }

  private async countFollowing(transaction: DatabaseTransaction, playerId: string): Promise<number> {
    const rows = await transaction.query<Array<{ relation_count: bigint }>>(
      "SELECT COUNT(*) AS relation_count FROM home_follow_relationships WHERE follower_player_id = ? AND status = 'active'", [playerId]
    );
    return Number(rows[0]?.relation_count ?? 0n);
  }

  private async readList(transaction: DatabaseTransaction, playerId: string, type: "followers" | "following"): Promise<HomeSocialFollowListRow[]> {
    const rows = await transaction.query<Array<{ player_id: bigint; rank_label: string; mutual: bigint | number }>>(
      type === "followers"
        ? `SELECT other.id AS player_id, ${PLAYER_LABEL} AS rank_label,
            EXISTS(SELECT 1 FROM home_follow_relationships inverse WHERE inverse.follower_player_id = ?
              AND inverse.followed_player_id = relation.follower_player_id AND inverse.status = 'active') AS mutual
           FROM home_follow_relationships relation JOIN players other ON other.id = relation.follower_player_id AND other.status = 'active'
           JOIN player_profiles profile ON profile.player_id = other.id LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = other.id
           WHERE relation.followed_player_id = ? AND relation.status = 'active' ORDER BY relation.followed_at, relation.follower_player_id`
        : `SELECT other.id AS player_id, ${PLAYER_LABEL} AS rank_label,
            EXISTS(SELECT 1 FROM home_follow_relationships inverse WHERE inverse.follower_player_id = relation.followed_player_id
              AND inverse.followed_player_id = ? AND inverse.status = 'active') AS mutual
           FROM home_follow_relationships relation JOIN players other ON other.id = relation.followed_player_id AND other.status = 'active'
           JOIN player_profiles profile ON profile.player_id = other.id LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = other.id
           WHERE relation.follower_player_id = ? AND relation.status = 'active' ORDER BY relation.followed_at, relation.followed_player_id`,
      [playerId, playerId]
    );
    return rows.map((row) => ({ playerId: row.player_id.toString(), rankLabel: row.rank_label, mutual: Boolean(row.mutual) }));
  }

  private async complete(transaction: DatabaseTransaction, operationId: string, completion: HomeSocialFollowCompletion, result: HomeSocialFollowResult): Promise<HomeSocialFollowResult> {
    const outbox = await transaction.execute(
      `INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [operationId, completion.channelId, JSON.stringify({ data: completion.data })]
    );
    await transaction.execute(
      `INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [completion.eventId, completion.commandCode, operationId]
    );
    const audit = await transaction.execute(
      `INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'player', ?, 'player', ?, ?, ?, 'Iris 펫홈 소셜', ?, UTC_TIMESTAMP(3))`,
      [operationId, completion.actorPlayerId, completion.targetPlayerId, completion.actionCode, completion.resultCode, JSON.stringify(completion.changeSummary)]
    );
    const completed = { ...result, auditId: audit.insertId.toString(), outboxId: outbox.insertId.toString() };
    await transaction.execute(
      "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(completed), operationId]
    );
    return completed;
  }
}
