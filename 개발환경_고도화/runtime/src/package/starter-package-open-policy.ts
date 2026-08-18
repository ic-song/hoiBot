import { ApplicationError } from "../shared/application-error.js";

export interface StarterRewardDefinition {
  code: string;
  displayName: string;
  quantity: bigint;
}

export interface StarterPackageDefinition {
  stage: number;
  command: string;
  commandCode: string;
  packageCode: string;
  consumerCode: string;
  consumerDisplayName: string;
  rewards: readonly StarterRewardDefinition[];
  pointQuantity: bigint;
}

const item = (code: string, displayName: string, quantity: bigint): StarterRewardDefinition => ({ code, displayName, quantity });
const tierTicket = () => item("tier_upgrade_ticket", "티어 승급티켓🎟", 10n);
const petStone = () => item("pet_enhance_stone", "펫 강화석⭐", 200n);
const spiritStone = (quantity: bigint) => item("spirit_stone", "정령 강화석🥀", quantity);
const specialFood = (quantity: bigint) => item("pet_food_special", "펫먹이특식🥡(/특식오픈)", quantity);
const petFood = (quantity: bigint) => item("pet_food", "펫먹이🍼", quantity);

export const STARTER_PACKAGE_DEFINITIONS: readonly StarterPackageDefinition[] = [
  { stage: 1, command: "/초보오픈1", commandCode: "starter_package_open_01", packageCode: "starter_01", consumerCode: "starter_package_01", consumerDisplayName: "초보자 스타터패키지🌟[1](/초보오픈1)", rewards: [tierTicket(), spiritStone(100n), specialFood(30n), petFood(700n)], pointQuantity: 100000000n },
  { stage: 2, command: "/초보오픈2", commandCode: "starter_package_open_02", packageCode: "starter_02", consumerCode: "starter_package_02", consumerDisplayName: "초보자 스타터패키지🌟[2](/초보오픈2)", rewards: [tierTicket(), spiritStone(100n), specialFood(35n), petFood(700n)], pointQuantity: 100000000n },
  { stage: 3, command: "/초보오픈3", commandCode: "starter_package_open_03", packageCode: "starter_03", consumerCode: "starter_package_03", consumerDisplayName: "초보자 스타터패키지🌟[3](/초보오픈3)", rewards: [tierTicket(), petStone(), spiritStone(100n), specialFood(35n), petFood(700n)], pointQuantity: 100000000n },
  { stage: 4, command: "/초보오픈4", commandCode: "starter_package_open_04", packageCode: "starter_04", consumerCode: "starter_package_04", consumerDisplayName: "초보자 스타터패키지🌟[4](/초보오픈4)", rewards: [tierTicket(), petStone(), spiritStone(200n), specialFood(35n)], pointQuantity: 100000000n },
  { stage: 5, command: "/초보오픈5", commandCode: "starter_package_open_05", packageCode: "starter_05", consumerCode: "starter_package_05", consumerDisplayName: "초보자 스타터패키지🌟[5](/초보오픈5)", rewards: [tierTicket(), petStone(), spiritStone(200n), specialFood(35n), petFood(1000n)], pointQuantity: 100000000n },
  { stage: 6, command: "/초보오픈6", commandCode: "starter_package_open_06", packageCode: "starter_06", consumerCode: "starter_package_06", consumerDisplayName: "초보자 스타터패키지🌟[6](/초보오픈6)", rewards: [tierTicket(), item("lucky_box", "럭키박스🍀(/럭키오픈)", 30n), petStone(), spiritStone(200n), specialFood(35n), petFood(1000n)], pointQuantity: 100000000n }
] as const;

const byCommand = new Map(STARTER_PACKAGE_DEFINITIONS.map((definition) => [definition.command, definition]));

export function isStarterPackageOpenCommand(rawMessage: string | undefined): boolean {
  return rawMessage !== undefined && byCommand.has(rawMessage);
}

export function parseStarterPackageOpenCommand(rawMessage: string | undefined): StarterPackageDefinition {
  const definition = rawMessage === undefined ? undefined : byCommand.get(rawMessage);
  if (definition === undefined) {
    throw new ApplicationError("INVALID_STARTER_PACKAGE_OPEN_COMMAND", "올바른 초보 패키지 오픈 명령을 입력해주세요.", 422);
  }
  return definition;
}

export function buildStarterPackageOpenReply(definition: StarterPackageDefinition, rankLabel: string): string {
  const lines = [
    `초보자 스타터패키지🌟[${definition.stage}] 패키지오픈!!`, "",
    `${definition.stage === 1 ? "첫 후원자" : "후원자"} [${rankLabel}]님 감사합니다.`,
    "본 후원은 봇개발 기획 및 외주 비용입니다",
    "더욱더 좋은 커뮤니티 발전에 힘쓰겠습니다 😊", ""
  ];
  for (const reward of definition.rewards) lines.push(`${reward.displayName} ${reward.quantity}개`);
  lines.push("🅟100,000,000");
  return lines.join("\n");
}

export function buildStarterPackageRequiredReply(rankLabel: string): string {
  return `[${rankLabel}] 님\n후원관련은 밑에 링크를 확인해주세요.\nhttps://hoiland123.tistory.com`;
}
