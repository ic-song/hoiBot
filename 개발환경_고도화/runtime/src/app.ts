import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { LogController, type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import { RecentEventStore } from "./recent-events.js";

interface TokenQuery {
  token?: string;
}

interface IrisPayload {
  msg?: unknown;
  room?: unknown;
  sender?: unknown;
  json?: {
    chat_id?: unknown;
    type?: unknown;
    v?: unknown;
    attachment?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface IrisTextReply {
  room: string;
  data: string;
}

interface IrisImageReply {
  room: string;
  imageUrl: string;
}

interface AppDependencies {
  sendIrisTextReply?: (reply: IrisTextReply) => Promise<void>;
  sendIrisImageReply?: (reply: IrisImageReply) => Promise<void>;
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

// Iris `/reply` API로 텍스트 답장을 전송합니다.
async function sendIrisTextReply(config: AppConfig, reply: IrisTextReply): Promise<void> {
  const response = await fetch(`${config.irisBaseUrl}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "text", room: reply.room, data: reply.data }),
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    throw new Error(`Iris reply failed with HTTP ${response.status}.`);
  }

  const result = await response.json() as { success?: unknown };
  if (result.success !== true) {
    throw new Error("Iris reply response did not report success.");
  }
}

// JSON 문자열 또는 객체로 전달된 Iris 하위 필드를 안전하게 객체로 변환합니다.
function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

// 허용된 Kakao CDN HTTPS 이미지 주소만 반환합니다.
function readTrustedKakaoImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const trustedHost = hostname === "kakaocdn.net"
      || hostname.endsWith(".kakaocdn.net")
      || hostname === "kakao.com"
      || hostname.endsWith(".kakao.com");

    return url.protocol === "https:" && trustedHost ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

// 단일 이미지 수신 이벤트에서 전달 가능한 이미지 URL을 추출합니다.
function readIncomingSingleImageUrl(
  payload: IrisPayload,
  targetRoomId: string
): string | undefined {
  if (String(payload.json?.type) !== "2") {
    return undefined;
  }

  const sourceRoomId = payload.json?.chat_id;
  if ((typeof sourceRoomId !== "string" && typeof sourceRoomId !== "number")
    || String(sourceRoomId) === targetRoomId) {
    return undefined;
  }

  const attachment = readRecord(payload.json?.attachment);
  return readTrustedKakaoImageUrl(attachment?.url);
}

// 제한된 크기로 원격 이미지를 내려받아 Iris 전송용 base64 문자열로 변환합니다.
async function downloadImageAsBase64(config: AppConfig, imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(config.imageDownloadTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Image download returned a non-image content type.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > config.imageMaxBytes) {
    throw new Error("Image download exceeds the configured size limit.");
  }
  if (response.body === null) {
    throw new Error("Image download returned an empty body.");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;
      if (totalBytes > config.imageMaxBytes) {
        await reader.cancel();
        throw new Error("Image download exceeds the configured size limit.");
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new Error("Image download returned an empty body.");
  }
  return Buffer.concat(chunks, totalBytes).toString("base64");
}

// Kakao CDN 이미지를 내려받아 Iris `/reply` API로 대상 방에 전송합니다.
async function sendIrisImageReply(config: AppConfig, reply: IrisImageReply): Promise<void> {
  const imageData = await downloadImageAsBase64(config, reply.imageUrl);
  const response = await fetch(`${config.irisBaseUrl}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "image", room: reply.room, data: imageData }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`Iris image reply failed with HTTP ${response.status}.`);
  }

  const result = await response.json() as { success?: unknown };
  if (result.success !== true) {
    throw new Error("Iris image reply response did not report success.");
  }
}

// 테스트와 실제 실행에서 공통으로 사용할 Fastify 앱을 생성합니다.
export function buildApp(config: AppConfig, dependencies: AppDependencies = {}) {
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
  const tokenGuard = createTokenGuard(config);
  const replyToIris = dependencies.sendIrisTextReply
    ?? ((reply: IrisTextReply) => sendIrisTextReply(config, reply));
  const forwardImageToIris = dependencies.sendIrisImageReply
    ?? ((reply: IrisImageReply) => sendIrisImageReply(config, reply));

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

      if (request.body.msg === "/ping") {
        const sender = typeof request.body.sender === "string" ? request.body.sender.trim() : "";
        const rawChatId = request.body.json?.chat_id;
        const chatId = typeof rawChatId === "string" || typeof rawChatId === "number"
          ? String(rawChatId)
          : "";

        if (sender !== "" && chatId !== "") {
          try {
            await replyToIris({ room: chatId, data: `${sender} pong` });
            request.log.info({ requestId: request.id }, "iris.ping_reply.sent");
          } catch (error) {
            request.log.error({ requestId: request.id, err: error }, "iris.ping_reply.failed");
          }
        } else {
          request.log.warn({ requestId: request.id }, "iris.ping_reply.missing_context");
        }
      }

      const imageUrl = readIncomingSingleImageUrl(
        request.body,
        config.irisImageForwardRoomId
      );
      if (imageUrl !== undefined
        && config.irisImageForwardRoomId !== "") {
        try {
          await forwardImageToIris({ room: config.irisImageForwardRoomId, imageUrl });
          request.log.info({ requestId: request.id }, "iris.image_forward.sent");
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "iris.image_forward.failed");
        }
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

  return app;
}
