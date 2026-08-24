export type HomeBadgeReferenceCommand =
  | { kind: "cube-rate" }
  | { kind: "gacha-rate" }
  | { kind: "special-list" }
  | { kind: "special-detail"; badgeCode: string | null };

export interface HomeBadgeReferenceSnapshot {
  versionId: string;
  versionKey: string;
  contentHash: string;
  rankLabel: string;
  cubeOptions: Array<{ sequence: number; code: string; displayName: string; maxPercent: string }>;
  cubeRateBands: Array<{ sequence: number; minPercent: string; maxPercent: string; ratePercent: string }>;
  gachaGradeRates: Array<{ sequence: number; grade: string; ratePercent: string; badgeCount: number }>;
  specialBadges: Array<{ sequence: number; code: string; emoji: string; displayName: string; acquisitionText: string }>;
}

export interface HomeBadgeReferenceRepository {
  readActiveForIdentity(providerCode: string, externalUserId: string): Promise<HomeBadgeReferenceSnapshot | null>;
}

// 홈뱃지 기준정보 조회 명령을 exact 또는 전체 단일-인자 패턴으로만 분류합니다.
export function parseHomeBadgeReferenceCommand(message: string | null | undefined): HomeBadgeReferenceCommand | null {
  if (message === "/큐브확률") return { kind: "cube-rate" };
  if (message === "/홈뽑기확률") return { kind: "gacha-rate" };
  if (message === "/특별뱃지목록") return { kind: "special-list" };
  const detail = message?.match(/^\/특별뱃지목록\s+(\S+)$/);
  if (detail === null || detail === undefined) return null;
  const code = detail[1]!.toUpperCase().match(/^\[?(S\d{2})\]?$/)?.[1] ?? null;
  return { kind: "special-detail", badgeCode: code };
}

// 개인톡에서는 큐브 확률만 pass-free이며 나머지는 그룹톡 또는 활성 pass를 요구합니다.
export function canReadHomeBadgeReference(
  command: HomeBadgeReferenceCommand,
  context: { isGroupChat: boolean; hasActivePass: boolean }
): boolean {
  return command.kind === "cube-rate" || context.isGroupChat || context.hasActivePass;
}

// DB decimal을 legacy의 고정 소수점 한 자리 형식으로 변환합니다.
function formatCubePercent(value: string): string {
  return Number(value).toFixed(1) + "%";
}

// version-pinned 큐브 확률 snapshot을 legacy 안내 형식으로 변환합니다.
export function formatHomeBadgeCubeRates(snapshot: HomeBadgeReferenceSnapshot): string {
  const lines = [`[${snapshot.rankLabel}] 님`, "💟 홈뱃지 큐브 확률", "━━━━━━━━━━━━━━━"];
  for (const band of snapshot.cubeRateBands) {
    const min = Number(band.minPercent);
    if (band.sequence > 1 && [10.1, 15, 20, 30, 40, 45, 48].includes(min)) lines.push("");
    const range = band.minPercent === band.maxPercent
      ? formatCubePercent(band.minPercent)
      : `${formatCubePercent(band.minPercent)}~${formatCubePercent(band.maxPercent)}`;
    lines.push(`${range} : ${Number(band.ratePercent).toFixed(6)}%`);
  }
  lines.push("━━━━━━━━━━━━━━━");
  lines.push("구간을 먼저 추첨한 뒤 구간 안의 0.1% 단위를 같은 확률로 뽑습니다.");
  lines.push("추첨된 소수 첫째 자리 수치를 적용하며, 실패해도 달성한 1% 단위 보호선이 유지됩니다.");
  lines.push(`옵션별 최대 수치: ${snapshot.cubeOptions.map((option) => `${option.displayName} ${Number(option.maxPercent).toFixed(0)}%`).join(" / ")}`);
  lines.push("네 옵션의 기본 합계가 100% 이상이면 장착 시 모든 효과에 10% 추가 버프가 적용됩니다.");
  return lines.join("\n");
}

// version-pinned 등급률과 종수로 legacy 개별 뽑기 확률을 계산합니다.
export function formatHomeBadgeGachaRates(snapshot: HomeBadgeReferenceSnapshot): string {
  const lines = [`[${snapshot.rankLabel}] 님`, "🛡️ 홈뱃지 뽑기 확률", "━━━━━━━━━━━━━━━"];
  for (const grade of snapshot.gachaGradeRates) {
    const rate = Number(grade.ratePercent);
    const individual = grade.badgeCount > 0 ? rate / grade.badgeCount : 0;
    lines.push(`[${grade.grade}] ${rate}% | ${grade.badgeCount}종 | 각 ${individual.toFixed(2)}%`);
  }
  lines.push("━━━━━━━━━━━━━━━");
  lines.push("등급을 먼저 추첨한 뒤 같은 등급의 홈뱃지 중 한 종을 동일 확률로 뽑습니다.");
  return lines.join("\n");
}

// 특별 뱃지 snapshot을 legacy 목록 안내 형식으로 변환합니다.
export function formatSpecialHomeBadges(snapshot: HomeBadgeReferenceSnapshot): string {
  const lines = [`[${snapshot.rankLabel}] 님`, "🎖️ 특별 펫홈 뱃지 목록", "━━━━━━━━━━━━"];
  for (const badge of snapshot.specialBadges) lines.push(`[${badge.code}] ${badge.emoji} ${badge.displayName}`);
  lines.push("", "조회: /특별뱃지목록 [코드]", "지급: /특별뱃지지급 [아이디] [뱃지이름|코드]", "회수: /특별뱃지회수 [아이디] [뱃지이름|코드]", "※ 아이디 뒤 쉼표를 붙일 수 있고, 코드는 S01 또는 [S01]로 입력할 수 있습니다.");
  return lines.join("\n");
}

// 특별 뱃지 한 건을 legacy 상세 안내 형식으로 변환합니다.
export function formatSpecialHomeBadgeDetail(snapshot: HomeBadgeReferenceSnapshot, badgeCode: string): string {
  const badge = snapshot.specialBadges.find((candidate) => candidate.code === badgeCode);
  if (badge === undefined) return "❌ 존재하지 않는 특별 뱃지 코드입니다.\n/특별뱃지목록에서 S01~S13 코드를 확인해 주세요.";
  return `[${snapshot.rankLabel}] 님\n[${badge.code}] ${badge.emoji} ${badge.displayName}\n━━━━━━━━━━━━\n획득 조건: ${badge.acquisitionText}`;
}

export class HomeBadgeReferenceService {
  constructor(private readonly repository: HomeBadgeReferenceRepository) {}

  // 접근 경계 확인 후 하나의 snapshot으로 기준정보 응답을 생성합니다.
  async execute(input: {
    command: HomeBadgeReferenceCommand;
    providerCode: string;
    externalUserId: string;
    isGroupChat: boolean;
    hasActivePass: boolean;
  }): Promise<string | null> {
    if (!canReadHomeBadgeReference(input.command, input)) return null;
    if (input.command.kind === "special-detail" && input.command.badgeCode === null) {
      return "❌ 존재하지 않는 특별 뱃지 코드입니다.\n/특별뱃지목록에서 S01~S13 코드를 확인해 주세요.";
    }
    const snapshot = await this.repository.readActiveForIdentity(input.providerCode, input.externalUserId);
    if (snapshot === null) return null;
    if (input.command.kind === "cube-rate") return formatHomeBadgeCubeRates(snapshot);
    if (input.command.kind === "gacha-rate") return formatHomeBadgeGachaRates(snapshot);
    if (input.command.kind === "special-list") return formatSpecialHomeBadges(snapshot);
    return formatSpecialHomeBadgeDetail(snapshot, input.command.badgeCode!);
  }
}
