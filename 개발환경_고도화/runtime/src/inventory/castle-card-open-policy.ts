import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/application-error.js";

export interface CastleCardRewardDefinition {
  code: string;
  displayName: string;
  upperExclusive: number | null;
  quantity: bigint;
  specialMessage?: string;
}

export interface ParsedCastleCardOpenCommand {
  rawMessage: string;
  parseMode: "exact_default_one" | "single_space_number" | "tab_default_one";
  openCount: number;
}

export interface CastleCardRandomSource { next(): number; }

export interface CastleCardRoll {
  rollIndex: number;
  chance: number;
  rewardCode: string;
  rewardName: string;
  quantity: string;
  special: boolean;
}

export interface CastleCardAggregate {
  rewardCode: string;
  rewardName: string;
  quantity: string;
}

export interface CastleCardOpenPlan {
  rawMessage: string;
  parseMode: ParsedCastleCardOpenCommand["parseMode"];
  openCount: number;
  rngSeed: string;
  rngTrace: CastleCardRoll[];
  aggregates: CastleCardAggregate[];
  immediateReply: string;
  delayedReply: string;
  specialNotices: string[];
}

export const CASTLE_CARD_COMMAND = "/카드오픈" as const;
export const CASTLE_CARD_COMMAND_CODE = "castle_card_open" as const;
// 부족 문구의 캐슬카드가 아니라 실제 Rhino 소비 key를 그대로 사용합니다.
export const CASTLE_CARD_CONSUMER = {
  code: "pet_food_special",
  displayName: "펫먹이특식🥡(/특식오픈)",
  replyName: "펫먹이특식🥡",
  shortageName: "캐슬카드🃏"
} as const;

export const CASTLE_CARD_REWARDS: readonly CastleCardRewardDefinition[] = [
  { code: "castle_immortal_unit", displayName: "캐슬불멸유닛🐉(+1500💕)", upperExclusive: 0.0003, quantity: 1n, specialMessage: "🌟 초대박!! 불멸유닛 등장!! 🌟" },
  { code: "castle_myth_unit", displayName: "캐슬신화유닛🧚🏻‍♀(+1000💕)", upperExclusive: 0.001, quantity: 1n, specialMessage: "✨ 신화급 유닛 등장!! ✨" },
  { code: "castle_legend_unit", displayName: "캐슬전설유닛🧝🏻‍♀(+500💕)", upperExclusive: 0.004, quantity: 1n },
  { code: "castle_hero_unit", displayName: "캐슬영웅유닛💠(+300💕)", upperExclusive: 0.014, quantity: 1n },
  { code: "castle_unique_unit", displayName: "캐슬유니크유닛👑(+200💕)", upperExclusive: 0.044, quantity: 1n },
  { code: "castle_rare_unit", displayName: "캐슬레어유닛⭐(+100💕)", upperExclusive: 0.114, quantity: 1n },
  { code: "pet_food", displayName: "펫먹이🍼", upperExclusive: 0.164, quantity: 4n },
  { code: "pet_food_box", displayName: "펫먹이상자📦(/상자오픈)", upperExclusive: 0.314, quantity: 1n },
  { code: "trash_box", displayName: "잡템상자☠", upperExclusive: null, quantity: 1n }
] as const;

export function isCastleCardOpenCommandCandidate(rawMessage: string | undefined): boolean {
  return rawMessage === CASTLE_CARD_COMMAND || (rawMessage !== undefined && /^\/카드오픈\s+\d+$/.test(rawMessage));
}

export function parseCastleCardOpenCommand(rawMessage: string | undefined): ParsedCastleCardOpenCommand {
  if (!isCastleCardOpenCommandCandidate(rawMessage)) {
    throw new ApplicationError("INVALID_CASTLE_CARD_OPEN_COMMAND", "올바른 카드 오픈 명령을 입력해주세요.", 422);
  }
  const message = rawMessage!;
  const args = message.trim().split(" ");
  if (args.length >= 2) {
    const openCount = Number.parseInt(args[1]!, 10);
    if (Number.isNaN(openCount) || openCount <= 0) {
      throw new ApplicationError("CASTLE_CARD_OPEN_COUNT_REQUIRED", "❌ 숫자를 올바르게 입력해주세요. 예: /카드오픈 3", 422);
    }
    return { rawMessage: message, parseMode: "single_space_number", openCount };
  }
  return {
    rawMessage: message,
    parseMode: message === CASTLE_CARD_COMMAND ? "exact_default_one" : "tab_default_one",
    openCount: 1
  };
}

export function castleCardSeed(eventId: string): string {
  return createHash("sha256").update(`${eventId}\u0000${CASTLE_CARD_COMMAND_CODE}`).digest("hex");
}

export function castleCardRandom(seed: string): CastleCardRandomSource {
  let rollIndex = 0;
  return {
    next() {
      const digest = createHash("sha256").update(`${seed}:${rollIndex++}`).digest();
      return digest.readUIntBE(0, 6) / 281474976710656;
    }
  };
}

export function selectCastleCardReward(chance: number): CastleCardRewardDefinition {
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new Error("Castle card RNG must return a finite value between 0 and 1.");
  }
  return CASTLE_CARD_REWARDS.find((reward) => reward.upperExclusive === null || chance < reward.upperExclusive)!;
}

export function planCastleCardOpen(input: {
  parsed: ParsedCastleCardOpenCommand;
  rankLabel: string;
  rngSeed: string;
  random: CastleCardRandomSource;
}): CastleCardOpenPlan {
  const rngTrace: CastleCardRoll[] = [];
  const aggregateOrder: string[] = [];
  const quantities = new Map<string, bigint>();
  const specialNotices: string[] = [];
  for (let rollIndex = 0; rollIndex < input.parsed.openCount; rollIndex++) {
    const chance = input.random.next();
    const reward = selectCastleCardReward(chance);
    if (!quantities.has(reward.code)) aggregateOrder.push(reward.code);
    quantities.set(reward.code, (quantities.get(reward.code) ?? 0n) + reward.quantity);
    rngTrace.push({
      rollIndex, chance, rewardCode: reward.code, rewardName: reward.displayName,
      quantity: reward.quantity.toString(), special: reward.specialMessage !== undefined
    });
    if (reward.specialMessage !== undefined) {
      specialNotices.push(`${reward.specialMessage}\n[${input.rankLabel}] 님이 ${reward.displayName}을(를) 획득했습니다! 🎉`);
    }
  }
  const byCode = new Map(CASTLE_CARD_REWARDS.map((reward) => [reward.code, reward]));
  const aggregates = aggregateOrder.map((rewardCode) => ({
    rewardCode,
    rewardName: byCode.get(rewardCode)!.displayName,
    quantity: quantities.get(rewardCode)!.toString()
  }));
  const rewardLines = aggregates.map((reward) => `🎁 ${reward.rewardName} x ${reward.quantity}`).join("\n");
  return {
    rawMessage: input.parsed.rawMessage,
    parseMode: input.parsed.parseMode,
    openCount: input.parsed.openCount,
    rngSeed: input.rngSeed,
    rngTrace,
    aggregates,
    immediateReply: `[${input.rankLabel}] 님이 ${CASTLE_CARD_CONSUMER.replyName}을 ${input.parsed.openCount}개 오픈합니다...`,
    delayedReply: `[${input.rankLabel}] 님의 보상 결과:\n${rewardLines}`,
    specialNotices
  };
}
