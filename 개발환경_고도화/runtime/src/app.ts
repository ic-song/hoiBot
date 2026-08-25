import { randomUUID, timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { LogController, type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { MiniPetCatalogProjectionService } from "./mini-pet/catalog-projection-service.js";
import { MariaMiniPetCatalogProjectionRepository } from "./mini-pet/maria-catalog-projection-repository.js";
import { registerMiniPetCatalogProjectionRoutes } from "./mini-pet/catalog-projection-routes.js";
import type { AppConfig } from "./config.js";
import type { DatabaseClient } from "./database.js";
import { RecentEventStore } from "./recent-events.js";
import { ApplicationError } from "./shared/application-error.js";
import { normalizeIrisEvent, type IrisPayload, type NormalizedIrisEvent } from "./integration/iris-normalizer.js";
import { ProcessIrisEventService, recordOutboxDelivery } from "./integration/event-processing-service.js";
import {
  formatIrisKakaoDiagnostic,
  IrisKakaoDatabaseInspector,
  splitIrisKakaoDiagnostic,
  type IrisKakaoDatabaseSnapshot
} from "./integration/iris-kakao-database-inspector.js";
import {
  formatIrisEventMonitorMessage,
  formatModerationIncidentReadMessage,
  shouldMonitorIrisEvent,
  type IrisOriginalMessageResult
} from "./integration/iris-event-monitor.js";
import {
  IrisChannelPolicyInspector,
  type IrisChannelAccessDecision
} from "./integration/iris-channel-policy.js";
import { AdminAuthService } from "./admin/auth-service.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { MariaProfileRepository } from "./player/maria-profile-repository.js";
import { ChangePlayerServerService } from "./player/change-player-server-service.js";
import { GetMyProfileService } from "./player/get-my-profile-service.js";
import { formatLegacyMyProfile } from "./player/legacy-profile-formatter.js";
import { AdminDirectoryService } from "./admin/directory-service.js";
import { AdminManagementService } from "./admin/management-service.js";
import { IrisAdminCommandService } from "./admin/iris-admin-command-service.js";
import { SignupService } from "./signup/signup-service.js";
import { isSignupCommand } from "./signup/signup-policy.js";
import { isPetCreationCommandCandidate, PetCreationService } from "./pet/pet-creation-service.js";
import { isPetRenameCommandCandidate, PetRenameService } from "./pet/pet-rename-service.js";
import { isYakitoriPackageUseCommand, YakitoriPackageUseService } from "./mini-pet/yakitori-package-use-service.js";
import { isMiniPetInventoryViewCommand, MiniPetInventoryViewNormalizeService } from "./mini-pet/inventory-view-normalize-service.js";
import { formatMiniPetEquippedRank, isMiniPetEquippedRankReadCommand } from "./mini-pet/equipped-rank-read-command.js";
import { formatMiniPetAdminInfo, readMiniPetAdminInfoTarget } from "./mini-pet/admin-info-read-command.js";
import { formatMiniPetCollection, isMiniPetCollectionReadCommand } from "./mini-pet/collection-read-command.js";
import { formatMiniPetGradeStats, isMiniPetGradeStatsReadCommand } from "./mini-pet/grade-stats-read-command.js";
import { formatMiniPetDrawRates, isMiniPetDrawRateReadCommand } from "./mini-pet/draw-rate-read-command.js";
import { AdminDrawGrantService, isAdminDrawGrantCommand } from "./mini-pet/admin-draw-grant-service.js";
import { MariaAdminDrawGrantRepository } from "./mini-pet/maria-admin-draw-grant-repository.js";
import { isMiniPetCollectionRegisterCommand, MiniPetCollectionRegisterService } from "./mini-pet/collection-register-service.js";
import { MariaMiniPetCollectionRegisterRepository } from "./mini-pet/maria-collection-register-repository.js";
import { isPetRenameTicketCraftCommand, PetRenameTicketCraftService } from "./pet/pet-rename-ticket-craft-service.js";
import { CastleBattleResetCraftService, isCastleBattleResetCraftCommand } from "./castle/castle-battle-reset-craft-service.js";
import { isRaidStrikeSealCraftCommand, RaidStrikeSealCraftService } from "./raid/raid-strike-seal-craft-service.js";
import { isPetFoodBoxCraftCommand, PetFoodBoxCraftService } from "./crafting/pet-food-box-craft-service.js";
import { AdvancedTierTicketCraftService, isAdvancedTierTicketCraftCommand } from "./crafting/advanced-tier-ticket-craft-service.js";
import { AdminDailyPayoutService, isAdminDailyPayoutCommand } from "./admin/daily-payout-service.js";
import { MariaPetInfoRepository } from "./pet/maria-pet-info-repository.js";
import { GetPetInfoService, isPetInfoCommand } from "./pet/pet-info-service.js";
import { GuildJoinService } from "./guild/guild-join-service.js";
import { MariaGuildJoinRepository } from "./guild/maria-guild-join-repository.js";
import { isGuildJoinCommandCandidate } from "./guild/guild-join-policy.js";
import { GuildJoinConditionService } from "./guild/guild-join-condition-service.js";
import { isGuildJoinConditionCommandCandidate } from "./guild/guild-join-condition-policy.js";
import { MariaGuildJoinConditionRepository } from "./guild/maria-guild-join-condition-repository.js";
import { GuildForceExpelService } from "./guild/guild-force-expel-service.js";
import { isGuildForceExpelCommandCandidate } from "./guild/guild-force-expel-policy.js";
import { MariaGuildForceExpelRepository } from "./guild/maria-guild-force-expel-repository.js";
import { ConstructionEditService } from "./home/construction-edit-service.js";
import { isConstructionEditCommandCandidate } from "./home/construction-edit-policy.js";
import { MariaConstructionEditRepository } from "./home/maria-construction-edit-repository.js";
import { UserAuthService } from "./user-auth/user-auth-service.js";
import { registerUserAuthRoutes } from "./user-auth/routes.js";
import { AccountCleanupService } from "./user-auth/account-cleanup-service.js";
import { ProviderVerificationService } from "./user-auth/provider-verification-service.js";
import { readKakaoVerificationCode } from "./user-auth/policy.js";
import { RequestRateLimiter } from "./user-auth/request-rate-limiter.js";
import {
  ModerationIncidentService,
  readModerationIncidentNumber
} from "./integration/moderation-incident-service.js";
import { MembershipLogService, type MembershipLogSummary } from "./integration/membership-log-service.js";
import { RetainedEventContentService } from "./integration/retained-event-content-service.js";
import { BagAttributeService, isBagAttributeCommandCandidate } from "./inventory/bag-attribute-service.js";
import { MariaBagAttributeRepository } from "./inventory/maria-bag-attribute-repository.js";
import { BagAddService, isBagAddCommandCandidate } from "./inventory/bag-add-service.js";
import { MariaBagAddRepository } from "./inventory/maria-bag-add-repository.js";
import { GetBagService, isBagCommand } from "./inventory/get-bag-service.js";
import { MariaBagRepository } from "./inventory/maria-bag-repository.js";
import { BagSellService } from "./inventory/bag-sell-service.js";
import { isBagSellCommand } from "./inventory/bag-sell.js";
import { MariaBagSellRepository } from "./inventory/maria-bag-sell-repository.js";
import { InventorySnapshotService, isInventorySnapshotCommand } from "./inventory/inventory-snapshot-service.js";
import { MariaInventorySnapshotRepository } from "./inventory/maria-inventory-snapshot-repository.js";
import { isOpenAllCommand } from "./inventory/open-all-policy.js";
import { OpenAllService } from "./inventory/open-all-service.js";
import { MariaOpenAllRepository } from "./inventory/maria-open-all-repository.js";
import { EnhanceBoxOpenService, isEnhanceBoxOpenCommandCandidate } from "./inventory/enhance-box-open-service.js";
import { MariaEnhanceBoxOpenRepository } from "./inventory/maria-enhance-box-open-repository.js";
import { EnhanceRateDrawService, isEnhanceRateDrawCommandCandidate } from "./inventory/enhance-rate-draw-service.js";
import { MariaEnhanceRateDrawRepository } from "./inventory/maria-enhance-rate-draw-repository.js";
import { formatLegacyBag } from "./inventory/legacy-bag-formatter.js";
import { GuildTerritoryReadModelService } from "./guild/guild-territory-read-model-service.js";
import { MariaGuildTerritoryReadModelRepository } from "./guild/maria-guild-territory-read-model-repository.js";
import { registerGuildTerritoryRoutes } from "./guild/guild-territory-routes.js";
import {
  GuildTerritoryTurnOrderCommand,
  isGuildTerritoryTurnOrderCommand
} from "./guild/guild-territory-turn-order-command.js";
import { HomeBadgeReferenceService, parseHomeBadgeReferenceCommand } from "./home/home-badge-reference.js";
import { MariaHomeBadgeReferenceRepository } from "./home/maria-home-badge-reference-repository.js";
import { HomeSocialRankingService, parseHomeSocialRankingCommand } from "./home/home-social-ranking.js";
import { MariaHomeSocialRankingRepository } from "./home/maria-home-social-ranking-repository.js";
import { HomeSocialFollowService, isHomeSocialFollowCommandCandidate } from "./home/home-social-follow.js";
import { MariaHomeSocialFollowRepository } from "./home/maria-home-social-follow-repository.js";
import { HomeUpgradeService, isHomeUpgradeCommandCandidate } from "./home/home-upgrade-service.js";

interface TokenQuery {
  token?: string;
}

interface IrisTextReply {
  room: string;
  data: string;
}

interface IrisImageReply {
  room: string;
  imageUrl: string;
}

export interface AppDependencies {
  sendIrisTextReply?: (reply: IrisTextReply) => Promise<void>;
  sendIrisImageReply?: (reply: IrisImageReply) => Promise<void>;
  inspectIrisKakaoDatabase?: (event: NormalizedIrisEvent) => Promise<IrisKakaoDatabaseSnapshot>;
  inspectIrisChannel?: (event: NormalizedIrisEvent) => Promise<IrisChannelAccessDecision>;
  retainIrisEventContent?: (payload: IrisPayload, event: NormalizedIrisEvent) => Promise<number>;
  database?: DatabaseClient;
  guildTerritoryReadModel?: Pick<GuildTerritoryReadModelService, "read" | "setRememberPreference">;
  homeBadgeReference?: Pick<HomeBadgeReferenceService, "execute">;
  homeSocialRanking?: Pick<HomeSocialRankingService, "execute">;
  homeSocialFollow?: Pick<HomeSocialFollowService, "handle">;
  homeUpgrade?: Pick<HomeUpgradeService, "handle">;
  miniPetCollectionRegister?: Pick<MiniPetCollectionRegisterService, "handle">;
  enhanceBoxOpen?: Pick<EnhanceBoxOpenService, "handle">;
  enhanceRateDraw?: Pick<EnhanceRateDrawService, "handle">;
}

// KakaoTalk DB 대상 행 조회 결과를 원문 표시 상태로 변환합니다.
function readOriginalMessage(snapshot: IrisKakaoDatabaseSnapshot): IrisOriginalMessageResult {
  const target = snapshot.targetChatLog;
  if (target.error !== undefined) return { status: "failed" };
  if (target.rows.length !== 1 || typeof target.rows[0]?.message !== "string") {
    return { status: "not_found" };
  }
  return { status: "recovered", message: target.rows[0].message };
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
  const inspectIrisKakaoDatabase = dependencies.inspectIrisKakaoDatabase
    ?? ((event: NormalizedIrisEvent) => new IrisKakaoDatabaseInspector(config.irisBaseUrl).inspect(event));
  const designatedChannelIds = new Set(config.irisAllowedOpenChatIds);
  const diagnosticChannelIds = new Set(
    config.nodeEnv === "production" || config.irisEventMonitorRoomId === ""
      ? []
      : [config.irisEventMonitorRoomId]
  );
  const inspectIrisChannel = dependencies.inspectIrisChannel
    ?? ((event: NormalizedIrisEvent) => new IrisChannelPolicyInspector(config.irisBaseUrl)
      .inspect(event, designatedChannelIds, diagnosticChannelIds, config.irisOpenChatObservationMode));
  const database = dependencies.database;
  const miniPetProjectionEnvironment = config.nodeEnv === "production" ? "prod" : "dev";
  const miniPetCatalogProjection = database === undefined ? undefined
    : new MiniPetCatalogProjectionService(
      new MariaMiniPetCatalogProjectionRepository(database), miniPetProjectionEnvironment
    );
  const guildTerritoryReadModel = dependencies.guildTerritoryReadModel
    ?? (database === undefined ? undefined
      : new GuildTerritoryReadModelService(new MariaGuildTerritoryReadModelRepository(database)));
  const homeBadgeReference = dependencies.homeBadgeReference
    ?? (database === undefined ? undefined
      : new HomeBadgeReferenceService(new MariaHomeBadgeReferenceRepository(database)));
  const homeSocialRanking = dependencies.homeSocialRanking
    ?? (database === undefined ? undefined
      : new HomeSocialRankingService(new MariaHomeSocialRankingRepository(database), "\u200b".repeat(500)));
  const homeSocialFollow = dependencies.homeSocialFollow
    ?? (database === undefined ? undefined
      : new HomeSocialFollowService(new MariaHomeSocialFollowRepository(database), "\u200b".repeat(500)));
  const homeUpgrade = dependencies.homeUpgrade
    ?? (database === undefined ? undefined : new HomeUpgradeService(database));
  const miniPetCollectionRegister = dependencies.miniPetCollectionRegister
    ?? (database === undefined ? undefined
      : new MiniPetCollectionRegisterService(new MariaMiniPetCollectionRegisterRepository(database)));
  const enhanceBoxOpen = dependencies.enhanceBoxOpen
    ?? (database === undefined ? undefined
      : new EnhanceBoxOpenService(new MariaEnhanceBoxOpenRepository(database)));
  const enhanceRateDraw = dependencies.enhanceRateDraw
    ?? (database === undefined ? undefined
      : new EnhanceRateDrawService(new MariaEnhanceRateDrawRepository(database)));
  const retainedEventContents = database === undefined ? undefined : new RetainedEventContentService(database, {
    enabled: config.retainedEventContentEnabled,
    retentionDays: config.retainedEventContentDays,
    storageDirectory: config.retainedEventContentStorageDirectory,
    maxBytes: config.imageMaxBytes,
    downloadTimeoutMs: config.imageDownloadTimeoutMs
  });
  const retainIrisEventContent = dependencies.retainIrisEventContent
    ?? (retainedEventContents === undefined ? undefined
      : (payload: IrisPayload, event: NormalizedIrisEvent) => retainedEventContents.retain(payload, event));
  const retainedContentChannelIds = new Set(config.retainedEventContentChannelIds);
  let accountCleanupTimer: NodeJS.Timeout | undefined;
  let retainedContentCleanupTimer: NodeJS.Timeout | undefined;

  void app.register(cookie);
  if (guildTerritoryReadModel !== undefined) {
    registerGuildTerritoryRoutes(app, { service: guildTerritoryReadModel, tokenGuard });
  }
  if (database !== undefined) {
    registerMiniPetCatalogProjectionRoutes(app, { service: miniPetCatalogProjection!, tokenGuard });
    const profiles = new MariaProfileRepository(database);
    void registerAdminRoutes(app, {
      auth: new AdminAuthService(database),
      profiles,
      changePlayerServer: new ChangePlayerServerService(database),
      directory: new AdminDirectoryService(database),
      management: new AdminManagementService(database),
      moderationIncidents: new ModerationIncidentService(database),
      retainedEventContents: retainedEventContents!,
      inspectIrisKakaoDatabase,
      secureCookies: config.nodeEnv === "production"
    });
    void registerUserAuthRoutes(app, {
      auth: new UserAuthService(database, config.userVerificationPepper, config.nodeEnv),
      profiles,
      rateLimiter: new RequestRateLimiter(config.userVerificationPepper),
      secureCookies: config.nodeEnv === "production"
    });
    if (config.nodeEnv !== "test") {
      const cleanup = new AccountCleanupService(database);
      void cleanup.runMaintenance().then((result) => {
        if (result.pending.processed > 0 || result.pending.failed > 0
          || result.deleted.processed > 0 || result.deleted.failed > 0) {
          app.log.info(result, "account_cleanup.completed");
        }
      }).catch((error) => app.log.error({ err: error }, "account_cleanup.failed"));
      accountCleanupTimer = setInterval(() => {
        void cleanup.runMaintenance().then((result) => {
          if (result.pending.processed > 0 || result.pending.failed > 0
            || result.deleted.processed > 0 || result.deleted.failed > 0) {
            app.log.info(result, "account_cleanup.completed");
          }
        }).catch((error) => app.log.error({ err: error }, "account_cleanup.failed"));
      }, 3_600_000);
      accountCleanupTimer.unref();
      if (config.retainedEventContentEnabled && retainedEventContents !== undefined) {
        void retainedEventContents.purgeExpired()
          .then((purged) => { if (purged > 0) app.log.info({ purged }, "retained_content_cleanup.completed"); })
          .catch((error) => app.log.error({ err: error }, "retained_content_cleanup.failed"));
        retainedContentCleanupTimer = setInterval(() => {
          void retainedEventContents.purgeExpired()
            .then((purged) => { if (purged > 0) app.log.info({ purged }, "retained_content_cleanup.completed"); })
            .catch((error) => app.log.error({ err: error }, "retained_content_cleanup.failed"));
        }, 3_600_000);
        retainedContentCleanupTimer.unref();
      }
    }
  }

  app.addHook("onClose", async () => {
    if (accountCleanupTimer !== undefined) clearInterval(accountCleanupTimer);
    if (retainedContentCleanupTimer !== undefined) clearInterval(retainedContentCleanupTimer);
    await database?.close();
  });

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

  app.setErrorHandler(async (error: FastifyError | ApplicationError, request, reply) => {
    const isApplicationError = error instanceof ApplicationError;
    const statusCode = isApplicationError ? error.statusCode
      : error.statusCode === 413 ? 413 : (error.statusCode ?? 500);
    const code = isApplicationError ? error.code
      : statusCode === 413 ? "PAYLOAD_TOO_LARGE" : "INTERNAL_SERVER_ERROR";
    const message = isApplicationError ? error.message
      : statusCode === 413 ? `요청 본문은 ${config.bodyLimitBytes}바이트를 초과할 수 없습니다.`
        : "서버가 요청을 처리하지 못했습니다.";

    request.log.error({ requestId: request.id, err: error }, "request.failed");
    await reply.code(statusCode).send({ ok: false, error: { code, message }, requestId: request.id });
  });

  app.get("/health/live", async (request) => ({
    ok: true,
    status: "alive",
    requestId: request.id
  }));

  app.get("/health/ready", async (request, reply) => {
    if (!config.database.enabled) {
      return { ok: true, status: "ready", database: "disabled", requestId: request.id };
    }

    if (database === undefined) {
      return reply.code(503).send({
        ok: false,
        status: "not_ready",
        database: "unavailable",
        requestId: request.id
      });
    }

    try {
      await database.ping();
      return { ok: true, status: "ready", database: "ready", requestId: request.id };
    } catch (error) {
      request.log.error({ requestId: request.id, err: error }, "database.readiness.failed");
      return reply.code(503).send({
        ok: false,
        status: "not_ready",
        database: "unavailable",
        requestId: request.id
      });
    }
  });

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

  app.get("/api/v1/public/overview", async (request) => {
    if (database === undefined || !config.database.enabled) {
      return {
        ok: true,
        service: { api: "ready", database: "disabled" },
        metrics: null,
        requestId: request.id
      };
    }
    try {
      const rows = await database.query<Array<{
        active_players: bigint;
        active_channels: bigint;
        events_last_24_hours: bigint;
        last_event_at: Date | null;
      }>>(
        `SELECT
          (SELECT COUNT(*) FROM players WHERE status = 'active') AS active_players,
          (SELECT COUNT(*) FROM channels WHERE provider_code = 'iris' AND status = 'active') AS active_channels,
          (SELECT COUNT(*) FROM event_inbox WHERE received_at >= UTC_TIMESTAMP(3) - INTERVAL 24 HOUR) AS events_last_24_hours,
          (SELECT MAX(received_at) FROM event_inbox) AS last_event_at`
      );
      const row = rows[0];
      return {
        ok: true,
        service: { api: "ready", database: "ready" },
        metrics: row === undefined ? null : {
          activePlayers: row.active_players.toString(),
          activeChannels: row.active_channels.toString(),
          eventsLast24Hours: row.events_last_24_hours.toString(),
          lastEventAt: row.last_event_at?.toISOString() ?? null
        },
        requestId: request.id
      };
    } catch (error) {
      request.log.error({ requestId: request.id, err: error }, "public.overview.failed");
      return {
        ok: true,
        service: { api: "ready", database: "unavailable" },
        metrics: null,
        requestId: request.id
      };
    }
  });

  app.post<{ Body: IrisPayload; Querystring: TokenQuery }>(
    "/api/v1/integrations/iris/events",
    { preHandler: tokenGuard },
    async (request, reply) => {
      const normalizedEvent = normalizeIrisEvent(request.body);
      const channelAccess = await inspectIrisChannel(normalizedEvent);
      if (channelAccess.mode === "denied") {
        request.log.info(
          { requestId: request.id, reason: channelAccess.reason, channelClass: channelAccess.channelClass },
          "iris.event_ignored_by_channel_policy"
        );
        return reply.code(202).send({
          ok: true,
          accepted: true,
          ignored: true,
          ignoreReason: channelAccess.reason,
          requestId: request.id
        });
      }

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

      const isOperationalChannel = channelAccess.mode === "operational";
      const isObservationChannel = channelAccess.mode === "observation";
      const isInteractiveChannel = isOperationalChannel || channelAccess.mode === "diagnostic";
      const verificationCode = readKakaoVerificationCode(normalizedEvent.message);
      const moderationIncidentNumber = readModerationIncidentNumber(normalizedEvent.message);
      const shouldCreateEventMonitorMessage = config.nodeEnv !== "production"
        && config.irisEventMonitorRoomId !== ""
        && shouldMonitorIrisEvent(request.body, normalizedEvent);
      const requiresOriginalMessageLookup = shouldCreateEventMonitorMessage
        && (normalizedEvent.eventCode === "message.deleted"
          || normalizedEvent.eventCode === "message.hidden_by_host");
      const requiresKakaoDatabaseLookup = requiresOriginalMessageLookup
        || (normalizedEvent.direction === "incoming" && (normalizedEvent.message === "/ping"
          || verificationCode !== null
          || isSignupCommand(normalizedEvent.message)
          || (normalizedEvent.message === "/info" && config.nodeEnv !== "production")
          || shouldCreateEventMonitorMessage));
      const kakaoDatabaseSnapshot = requiresKakaoDatabaseLookup
        ? await inspectIrisKakaoDatabase(normalizedEvent)
        : undefined;
      const commandEvent = {
        ...normalizedEvent,
        ...(kakaoDatabaseSnapshot?.subjectUserId === undefined
          ? {}
          : { userId: kakaoDatabaseSnapshot.subjectUserId }),
        ...(kakaoDatabaseSnapshot?.nickname === undefined
          || kakaoDatabaseSnapshot.nicknameSource === "iris_sender"
          ? {}
          : { displayName: kakaoDatabaseSnapshot.nickname,
              displayNameSource: "kakao_db" as const, displayNameTrust: "trusted" as const })
      };
      const isDiagnosticModeration = channelAccess.mode === "diagnostic"
        && (normalizedEvent.eventCode === "message.deleted"
          || normalizedEvent.eventCode === "message.hidden_by_host");
      const isMembershipEvent = normalizedEvent.eventCode === "member.joined"
        || normalizedEvent.eventCode === "member.departed";
      const isDiagnosticMembership = channelAccess.mode === "diagnostic" && isMembershipEvent;
      const eventProcessor = database === undefined
        || (!isOperationalChannel && !isObservationChannel && !isDiagnosticModeration && !isDiagnosticMembership)
        ? undefined
        : new ProcessIrisEventService(database);
      const processing = eventProcessor === undefined
        ? undefined
        : isOperationalChannel || isObservationChannel || isDiagnosticMembership
          ? await eventProcessor.execute(normalizedEvent, commandEvent, channelAccess.channelClass === "open_direct"
            ? "open_direct"
            : "open_group", {
              allowCommands: isOperationalChannel,
              channelName: kakaoDatabaseSnapshot?.roomName === undefined
                || kakaoDatabaseSnapshot.roomNameSource === "unavailable"
                ? undefined
                : {
                    displayName: kakaoDatabaseSnapshot.roomName,
                    sourceCode: kakaoDatabaseSnapshot.roomNameSource === "open_link"
                      ? "kakao_open_link"
                      : "kakao_chat_room_meta"
                  }
            })
          : await eventProcessor.executeDiagnosticModeration(normalizedEvent);
      const isRetainedContentChannel = commandEvent.channelId !== undefined
        && (isOperationalChannel || isObservationChannel);
      const isWithinRetainedContentScope = isRetainedContentChannel
        && (config.retainedEventContentScope === "all_verified_open"
          || retainedContentChannelIds.has(commandEvent.channelId!));
      if (config.retainedEventContentEnabled && isWithinRetainedContentScope && retainIrisEventContent !== undefined
        && (processing === undefined || !processing.duplicate)) {
        try {
          await retainIrisEventContent(request.body, commandEvent);
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "retained_event_content.failed");
        }
      }
      let membershipSummary: MembershipLogSummary | null | undefined;
      if (database !== undefined && processing !== undefined && !processing.duplicate
        && isMembershipEvent && commandEvent.channelId !== undefined && commandEvent.userId !== undefined) {
        try {
          membershipSummary = await new MembershipLogService(database)
            .getSummary(commandEvent.channelId, commandEvent.userId);
        } catch (error) {
          request.log.warn({ requestId: request.id, err: error }, "membership.summary_unavailable");
        }
      }
      const eventMonitorMessage = shouldCreateEventMonitorMessage
        ? formatIrisEventMonitorMessage(
            request.body,
            commandEvent,
            kakaoDatabaseSnapshot?.roomName,
            processing?.incidentId,
            membershipSummary ?? undefined
          )
        : undefined;

      if (isInteractiveChannel && moderationIncidentNumber !== null && database !== undefined
        && commandEvent.channelId !== undefined) {
        const incidentService = new ModerationIncidentService(database);
        const incident = await incidentService.findByNumber(moderationIncidentNumber);
        let incidentReply: string;
        if (incident === null) {
          incidentReply = `🔎 [삭제 메시지 열람]\n⚠️ 열람 번호 #${moderationIncidentNumber}을(를) 찾을 수 없습니다.`;
        } else {
          const isSourceRoom = commandEvent.channelId === incident.sourceChannelId;
          const isMonitoringRoom = commandEvent.channelId === config.irisEventMonitorRoomId;
          if (!isSourceRoom && !isMonitoringRoom) {
            incidentReply = "🔎 [삭제 메시지 열람]\n⚠️ 삭제가 감지된 방 또는 모니터링방에서만 열람할 수 있습니다.";
          } else {
            const incidentSnapshot = await inspectIrisKakaoDatabase(incident.lookupEvent);
            incidentReply = formatModerationIncidentReadMessage({
              incidentId: incident.incidentId,
              incidentType: incident.incidentType,
              roomName: incidentSnapshot.roomName,
              displayName: incidentSnapshot.nicknameSource === "iris_sender"
                ? undefined
                : incidentSnapshot.nickname,
              originalMessage: readOriginalMessage(incidentSnapshot)
            });
          }
        }
        if (processing !== undefined && !processing.duplicate) {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            commandEvent,
            "moderation_incident_read",
            incidentReply
          ));
        } else if (processing === undefined) {
          try {
            await replyToIris({ room: commandEvent.channelId, data: incidentReply });
            request.log.info({ requestId: request.id }, "iris.moderation_incident_read.sent");
          } catch (error) {
            request.log.error({ requestId: request.id, err: error }, "iris.moderation_incident_read.failed");
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.message === "/info"
        && commandEvent.channelId !== undefined && kakaoDatabaseSnapshot !== undefined) {
        const diagnosticChunks = splitIrisKakaoDiagnostic(
          formatIrisKakaoDiagnostic(request.body, normalizedEvent, kakaoDatabaseSnapshot)
        );
        for (const [index, diagnosticChunk] of diagnosticChunks.entries()) {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            commandEvent,
            `iris_kakao_database_info_${index + 1}`,
            diagnosticChunk
          ));
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildTerritoryTurnOrderCommand(normalizedEvent.message)
        && normalizedEvent.channelId !== undefined && guildTerritoryReadModel !== undefined) {
        const data = await new GuildTerritoryTurnOrderCommand(guildTerritoryReadModel).execute();
        processing.replies.push(await eventProcessor!.queueCommandReply(
          normalizedEvent,
          "guild_territory_turn_order_read",
          data
        ));
      }

      const homeBadgeReferenceCommand = parseHomeBadgeReferenceCommand(normalizedEvent.message);
      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && homeBadgeReferenceCommand !== null && normalizedEvent.userId !== undefined
        && normalizedEvent.channelId !== undefined && homeBadgeReference !== undefined) {
        const data = await homeBadgeReference.execute({
          command: homeBadgeReferenceCommand,
          providerCode: "kakao",
          externalUserId: normalizedEvent.userId,
          isGroupChat: true,
          hasActivePass: false
        });
        if (data !== null) {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent,
            `home_badge_reference_${homeBadgeReferenceCommand.kind.replaceAll("-", "_")}`,
            data
          ));
        }
      }

      const homeSocialRankingCommand = parseHomeSocialRankingCommand(normalizedEvent.message);
      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && homeSocialRankingCommand !== null && normalizedEvent.userId !== undefined
        && normalizedEvent.channelId !== undefined && homeSocialRanking !== undefined) {
        const data = await homeSocialRanking.execute({
          providerCode: "kakao",
          externalUserId: normalizedEvent.userId,
          kind: homeSocialRankingCommand
        });
        if (data !== null) {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent,
            `home_social_ranking_${homeSocialRankingCommand}`,
            data
          ));
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeSocialFollowCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && homeSocialFollow !== undefined) {
        const result = await homeSocialFollow.handle({
          providerCode: "kakao",
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.data !== undefined && result.outboxId !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeUpgradeCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && homeUpgrade !== undefined) {
        const result = await homeUpgrade.handle({
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.data !== undefined && result.outboxId !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.message === "/내정보"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const profile = await new GetMyProfileService(new MariaProfileRepository(database!))
            .execute("kakao", normalizedEvent.userId);
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent,
            "my_profile",
            formatLegacyMyProfile(profile)
          ));
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "IDENTITY_MAPPING_REQUIRED") {
            request.log.warn({ requestId: request.id }, "iris.profile.identity_mapping_required");
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && isBagCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const bag = await new GetBagService(new MariaBagRepository(database!))
            .execute("kakao", normalizedEvent.userId);
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent,
            "bag_read",
            formatLegacyBag(bag)
          ));
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "IDENTITY_MAPPING_REQUIRED") {
            request.log.warn({ requestId: request.id }, "iris.bag.identity_mapping_required");
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isBagSellCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new BagSellService(new MariaBagSellRepository(database!)).execute({
          providerCode: "kakao",
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.outboxId !== undefined) {
          processing.replies.push({
            outboxId: result.outboxId,
            room: normalizedEvent.channelId,
            data: result.data
          });
        } else {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent,
            "bag_sell_validation",
            result.data
          ));
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isBagAttributeCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new BagAttributeService(new MariaBagAttributeRepository(database!)).handle({
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.outboxId !== undefined && result.data !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } else if (result.status !== "ignored_forbidden" && result.data !== undefined) {
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "bag_attribute_validation", result.data));
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isBagAddCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new BagAddService(new MariaBagAddRepository(database!)).handle({
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.outboxId !== undefined && result.data !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } else if (result.status !== "ignored_forbidden" && result.data !== undefined) {
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "bag_add_validation", result.data));
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isInventorySnapshotCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new InventorySnapshotService(new MariaInventorySnapshotRepository(database!)).handle({
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.outboxId !== undefined && result.data !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.message?.startsWith("/서버이동 ")
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new IrisAdminCommandService(database!).changePlayerServer({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "change_player_server", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.direction === "incoming"
        && verificationCode !== null
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && commandEvent.displayNameTrust === "trusted" && commandEvent.displayName !== undefined) {
        try {
          const result = await new ProviderVerificationService(database!, config.userVerificationPepper)
            .verifyInitialKakao({
              code: verificationCode,
              externalUserId: normalizedEvent.userId,
              displayName: commandEvent.displayName,
              channelId: normalizedEvent.channelId
            });
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent, "site_signup_kakao_verify", result.data
          ));
        } catch (error) {
          if (error instanceof ApplicationError) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "site_signup_kakao_verify", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetInfoCommand(normalizedEvent.message) && normalizedEvent.userId !== undefined
        && normalizedEvent.channelId !== undefined) {
        try {
          const replies = await new GetPetInfoService(new MariaPetInfoRepository(database!))
            .execute("kakao", normalizedEvent.userId);
          for (let index = 0; index < replies.length; index++) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, `pet_info_${index + 1}`, replies[index]!.data
            ));
          }
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "PET_NOT_FOUND") {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_info", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildForceExpelCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildForceExpelService(new MariaGuildForceExpelRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.data !== undefined && result.outboxId !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          } else if (result.data !== undefined) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_force_expel", result.data));
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_force_expel_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isConstructionEditCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new ConstructionEditService(new MariaConstructionEditRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.data !== undefined && result.outboxId !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          } else if (result.data !== undefined) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "construction_edit", result.data));
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "construction_edit_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildJoinConditionCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildJoinConditionService(new MariaGuildJoinConditionRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.data !== undefined && result.outboxId !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          } else if (result.data !== undefined) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_join_condition", result.data));
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_join_condition_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildJoinCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildJoinService(new MariaGuildJoinRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.data !== undefined && result.outboxId !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_join_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isAdminDailyPayoutCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new AdminDailyPayoutService(database!).handle({ externalUserId: normalizedEvent.userId, channelId: normalizedEvent.channelId, message: normalizedEvent.message!, eventId: normalizedEvent.eventId });
          if (result.status === "paid" && !result.duplicate) processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "admin_daily_payout", error.message));
          else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isAdvancedTierTicketCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new AdvancedTierTicketCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted" && !result.duplicate) {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "advanced_tier_ticket_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetFoodBoxCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetFoodBoxCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_food_box_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isEnhanceRateDrawCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && enhanceRateDraw !== undefined) {
        try {
          const result = await enhanceRateDraw.handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "drawn" && !result.duplicate) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "enhance_rate_draw", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isEnhanceBoxOpenCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && enhanceBoxOpen !== undefined) {
        try {
          const result = await enhanceBoxOpen.handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "opened" && !result.duplicate) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "enhance_box_open", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isOpenAllCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new OpenAllService(new MariaOpenAllRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "opened" && !result.duplicate) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "open_all_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isRaidStrikeSealCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new RaidStrikeSealCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "raid_strike_seal_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleBattleResetCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new CastleBattleResetCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "castle_battle_reset_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetRenameTicketCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetRenameTicketCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_rename_ticket_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetEquippedRankReadCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await miniPetCatalogProjection!.readLatestEquippedRank({
            environmentCode: miniPetProjectionEnvironment,
            providerEventId: normalizedEvent.eventId
          });
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent, "mini_pet_equipped_rank_read", formatMiniPetEquippedRank(result.owned)
          ));
        } catch (error) {
          if (error instanceof ApplicationError && [404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "mini_pet_equipped_rank_read", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      const miniPetAdminInfoTarget = readMiniPetAdminInfoTarget(normalizedEvent.message);
      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && miniPetAdminInfoTarget !== undefined
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        if (miniPetAdminInfoTarget.length === 0) {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent, "mini_pet_admin_info_read", "사용법: /미니펫정보 [대상]"
          ));
        } else {
          try {
            const result = await miniPetCatalogProjection!.readLatestAdminInfo({
              environmentCode: miniPetProjectionEnvironment,
              providerEventId: normalizedEvent.eventId,
              viewerExternalUserId: normalizedEvent.userId,
              requestChannelId: normalizedEvent.channelId,
              targetName: miniPetAdminInfoTarget
            });
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "mini_pet_admin_info_read", formatMiniPetAdminInfo(result)
            ));
          } catch (error) {
            if (error instanceof ApplicationError && error.statusCode === 403) {
              // 레거시와 동일하게 권한 또는 허용방 밖 요청은 응답하지 않습니다.
            } else if (error instanceof ApplicationError && [404, 409, 422].includes(error.statusCode)) {
              processing.replies.push(await eventProcessor!.queueCommandReply(
                normalizedEvent, "mini_pet_admin_info_read", error.message
              ));
            } else {
              throw error;
            }
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetCollectionRegisterCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && miniPetCollectionRegister !== undefined) {
        try {
          const result = await miniPetCollectionRegister.handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.outboxId !== undefined && result.data !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          } else if (result.data !== undefined) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "mini_pet_collection_register", result.data
            ));
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 410, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "mini_pet_collection_register", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetCollectionReadCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await miniPetCatalogProjection!.readLatestCollection({
            environmentCode: miniPetProjectionEnvironment,
            providerEventId: normalizedEvent.eventId,
            viewerExternalUserId: normalizedEvent.userId
          });
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent, "mini_pet_collection_read", formatMiniPetCollection(result)
          ));
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "MINIPET_COLLECTION_SIEGE_SILENT") {
            // 레거시와 동일하게 공성전 중 조회는 응답하지 않습니다.
          } else if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "mini_pet_collection_read", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetGradeStatsReadCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await miniPetCatalogProjection!.readLatestGradeStats({
            environmentCode: miniPetProjectionEnvironment,
            providerEventId: normalizedEvent.eventId
          });
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent, "mini_pet_grade_stats_read", formatMiniPetGradeStats(result)
          ));
        } catch (error) {
          if (error instanceof ApplicationError && [404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "mini_pet_grade_stats_read", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetDrawRateReadCommand(normalizedEvent.message)) {
        try {
          const result = await miniPetCatalogProjection!.readLatestDrawRates({
            environmentCode: miniPetProjectionEnvironment,
            providerEventId: normalizedEvent.eventId
          });
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent, "mini_pet_draw_rate_read", formatMiniPetDrawRates(result)
          ));
        } catch (error) {
          if (error instanceof ApplicationError && [404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "mini_pet_draw_rate_read", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isAdminDrawGrantCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new AdminDrawGrantService(new MariaAdminDrawGrantRepository(database!)).handle({
          externalUserId: normalizedEvent.userId,
          actorDisplayName: commandEvent.displayNameTrust === "trusted" ? commandEvent.displayName : undefined,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.outboxId !== undefined && result.data !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetInventoryViewCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new MiniPetInventoryViewNormalizeService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId,
            environmentCode: config.nodeEnv === "production" ? "prod" : "dev"
          });
          if (result.status === "repaired") {
            processing.replies.push({
              outboxId: result.outboxId!,
              room: normalizedEvent.channelId,
              data: result.data!
            });
          } else if (result.status === "read") {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent,
              "mini_pet_inventory_view_normalize",
              result.data!
            ));
          }
        } catch (error) {
          if (error instanceof ApplicationError && (error.statusCode === 409 || error.statusCode === 422)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent,
              "mini_pet_inventory_view_normalize",
              error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isYakitoriPackageUseCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new YakitoriPackageUseService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId,
            environmentCode: config.nodeEnv === "production" ? "prod" : "dev"
          });
          if (result.status === "opened") {
            processing.replies.push({
              outboxId: result.outboxId!,
              room: normalizedEvent.channelId,
              data: result.data!
            });
          }
        } catch (error) {
          if (error instanceof ApplicationError && (error.statusCode === 409 || error.statusCode === 422)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent,
              "yakitori_package_use",
              error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetRenameCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetRenameService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "renamed") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_rename", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetCreationCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetCreationService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          for (const petReply of result.replies) {
            processing.replies.push({ outboxId: petReply.outboxId, room: normalizedEvent.channelId, data: petReply.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_create", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.direction === "incoming"
        && verificationCode !== null && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && commandEvent.displayNameTrust !== "trusted") {
        processing.replies.push(await eventProcessor!.queueCommandReply(
          normalizedEvent,
          "site_signup_kakao_verify_name_unavailable",
          "카카오톡 DB에서 현재 닉네임을 확인할 수 없어 인증을 완료하지 않았습니다. Iris sender 캐시값은 인증에 사용하지 않습니다."
        ));
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.direction === "incoming"
        && isSignupCommand(normalizedEvent.message) && normalizedEvent.userId !== undefined
        && normalizedEvent.channelId !== undefined && commandEvent.displayNameTrust === "trusted"
        && commandEvent.displayName !== undefined) {
        try {
          const result = await new SignupService(database!).handle({
            externalUserId: normalizedEvent.userId,
            displayName: commandEvent.displayName,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "signup", error.message));
          } else {
            throw error;
          }
        }
      }

      if (processing !== undefined && !processing.duplicate && eventMonitorMessage !== undefined) {
        processing.replies.push(await eventProcessor!.queueCommandReply(
          commandEvent,
          "iris_event_monitor",
          eventMonitorMessage,
          config.irisEventMonitorRoomId
        ));
      }

      if (processing !== undefined) {
        for (const pendingReply of processing.replies) {
          try {
            await replyToIris({ room: pendingReply.room, data: pendingReply.data });
            await recordOutboxDelivery(database!, pendingReply.outboxId, { ok: true });
            request.log.info({ requestId: request.id }, "iris.outbox_reply.sent");
          } catch (error) {
            await recordOutboxDelivery(database!, pendingReply.outboxId, { ok: false, errorCode: "IRIS_REPLY_FAILED" });
            request.log.error({ requestId: request.id, err: error }, "iris.outbox_reply.failed");
          }
        }
      } else if (isInteractiveChannel && normalizedEvent.message === "/info" && commandEvent.channelId !== undefined
        && kakaoDatabaseSnapshot !== undefined) {
        try {
          const diagnosticChunks = splitIrisKakaoDiagnostic(
            formatIrisKakaoDiagnostic(request.body, normalizedEvent, kakaoDatabaseSnapshot)
          );
          for (const diagnosticChunk of diagnosticChunks) {
            await replyToIris({ room: commandEvent.channelId, data: diagnosticChunk });
          }
          request.log.info({ requestId: request.id }, "iris.database_info_reply.sent");
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "iris.database_info_reply.failed");
        }
      } else if (isInteractiveChannel && normalizedEvent.message === "/ping") {
        const sender = commandEvent.displayNameTrust === "trusted"
          ? commandEvent.displayName ?? ""
          : "미확인 사용자";
        const chatId = commandEvent.channelId ?? "";

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

      if (processing === undefined && eventMonitorMessage !== undefined) {
        try {
          await replyToIris({ room: config.irisEventMonitorRoomId, data: eventMonitorMessage });
          request.log.info({ requestId: request.id }, "iris.event_monitor.sent");
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "iris.event_monitor.failed");
        }
      }

      const imageUrl = readIncomingSingleImageUrl(
        request.body,
        config.irisImageForwardRoomId
      );
      if (isOperationalChannel && imageUrl !== undefined
        && config.irisImageForwardRoomId !== "") {
        try {
          await forwardImageToIris({ room: config.irisImageForwardRoomId, imageUrl });
          request.log.info({ requestId: request.id }, "iris.image_forward.sent");
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "iris.image_forward.failed");
        }
      }

      return reply.code(202).send({
        ok: true,
        accepted: true,
        ignored: false,
        channelMode: channelAccess.mode,
        duplicate: processing?.duplicate ?? false,
        requestId: request.id
      });
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
