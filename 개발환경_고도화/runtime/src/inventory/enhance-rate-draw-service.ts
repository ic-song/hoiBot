import { ApplicationError } from "../shared/application-error.js";

export const ENHANCE_RATE_DRAW_COMMAND = "/강화뽑기";
export const ENHANCE_RATE_DRAW_MAX_COUNT = 1_000n;

export interface EnhanceRateDrawCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface EnhanceRateDrawResult {
  status: "drawn";
  playerId: string;
  data: string;
  resultData: string;
  outboxId: string;
  resultOutboxId: string;
  auditId: string;
  rateVersion: string;
  requestedCount: string;
  drawRewardCodes: string[];
  rewardCounts: Record<string, string>;
  duplicate?: boolean;
}

export interface EnhanceRateDrawRandomSource {
  next(): number;
}

export interface EnhanceRateDrawRepository {
  draw(
    command: EnhanceRateDrawCommand,
    requestedCount: bigint,
    random: EnhanceRateDrawRandomSource
  ): Promise<EnhanceRateDrawResult>;
}

// 강화 확률 뽑기의 정확한 무인자 또는 숫자 명령만 실행 후보로 판별합니다.
export function isEnhanceRateDrawCommandCandidate(message: string | undefined): boolean {
  return message === ENHANCE_RATE_DRAW_COMMAND
    || (message !== undefined && /^\/강화뽑기\s+\d+$/.test(message));
}

// 강화 확률 뽑기 수량을 읽고 안전한 실행 상한을 검증합니다.
export function readEnhanceRateDrawCount(message: string): bigint | null {
  if (message === ENHANCE_RATE_DRAW_COMMAND) return 1n;
  const match = /^\/강화뽑기\s+(\d+)$/.exec(message);
  if (match === null) return null;
  const count = BigInt(match[1]!);
  if (count < 1n) {
    throw new ApplicationError("ENHANCE_RATE_DRAW_COUNT_REQUIRED", "뽑기 횟수는 1회 이상이어야 합니다.", 422);
  }
  if (count > ENHANCE_RATE_DRAW_MAX_COUNT) {
    throw new ApplicationError(
      "ENHANCE_RATE_DRAW_COUNT_LIMIT",
      `한 번에 최대 ${ENHANCE_RATE_DRAW_MAX_COUNT.toString()}회까지 뽑을 수 있습니다.`,
      422
    );
  }
  return count;
}

// 강화 확률 뽑기 요청을 검증하고 DB 원자 처리 provider에 위임합니다.
export class EnhanceRateDrawService {
  constructor(
    private readonly repository: EnhanceRateDrawRepository,
    private readonly random: EnhanceRateDrawRandomSource = { next: Math.random }
  ) {}

  async handle(command: EnhanceRateDrawCommand): Promise<EnhanceRateDrawResult | { status: "ignored" }> {
    const count = readEnhanceRateDrawCount(command.message);
    if (count === null) return { status: "ignored" };
    return this.repository.draw(command, count, this.random);
  }
}
