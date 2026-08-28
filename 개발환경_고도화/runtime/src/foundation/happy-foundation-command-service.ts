import type { DatabaseClient } from "../database.js";
import { HappyFoundationCaptainService, isHappyFoundationCaptainCommand, normalizeHappyFoundationDispatchMessage as normalizeCaptainMessage } from "./happy-foundation-captain-service.js";
import { HappyFoundationTransferFeeService, isHappyFoundationTransferFeeCommand, normalizeHappyFoundationTransferFeeDispatchMessage } from "./happy-foundation-transfer-fee-service.js";

interface HappyFoundationInput { externalUserId: string; channelId: string; message: string; eventId: string; }

// 행복재단 단장·수수료·조회·이체 명령을 하나의 dispatch 경계로 묶습니다.
export function isHappyFoundationCommand(message: string | undefined): boolean {
  return isHappyFoundationCaptainCommand(message) || isHappyFoundationTransferFeeCommand(message);
}

// 행복재단 인자형 명령을 공용 command registry 별칭으로 정규화합니다.
export function normalizeHappyFoundationDispatchMessage(message: string): string {
  return isHappyFoundationCaptainCommand(message) ? normalizeCaptainMessage(message) : normalizeHappyFoundationTransferFeeDispatchMessage(message);
}

// 행복재단 하위 서비스를 명령 종류에 따라 안정적으로 위임합니다.
export class HappyFoundationCommandService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: HappyFoundationInput) {
    if (isHappyFoundationCaptainCommand(input.message)) return new HappyFoundationCaptainService(this.database).handle(input);
    return new HappyFoundationTransferFeeService(this.database).handle({ eventId: input.eventId, externalUserId: input.externalUserId, destinationId: input.channelId, message: input.message });
  }
}
