import type { DatabaseClient } from "../database.js";

const LEADERBOARD_CODE = "mini_pet_collection_stage";
const LEADERBOARD_SEASON = "lifetime";

export interface MiniPetCollectionRankingEntry {
  playerId: string;
  displayName: string;
  stage: number;
  completedStage: number;
  rank: number;
}

// 인자 없는 미니펫 컬렉션 순위 명령만 실행 대상으로 인정합니다.
export function isMiniPetCollectionRankingReadCommand(message: string | undefined): boolean {
  return message === "/미니펫컬렉션순위";
}

// 컬렉션 단계 순위를 legacy 표시 계약에 맞게 출력합니다.
export function formatMiniPetCollectionRanking(entries: MiniPetCollectionRankingEntry[]): string {
  if (entries.length === 0) return "🏆 미니펫 컬렉션 순위\n아직 순위 데이터가 없습니다.";
  const lines = [
    "🏆 미니펫 컬렉션 순위",
    ...entries.slice(0, 10).map((entry) =>
      `${entry.rank}위 ${entry.displayName} - 단계 ${entry.stage} (완료 ${entry.completedStage})`)
  ];
  return `${lines.join("\n")}${entries.length >= 10 ? "\n" + "\u200b".repeat(500) : ""}`;
}

export class MiniPetCollectionRankingReadService {
  constructor(private readonly database: DatabaseClient) {}

  // 현재 collection projection을 집계하고 공용 leaderboard snapshot을 원자 교체합니다.
  async refresh(): Promise<MiniPetCollectionRankingEntry[]> {
    return this.database.withTransaction(async (tx) => {
      const rows = await tx.query<Array<{
        player_id: bigint;
        current_display_name: string;
        stage: number;
        completed_stage: number;
      }>>(
        `SELECT projection.player_id, profile.current_display_name,
          MAX(COALESCE(NULLIF(projection.stage, 0), 1)) AS stage,
          MAX(COALESCE(projection.completed_stage, 0)) AS completed_stage
         FROM mini_pet_collection_projections projection
         JOIN players player ON player.id = projection.player_id
         JOIN player_profiles profile ON profile.player_id = player.id
         GROUP BY projection.player_id, profile.current_display_name
         ORDER BY stage DESC, profile.current_display_name COLLATE utf8mb4_unicode_ci ASC, projection.player_id ASC`
      );
      await tx.execute(
        `INSERT INTO leaderboards (code, season_key, calculated_at)
         VALUES (?, ?, UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE calculated_at = VALUES(calculated_at)`,
        [LEADERBOARD_CODE, LEADERBOARD_SEASON]
      );
      const boards = await tx.query<Array<{ id: bigint }>>(
        "SELECT id FROM leaderboards WHERE code = ? AND season_key = ? FOR UPDATE",
        [LEADERBOARD_CODE, LEADERBOARD_SEASON]
      );
      const leaderboardId = boards[0]!.id;
      await tx.execute("DELETE FROM leaderboard_entries WHERE leaderboard_id = ?", [leaderboardId]);
      const entries = rows.map((row, index) => ({
        playerId: row.player_id.toString(),
        displayName: row.current_display_name,
        stage: Number(row.stage),
        completedStage: Number(row.completed_stage),
        rank: index + 1
      }));
      for (const entry of entries) {
        await tx.execute(
          `INSERT INTO leaderboard_entries
            (leaderboard_id, player_id, rank_no, score, tie_break_key)
           VALUES (?, ?, ?, ?, ?)`,
          [leaderboardId, entry.playerId, entry.rank, entry.stage, entry.displayName]
        );
      }
      return entries;
    });
  }
}
