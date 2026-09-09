import type { DatabaseClient } from "../database.js";
import { TransactionalOperationRunner, type OperationActor } from "../shared/transactional-operation.js";

export interface PetExploreLegacyRecord {
  win?: unknown;
  lose?: unknown;
}

export interface PetExploreRankEntry {
  playerName: string;
  win: number;
  lose: number;
  rankLabel: string;
}

export interface PetExploreRankImportCommand {
  records: Readonly<Record<string, PetExploreLegacyRecord | undefined>>;
  activePlayerNames: readonly string[];
  idempotencyKey: string;
  actor: OperationActor;
  sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system";
  reason: string;
}

export interface PetExploreRankMessageOptions {
  allsee: string;
  nextIntervalText: string;
  minWin?: number;
  maxShow?: number;
}

interface PetExploreRankDatabaseRow {
  player_name: string;
  win_count: bigint | number | string;
  lose_count: bigint | number | string;
}

const DEFAULT_MIN_WIN = 30;
const DEFAULT_MAX_SHOW = 50;

// 레거시와 동일하게 인자가 없는 정확한 순위 명령만 허용합니다.
export function isPetExploreRankCommand(message: string): boolean {
  return message === "/펫탐험순위";
}

// 레거시 숫자 필드만 음수 없는 정수로 정규화합니다.
function normalizeLegacyCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

// 승리, 적은 패배, 사용자명 순서로 레거시 순위를 정렬합니다.
function comparePetExploreRank(a: PetExploreRankEntry, b: PetExploreRankEntry): number {
  if (a.win !== b.win) return b.win - a.win;
  if (a.lose !== b.lose) return a.lose - b.lose;
  return a.playerName < b.playerName ? -1 : a.playerName > b.playerName ? 1 : 0;
}

// 조회 결과를 기존 /펫탐험순위 출력 형식으로 변환합니다.
export function buildPetExploreRankMessage(
  entries: readonly PetExploreRankEntry[],
  options: PetExploreRankMessageOptions
): string {
  const minWin = options.minWin ?? DEFAULT_MIN_WIN;
  const maxShow = options.maxShow ?? DEFAULT_MAX_SHOW;
  const rows = entries.filter((entry) => entry.win >= minWin).slice().sort(comparePetExploreRank).slice(0, maxShow);
  const header = `⛰️ [ 펫탐험 다승 순위 ] ⛰️\n(승리 → 적은 패배 → 가나다, ${minWin}승 이상만 표시)`;
  if (rows.length === 0) return `${header}\n\n표시할 유저가 없습니다.`;

  let output = `${header}\n\n`;
  rows.forEach((entry, index) => {
    const total = entry.win + entry.lose;
    const rate = total > 0 ? ((entry.win / total) * 100).toFixed(2) : "0.00";
    output += `${index + 1}등 [${entry.rankLabel}] : ${entry.win}승 ${entry.lose}패 (${rate}%)\n`;
    if (index + 1 === 5) output += options.allsee;
  });
  output += `\n${options.nextIntervalText}`;
  return output.trim();
}

// 펫탐험 전적 projection의 import와 순위 조회를 관리합니다.
export class PetExploreRankService {
  private readonly operations: TransactionalOperationRunner;

  constructor(
    private readonly database: DatabaseClient,
    private readonly resolveRankLabel: (playerName: string) => Promise<string>
  ) {
    this.operations = new TransactionalOperationRunner(database);
  }

  async importLegacySnapshot(command: PetExploreRankImportCommand): Promise<{
    importedCount: number;
    removedInvalidCount: number;
    auditId: string;
  }> {
    const activePlayers = new Set(command.activePlayerNames);
    const sourceRows = Object.entries(command.records);
    const rows = sourceRows
      .filter(([playerName]) => activePlayers.has(playerName))
      .map(([playerName, record], sourceOrder) => ({
        playerName,
        win: normalizeLegacyCount(record?.win),
        lose: normalizeLegacyCount(record?.lose),
        sourceOrder
      }));

    return this.operations.run({
      scope: "pet-explore-rank:snapshot",
      idempotencyKey: command.idempotencyKey,
      actor: command.actor,
      sourceCode: command.sourceCode,
      actionCode: "pet_explore_rank.snapshot.import",
      targetType: "pet_explore_rank",
      reason: command.reason,
      outboxType: "pet_explore_rank.snapshot.imported"
    }, async (transaction) => {
      await transaction.execute("DELETE FROM player_pet_explore_rank_stats");
      for (const row of rows) {
        await transaction.execute(
          `INSERT INTO player_pet_explore_rank_stats
             (player_name, win_count, lose_count, source_order, imported_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [row.playerName, row.win, row.lose, row.sourceOrder]
        );
      }
      const removedInvalidCount = sourceRows.length - rows.length;
      return {
        result: { importedCount: rows.length, removedInvalidCount },
        changeSummary: { importedCount: rows.length, removedInvalidCount }
      };
    });
  }

  async execute(message: string, options: PetExploreRankMessageOptions): Promise<string | null> {
    if (!isPetExploreRankCommand(message)) return null;
    const rows = await this.database.query<PetExploreRankDatabaseRow[]>(
      `SELECT player_name, win_count, lose_count
         FROM player_pet_explore_rank_stats
        WHERE win_count >= ?`,
      [options.minWin ?? DEFAULT_MIN_WIN]
    );
    const entries: PetExploreRankEntry[] = [];
    for (const row of rows) {
      entries.push({
        playerName: row.player_name,
        win: Number(row.win_count),
        lose: Number(row.lose_count),
        rankLabel: await this.resolveRankLabel(row.player_name)
      });
    }
    return buildPetExploreRankMessage(entries, options);
  }
}

