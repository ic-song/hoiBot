import { ApplicationError } from "../shared/application-error.js";
import type { PetInfoRepository, PetInfoView } from "./pet-info.js";

const ALL_SEE = "​".repeat(500);

export interface PetInfoReply { data: string; }

// `/펫정보`와 기존 두 별칭만 정확히 허용합니다.
export function isPetInfoCommand(message: string | undefined): boolean {
  return message === "/펫정보" || message === "/ㅎ" || message === "ㅁㅁㅁ";
}

// 정수 문자열을 기존 쉼표 표기로 변환합니다.
function withCommas(value: string): string { return value.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 큰 매력값을 기존 만·억 약식 표기로 변환합니다.
function koreanShort(value: string): string {
  const number = BigInt(value);
  if (number >= 100000000n) {
    const tenth = number * 10n / 100000000n;
    return tenth % 10n === 0n ? `${withCommas((tenth / 10n).toString())}억` : `${withCommas((tenth / 10n).toString())}.${tenth % 10n}억`;
  }
  if (number >= 10000n) return `${withCommas((number / 10000n).toString())}만`;
  return withCommas(value);
}

// 일일 기록 한 줄을 완료 또는 사용량 표기로 만듭니다.
function doneLine(label: string, used: string, max: bigint, detail: string): string {
  return BigInt(used) >= max ? `${label}[✅완료]: ${detail}` : `${label}[${used}/${max}]: ${detail}`;
}

// 신규·기본 티어의 기존 새싹 표시를 보존하고 미정 코드는 이름만 표시합니다.
function rankedName(view: PetInfoView): string {
  return `${view.tierCode === "seedling" || view.tierCode === "starter" ? "🌱" : ""}${view.displayName}`;
}

// 정규화된 PetInfoView를 기존 `/펫정보`의 두 답장 구조로 렌더링합니다.
export function formatLegacyPetInfo(view: PetInfoView, guideIndex = 0): PetInfoReply[] {
  const miniWins = BigInt(view.daily.miniWins); const miniLosses = BigInt(view.daily.miniLosses);
  const miniTotal = miniWins + miniLosses;
  const miniRate = miniTotal === 0n ? "0.00" : (Number(miniWins) / Number(miniTotal) * 100).toFixed(2);
  const weekly = BigInt(view.daily.weeklyQuestCount) > 7n ? 7n : BigInt(view.daily.weeklyQuestCount);
  const weeklyRemain = 7n - weekly;
  const weeklyText = weeklyRemain <= 0n ? "주간 보상 수령 가능✅" : `주간 보상까지 ${weeklyRemain}번 일퀘 남음`;
  const guides = ["('/정리' or 'ㅇㅇㅇ'만 해도 자동지급!)", "(👉전부 ✅ /퀘스트완료 or /ㅇ 시 보상지급!)", "(일일퀘스트 7번을 완료하면 주간보상!)", `(${weeklyText})`];
  const petHomeCommentComplete = BigInt(view.daily.petHomeCommentCount) >= 1n;
  const feedPostComplete = BigInt(view.daily.feedPostCount) >= 1n;
  const homeAlertComplete = BigInt(view.daily.homeAlertOpenCount) >= 1n;
  const lines: string[] = [];
  if (view.title !== null) lines.push(`⭒━${view.title}━⭒`);
  lines.push(`[${rankedName(view)}]의 펫정보🐶${view.charm.rank === null ? "" : `(${view.charm.rank}등👑)`}`);
  lines.push(`이름📝: ${view.pet.name} ${view.pet.image ?? ""} | 속성♻️: ${view.pet.typeName ?? view.pet.typeCode ?? ""}`);
  lines.push(`성격😶: ${view.pet.personality ?? ""}`);
  lines.push(`펫 친밀도🐾 [Lv.${view.intimacy.level}](${view.intimacy.rank === null ? "순위없음" : `${view.intimacy.rank}등🍼`})`);
  lines.push("━━━ ✦ 종합 스탯 ✦ ━━━");
  lines.push(`종합매력👑: ${koreanShort(view.charm.total)}💞`);
  lines.push(`└ 합산: 캐슬매력⚔️: ${koreanShort(view.charm.castle)}`);
  lines.push(` └ 레이드매력👾: ${koreanShort(view.charm.raid)}`);
  lines.push(`펫강화⭐️: ${view.charm.effectiveEnhancement}강(💥${view.charm.criticalChance}%)[${view.charm.criticalMultiplier}배]`);
  lines.push(`펫스킬📙: [장착중 ${view.skill.equipped}/${view.skill.slots}] "/펫스킬"`);
  lines.push("━ ✦ (일일주간 · 장비 상세보기) ✦ ━ ");
  lines.push(`[😈${BigInt(view.daily.towerAttempts) >= 15n ? "✅" : "❌"}][🏆${BigInt(view.daily.castleAttempts) >= 15n ? "✅" : "❌"}][🐹${BigInt(view.daily.miniAttempts) >= 15n ? "✅" : "❌"}][⛰️${BigInt(view.daily.exploreAttempts) >= 10n ? "✅" : "❌"}]`);
  if (view.pass.base || view.pass.premium) lines.push(`${view.pass.premium ? "[🐺호프 전용]" : "[🐶호패 전용]"}[💬${petHomeCommentComplete ? "✅" : "❌"}][✍️${feedPostComplete ? "✅" : "❌"}][🔔${homeAlertComplete ? "✅" : "❌"}]`);
  lines.push(view.daily.dailyQuestRewarded ? "[🅾️일일퀘스트 보상지급 완료🅾️]" : "[❌일일퀘스트 보상지급 미완료❌]");
  lines.push(guides[Math.abs(guideIndex) % guides.length]! + ALL_SEE);
  lines.push("━━━ ✦ 장비 정보 ✦ ━━━");
  if (view.elemental !== null) lines.push(`정령🔯: ${view.elemental.name}[${view.elemental.grade}](+${view.elemental.enhancement})`);
  lines.push(view.pendant === null ? "펜던트💎: 현재 펜던트가 없습니다." : `펜던트💎: ${view.pendant.name}[${view.pendant.grade}]${view.pendant.durability === null || view.pendant.maxDurability === null ? "" : `[⚒️${view.pendant.durability}/${view.pendant.maxDurability}]`}(+${view.pendant.enhancement})`);
  lines.push(view.miniPet === null ? "미니펫🐹: 펫 나만 없어.." : `미니🐹: ${view.miniPet.name}${view.miniPet.emoji ?? ""}(+${withCommas(view.miniPet.battleCharm)}💕)[${view.miniPet.grade ?? ""}]${view.miniPet.enhancement === "0" ? "" : `(+${view.miniPet.enhancement}💫)`}`);
  if (view.home !== null) lines.push(`펫홈🏡: ${view.home.name}(+${withCommas(view.home.charm)}💕)[+${view.home.floorArea}평]`);
  lines.push("━ ✦ (일일 · 주간 퀘스트 상세정보) ✦ ━ ");
  lines.push(doneLine("시련탑😈", view.daily.towerAttempts, 15n, `${view.daily.towerFloor}층 공략`));
  lines.push(doneLine("캐대전🏆", view.daily.castleAttempts, 15n, `${withCommas(view.daily.castleScore)}pt(${view.daily.castleRank ?? "-"})`));
  lines.push(doneLine("미대전🐹", view.daily.miniAttempts, 15n, `${withCommas(view.daily.miniWins)}승(${miniRate}%)`));
  lines.push(doneLine("펫탐험⛰️", view.daily.exploreAttempts, 10n, `${withCommas(view.daily.exploreWins)}승 (순위: 순위없음)`));
  lines.push("━━━━━━━━━━━━━━━━"); lines.push("【 🐶호이,초보패스🐥전용 일퀘 조건 】"); lines.push("━━━━━━━━━━━━━━━━");
  if (view.pass.base || view.pass.premium) {
    lines.push(doneLine("펫홈 댓글 달성📝", view.daily.petHomeCommentCount, 1n, "패스 전용"));
    lines.push(doneLine("피드 글 작성✍️", view.daily.feedPostCount, 1n, "패스 전용"));
    lines.push(doneLine("홈알림 열기🔔", view.daily.homeAlertOpenCount, 1n, "패스 전용"));
  } else {
    lines.push("펫홈 댓글 달성📝[호패,초패 회원전용]"); lines.push("피드 글 작성✍️[호패,초패 회원전용]"); lines.push("홈알림 열기🔔[호패,초패 회원전용]");
  }
  lines.push(`주간퀘스트🦋[${weekly}/7]: ${weeklyText}`);
  return [{ data: view.pet.image ?? "" }, { data: lines.join("\n") }];
}

// 외부 identity로 펫정보를 조회하고 legacy formatter에 전달합니다.
export class GetPetInfoService {
  constructor(private readonly repository: PetInfoRepository, private readonly guideRandom: () => number = Math.random) {}
  async execute(providerCode: string, externalUserId: string): Promise<PetInfoReply[]> {
    const view = await this.repository.findByExternalIdentity(providerCode, externalUserId);
    if (view === null) throw new ApplicationError("PET_NOT_FOUND", "펫을 먼저 생성해주세요.", 404);
    return formatLegacyPetInfo(view, Math.floor(this.guideRandom() * 4));
  }
}
