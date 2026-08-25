import type {
  CastleBattleRankingCommand,
  CastleBattleRankingRepository,
  CastleBattleRankingResult,
  CastleBattleRankingSnapshot
} from "./castle-battle-ranking-repository.js";

const ALL_SEE = "​".repeat(500);

// `/캐슬대전순위` 정확 일치 명령만 현대화 후보로 허용합니다.
export function isCastleBattleRankingCommand(message: string | undefined): boolean {
  return message === "/캐슬대전순위";
}

// 게시된 캐슬대전 순위 스냅샷을 레거시 표시 형식으로 제공합니다.
export class CastleBattleRankingService {
  constructor(private readonly repository: CastleBattleRankingRepository) {}

  async handle(command: CastleBattleRankingCommand & { message: string }): Promise<CastleBattleRankingResult> {
    if (!isCastleBattleRankingCommand(command.message)) {
      throw new Error("Castle battle ranking command must match exactly.");
    }
    return this.repository.read(command, renderCastleBattleRanking);
  }
}

// 고정된 스냅샷을 동일한 입력이면 항상 같은 순위 문구로 렌더링합니다.
export function renderCastleBattleRanking(snapshot: CastleBattleRankingSnapshot | null): string {
  if (snapshot === null) {
    return "🏆 캐슬대전 순위 🏆\n\n아직 집계된 캐슬대전 순위가 없습니다.";
  }
  if (snapshot.entries.length === 0) {
    return "🏆 캐슬대전 순위 🏆\n\n현재 순위에 등록된 사용자가 없습니다.";
  }

  const lines = ["🏆 캐슬대전 순위 🏆", ""];
  const medals = ["🥇", "🥈", "🥉"];
  snapshot.entries.forEach((entry, index) => {
    const marker = medals[index] ?? `[${entry.rank}]`;
    lines.push(`${marker} ${entry.displayName} | ${entry.tier} | ${entry.score.toString()}pt`);
    if (index === 2 && snapshot.entries.length > 3) lines.push(ALL_SEE);
  });
  return lines.join("\n");
}
