import type { OwnedMiniPetProjection } from "./catalog-projection-repository.js";

const ALLSEE = "\u200b".repeat(500);

// 인자 없는 장착 미니펫 순위 명령만 실행 대상으로 인정합니다.
export function isMiniPetEquippedRankReadCommand(message: string | undefined): boolean {
  return message === "/미니펫순위";
}

// version-pinned 순위를 legacy 제목·순번·11번째 allsee 형식으로 출력합니다.
export function formatMiniPetEquippedRank(owned: OwnedMiniPetProjection[]): string {
  const lines = ["🏆 미니펫 종합 순위 🏆"];
  owned.forEach((item, index) => {
    if (index === 10) lines.push(ALLSEE);
    lines.push(`${index + 1}위. ${item.ownerCheckRank || item.ownerDisplayName} | ${item.emoji}${item.name} | ${item.grade} | EXP ${item.experience}`);
  });
  return lines.join("\n");
}
