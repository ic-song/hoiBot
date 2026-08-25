import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const COMMAND_CODE = "MINIPET_EXP_RANK_READ";
const LEADERBOARD_CODE = "minipet_exp_total";
const ALL_SEE = "​".repeat(500);

interface MiniPetExperienceRow {
  player_id: bigint;
  display_name: string;
  owned_mini_pet_id: bigint | null;
  battle_experience: bigint | null;
  equipped: number | null;
}

export interface MiniPetExpRankEntry {
  rank: number;
  playerId: string;
  displayName: string;
  equippedExperience: string;
  bagTopFiveExperience: string;
  totalExperience: string;
}

export interface MiniPetExpRankResult {
  commandCode: typeof COMMAND_CODE;
  snapshotCode: typeof LEADERBOARD_CODE;
  totalPlayers: number;
  entries: readonly MiniPetExpRankEntry[];
  data: string;
}

interface RankAccumulator {
  playerId: string;
  displayName: string;
  equipped: Array<{ id: bigint; experience: bigint }>;
  bag: Array<{ id: bigint; experience: bigint }>;
}

// `/미니펫종합순위` 정확 일치 입력만 현대화 순위 조회 후보로 허용한다.
export function isMiniPetExpRankCommand(message: string | undefined): boolean {
  return message === "/미니펫종합순위";
}

// 쉼표를 포함한 기존 매력 수치 표기로 변환한다.
function withCommas(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 레거시의 장착 1개와 비장착 가방 상위 5개 합산 규칙으로 순위를 계산한다.
export function calculateMiniPetExpRanks(rows: readonly MiniPetExperienceRow[]): MiniPetExpRankEntry[] {
  const players = new Map<string, RankAccumulator>();
  for (const row of rows) {
    const playerId = row.player_id.toString();
    let player = players.get(playerId);
    if (player === undefined) {
      player = { playerId, displayName: row.display_name, equipped: [], bag: [] };
      players.set(playerId, player);
    }
    if (row.owned_mini_pet_id === null) continue;
    const miniPet = { id: row.owned_mini_pet_id, experience: row.battle_experience ?? 0n };
    (row.equipped === 1 ? player.equipped : player.bag).push(miniPet);
  }

  const totals = [...players.values()].map((player) => {
    player.equipped.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    player.bag.sort((left, right) => left.experience === right.experience
      ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      : (left.experience > right.experience ? -1 : 1));
    const equippedExperience = player.equipped[0]?.experience ?? 0n; // 레거시 단일 장착 미니펫
    const bagTopFiveExperience = player.bag.slice(0, 5).reduce((sum, pet) => sum + pet.experience, 0n);
    return { ...player, equippedExperience, bagTopFiveExperience,
      totalExperience: equippedExperience + bagTopFiveExperience };
  }).filter((player) => player.totalExperience > 0n);

  totals.sort((left, right) => left.totalExperience === right.totalExperience
    ? (left.displayName.localeCompare(right.displayName, "ko") || left.playerId.localeCompare(right.playerId))
    : (left.totalExperience > right.totalExperience ? -1 : 1));
  return totals.map((player, index) => ({
    rank: index + 1,
    playerId: player.playerId,
    displayName: player.displayName,
    equippedExperience: player.equippedExperience.toString(),
    bagTopFiveExperience: player.bagTopFiveExperience.toString(),
    totalExperience: player.totalExperience.toString()
  }));
}

// 상위 10명의 순번·회원명·미니펫 매력을 기존 순위형 답장으로 렌더링한다.
export function formatMiniPetExpRank(entries: readonly MiniPetExpRankEntry[]): string {
  const visible = entries.slice(0, 10);
  const lines = ["🐹 미니펫 종합순위 🐹"];
  if (visible.length === 0) lines.push("순위에 등록된 미니펫이 없습니다.");
  for (const entry of visible) {
    lines.push(`${entry.rank}위 ${entry.displayName} (+${withCommas(entry.totalExperience)}💕)`);
  }
  if (visible.length === 10) lines.push(ALL_SEE);
  return lines.join("\n");
}

// 계산된 전체 순위를 공용 leaderboard snapshot에 원자적으로 교체한다.
async function replaceSnapshot(transaction: DatabaseTransaction, entries: readonly MiniPetExpRankEntry[]): Promise<void> {
  const leaderboard = await transaction.execute(
    `INSERT INTO leaderboards (code,season_key,calculated_at)
     VALUES (?, 'lifetime', UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),calculated_at=VALUES(calculated_at)`,
    [LEADERBOARD_CODE]
  );
  await transaction.execute("DELETE FROM leaderboard_entries WHERE leaderboard_id=?", [leaderboard.insertId]);
  if (entries.length === 0) return;
  const placeholders = entries.map(() => "(?,?,?,?,?)").join(",");
  const values: unknown[] = [];
  for (const entry of entries) {
    values.push(leaderboard.insertId, entry.playerId, entry.rank, entry.totalExperience, entry.displayName);
  }
  await transaction.execute(
    `INSERT INTO leaderboard_entries (leaderboard_id,player_id,rank_no,score,tie_break_key) VALUES ${placeholders}`,
    values
  );
}

// 현재 DB projection으로 순위를 계산하고 player·inventory 변경 없이 snapshot과 답장을 만든다.
export class MiniPetExpRankService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(): Promise<MiniPetExpRankResult> {
    const entries = await this.database.withTransaction(async (transaction) => {
      const rows = await transaction.query<MiniPetExperienceRow[]>(
        `SELECT player.id AS player_id,profile.current_display_name AS display_name,
                mini.id AS owned_mini_pet_id,mini.battle_experience,mini.equipped
           FROM players player
           JOIN player_profiles profile ON profile.player_id=player.id
           LEFT JOIN owned_mini_pets mini ON mini.player_id=player.id
          WHERE player.status='active'
          ORDER BY player.id,mini.id`
      );
      const ranked = calculateMiniPetExpRanks(rows);
      await replaceSnapshot(transaction, ranked);
      return ranked;
    });
    return {
      commandCode: COMMAND_CODE,
      snapshotCode: LEADERBOARD_CODE,
      totalPlayers: entries.length,
      entries: entries.slice(0, 10),
      data: formatMiniPetExpRank(entries)
    };
  }
}
