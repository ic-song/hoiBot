import { createHash } from "node:crypto";

export interface FixedRangeBoxDefinition {
  command: "/정령오픈" | "/치킨오픈";
  commandCode: "spirit_box_open" | "chicken_box_open";
  boxCode: "spirit_box" | "chicken_box";
  boxName: "정령상자🥀" | "치킨상자🐔";
  rewardCode: "spirit_fragment" | "seasoned_chicken";
  rewardName: "정령조각🥀" | "양념치킨🐔";
}

export interface ParsedFixedRangeBoxCommand {
  definition: FixedRangeBoxDefinition;
  rawMessage: string;
  parseMode: "exact_default_one" | "single_space_number" | "multi_space_all" | "whitespace_default_one";
  requestedOpenCount: number | null;
}

export interface FixedRangeRandomSource { next(): number; }

export interface FixedRangeBoxPlan {
  commandCode: FixedRangeBoxDefinition["commandCode"];
  rawMessage: string;
  parseMode: ParsedFixedRangeBoxCommand["parseMode"];
  requestedOpenCount: number | null;
  effectiveOpenCount: number;
  rngSeed: string;
  rngTrace: number[];
  totalQuantity: bigint;
  boxBefore: bigint;
  boxAfter: bigint;
  rewardBefore: bigint;
  rewardAfter: bigint;
  createRewardZeroStack: boolean;
  reply: string;
}

export const FIXED_RANGE_BOX_DEFINITIONS: readonly FixedRangeBoxDefinition[] = [
  { command: "/정령오픈", commandCode: "spirit_box_open", boxCode: "spirit_box", boxName: "정령상자🥀", rewardCode: "spirit_fragment", rewardName: "정령조각🥀" },
  { command: "/치킨오픈", commandCode: "chicken_box_open", boxCode: "chicken_box", boxName: "치킨상자🐔", rewardCode: "seasoned_chicken", rewardName: "양념치킨🐔" }
] as const;

// Rhino의 split(" ") 분기까지 포함해 원문 공백별 오픈 수를 재현합니다.
export function parseFixedRangeBoxCommand(rawMessage: string | undefined): ParsedFixedRangeBoxCommand | null {
  if (rawMessage === undefined) return null;
  for (const definition of FIXED_RANGE_BOX_DEFINITIONS) {
    if (rawMessage === definition.command) {
      return { definition, rawMessage, parseMode: "exact_default_one", requestedOpenCount: 1 };
    }
    const guard: RegExp = new RegExp(`^${definition.command}\\s+\\d+$`);
    if (!guard.test(rawMessage)) continue;
    const args = rawMessage.split(" ");
    if (args.length > 1 && !Number.isNaN(Number(args[1]))) {
      const parsed = Number.parseInt(args[1]!, 10);
      if (Number.isNaN(parsed)) {
        return { definition, rawMessage, parseMode: "multi_space_all", requestedOpenCount: null };
      }
      return { definition, rawMessage, parseMode: "single_space_number", requestedOpenCount: parsed };
    }
    return { definition, rawMessage, parseMode: "whitespace_default_one", requestedOpenCount: 1 };
  }
  return null;
}

export function isFixedRangeBoxCommandCandidate(rawMessage: string | undefined): boolean {
  return parseFixedRangeBoxCommand(rawMessage) !== null;
}

export function fixedRangeSeed(eventId: string, commandCode: string): string {
  return createHash("sha256").update(`${eventId}\u0000${commandCode}`).digest("hex");
}

// seed와 roll index만으로 재시작 후에도 동일한 난수열을 생성합니다.
export function fixedRangeRandom(seed: string): FixedRangeRandomSource {
  let rollIndex = 0;
  return {
    next() {
      const digest = createHash("sha256").update(`${seed}:${rollIndex++}`).digest();
      return digest.readUIntBE(0, 6) / 281474976710656;
    }
  };
}

// 잠긴 잔여 상자 수를 기준으로 5~10 보상 trace와 legacy 응답을 계산합니다.
export function planFixedRangeBoxOpen(input: {
  parsed: ParsedFixedRangeBoxCommand;
  boxQuantity: bigint;
  rewardQuantity: bigint;
  rewardStackExists: boolean;
  rankLabel: string;
  rngSeed: string;
  random: FixedRangeRandomSource;
}): FixedRangeBoxPlan {
  const requested = input.parsed.requestedOpenCount;
  const requestedCount = requested === null ? input.boxQuantity : BigInt(requested);
  const effective = requestedCount > input.boxQuantity ? input.boxQuantity : requestedCount;
  const effectiveOpenCount = Number(effective);
  const rngTrace: number[] = [];
  let totalQuantity = 0n;
  for (let rollIndex = 0; rollIndex < effectiveOpenCount; rollIndex++) {
    const raw = input.random.next();
    if (!Number.isFinite(raw) || raw < 0 || raw > 1) throw new Error("Fixed range RNG must return a finite value between 0 and 1.");
    const normalized = raw === 1 ? 1 - Number.EPSILON : raw;
    const reward = Math.floor(normalized * 6) + 5;
    rngTrace.push(reward);
    totalQuantity += BigInt(reward);
  }
  const boxAfter = input.boxQuantity - effective;
  const rewardAfter = input.rewardQuantity + totalQuantity;
  return {
    commandCode: input.parsed.definition.commandCode,
    rawMessage: input.parsed.rawMessage,
    parseMode: input.parsed.parseMode,
    requestedOpenCount: requested,
    effectiveOpenCount,
    rngSeed: input.rngSeed,
    rngTrace,
    totalQuantity,
    boxBefore: input.boxQuantity,
    boxAfter,
    rewardBefore: input.rewardQuantity,
    rewardAfter,
    createRewardZeroStack: effectiveOpenCount === 0 && !input.rewardStackExists,
    reply: `${input.parsed.definition.boxName} ${effectiveOpenCount}개 오픈!!\n[${input.rankLabel}] 님 ${input.parsed.definition.rewardName} ${totalQuantity}개 획득`
  };
}
