import { ApplicationError } from "../shared/application-error.js";

export const ENHANCE_BOX_OPEN_COMMAND = "/강화박스오픈";
export const ENHANCE_BOX_OPEN_MAX_COUNT = 1_000n;

export interface EnhanceBoxOpenCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface EnhanceBoxOpenResult {
  status: "opened";
  playerId: string;
  data: string;
  outboxId: string;
  auditId: string;
  rateVersion: string;
  requestedCount: string;
  openedCount: string;
  totalReward: string;
  drawRewards: number[];
  duplicate?: boolean;
}

export interface EnhanceBoxOpenRandomSource {
  next(): number;
}

export interface EnhanceBoxOpenRepository {
  open(
    command: EnhanceBoxOpenCommand,
    requestedCount: bigint,
    random: EnhanceBoxOpenRandomSource
  ): Promise<EnhanceBoxOpenResult>;
}

// 강화박스 개봉 명령의 정확한 실행 후보만 판별합니다.
export function isEnhanceBoxOpenCommandCandidate(message: string | undefined): boolean {
  return message === ENHANCE_BOX_OPEN_COMMAND
    || (message !== undefined && /^\/강화박스오픈\s+\d+$/.test(message));
}

// 정확한 명령에서 개봉 요청 수량을 읽고 안전 상한을 검증합니다.
export function readEnhanceBoxOpenCount(message: string): bigint | null {
  if (message === ENHANCE_BOX_OPEN_COMMAND) return 1n;
  const match = /^\/강화박스오픈\s+(\d+)$/.exec(message);
  if (match === null) return null;
  const count = BigInt(match[1]!);
  if (count < 1n) {
    throw new ApplicationError("ENHANCE_BOX_OPEN_COUNT_REQUIRED", "개봉 개수는 1개 이상이어야 합니다.", 422);
  }
  if (count > ENHANCE_BOX_OPEN_MAX_COUNT) {
    throw new ApplicationError(
      "ENHANCE_BOX_OPEN_COUNT_LIMIT",
      `한 번에 최대 ${ENHANCE_BOX_OPEN_MAX_COUNT.toString()}개까지 개봉할 수 있습니다.`,
      422
    );
  }
  return count;
}

// 강화박스 요청을 검증한 뒤 MariaDB 원자 처리 provider로 위임합니다.
export class EnhanceBoxOpenService {
  constructor(
    private readonly repository: EnhanceBoxOpenRepository,
    private readonly random: EnhanceBoxOpenRandomSource = { next: Math.random }
  ) {}

  async handle(command: EnhanceBoxOpenCommand): Promise<EnhanceBoxOpenResult | { status: "ignored" }> {
    const requestedCount = readEnhanceBoxOpenCount(command.message);
    if (requestedCount === null) return { status: "ignored" };
    return this.repository.open(command, requestedCount, this.random);
  }
}
