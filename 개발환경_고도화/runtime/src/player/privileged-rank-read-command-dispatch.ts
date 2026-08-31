import type { DatabaseClient } from "../database.js";
import { isPlayerCumulativeLevelRankReadCommand } from "./player-cumulative-level-rank-read-service.js";
import { isPlayerCumulativeLikeRankReadCommand } from "./player-cumulative-like-rank-read-service.js";
import { isPlayerDiamondRankReadCommand } from "./player-diamond-rank-read-service.js";
import { isPlayerLevelRankReadCommand } from "./player-level-rank-read-service.js";
import { isPlayerVerificationRankReadCommand, PlayerVerificationRankReadService } from "./player-verification-rank-read-service.js";
import { isPrivilegedPointRankReadCommand, PrivilegedPointRankReadService } from "./privileged-point-rank-read-service.js";

interface PrivilegedRankReadResult {
  data: string;
  outboxId: string;
}

interface PrivilegedRankReadService {
  read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<PrivilegedRankReadResult | null>;
}

// 기존 인증순위와 관리자 포인트순위를 하나의 좁은 dispatch 후보로 묶습니다.
export function isPrivilegedRankReadCommand(message: string | undefined): boolean {
  return isPlayerVerificationRankReadCommand(message) || isPrivilegedPointRankReadCommand(message);
}

// 모든 exact 회원 순위 조회를 공용 partial-dispatch 후보 하나로 축약합니다.
export function isPlayerRankReadCommandCandidate(message: string | undefined): boolean {
  return isPlayerCumulativeLevelRankReadCommand(message)
    || isPlayerCumulativeLikeRankReadCommand(message)
    || isPlayerDiamondRankReadCommand(message)
    || isPlayerLevelRankReadCommand(message)
    || isPrivilegedRankReadCommand(message);
}

// exact 명령과 command registry handler가 같은 관리자 순위 조회인지 판정합니다.
export function isPrivilegedRankReadDispatch(message: string | undefined, handlerKey: string | undefined): boolean {
  return (isPlayerVerificationRankReadCommand(message) && handlerKey === "player_verification_rank_read")
    || (isPrivilegedPointRankReadCommand(message) && handlerKey === "privileged_point_rank_read");
}

// 검증 횟수와 포인트 순위가 각자의 기존 권한·조회 서비스를 유지하도록 선택합니다.
export function createPrivilegedRankReadService(database: DatabaseClient, handlerKey: string | undefined): PrivilegedRankReadService {
  return handlerKey === "player_verification_rank_read"
    ? new PlayerVerificationRankReadService(database)
    : new PrivilegedPointRankReadService(database);
}
