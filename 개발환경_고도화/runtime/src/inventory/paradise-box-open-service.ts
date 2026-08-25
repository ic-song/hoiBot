import { ApplicationError } from "../shared/application-error.js";

export const PARADISE_BOX_OPEN_COMMAND = "/극락오픈";
export const PARADISE_BOX_OPEN_MAX_COUNT = 1_000n;

export interface ParadiseBoxOpenCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface ParadiseBoxOpenResult {
  status: "opened";
  playerId: string;
  data: string;
  outboxId: string;
  auditId: string;
  rateVersion: string;
  requestedCount: string;
  openedCount: string;
  totalPoint: string;
  balanceAfter: string;
  drawPoints: string[];
  duplicate?: boolean;
}

export interface ParadiseBoxOpenRandomSource {
  next(): number;
}

export interface ParadiseBoxOpenRepository {
  open(
    command: ParadiseBoxOpenCommand,
    requestedCount: bigint,
    random: ParadiseBoxOpenRandomSource
  ): Promise<ParadiseBoxOpenResult>;
}

// 극락상자 개봉 명령의 정확한 실행 후보만 판별합니다.
export function isParadiseBoxOpenCommandCandidate(message: string | undefined): boolean {
  return message === PARADISE_BOX_OPEN_COMMAND
    || (message !== undefined && /^\/극락오픈\s+\d+$/.test(message));
}

// 정확한 명령에서 개봉 수량을 읽고 0과 과도한 반복을 차단합니다.
export function readParadiseBoxOpenCount(message: string): bigint | null {
  if (message === PARADISE_BOX_OPEN_COMMAND) return 1n;
  const match = /^\/극락오픈\s+(\d+)$/.exec(message);
  if (match === null) return null;
  const count = BigInt(match[1]!);
  if (count < 1n) {
    throw new ApplicationError("PARADISE_BOX_OPEN_COUNT_REQUIRED", "개봉 개수는 1개 이상이어야 합니다.", 422);
  }
  if (count > PARADISE_BOX_OPEN_MAX_COUNT) {
    throw new ApplicationError(
      "PARADISE_BOX_OPEN_COUNT_LIMIT",
      `한 번에 최대 ${PARADISE_BOX_OPEN_MAX_COUNT.toString()}개까지 개봉할 수 있습니다.`,
      422
    );
  }
  return count;
}

// 극락상자 요청을 검증한 뒤 MariaDB 원자 처리 provider로 위임합니다.
export class ParadiseBoxOpenService {
  constructor(
    private readonly repository: ParadiseBoxOpenRepository,
    private readonly random: ParadiseBoxOpenRandomSource = { next: Math.random }
  ) {}

  async handle(command: ParadiseBoxOpenCommand): Promise<ParadiseBoxOpenResult | { status: "ignored" }> {
    const requestedCount = readParadiseBoxOpenCount(command.message);
    if (requestedCount === null) return { status: "ignored" };
    return this.repository.open(command, requestedCount, this.random);
  }
}
