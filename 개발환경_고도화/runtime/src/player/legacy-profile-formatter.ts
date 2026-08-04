import type { ProfileView } from "./profile.js";

const ALL_SEE = "​".repeat(500);

// 정수·소수 문자열에 천 단위 구분자를 추가하되 정밀도를 바꾸지 않습니다.
function withCommas(value: string): string {
  const [integer, fraction] = value.split(".");
  const formatted = (integer ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction?.replace(/0+$/, "");
  return trimmedFraction === undefined || trimmedFraction === "" ? formatted : `${formatted}.${trimmedFraction}`;
}

// UTC 가입 시각을 기존 출력과 같은 한국 날짜 형식으로 표시합니다.
function formatKoreanDate(value: string | null): string {
  if (value === null) return "-";
  const kst = new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000);
  const year = String(kst.getUTCFullYear()).padStart(4, "0");
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${year}년 ${month}월 ${day}일`;
}

// ProfileView를 기존 `/내정보` KakaoTalk 문자열로 렌더링합니다.
export function formatLegacyMyProfile(profile: ProfileView): string {
  const level = BigInt(profile.level);
  const currentExperience = BigInt(profile.experience.current);
  const nextExperience = 6n * level + 84n;
  const experiencePercent = nextExperience > 0n ? currentExperience * 100n / nextExperience : 0n;
  const lifetimeLikes = profile.counters["like:lifetime"] ?? profile.counters["like0:lifetime"] ?? "0";
  const lines: string[] = [];
  if (profile.activeTitle !== null) lines.push(`• ${profile.activeTitle}`);
  if (profile.passes.some((pass) => pass.code === "premium" && pass.enabled)) lines.push("• [🐺호이패스 프리미엄🐺]");
  if (profile.server !== null) lines.push(`• ${profile.server.displayName}`);
  lines.push(profile.firstSponsor ? "• 🐹호이월드 후원자🐹" : "• 🐹호월 미후원자🐹");
  const rankLabel = profile.badges[0] ?? profile.displayName;
  lines.push(`• [${rankLabel}] 님의 종합 정보`);
  lines.push(`• 길드: ${profile.guild === null ? " 없음" : `${profile.guild.name}${profile.guild.mark === null ? "" : `(${profile.guild.mark})`}`}`);
  lines.push(`• 인생:${profile.rebirthCount}회차`);
  lines.push(`• 레벨: ${profile.level} (누적 레벨 : ${profile.accumulatedLevel})`);
  lines.push(`• 가입일: ${formatKoreanDate(profile.joinedAt)}`);
  lines.push(`• 총 출석일: ${profile.counters["attendance:lifetime"] ?? "0"}일`);
  lines.push(`• 다이아💎: ${withCommas(profile.currencies.diamond ?? "0")}개`);
  lines.push(`• 보유 포인트: 🅟${withCommas(profile.currencies.point ?? "0")}`);
  lines.push(`• 타이틀 개수: ${profile.titleCount}개`);
  lines.push(`• 펫타이틀 개수: ${profile.petTitleCount}개`);
  lines.push(`• 경험치: ${profile.experience.current} / ${nextExperience} (${experiencePercent}%)`);
  lines.push(`\n• ━ ✦ 내정보 상세보기 ✦ ━${ALL_SEE} `);
  lines.push(`\n• 💌 x ${profile.home?.likes ?? "0"} (순위 : ${profile.ranks.home_like ?? "null"}위)`);
  lines.push(`• 💕 x ${profile.counters["like:current"] ?? "0"} (누적 : ${lifetimeLikes})`);
  lines.push(`• 🥕 x ${profile.counters["carrot:lifetime"] ?? "0"} (순위 : ${profile.ranks.carrot === undefined ? "순위 없음" : `${profile.ranks.carrot}위`})`);
  lines.push(`• 🌡️ x ${profile.counters["thermo:lifetime"] ?? "0"} (순위 : ${profile.ranks.thermo === undefined ? "순위 없음" : `${profile.ranks.thermo}위`})`);
  lines.push(`• 펫: ${profile.pet === null ? "없음" : `${profile.pet.imageValue ?? ""}${profile.pet.name ?? ""} 💕${profile.pet.experience}`}`);
  if (profile.equippedMiniPet !== null) {
    lines.push(`• 미니펫🐹: ${profile.equippedMiniPet.name}${profile.equippedMiniPet.emoji ?? ""}(+${withCommas(profile.equippedMiniPet.battleExperience)}💕)[${profile.equippedMiniPet.gradeDisplayName ?? ""}]`);
  }
  if (profile.home !== null) lines.push(`• 펫스윗홈🏡: ${profile.home.name ?? "없음"}(+${withCommas(profile.home.charm)}💕)[+${profile.home.floorArea}평]`);
  return lines.join("\n");
}
