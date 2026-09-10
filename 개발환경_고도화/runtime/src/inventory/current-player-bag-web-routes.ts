import type { FastifyInstance } from "fastify";
import { ApplicationError } from "../shared/application-error.js";
import type { UserAuthService } from "../user-auth/user-auth-service.js";
import { CurrentPlayerBagService, type CurrentPlayerBagRepository } from "./current-player-bag-service.js";

interface CurrentPlayerBagWebDependencies {
  auth: Pick<UserAuthService, "refreshSession">;
  bags: CurrentPlayerBagRepository;
}

interface CurrentPlayerBagQuery {
  limit?: string;
  offset?: string;
}

const USER_SESSION_COOKIE = "hoibot_user_session";

// 쿼리 문자열을 서비스가 검증할 수 있는 안전한 정수로 변환합니다.
function readPageInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new ApplicationError("BAG_PAGINATION_INVALID", "가방 페이지 범위를 확인해 주세요.", 422);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApplicationError("BAG_PAGINATION_INVALID", "가방 페이지 범위를 확인해 주세요.", 422);
  }
  return parsed;
}

// 인증 세션의 현재 player_id만 사용해 가방 read API를 등록합니다.
export async function registerCurrentPlayerBagWebRoutes(
  app: FastifyInstance,
  dependencies: CurrentPlayerBagWebDependencies
): Promise<void> {
  const service = new CurrentPlayerBagService(dependencies.bags);
  app.get<{ Querystring: CurrentPlayerBagQuery }>("/api/v1/inventory/current", async (request) => {
    const refreshed = await dependencies.auth.refreshSession(request.cookies[USER_SESSION_COOKIE] ?? "");
    const result = await service.execute({
      currentPlayerId: refreshed.session.playerId,
      ...(request.query.limit === undefined ? {} : { limit: readPageInteger(request.query.limit) }),
      ...(request.query.offset === undefined ? {} : { offset: readPageInteger(request.query.offset) })
    });
    return { ok: true, ...result, requestId: request.id };
  });
}
