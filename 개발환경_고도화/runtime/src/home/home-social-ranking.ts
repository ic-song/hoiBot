export type HomeSocialRankingKind = "followers" | "hearts" | "badges";

export interface HomeSocialRankingRow {
  playerId: string;
  rankLabel: string;
  sortName: string;
  score: bigint;
  hearts?: { cute: bigint; cheer: bigint; cool: bigint; love: bigint };
}

export interface HomeSocialRankingSnapshot {
  viewerRankLabel: string;
  rows: HomeSocialRankingRow[];
}

export interface HomeSocialRankingRepository {
  read(providerCode: string, externalUserId: string, kind: HomeSocialRankingKind): Promise<HomeSocialRankingSnapshot | null>;
}

// 세 소셜 순위 명령을 정확히 일치할 때만 분류합니다.
export function parseHomeSocialRankingCommand(message: string | null | undefined): HomeSocialRankingKind | null {
  if (message === "/팔로워순위") return "followers";
  if (message === "/마음순위") return "hearts";
  if (message === "/뱃지순위") return "badges";
  return null;
}

// bigint 점수를 legacy의 세 자리 쉼표 형식으로 변환합니다.
function formatInteger(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// DB 집계 행을 legacy의 한국어 동률 정렬과 TOP 100 규칙으로 고정합니다.
export function normalizeHomeSocialRankingRows(rows: HomeSocialRankingRow[]): HomeSocialRankingRow[] {
  const collator = new Intl.Collator("ko");
  return rows
    .filter((row) => row.score > 0n)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score > right.score ? -1 : 1;
      const labelOrder = collator.compare(left.sortName, right.sortName);
      return labelOrder !== 0 ? labelOrder : left.playerId.localeCompare(right.playerId);
    })
    .slice(0, 100);
}

// 순위 snapshot을 legacy 제목·allsee·세부 마음표현 형식으로 출력합니다.
export function formatHomeSocialRanking(snapshot: HomeSocialRankingSnapshot, kind: HomeSocialRankingKind, allsee: string): string {
  const settings = kind === "followers"
    ? { title: "🐾━━ 팔로워 순위 TOP 100 ━━🐾", unit: "팔로워 ", suffix: "명" }
    : kind === "hearts"
      ? { title: "💞━━ 마음표현 받은 순위 TOP 100 ━━💞", unit: "총 ", suffix: "회" }
      : { title: "🏅━━ 뱃지 순위 TOP 100 ━━🏅", unit: "뱃지 ", suffix: "개" };
  const rows = normalizeHomeSocialRankingRows(snapshot.rows);
  const lines = [`[${snapshot.viewerRankLabel}] 님`, settings.title, allsee, ""];
  if (rows.length === 0) return lines.concat("[순위에 등록된 유저가 없습니다.]").join("\n");
  rows.forEach((row, index) => {
    lines.push(`${index + 1}위. ${row.rankLabel} — ${settings.unit}${formatInteger(row.score)}${settings.suffix}`);
    if (kind === "hearts") {
      const hearts = row.hearts ?? { cute: 0n, cheer: 0n, cool: 0n, love: 0n };
      lines.push(`└ 귀여워🐾 ${formatInteger(hearts.cute)} | 멋져요✨ ${formatInteger(hearts.cool)} | 응원해⭐ ${formatInteger(hearts.cheer)} | 사랑해💖 ${formatInteger(hearts.love)}`);
    }
  });
  return lines.join("\n").trim();
}

export class HomeSocialRankingService {
  constructor(private readonly repository: HomeSocialRankingRepository, private readonly allsee: string) {}

  // 가입 identity와 같은 read transaction의 순위 snapshot으로 응답합니다.
  async execute(input: { providerCode: string; externalUserId: string; kind: HomeSocialRankingKind }): Promise<string | null> {
    const snapshot = await this.repository.read(input.providerCode, input.externalUserId, input.kind);
    return snapshot === null ? null : formatHomeSocialRanking(snapshot, input.kind, this.allsee);
  }
}
