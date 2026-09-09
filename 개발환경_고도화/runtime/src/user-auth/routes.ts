import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApplicationError } from "../shared/application-error.js";
import type { UserAuthService } from "./user-auth-service.js";
import {
  USER_AUTH_RATE_WINDOW_MS
} from "./policy.js";
import type { RequestRateLimiter } from "./request-rate-limiter.js";
import type { ProfileRepository } from "../player/profile.js";

interface UserRouteDependencies {
  auth: UserAuthService;
  profiles: ProfileRepository;
  rateLimiter: RequestRateLimiter;
  secureCookies: boolean;
}

const USER_SESSION_COOKIE = "hoibot_user_session";

function readString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new ApplicationError("INVALID_REQUEST", `${name} 값이 필요합니다.`, 422);
  return value;
}

function readRequiredCsrf(request: FastifyRequest): string {
  const value = request.headers["x-csrf-token"];
  if (typeof value !== "string") throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  return value;
}

// 사용자 회원가입·Kakao 인증 대기·로그인·현재 세션 API를 등록합니다.
export async function registerUserAuthRoutes(app: FastifyInstance, dependencies: UserRouteDependencies): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>("/api/v1/user-accounts", async (request, reply) => {
    const body = request.body ?? {};
    const loginId = readString(body.loginId, "loginId");
    dependencies.rateLimiter.consume("signup-login", loginId, { limit: 5, windowMs: USER_AUTH_RATE_WINDOW_MS });
    dependencies.rateLimiter.consume("signup-network", request.ip, { limit: 30, windowMs: USER_AUTH_RATE_WINDOW_MS });
    const result = await dependencies.auth.signup({
      loginId,
      password: readString(body.password, "password"),
      systemAccountName: readString(body.systemAccountName, "systemAccountName"),
      acceptTerms: body.acceptTerms === true,
      ...(body.gameAccountPurpose === undefined ? {} : { gameAccountPurpose: readString(body.gameAccountPurpose, "gameAccountPurpose") }),
      ...(body.legacyPlayerId === undefined ? {} : { legacyPlayerId: readString(body.legacyPlayerId, "legacyPlayerId") })
    });
    return reply.code(201).send({ ok: true, signup: result, requestId: request.id });
  });

  app.post<{ Body: Record<string, unknown> }>("/api/v1/verification-challenges", async (request, reply) => {
    const body = request.body ?? {};
    const loginId = readString(body.loginId, "loginId");
    dependencies.rateLimiter.consume("verification-reissue-login", loginId, { limit: 5, windowMs: USER_AUTH_RATE_WINDOW_MS });
    dependencies.rateLimiter.consume("verification-reissue-network", request.ip, { limit: 20, windowMs: USER_AUTH_RATE_WINDOW_MS });
    const result = await dependencies.auth.reissueSignupCode(
      loginId,
      readString(body.password, "password")
    );
    return reply.code(201).send({ ok: true, signup: result, requestId: request.id });
  });

  app.get<{ Params: { challengeId: string } }>("/api/v1/verification-challenges/:challengeId", async (request) => ({
    ok: true,
    verification: await dependencies.auth.readSignupStatus(request.params.challengeId),
    requestId: request.id
  }));

  app.post<{ Body: Record<string, unknown> }>("/api/v1/sessions", async (request, reply) => {
    const body = request.body ?? {};
    const loginId = readString(body.loginId, "loginId");
    dependencies.rateLimiter.consume("login-account", loginId, { limit: 10, windowMs: USER_AUTH_RATE_WINDOW_MS });
    dependencies.rateLimiter.consume("login-network", request.ip, { limit: 50, windowMs: USER_AUTH_RATE_WINDOW_MS });
    const result = await dependencies.auth.login(
      loginId,
      readString(body.password, "password")
    );
    reply.setCookie(USER_SESSION_COOKIE, result.sessionToken, {
      httpOnly: true, secure: dependencies.secureCookies, sameSite: "strict", path: "/", maxAge: 604_800
    });
    return reply.code(201).send({
      ok: true,
      session: {
        accountId: result.accountId, playerId: result.playerId,
        loginId: result.loginId, systemAccountName: result.systemAccountName
      },
      csrfToken: result.csrfToken,
      requestId: request.id
    });
  });

  app.get("/api/v1/sessions/current", async (request) => {
    const refreshed = await dependencies.auth.refreshSession(request.cookies[USER_SESSION_COOKIE] ?? "");
    return { ok: true, session: refreshed.session, csrfToken: refreshed.csrfToken, requestId: request.id };
  });

  app.get("/api/v1/player-profiles/current", async (request) => {
    const refreshed = await dependencies.auth.refreshSession(request.cookies[USER_SESSION_COOKIE] ?? "");
    const profile = await dependencies.profiles.findByPlayerId(refreshed.session.playerId);
    if (profile === null) {
      throw new ApplicationError("PLAYER_PROFILE_NOT_FOUND", "캐릭터 정보를 찾을 수 없습니다.", 404);
    }
    return { ok: true, profile, requestId: request.id };
  });

  app.delete("/api/v1/sessions/current", async (request, reply) => {
    const token = request.cookies[USER_SESSION_COOKIE] ?? "";
    await dependencies.auth.logout(token, readRequiredCsrf(request));
    reply.clearCookie(USER_SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.post<{ Body: { confirmed?: unknown } }>("/api/v1/account-deletion-requests", async (request, reply) => {
    if (request.body?.confirmed !== true) throw new ApplicationError("CONFIRMATION_REQUIRED", "탈퇴 내용을 다시 확인해 주세요.", 422);
    const result = await dependencies.auth.requestDeletion(request.cookies[USER_SESSION_COOKIE] ?? "", readRequiredCsrf(request));
    reply.clearCookie(USER_SESSION_COOKIE, { path: "/" });
    return reply.code(201).send({ ok: true, deletionRequest: result, requestId: request.id });
  });

  app.delete<{ Body: { loginId?: unknown; password?: unknown } }>("/api/v1/account-deletion-requests/current", async (request) => {
    const loginId = readString(request.body?.loginId, "loginId");
    dependencies.rateLimiter.consume("account-recovery-account", loginId, { limit: 5, windowMs: USER_AUTH_RATE_WINDOW_MS });
    dependencies.rateLimiter.consume("account-recovery-network", request.ip, { limit: 20, windowMs: USER_AUTH_RATE_WINDOW_MS });
    return {
      ok: true,
      deletionRequest: await dependencies.auth.recoverDeletion(loginId, readString(request.body?.password, "password")),
      requestId: request.id
    };
  });
}
