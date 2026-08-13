export type GuildJoinConditionCommand =
  | { kind: "ignored" }
  | { kind: "usage" }
  | { kind: "invalid" }
  | { kind: "change"; experience: bigint };

const COMMAND = "/길드가입조건";
const MAX_EXPERIENCE_DIGITS = 30;

// 길드가입조건 명령 후보만 Iris dispatch 대상으로 분류합니다.
export function isGuildJoinConditionCommandCandidate(message: string): boolean {
  return message === COMMAND || message.indexOf(COMMAND + " ") === 0;
}

// 숫자 한 개만 허용하고 쉼표 표기는 천 단위 형식일 때만 정규화합니다.
export function parseGuildJoinConditionCommand(message: string): GuildJoinConditionCommand {
  if (message === COMMAND) return { kind: "usage" };
  if (!isGuildJoinConditionCommandCandidate(message)) return { kind: "ignored" };
  const match = /^\/길드가입조건\s+((?:\d{1,3}(?:,\d{3})+)|(?:\d+))$/.exec(message);
  if (match === null) return { kind: "invalid" };
  const digits = match[1]!.replace(/,/g, "");
  if (digits.length > MAX_EXPERIENCE_DIGITS) return { kind: "invalid" };
  return { kind: "change", experience: BigInt(digits) };
}

// 저장된 EXP 조건을 레거시 성공 답장 형식으로 표시합니다.
export function buildGuildJoinConditionChangedMessage(experience: bigint): string {
  const display = experience === 0n ? "제한없음" : experience.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " EXP 이상";
  return "✅ 길드 가입조건이 변경되었습니다.\n가입조건: " + display;
}
