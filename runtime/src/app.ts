import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { LogController, type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import { EmptyPackageCatalogRepository, RepositoryPackageCatalogProvider } from "./package-provider.js";
import { RecentEventStore } from "./recent-events.js";

interface TokenQuery {
  token?: string;
}

interface IrisPayload {
  msg?: unknown;
  room?: unknown;
  sender?: unknown;
  json?: unknown;
  [key: string]: unknown;
}

// 로그에 인증 쿼리 문자열이 남지 않도록 경로만 반환합니다.
function getSafePath(url: string): string {
  return new URL(url, "http://localhost").pathname;
}

// 두 공유 토큰을 일정 시간 비교 방식으로 확인합니다.
function tokensMatch(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

// 헤더를 우선하고 Iris 호환용 쿼리 토큰을 보조로 읽습니다.
function readSharedToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  const headerToken = request.headers["x-iris-token"];
  if (typeof headerToken === "string") {
    return headerToken;
  }

  return (request.query as TokenQuery).token ?? "";
}

// 보호된 Iris 및 디버그 API에서 공유 토큰을 검증합니다.
function createTokenGuard(config: AppConfig) {
  return async function tokenGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!tokensMatch(readSharedToken(request), config.irisSharedToken)) {
      await reply.code(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "유효한 Iris 공유 토큰이 필요합니다." },
        requestId: request.id
      });
    }
  };
}

// 테스트와 실제 실행에서 공통으로 사용할 Fastify 앱을 생성합니다.
export function buildApp(config: AppConfig) {
  const app = Fastify({
    bodyLimit: config.bodyLimitBytes,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.x-iris-token"],
        censor: "[REDACTED]"
      }
    }
  });
  const recentEvents = new RecentEventStore(config.recentEventLimit);
  const packageCatalog = new RepositoryPackageCatalogProvider(new EmptyPackageCatalogRepository());
  const tokenGuard = createTokenGuard(config);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    request.log.info(
      { requestId: request.id, method: request.method, path: getSafePath(request.url) },
      "request.received"
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      { requestId: request.id, statusCode: reply.statusCode, responseTimeMs: reply.elapsedTime },
      "request.completed"
    );
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const statusCode = error.statusCode === 413 ? 413 : (error.statusCode ?? 500);
    const code = statusCode === 413 ? "PAYLOAD_TOO_LARGE" : "INTERNAL_SERVER_ERROR";
    const message = statusCode === 413
      ? `요청 본문은 ${config.bodyLimitBytes}바이트를 초과할 수 없습니다.`
      : "서버가 요청을 처리하지 못했습니다.";

    request.log.error({ requestId: request.id, err: error }, "request.failed");
    await reply.code(statusCode).send({ ok: false, error: { code, message }, requestId: request.id });
  });

  app.get("/health/live", async (request) => ({
    ok: true,
    status: "alive",
    requestId: request.id
  }));

  app.get("/health/ready", async (request) => ({
    ok: true,
    status: "ready",
    requestId: request.id
  }));

  app.get("/api/v1/ping", async (request) => ({
    ok: true,
    message: "pong",
    requestId: request.id
  }));

  app.get("/api/v1/version", async (request) => ({
    ok: true,
    version: config.version,
    requestId: request.id
  }));

  app.post<{ Body: IrisPayload; Querystring: TokenQuery }>(
    "/api/v1/integrations/iris/events",
    { preHandler: tokenGuard },
    async (request, reply) => {
      if (config.rawPayloadLogging) {
        request.log.info(
          { requestId: request.id, irisPayload: request.body },
          "iris.raw_payload"
        );
      }

      if (config.recentEventsEnabled) {
        recentEvents.add({
          requestId: request.id,
          receivedAt: new Date().toISOString(),
          payload: request.body
        });
      }

      return reply.code(202).send({ ok: true, accepted: true, requestId: request.id });
    }
  );

  app.get<{ Querystring: TokenQuery }>(
    "/api/v1/debug/recent-events",
    { preHandler: tokenGuard },
    async (request, reply) => {
      if (!config.recentEventsEnabled) {
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "최근 이벤트 조회 기능이 비활성화되어 있습니다." },
          requestId: request.id
        });
      }

      return { ok: true, events: recentEvents.list(), requestId: request.id };
    }
  );

  app.get<{ Querystring: TokenQuery }>(
    "/api/v1/packages/catalog",
    { preHandler: tokenGuard },
    async (request) => {
      const snapshot = await packageCatalog.getSnapshot();
      return {
        ok: true,
        catalogVersion: snapshot.version,
        packages: snapshot.packages,
        requestId: request.id
      };
    }
  );

  app.get<{ Params: { packageId: string }; Querystring: TokenQuery }>(
    "/api/v1/packages/catalog/:packageId",
    { preHandler: tokenGuard },
    async (request, reply) => {
      const packageEntry = await packageCatalog.findById(request.params.packageId);
      if (!packageEntry) {
        return reply.code(404).send({
          ok: false,
          error: { code: "PACKAGE_NOT_FOUND", message: "패키지 카탈로그 항목을 찾을 수 없습니다." },
          requestId: request.id
        });
      }

      return {
        ok: true,
        catalogVersion: (await packageCatalog.getSnapshot()).version,
        package: packageEntry,
        requestId: request.id
      };
    }
  );

  return app;
}
