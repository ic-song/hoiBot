import type { FastifyInstance, FastifyRequest } from "fastify";
import { requirePermission, type AdminSession } from "./auth-service.js";
import { ApplicationError } from "../shared/application-error.js";
import type { AdminAccountLinkReadService } from "./admin-account-link-read-service.js";

interface AdminSessionAuthenticator {
  authenticate(sessionToken: string, csrfToken?: string): Promise<AdminSession>;
}

export interface AdminAccountLinkReadRouteDependencies {
  auth: AdminSessionAuthenticator;
  reader: Pick<AdminAccountLinkReadService, "read">;
}

const SESSION_COOKIE = "hoibot_admin_session";
const UINT64_MAX = 18_446_744_073_709_551_615n;

// URL playerId를 JavaScript number 손실 없이 unsigned bigint로 검증합니다.
function readPlayerId(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new ApplicationError("PLAYER_ID_INVALID", "playerId는 0 이상의 정수 문자열이어야 합니다.", 422);
  }
  const playerId = BigInt(value);
  if (playerId > UINT64_MAX) {
    throw new ApplicationError("PLAYER_ID_INVALID", "playerId 범위를 확인해 주세요.", 422);
  }
  return playerId;
}

// 기존 관리자 세션과 player.read 최소 권한만 조회 요청에 적용합니다.
async function authenticate(request: FastifyRequest, dependencies: AdminAccountLinkReadRouteDependencies): Promise<void> {
  const session = await dependencies.auth.authenticate(request.cookies[SESSION_COOKIE] ?? "");
  requirePermission(session, "player.read");
}

// WBS746 계정 연결 현황을 관리자 읽기 API로 등록합니다.
export async function registerAdminAccountLinkReadRoutes(
  app: FastifyInstance,
  dependencies: AdminAccountLinkReadRouteDependencies,
): Promise<void> {
  app.get<{ Params: { playerId: string } }>("/api/v1/admin/players/:playerId/account-links", async (request) => {
    await authenticate(request, dependencies);
    const playerId = readPlayerId(request.params.playerId);
    return { ok: true, playerId: playerId.toString(), accountLinks: await dependencies.reader.read(playerId), requestId: request.id };
  });
}
