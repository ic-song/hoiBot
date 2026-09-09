import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { isMemberTicketTierRecalculateCommand, MemberTicketTierRecalculateService } from "./member-ticket-tier-recalculate-service.js";
import { isTierRosterReadCommand, TierRosterReadService } from "./tier-roster-read-service.js";

interface TierCommandInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

interface TierCommandResult {
  data: string;
  outboxId: string;
}

// 재계산과 두 조회를 하나의 partial-dispatch 후보로 묶습니다.
export function isTierCommandCandidate(message: string | undefined): boolean {
  return isMemberTicketTierRecalculateCommand(message) || isTierRosterReadCommand(message);
}

// exact 명령과 command registry handler가 일치하는지 판정합니다.
export function isTierCommandDispatch(message: string | undefined, handlerKey: string | undefined): boolean {
  return (message === "/티어적용" && handlerKey === "member_ticket_tier_recalculate")
    || (message === "/티어확인" && handlerKey === "tier_roster_read")
    || (message === "/티어순위" && handlerKey === "tier_rank_read");
}

// 세 티어 handler가 공용 adapter 대상인지 판정합니다.
export function isTierCommandHandler(handlerKey: string | undefined): boolean {
  return handlerKey === "member_ticket_tier_recalculate" || handlerKey === "tier_roster_read" || handlerKey === "tier_rank_read";
}

// 기존 재계산 서비스와 신규 읽기 서비스를 같은 app 실행 계약으로 노출합니다.
export function createTierCommandService(database: DatabaseClient, handlerKey: string | undefined): { handle(input: TierCommandInput): Promise<TierCommandResult> } {
  if (handlerKey === "member_ticket_tier_recalculate") return new MemberTicketTierRecalculateService(database);
  const service = new TierRosterReadService(database);
  return { handle: async (input) => {
    const result = await service.handle(input);
    if (result === null) throw new ApplicationError("FORBIDDEN", "연결된 회원만 티어 정보를 조회할 수 있습니다.", 403);
    return result;
  } };
}
