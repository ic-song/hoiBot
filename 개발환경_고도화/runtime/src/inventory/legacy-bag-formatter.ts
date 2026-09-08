import type { BagItemView, BagView } from "./bag.js";

const ALLSEE = "​".repeat(500);
const INTIMACY_ITEM = /^펫 친밀도🐾\s*\[Lv\.\d+\]\(\d+\/1000\)\+\d+💕$/;
const KOREAN = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;

export function compareLegacyBagItems(left: BagItemView, right: BagItemView): number {
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

// `generateBagOutput`은 첫 친밀도 key만 맨 앞에 두고, 0인 특수 item만
// JavaScript truthiness로 숨긴 뒤 나머지를 한글/비한글 code-unit 순으로 정렬합니다.
export function orderLegacyBagItems(items: readonly BagItemView[]): BagItemView[] {
  const firstIntimacyIndex = items.findIndex((item) => INTIMACY_ITEM.test(item.displayName));
  const firstIntimacy = firstIntimacyIndex < 0 ? [] : [items[firstIntimacyIndex]!];
  const special = items
    .filter((item, index) => index !== firstIntimacyIndex && item.legacyBagOrder !== null && BigInt(item.quantity) !== 0n)
    .sort((left, right) => left.legacyBagOrder! - right.legacyBagOrder!);
  const remaining = items.filter((item, index) => index !== firstIntimacyIndex && item.legacyBagOrder === null);
  const korean = remaining.filter((item) => KOREAN.test(item.displayName)).sort((left, right) => left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0);
  const nonKorean = remaining.filter((item) => !KOREAN.test(item.displayName)).sort((left, right) => left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0);
  return [...firstIntimacy, ...special, ...korean, ...nonKorean];
}

// 레거시 `/가방`의 순서, 줄바꿈, 광고와 접기 문자를 재현합니다.
export function formatLegacyBag(bag: BagView): string {
  if (bag.items.length === 0) return "가방이 비어 있습니다.";
  const items = orderLegacyBagItems(bag.items);

  let output = `[${bag.ownerLabel}]의 가방🧳\n`;
  if (items.length > 10) output += `(알림)${bag.advertisement}\n${ALLSEE}`;
  output += "(알림📢)후원은 봇 개발에 많은 도움이됩니다.\n";
  output += items.map((item, index) => `   ${index + 1}. ${item.displayName} x ${item.quantity}`).join("\n");
  return output.trimEnd();
}
