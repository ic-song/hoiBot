import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import type { HomeBadgeReferenceRepository, HomeBadgeReferenceSnapshot } from "./home-badge-reference.js";

interface IdentityRow { rank_label: string; }
interface VersionRow { id: bigint; version_key: string; content_hash: string; }

// 활성 사용자와 하나의 published 기준정보 version을 같은 read transaction에서 고정합니다.
export class MariaHomeBadgeReferenceRepository implements HomeBadgeReferenceRepository {
  constructor(private readonly database: DatabaseClient) {}

  async readActiveForIdentity(providerCode: string, externalUserId: string): Promise<HomeBadgeReferenceSnapshot | null> {
    return this.database.withTransaction(async (transaction) => {
      const identities = await transaction.query<IdentityRow[]>(
        `SELECT COALESCE(rank.rank_label, profile.current_display_name) AS rank_label
         FROM external_identities identity_row
         JOIN players player ON player.id = identity_row.player_id AND player.status = 'active'
         JOIN player_profiles profile ON profile.player_id = player.id
         LEFT JOIN player_rank_projections rank ON rank.player_id = player.id
         WHERE identity_row.provider_code = ? AND identity_row.external_user_id = ?
           AND identity_row.status = 'linked' LIMIT 1`,
        [providerCode, externalUserId]
      );
      if (identities[0] === undefined) return null;

      const versions = await transaction.query<VersionRow[]>(
        `SELECT id, version_key, content_hash FROM home_badge_reference_versions
         WHERE status = 'published' AND effective_at <= UTC_TIMESTAMP(3)
         ORDER BY effective_at DESC, id DESC LIMIT 1`
      );
      if (versions[0] === undefined) return null;
      return this.readSnapshot(transaction, versions[0], identities[0].rank_label);
    });
  }

  // 자식 기준정보를 version PK로만 조회해 혼합 version 응답을 차단합니다.
  private async readSnapshot(transaction: DatabaseTransaction, version: VersionRow, rankLabel: string): Promise<HomeBadgeReferenceSnapshot> {
    const cubeOptions = await transaction.query<Array<{ sequence_no: number; option_code: string; display_name: string; max_percent: string }>>(
      `SELECT sequence_no, option_code, display_name, max_percent FROM home_badge_cube_options
       WHERE reference_version_id = ? ORDER BY sequence_no`, [version.id]
    );
    const cubeRateBands = await transaction.query<Array<{ sequence_no: number; min_percent: string; max_percent: string; rate_percent: string }>>(
      `SELECT sequence_no, min_percent, max_percent, rate_percent FROM home_badge_cube_rate_bands
       WHERE reference_version_id = ? ORDER BY sequence_no`, [version.id]
    );
    const gachaGradeRates = await transaction.query<Array<{ sequence_no: number; grade_code: string; rate_percent: string; badge_count: number }>>(
      `SELECT sequence_no, grade_code, rate_percent, badge_count FROM home_badge_gacha_grade_rates
       WHERE reference_version_id = ? ORDER BY sequence_no`, [version.id]
    );
    const specialBadges = await transaction.query<Array<{ sequence_no: number; badge_code: string; emoji_value: string; display_name: string; acquisition_text: string }>>(
      `SELECT sequence_no, badge_code, emoji_value, display_name, acquisition_text FROM home_badge_special_definitions
       WHERE reference_version_id = ? ORDER BY sequence_no`, [version.id]
    );
    return {
      versionId: version.id.toString(), versionKey: version.version_key, contentHash: version.content_hash, rankLabel,
      cubeOptions: cubeOptions.map((row) => ({ sequence: row.sequence_no, code: row.option_code, displayName: row.display_name, maxPercent: row.max_percent })),
      cubeRateBands: cubeRateBands.map((row) => ({ sequence: row.sequence_no, minPercent: row.min_percent, maxPercent: row.max_percent, ratePercent: row.rate_percent })),
      gachaGradeRates: gachaGradeRates.map((row) => ({ sequence: row.sequence_no, grade: row.grade_code, ratePercent: row.rate_percent, badgeCount: row.badge_count })),
      specialBadges: specialBadges.map((row) => ({ sequence: row.sequence_no, code: row.badge_code, emoji: row.emoji_value, displayName: row.display_name, acquisitionText: row.acquisition_text }))
    };
  }
}
