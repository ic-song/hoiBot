import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type {
  HomeSocialRankingKind,
  HomeSocialRankingRepository,
  HomeSocialRankingRow,
  HomeSocialRankingSnapshot
} from "./home-social-ranking.js";

interface ViewerRow { rank_label: string; }
interface ScoreRow {
  player_id: bigint;
  rank_label: string;
  sort_name: string;
  score: bigint | string;
  cute_count?: bigint | string;
  cheer_count?: bigint | string;
  cool_count?: bigint | string;
  love_count?: bigint | string;
}

const PLAYER_LABEL = "COALESCE(rank_projection.rank_label, profile.current_display_name)";

// DB 숫자 형식을 손실 없는 bigint로 정규화합니다.
function toBigInt(value: bigint | string | undefined): bigint {
  return value === undefined ? 0n : BigInt(value);
}

// 조회 종류별 집계를 하나의 read transaction에서 실행합니다.
export class MariaHomeSocialRankingRepository implements HomeSocialRankingRepository {
  constructor(private readonly database: DatabaseClient) {}

  async read(providerCode: string, externalUserId: string, kind: HomeSocialRankingKind): Promise<HomeSocialRankingSnapshot | null> {
    return this.database.withTransaction(async (transaction) => {
      const viewers = await transaction.query<ViewerRow[]>(
        `SELECT ${PLAYER_LABEL} AS rank_label
         FROM external_identities identity_row
         JOIN players player ON player.id = identity_row.player_id AND player.status = 'active'
         JOIN player_profiles profile ON profile.player_id = player.id
         LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = player.id
         WHERE identity_row.provider_code = ? AND identity_row.external_user_id = ?
           AND identity_row.status = 'linked' LIMIT 1`,
        [providerCode, externalUserId]
      );
      if (viewers[0] === undefined) return null;
      const rows = kind === "followers"
        ? await this.readFollowers(transaction)
        : kind === "hearts"
          ? await this.readHearts(transaction)
          : await this.readBadges(transaction);
      return { viewerRankLabel: viewers[0].rank_label, rows };
    });
  }

  // 유효한 고유 follower와 장착된 고유 스킬의 followerBonus를 합산합니다.
  private async readFollowers(transaction: DatabaseTransaction): Promise<HomeSocialRankingRow[]> {
    const rows = await transaction.query<ScoreRow[]>(
      `SELECT player.id AS player_id, ${PLAYER_LABEL} AS rank_label, profile.current_display_name AS sort_name,
         COALESCE(follower_totals.follower_count, 0) + COALESCE(skill_totals.follower_bonus, 0) AS score
       FROM players player
       JOIN player_profiles profile ON profile.player_id = player.id
       LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = player.id
       LEFT JOIN (
         SELECT relation.followed_player_id AS player_id, COUNT(DISTINCT relation.follower_player_id) AS follower_count
         FROM home_follow_relationships relation
         JOIN players follower ON follower.id = relation.follower_player_id AND follower.status = 'active'
         WHERE relation.status = 'active' GROUP BY relation.followed_player_id
       ) follower_totals ON follower_totals.player_id = player.id
       LEFT JOIN (
         SELECT equipped.player_id,
           SUM(CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json, '$.followerBonus')), '0') AS UNSIGNED)) AS follower_bonus
         FROM (
           SELECT DISTINCT pet.player_id, skill.skill_id
           FROM player_pets pet JOIN pet_skills skill ON skill.player_pet_id = pet.id AND skill.equipped = TRUE
         ) equipped
         JOIN skill_definitions definition ON definition.id = equipped.skill_id AND definition.active = TRUE
         GROUP BY equipped.player_id
       ) skill_totals ON skill_totals.player_id = player.id
       WHERE player.status = 'active'`);
    return rows.map((row) => ({ playerId: row.player_id.toString(), rankLabel: row.rank_label, sortName: row.sort_name, score: toBigInt(row.score) }));
  }

  // 네 마음표현의 누적값과 합계를 함께 조회합니다.
  private async readHearts(transaction: DatabaseTransaction): Promise<HomeSocialRankingRow[]> {
    const rows = await transaction.query<ScoreRow[]>(
      `SELECT player.id AS player_id, ${PLAYER_LABEL} AS rank_label, profile.current_display_name AS sort_name,
         COALESCE(heart.cute_count, 0) AS cute_count, COALESCE(heart.cheer_count, 0) AS cheer_count,
         COALESCE(heart.cool_count, 0) AS cool_count, COALESCE(heart.love_count, 0) AS love_count,
         COALESCE(heart.cute_count, 0) + COALESCE(heart.cheer_count, 0)
           + COALESCE(heart.cool_count, 0) + COALESCE(heart.love_count, 0) AS score
       FROM players player
       JOIN player_profiles profile ON profile.player_id = player.id
       LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = player.id
       LEFT JOIN home_heart_expression_totals heart ON heart.player_id = player.id
       WHERE player.status = 'active'`);
    return rows.map((row) => ({
      playerId: row.player_id.toString(), rankLabel: row.rank_label, sortName: row.sort_name, score: toBigInt(row.score),
      hearts: { cute: toBigInt(row.cute_count), cheer: toBigInt(row.cheer_count), cool: toBigInt(row.cool_count), love: toBigInt(row.love_count) }
    }));
  }

  // 활성 정의와 현재 유효 기간을 모두 만족하는 고유 뱃지만 집계합니다.
  private async readBadges(transaction: DatabaseTransaction): Promise<HomeSocialRankingRow[]> {
    const rows = await transaction.query<ScoreRow[]>(
      `SELECT player.id AS player_id, ${PLAYER_LABEL} AS rank_label, profile.current_display_name AS sort_name,
         COUNT(DISTINCT CASE WHEN definition.badge_code IS NOT NULL THEN assignment.badge_code END) AS score
       FROM players player
       JOIN player_profiles profile ON profile.player_id = player.id
       LEFT JOIN player_rank_projections rank_projection ON rank_projection.player_id = player.id
       LEFT JOIN player_badge_assignments assignment ON assignment.player_id = player.id
         AND (assignment.starts_at IS NULL OR assignment.starts_at <= UTC_TIMESTAMP(3))
         AND (assignment.ends_at IS NULL OR assignment.ends_at > UTC_TIMESTAMP(3))
       LEFT JOIN home_badge_definitions definition ON definition.badge_code = assignment.badge_code AND definition.active = TRUE
       WHERE player.status = 'active'
       GROUP BY player.id, profile.current_display_name, rank_projection.rank_label`);
    return rows.map((row) => ({ playerId: row.player_id.toString(), rankLabel: row.rank_label, sortName: row.sort_name, score: toBigInt(row.score) }));
  }
}
