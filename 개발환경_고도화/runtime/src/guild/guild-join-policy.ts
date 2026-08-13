export const GUILD_JOIN_TICKET_NAME = "길드가입권🍭(/길드가입 숫자)";

export interface GuildJoinCandidate {
  guildId: string;
  displayName: string;
  mark: string;
  serverCode: string;
  level: number;
  joinRequirementExperience: bigint;
  memberCount: number;
  maxMembers: number;
  recruitmentBonus: number;
  memberJoinClosed: boolean;
}

export interface GuildJoinEligibility {
  eligible: boolean;
  reason: "joinable" | "closed" | "full" | "experience_required";
}

// 길드가입 요청·확정·취소 후보만 DB 서비스로 전달합니다.
export function isGuildJoinCommandCandidate(message: string | undefined): boolean {
  return message?.startsWith("/길드가입") === true
    || message === "/가입한다" || message === "가입한다" || message === "/안한다";
}

// 길드가입 명령에서 안내문 뒤붙임을 허용하지 않고 양의 길드 번호만 추출합니다.
export function parseGuildJoinCommand(message: string): number | null {
  const match = /^\/길드가입\s+([1-9]\d*)$/.exec(message);
  if (match === null) return null;
  const guildNo = Number(match[1]);
  return Number.isSafeInteger(guildNo) ? guildNo : null;
}

// 레거시와 같은 길드가입 확정 별칭만 허용합니다.
export function isGuildJoinConfirmation(message: string): boolean {
  return message === "/가입한다" || message === "가입한다";
}

// 레거시와 같은 길드가입 취소 명령만 허용합니다.
export function isGuildJoinCancellation(message: string): boolean {
  return message === "/안한다";
}

// 징집명령 보정을 포함한 실제 길드 정원을 계산합니다.
export function getEffectiveGuildMemberLimit(candidate: GuildJoinCandidate): number {
  return candidate.maxMembers + candidate.recruitmentBonus;
}

// 길드 마감·정원·가입 EXP 조건을 한 곳에서 판정합니다.
export function evaluateGuildJoin(candidate: GuildJoinCandidate, playerExperience: bigint): GuildJoinEligibility {
  if (candidate.memberJoinClosed) return { eligible: false, reason: "closed" };
  if (candidate.memberCount >= getEffectiveGuildMemberLimit(candidate)) return { eligible: false, reason: "full" };
  if (playerExperience < candidate.joinRequirementExperience) return { eligible: false, reason: "experience_required" };
  return { eligible: true, reason: "joinable" };
}

// 가입 가능한 길드를 레거시 목록 번호와 같은 순서로 정렬합니다.
export function sortJoinableGuilds(candidates: readonly GuildJoinCandidate[]): GuildJoinCandidate[] {
  return candidates
    .filter((candidate) => evaluateGuildJoin(candidate, candidate.joinRequirementExperience).reason === "joinable")
    .sort((left, right) => {
      if (left.level !== right.level) return right.level - left.level;
      if (left.joinRequirementExperience !== right.joinRequirementExperience) {
        return left.joinRequirementExperience > right.joinRequirementExperience ? -1 : 1;
      }
      if (left.displayName < right.displayName) return -1;
      if (left.displayName > right.displayName) return 1;
      return 0;
    });
}

// 레거시 길드가입 확인 안내 문구를 그대로 구성합니다.
export function buildGuildJoinConfirmationMessage(rankLabel: string, candidate: GuildJoinCandidate): string {
  return `✅ [${rankLabel}] 님\n🎖️ ${candidate.displayName}(${candidate.mark}) 길드에 가입하실껀가요?\n\n👉 [가입한다] / [안한다]\n\n━━━━━━━━━━━━━━━\n※ [가입한다]을 입력하면 길드에 가입됩니다.`;
}

// 레거시 길드가입 완료 문구를 그대로 구성합니다.
export function buildGuildJoinCompletedMessage(candidate: GuildJoinCandidate): string {
  return `✅ 길드 가입 완료!\n길드: ${candidate.displayName}(${candidate.mark})[${candidate.serverCode}]`;
}

// 가입조건 미달 문구에 표시할 정수 EXP를 천 단위로 구분합니다.
export function buildGuildExperienceRequiredMessage(required: bigint, current: bigint): string {
  const format = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `❌ 가입조건 미달입니다.\n필요 EXP: ${format(required)} 이상\n내 EXP: ${format(current)}`;
}
