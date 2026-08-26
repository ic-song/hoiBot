import { randomUUID, timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { LogController, type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
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
import { DailyPrayerIrisCommandService, isDailyPrayerCommand } from "./player/daily-prayer-service.js";
import { AutoExploreFixedConfigService, isAutoExploreFixedConfigCommand } from "./pet/auto-explore-fixed-config-service.js";
import { InventoryBulkSellService, isInventoryBulkSellCommand } from "./inventory/bulk-sell-service.js";
import { DiamondBoxCraftService, isDiamondBoxCraftCommand, normalizeDiamondBoxCraftDispatchMessage } from "./crafting/diamond-box-craft-service.js";
import { FirstSponsorRegistryService, isFirstSponsorCommandCandidate, normalizeFirstSponsorDispatchMessage } from "./admin/first-sponsor-registry-service.js";
import { HappyFoundationCaptainService, isHappyFoundationCaptainCommand, normalizeHappyFoundationDispatchMessage } from "./foundation/happy-foundation-captain-service.js";
import { GetMyProfileService } from "./player/get-my-profile-service.js";
import { formatLegacyMyProfile } from "./player/legacy-profile-formatter.js";
import { AdminDirectoryService } from "./admin/directory-service.js";
import { AdminManagementService } from "./admin/management-service.js";
import { IrisAdminCommandService, isPointEditCommandCandidate } from "./admin/iris-admin-command-service.js";
import { AdminDiamondEditService, isAdminDiamondEditCommand, normalizeAdminDiamondEditDispatchMessage } from "./admin/admin-diamond-edit-service.js";
import { AdminDiamondResetAllService, isAdminDiamondResetAllCommand, normalizeAdminDiamondResetAllDispatchMessage } from "./admin/admin-diamond-reset-all-service.js";
import { SignupService } from "./signup/signup-service.js";
import { isSignupCommand } from "./signup/signup-policy.js";
import {
  CommandDispatcher,
  MariaCommandDispatchRepository,
  parseCanaryUserIds
} from "./dispatch/command-dispatcher.js";
import { isPetCreationCommandCandidate, PetCreationService } from "./pet/pet-creation-service.js";
import { isPetRenameCommandCandidate, PetRenameService } from "./pet/pet-rename-service.js";
import { isPetRenameTicketCraftCommand, PetRenameTicketCraftService } from "./pet/pet-rename-ticket-craft-service.js";
import { CastleBattleResetCraftService, isCastleBattleResetCraftCommand } from "./castle/castle-battle-reset-craft-service.js";
import { CastleBattleRankingService, isCastleBattleRankingCommand } from "./castle/castle-battle-ranking-service.js";
import { MariaCastleBattleRankingRepository } from "./castle/maria-castle-battle-ranking-repository.js";
import { isSpiritRankCommand, SpiritRankService } from "./pet/spirit-rank-service.js";
import { isSpiritInfoCommand, SpiritInfoService } from "./pet/spirit-info-service.js";
import { isPendantBagCommandCandidate, PendantBagService } from "./pet/pendant-bag-service.js";
import { isPendantBagCleanupCommandCandidate, normalizePendantBagCleanupDispatchMessage, PendantBagCleanupService } from "./pet/pendant-bag-cleanup-service.js";
import { isPendantEnhanceCommandCandidate, normalizePendantEnhanceDispatchMessage, PendantEnhanceService } from "./pet/pendant-enhance-service.js";
import { isPendantEnhanceCorrectionCommandCandidate, normalizePendantEnhanceCorrectionDispatchMessage, PendantEnhanceCorrectionService } from "./pet/pendant-enhance-correction-service.js";
import { isPendantDurabilityCorrectionCommandCandidate, normalizePendantDurabilityCorrectionDispatchMessage, PendantDurabilityCorrectionService } from "./pet/pendant-durability-correction-service.js";
import { isPendantMarketRegisterCommandCandidate, normalizePendantMarketRegisterDispatchMessage, PendantMarketRegisterService } from "./market/pendant-market-register-service.js";
import { isPendantMarketInfoCommandCandidate, normalizePendantMarketInfoDispatchMessage, PendantMarketInfoService } from "./market/pendant-market-info-service.js";
import { isPendantCarrotTradeCommandCandidate, normalizePendantCarrotTradeDispatchMessage, PendantCarrotTradeService } from "./market/pendant-carrot-trade-service.js";
import { isPendantRestoreCommandCandidate, normalizePendantRestoreDispatchMessage, PendantRestoreService } from "./pet/pendant-restore-service.js";
import { isPendantDeleteCommandCandidate,normalizePendantDeleteDispatchMessage,PendantDeleteService } from "./pet/pendant-delete-service.js";
import { isPendantRankCommand,PendantRankService } from "./pet/pendant-rank-service.js";
import { isPendantDrawOpenCommandCandidate,normalizePendantDrawOpenDispatchMessage,PendantDrawOpenService } from "./pet/pendant-draw-open-service.js";
import { isPendantEquipCommandCandidate,normalizePendantEquipDispatchMessage,PendantEquipService } from "./pet/pendant-equip-service.js";
import { isPendantEquipResetCommandCandidate,normalizePendantEquipResetDispatchMessage,PendantEquipResetService } from "./pet/pendant-equip-reset-service.js";
import { isPendantInfoCommandCandidate,normalizePendantInfoDispatchMessage,PendantInfoService } from "./pet/pendant-info-service.js";
import { isPendantGrantCommandCandidate,normalizePendantGrantDispatchMessage,PendantGrantService } from "./pet/pendant-grant-service.js";
import { isPendantSellCommandCandidate,normalizePendantSellDispatchMessage,PendantSellService } from "./pet/pendant-sell-service.js";
import { isPendantProbabilityCommand,PendantProbabilityService } from "./pet/pendant-probability-service.js";
import { isSpiritNameCommandCandidate, SpiritNameService } from "./pet/spirit-name-service.js";
import { isSpiritNameCombineCommand, SpiritNameCombineService } from "./pet/spirit-name-combine-service.js";
import { isRaidStrikeSealCraftCommand, RaidStrikeSealCraftService } from "./raid/raid-strike-seal-craft-service.js";
import { isPetFoodBoxCraftCommand, PetFoodBoxCraftService } from "./crafting/pet-food-box-craft-service.js";
import { MariaPetInfoRepository } from "./pet/maria-pet-info-repository.js";
import { GetPetInfoService, isPetInfoCommand } from "./pet/pet-info-service.js";
import { isPetStatusCommand, PetStatusService } from "./pet/pet-status-service.js";
import { GuildJoinService } from "./guild/guild-join-service.js";
import { MariaGuildJoinRepository } from "./guild/maria-guild-join-repository.js";
import { isGuildJoinCommandCandidate } from "./guild/guild-join-policy.js";
import { GuildJoinConditionService } from "./guild/guild-join-condition-service.js";
import { isGuildJoinConditionCommandCandidate } from "./guild/guild-join-condition-policy.js";
import { MariaGuildJoinConditionRepository } from "./guild/maria-guild-join-condition-repository.js";
import { GuildForceExpelService } from "./guild/guild-force-expel-service.js";
import { isGuildForceExpelCommandCandidate } from "./guild/guild-force-expel-policy.js";
import { MariaGuildForceExpelRepository } from "./guild/maria-guild-force-expel-repository.js";
import { GuildRecruitmentToggleService, isGuildRecruitmentToggleCommand } from "./guild/guild-recruitment-toggle-service.js";
import { isRiftForceAdminCommand, RiftForceAdminService } from "./guild/rift-force-admin-service.js";
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
import { InventorySnapshotService, isInventorySnapshotCommand } from "./inventory/inventory-snapshot-service.js";
import { MariaInventorySnapshotRepository } from "./inventory/maria-inventory-snapshot-repository.js";
import { isOpenAllCommand } from "./inventory/open-all-policy.js";
import { OpenAllService } from "./inventory/open-all-service.js";
import { MariaOpenAllRepository } from "./inventory/maria-open-all-repository.js";
import { formatLegacyBag } from "./inventory/legacy-bag-formatter.js";
import {
  isPackageCommandCandidate,
  normalizePackageDispatchMessage,
} from "./package/package-command.js";
import { PackageIrisCommandHandler } from "./package/package-iris-command-handler.js";
import {
  isPackageCatalogAdminCommandCandidate,
  normalizePackageCatalogAdminDispatchMessage,
} from "./package/package-catalog-admin-command.js";
import { PackageCatalogAdminIrisHandler } from "./package/package-catalog-admin-iris-handler.js";
import { isPackageCatalogWizardControl } from "./package/package-catalog-add-wizard.js";
import { PackageCatalogAddWizardIrisHandler } from "./package/package-catalog-add-wizard-iris-handler.js";
import {
  isPointShopCatalogCommandCandidate,
  normalizePointShopCatalogDispatchMessage,
} from "./shop/point-shop-catalog-command.js";
import { PointShopCatalogIrisHandler } from "./shop/point-shop-catalog-iris-handler.js";
import {
  isCommentPinDeleteCommandCandidate,
  normalizeCommentPinDeleteDispatchMessage,
} from "./home/comment-pin-delete-command.js";
import { CommentPinDeleteIrisHandler } from "./home/comment-pin-delete-iris-handler.js";

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
  dailyPrayerRandom?: () => number;
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
  if (database !== undefined) {
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
      const packageDispatchCandidate = process.env.PACKAGE_COMMAND_ENABLED === "true"
        && isPackageCommandCandidate(normalizedEvent.message ?? "");
      const packageCatalogAdminDispatchCandidate = process.env.PACKAGE_CATALOG_ADMIN_COMMAND_ENABLED === "true"
        && isPackageCatalogAdminCommandCandidate(normalizedEvent.message ?? "");
      const pointShopCatalogDispatchCandidate = process.env.POINT_SHOP_CATALOG_COMMAND_ENABLED === "true"
        && isPointShopCatalogCommandCandidate(normalizedEvent.message);
      const commentPinDeleteDispatchCandidate = process.env.COMMENT_PIN_DELETE_COMMAND_ENABLED === "true"
        && isCommentPinDeleteCommandCandidate(normalizedEvent.message);
      const packageCatalogWizardHandler = database !== undefined
        && process.env.PACKAGE_CATALOG_WIZARD_COMMAND_ENABLED === "true"
        ? new PackageCatalogAddWizardIrisHandler(database)
        : undefined;
      const packageCatalogWizardControlCandidate = packageCatalogWizardHandler !== undefined
        && isPackageCatalogWizardControl(normalizedEvent.message ?? "");
      const packageCatalogWizardActiveInput = packageCatalogWizardHandler !== undefined
        && normalizedEvent.direction === "incoming"
        && normalizedEvent.message !== undefined
        && !normalizedEvent.message.startsWith("/")
        && await packageCatalogWizardHandler.hasActiveSession(normalizedEvent);
      const partialDispatchCandidate = normalizedEvent.message === "/내정보"
        || isSignupCommand(normalizedEvent.message ?? "")
        || isInventoryBulkSellCommand(normalizedEvent.message)
        || isDiamondBoxCraftCommand(normalizedEvent.message)
        || isAdminDiamondEditCommand(normalizedEvent.message)
        || isAdminDiamondResetAllCommand(normalizedEvent.message)
        || isFirstSponsorCommandCandidate(normalizedEvent.message)
        || isHappyFoundationCaptainCommand(normalizedEvent.message)
        || isGuildRecruitmentToggleCommand(normalizedEvent.message)
        || isRiftForceAdminCommand(normalizedEvent.message)
        || isCastleBattleRankingCommand(normalizedEvent.message)
        || isSpiritRankCommand(normalizedEvent.message)
        || isPendantBagCleanupCommandCandidate(normalizedEvent.message)
        || isPendantEnhanceCommandCandidate(normalizedEvent.message)
        || isPendantEnhanceCorrectionCommandCandidate(normalizedEvent.message)
        || isPendantDurabilityCorrectionCommandCandidate(normalizedEvent.message)
        || isPendantMarketRegisterCommandCandidate(normalizedEvent.message)
        || isPendantMarketInfoCommandCandidate(normalizedEvent.message)
        || isPendantCarrotTradeCommandCandidate(normalizedEvent.message)
        || isPendantRestoreCommandCandidate(normalizedEvent.message)
        || isPendantDeleteCommandCandidate(normalizedEvent.message)
         || isPendantRankCommand(normalizedEvent.message)
         || isPendantDrawOpenCommandCandidate(normalizedEvent.message)
         || isPendantEquipCommandCandidate(normalizedEvent.message)
         || isPendantEquipResetCommandCandidate(normalizedEvent.message)
         || isPendantInfoCommandCandidate(normalizedEvent.message)
         || isPendantGrantCommandCandidate(normalizedEvent.message)
         || isPendantSellCommandCandidate(normalizedEvent.message)
         || isPendantProbabilityCommand(normalizedEvent.message)
        || isSpiritNameCommandCandidate(normalizedEvent.message)
        || isSpiritNameCombineCommand(normalizedEvent.message)
        || isPetStatusCommand(normalizedEvent.message)
        || packageDispatchCandidate
        || packageCatalogAdminDispatchCandidate
        || pointShopCatalogDispatchCandidate
        || commentPinDeleteDispatchCandidate
        || packageCatalogWizardControlCandidate
        || packageCatalogWizardActiveInput;
      const partialDispatchEnabled = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED === "true"
        || (config.nodeEnv !== "production" && process.env.PARTIAL_COMMAND_DISPATCH_ENABLED !== "false");
      const partialDispatchDecision = database !== undefined
        && normalizedEvent.direction === "incoming"
        && partialDispatchCandidate
        ? await new CommandDispatcher(new MariaCommandDispatchRepository(database), {
          enabled: partialDispatchEnabled,
          allowAllCanaries: config.nodeEnv !== "production",
          canaryUserIds: parseCanaryUserIds(process.env.PARTIAL_COMMAND_CANARY_USER_IDS)
        }).resolve({
          eventId: normalizedEvent.eventId,
           message: isPendantDeleteCommandCandidate(normalizedEvent.message)
            ? normalizePendantDeleteDispatchMessage(normalizedEvent.message ?? "")
            : isPendantRestoreCommandCandidate(normalizedEvent.message)
            ? normalizePendantRestoreDispatchMessage(normalizedEvent.message ?? "")
            : isPendantCarrotTradeCommandCandidate(normalizedEvent.message)
            ? normalizePendantCarrotTradeDispatchMessage(normalizedEvent.message ?? "")
            : isPendantDurabilityCorrectionCommandCandidate(normalizedEvent.message)
            ? normalizePendantDurabilityCorrectionDispatchMessage(normalizedEvent.message ?? "")
            : isPendantMarketInfoCommandCandidate(normalizedEvent.message)
            ? normalizePendantMarketInfoDispatchMessage(normalizedEvent.message ?? "")
            : isPendantMarketRegisterCommandCandidate(normalizedEvent.message)
            ? normalizePendantMarketRegisterDispatchMessage(normalizedEvent.message ?? "")
            : isPendantEnhanceCorrectionCommandCandidate(normalizedEvent.message)
            ? normalizePendantEnhanceCorrectionDispatchMessage(normalizedEvent.message ?? "")
            : isPendantEnhanceCommandCandidate(normalizedEvent.message)
            ? normalizePendantEnhanceDispatchMessage(normalizedEvent.message ?? "")
             : isPendantBagCleanupCommandCandidate(normalizedEvent.message)
             ? normalizePendantBagCleanupDispatchMessage(normalizedEvent.message ?? "")
             : isPendantDrawOpenCommandCandidate(normalizedEvent.message)
             ? normalizePendantDrawOpenDispatchMessage(normalizedEvent.message ?? "")
             : isPendantEquipCommandCandidate(normalizedEvent.message)
             ? normalizePendantEquipDispatchMessage(normalizedEvent.message ?? "")
             : isPendantEquipResetCommandCandidate(normalizedEvent.message)
             ? normalizePendantEquipResetDispatchMessage(normalizedEvent.message ?? "")
             : isPendantInfoCommandCandidate(normalizedEvent.message)
             ? normalizePendantInfoDispatchMessage(normalizedEvent.message ?? "")
             : isPendantGrantCommandCandidate(normalizedEvent.message)
             ? normalizePendantGrantDispatchMessage(normalizedEvent.message ?? "")
             : isPendantSellCommandCandidate(normalizedEvent.message)
             ? normalizePendantSellDispatchMessage(normalizedEvent.message ?? "")
            : packageDispatchCandidate
            ? normalizePackageDispatchMessage(normalizedEvent.message ?? "")
            : packageCatalogAdminDispatchCandidate
              ? normalizePackageCatalogAdminDispatchMessage(normalizedEvent.message ?? "")
              : pointShopCatalogDispatchCandidate
                ? normalizePointShopCatalogDispatchMessage(normalizedEvent.message ?? "")
                : commentPinDeleteDispatchCandidate
                  ? normalizeCommentPinDeleteDispatchMessage(normalizedEvent.message ?? "")
              : isHappyFoundationCaptainCommand(normalizedEvent.message)
                ? normalizeHappyFoundationDispatchMessage(normalizedEvent.message ?? "")
              : isDiamondBoxCraftCommand(normalizedEvent.message)
                ? normalizeDiamondBoxCraftDispatchMessage(normalizedEvent.message ?? "")
              : isAdminDiamondEditCommand(normalizedEvent.message)
                ? normalizeAdminDiamondEditDispatchMessage(normalizedEvent.message ?? "")
              : isAdminDiamondResetAllCommand(normalizedEvent.message)
                ? normalizeAdminDiamondResetAllDispatchMessage(normalizedEvent.message ?? "")
              : isFirstSponsorCommandCandidate(normalizedEvent.message)
                ? normalizeFirstSponsorDispatchMessage(normalizedEvent.message ?? "")
                : normalizedEvent.message ?? "",
          userId: normalizedEvent.userId,
          hasTrustedDisplayName: commandEvent.displayNameTrust === "trusted"
        })
        : undefined;
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
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && (partialDispatchDecision.handlerKey === "PACKAGE_BAG"
          || partialDispatchDecision.handlerKey === "PACKAGE_USE")) {
        const packageResponse = await new PackageIrisCommandHandler(database).execute(normalizedEvent);
        processing.replies.push(await eventProcessor.queueCommandReply(
          normalizedEvent,
          packageResponse.commandCode,
          packageResponse.message,
        ));
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && (partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_ADD"
          || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_EDIT"
          || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_REMOVE"
          || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_ENABLE")) {
        const catalogResponse = await new PackageCatalogAdminIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({
          outboxId: catalogResponse.outboxId,
          room: normalizedEvent.channelId!,
          data: catalogResponse.message,
        });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && (partialDispatchDecision.handlerKey === "POINT_SHOP_CATALOG_READ"
          || partialDispatchDecision.handlerKey === "POINT_SHOP_CATALOG_UPSERT"
          || partialDispatchDecision.handlerKey === "POINT_SHOP_CATALOG_REMOVE")) {
        const shopResponse = await new PointShopCatalogIrisHandler(database).execute(normalizedEvent);
        processing.replies.push(shopResponse.outboxId
          ? { outboxId: shopResponse.outboxId, room: normalizedEvent.channelId!, data: shopResponse.message }
          : await eventProcessor.queueCommandReply(normalizedEvent, shopResponse.commandCode, shopResponse.message));
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "HOME_COMMENT_PIN_DELETE") {
        const pinResponse = await new CommentPinDeleteIrisHandler(database).execute(normalizedEvent);
        processing.replies.push(pinResponse.outboxId
          ? { outboxId: pinResponse.outboxId, room: normalizedEvent.channelId!, data: pinResponse.message }
          : await eventProcessor.queueCommandReply(normalizedEvent, "HOME_COMMENT_PIN_DELETE", pinResponse.message));
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && packageCatalogWizardHandler !== undefined
        && (packageCatalogWizardActiveInput
          || (partialDispatchDecision?.route === "MODERN"
            && (partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_WIZARD_GUIDE"
              || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_WIZARD_START"
              || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_WIZARD_CANCEL"
              || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_WIZARD_STATUS")))) {
        const wizardResponse = await packageCatalogWizardHandler.execute(normalizedEvent);
        if (wizardResponse.outboxId) {
          processing.replies.push({ outboxId: wizardResponse.outboxId, room: normalizedEvent.channelId!, data: wizardResponse.message });
        } else {
          processing.replies.push(await eventProcessor.queueCommandReply(normalizedEvent, wizardResponse.commandCode, wizardResponse.message));
        }
      }
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

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.message === "/내정보"
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "USER_PROFILE"
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

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPointEditCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new IrisAdminCommandService(database!, config.irisAllowedOpenChatIds).changePlayerPoint({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "changed") {
            const replies = result.replies ?? [{ outboxId: result.outboxId, data: result.data }];
            for (const reply of replies) {
              processing.replies.push({ outboxId: reply.outboxId, room: reply.room ?? normalizedEvent.channelId, data: reply.data });
            }
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "admin_point_edit_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isAdminDiamondEditCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "admin_diamond_edit"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new AdminDiamondEditService(database!).handle({
            externalUserId: normalizedEvent.userId, channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!, eventId: normalizedEvent.eventId
          });
          if (result.status === "changed") {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "admin_diamond_edit_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isAdminDiamondResetAllCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "admin_diamond_reset_all"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new AdminDiamondResetAllService(database!).handle({
            externalUserId: normalizedEvent.userId, channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!, eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "admin_diamond_reset_all_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isDailyPrayerCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new DailyPrayerIrisCommandService(database!, {
            random: dependencies.dailyPrayerRandom
          }).execute({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "completed") {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "daily_prayer_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isAutoExploreFixedConfigCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new AutoExploreFixedConfigService(database!).handleIris({ externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId, message: normalizedEvent.message!, eventId: normalizedEvent.eventId });
          if (result.status === "completed") processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [404,422].includes(error.statusCode)) processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"auto_explore_fixed_config_error",error.message));
          else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isHappyFoundationCaptainCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "happy_foundation_captain"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new HappyFoundationCaptainService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "happy_foundation_captain_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isFirstSponsorCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "admin_first_sponsor_registry"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new FirstSponsorRegistryService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "admin_first_sponsor_registry_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isInventoryBulkSellCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "inventory_bulk_sell"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new InventoryBulkSellService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if ((result.status === "sold" || result.status === "nothing_to_sell")
            && result.outboxId !== undefined && result.data !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "inventory_bulk_sell_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isDiamondBoxCraftCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "diamond_box_craft"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new DiamondBoxCraftService(database!).handle({ externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId, message: normalizedEvent.message!, eventId: normalizedEvent.eventId });
          if (result.status !== "ignored_unregistered" && result.outboxId !== undefined && result.data !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"diamond_box_craft_error",error.message));
          } else throw error;
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
        && isPetStatusCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pet_status_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PetStatusService(database!).read({
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId,
          idempotencyKey: normalizedEvent.eventId,
          sourceEventId: normalizedEvent.eventId,
        });
        if (result.status === "displayed" && result.data !== null && result.outboxId !== null) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
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
        && isSpiritRankCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "spirit_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new SpiritRankService(database!).read({ eventId:normalizedEvent.eventId,
          externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId });
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSpiritInfoCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "spirit_info_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new SpiritInfoService(database!).read({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId });
        for (const reply of result.replies) processing.replies.push({ outboxId: reply.outboxId, room: normalizedEvent.channelId, data: reply.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantBagCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_bag_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantBagService(database!).read({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status === "replied") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantBagCleanupCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_bag_cleanup"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantBagCleanupService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantEnhanceCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_enhance"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantEnhanceService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantEnhanceCorrectionCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_enhance_correction"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantEnhanceCorrectionService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantDurabilityCorrectionCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_durability_correction"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantDurabilityCorrectionService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantMarketRegisterCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_market_register"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantMarketRegisterService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantMarketInfoCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_market_info"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantMarketInfoService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantCarrotTradeCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_carrot_trade"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantCarrotTradeService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantRestoreCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_restore"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new PendantRestoreService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});
      }

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantDeleteCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_delete"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantDeleteService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantRankCommand(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_rank_read"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantRankService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantDrawOpenCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_draw_open"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantDrawOpenService(database!,Math.random,config.irisAllowedOpenChatIds).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});for(const reply of result.replies??[])processing.replies.push({outboxId:reply.outboxId,room:reply.room,data:reply.data});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantEquipCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&(partialDispatchDecision.handlerKey==="pendant_equip"||partialDispatchDecision.handlerKey==="pendant_unequip")&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantEquipService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantEquipResetCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_equip_reset"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantEquipResetService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantInfoCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_info_read"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantInfoService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantGrantCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_grant"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantGrantService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantSellCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_sell"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantSellService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantProbabilityCommand(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_probability_read"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantProbabilityService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSpiritNameCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "spirit_name_mutate"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new SpiritNameService(database!).handle({
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
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "spirit_name_mutate", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSpiritNameCombineCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "spirit_name_combine"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new SpiritNameCombineService(database!).handle({
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
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "spirit_name_combine", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleBattleRankingCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "castle_battle_ranking_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new CastleBattleRankingService(new MariaCastleBattleRankingRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "IDENTITY_MAPPING_REQUIRED") {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "castle_battle_ranking_read", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isRiftForceAdminCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "rift_force_admin"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new RiftForceAdminService(database!).handle({
          externalUserId: normalizedEvent.userId, channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!, eventId: normalizedEvent.eventId, nodeEnv: config.nodeEnv
        });
        if (result.status !== "handled_no_reply") {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildRecruitmentToggleCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "guild_recruitment_toggle"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildRecruitmentToggleService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "guild_recruitment_toggle_error", error.message
            ));
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
        && isSignupCommand(normalizedEvent.message) && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "USER_SIGNUP" && normalizedEvent.userId !== undefined
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
