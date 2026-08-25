import type { BagItemView, BagView } from "./bag.js";

const ALLSEE = "​".repeat(500);
const INTIMACY_ITEM = /^펫 친밀도🐾\s*\[Lv\.\d+\]\(\d+\/1000\)\+\d+💕$/;
const KOREAN = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;

export function compareLegacyItems(left: BagItemView, right: BagItemView): number {
  const leftIntimacy = INTIMACY_ITEM.test(left.displayName);
  const rightIntimacy = INTIMACY_ITEM.test(right.displayName);
  if (leftIntimacy !== rightIntimacy) return leftIntimacy ? -1 : 1;

  const leftSpecial = left.legacyBagOrder !== null;
  const rightSpecial = right.legacyBagOrder !== null;
  if (leftSpecial !== rightSpecial) return leftSpecial ? -1 : 1;
  if (leftSpecial && rightSpecial) return left.legacyBagOrder! - right.legacyBagOrder!;

  const leftKorean = KOREAN.test(left.displayName);
  const rightKorean = KOREAN.test(right.displayName);
  if (leftKorean !== rightKorean) return leftKorean ? -1 : 1;
  return left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0;
}

// 표시와 mutation이 같은 순서를 사용하도록 레거시 가방 정렬 복사본을 반환합니다.
export function sortLegacyBagItems(items: BagItemView[]): BagItemView[] {
  return items.filter((item) => BigInt(item.quantity) > 0n).sort(compareLegacyItems);
}

// 레거시 `/가방`의 순서, 줄바꿈, 광고와 접기 문자를 재현합니다.
export function formatLegacyBag(bag: BagView): string {
  const items = sortLegacyBagItems(bag.items);
  if (items.length === 0) return "가방이 비어 있습니다.";

  let output = `[${bag.ownerLabel}]의 가방🧳\n`;
  if (items.length > 10) output += `(알림)${bag.advertisement}\n${ALLSEE}`;
  output += "(알림📢)후원은 봇 개발에 많은 도움이됩니다.\n";
  output += items.map((item, index) => `   ${index + 1}. ${item.displayName} x ${item.quantity}`).join("\n");
  return output;
}
