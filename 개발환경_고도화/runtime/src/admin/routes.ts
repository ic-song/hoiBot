import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminAuthService, AdminSession } from "./auth-service.js";
import { requirePermission } from "./auth-service.js";
import type { ProfileRepository } from "../player/profile.js";
import type { ChangePlayerServerService } from "../player/change-player-server-service.js";
import { ApplicationError } from "../shared/application-error.js";
import type { AdminDirectoryService } from "./directory-service.js";

interface AdminRouteDependencies {
  auth: AdminAuthService;
  profiles: ProfileRepository;
  changePlayerServer: ChangePlayerServerService;
  directory: AdminDirectoryService;
  secureCookies: boolean;
}

const SESSION_COOKIE = "hoibot_admin_session";

// 쿠키와 선택적 CSRF 헤더에서 관리자 세션을 확인합니다.
async function authenticate(
  request: FastifyRequest,
  dependencies: AdminRouteDependencies,
  requireCsrf: boolean
): Promise<AdminSession> {
  const token = request.cookies[SESSION_COOKIE] ?? "";
  const csrf = requireCsrf ? request.headers["x-csrf-token"] : undefined;
  if (requireCsrf && typeof csrf !== "string") {
    throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  }
  return dependencies.auth.authenticate(token, typeof csrf === "string" ? csrf : undefined);
}

// 관리자 인증·회원 조회·서버 변경 API를 등록합니다.
export async function registerAdminRoutes(app: FastifyInstance, dependencies: AdminRouteDependencies): Promise<void> {
  app.post<{ Body: { loginId?: unknown; password?: unknown } }>("/api/v1/admin/auth/login", async (request, reply) => {
    if (typeof request.body?.loginId !== "string" || typeof request.body?.password !== "string") {
      throw new ApplicationError("INVALID_LOGIN_REQUEST", "loginId와 password가 필요합니다.", 422);
    }
    const result = await dependencies.auth.login(request.body.loginId, request.body.password);
    reply.setCookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true, secure: dependencies.secureCookies, sameSite: "strict", path: "/", maxAge: 86_400
    });
    return { ok: true, session: { operatorId: result.operatorId, loginId: result.loginId, displayName: result.displayName, permissions: result.permissions }, csrfToken: result.csrfToken, requestId: request.id };
  });

  app.get("/api/v1/admin/session", async (request) => {
    const session = await authenticate(request, dependencies, false);
    return { ok: true, session, requestId: request.id };
  });

  app.delete("/api/v1/admin/auth/session", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE] ?? "";
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string") {
      throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
    }
    await dependencies.auth.logout(token, csrf);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true, requestId: request.id };
  });

  app.get<{ Querystring: { search?: string; limit?: string; offset?: string } }>("/api/v1/admin/players", async (request) => {
    const session = await authenticate(request, dependencies, false);
    requirePermission(session, "player.read");
    const limit = Math.min(Math.max(Number(request.query.limit ?? 50), 1), 100);
    const offset = Math.max(Number(request.query.offset ?? 0), 0);
    const players = await dependencies.profiles.list(request.query.search, limit, offset);
    return { ok: true, players, requestId: request.id };
  });

  app.get<{ Params: { playerId: string } }>("/api/v1/admin/players/:playerId/profile", async (request) => {
    const session = await authenticate(request, dependencies, false);
    requirePermission(session, "player.read");
    const profile = await dependencies.profiles.findByPlayerId(request.params.playerId);
    if (profile === null) {
      throw new ApplicationError("PLAYER_NOT_FOUND", "회원을 찾을 수 없습니다.", 404);
    }
    return { ok: true, profile, requestId: request.id };
  });

  app.patch<{ Params: { playerId: string }; Body: { serverCode?: unknown; expectedVersion?: unknown; reason?: unknown } }>(
    "/api/v1/admin/players/:playerId/server",
    async (request) => {
      const session = await authenticate(request, dependencies, true);
      requirePermission(session, "player.server.change");
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
        throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 헤더가 필요합니다.", 422);
      }
      const { serverCode, expectedVersion, reason } = request.body ?? {};
      if (typeof serverCode !== "string" || (typeof expectedVersion !== "string" && typeof expectedVersion !== "number") || typeof reason !== "string" || reason.trim() === "") {
        throw new ApplicationError("INVALID_SERVER_CHANGE", "serverCode, expectedVersion와 reason이 필요합니다.", 422);
      }
      const result = await dependencies.changePlayerServer.execute({
        playerId: request.params.playerId, serverCode, expectedVersion: String(expectedVersion), reason,
        idempotencyKey, actorId: session.operatorId, sourceCode: "admin_api"
      });
      return { ok: true, ...result, requestId: request.id };
    }
  );

  app.get("/api/v1/admin/game-servers", async (request) => {
    const session = await authenticate(request, dependencies, false);
    requirePermission(session, "player.read");
    return { ok: true, servers: await dependencies.directory.listGameServers(), requestId: request.id };
  });

  app.get("/api/v1/admin/identity-candidates", async (request) => {
    const session = await authenticate(request, dependencies, false);
    requirePermission(session, "identity.approve");
    return { ok: true, candidates: await dependencies.directory.listIdentityCandidates(), requestId: request.id };
  });

  app.post<{ Params: { id: string }; Body: { playerId?: unknown; reason?: unknown } }>("/api/v1/admin/identity-candidates/:id/approve", async (request) => {
    const session = await authenticate(request, dependencies, true);
    requirePermission(session, "identity.approve");
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || typeof request.body?.playerId !== "string" || typeof request.body?.reason !== "string" || request.body.reason.trim() === "") {
      throw new ApplicationError("INVALID_IDENTITY_APPROVAL", "Idempotency-Key, playerId와 reason이 필요합니다.", 422);
    }
    const result = await dependencies.directory.approveIdentity({ identityId: request.params.id, playerId: request.body.playerId, reason: request.body.reason, actorId: session.operatorId, idempotencyKey });
    return { ok: true, ...result, requestId: request.id };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/v1/admin/audit", async (request) => {
    const session = await authenticate(request, dependencies, false);
    requirePermission(session, "audit.read");
    const limit = Math.min(Math.max(Number(request.query.limit ?? 100), 1), 200);
    return { ok: true, entries: await dependencies.directory.listAudit(limit), requestId: request.id };
  });
}
