import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminAuthService, AdminSession } from "./auth-service.js";
import { requirePermission } from "./auth-service.js";
import type { ProfileRepository } from "../player/profile.js";
import type { ChangePlayerServerService } from "../player/change-player-server-service.js";
import { ApplicationError } from "../shared/application-error.js";
import type { AdminDirectoryService } from "./directory-service.js";
import type { AdminManagementService } from "./management-service.js";
import type { ModerationIncidentService } from "../integration/moderation-incident-service.js";
import type { IrisKakaoDatabaseSnapshot } from "../integration/iris-kakao-database-inspector.js";
import type { RetainedEventContentService } from "../integration/retained-event-content-service.js";
import type { CurrencyService } from "../currency/currency-service.js";
import type { ManagedBackupCommandService } from "./managed-backup-command-service.js";
import type { DataBackupService } from "./data-backup-service.js";
import type { DataRestoreGeneration, DataRestoreService } from "./data-restore-service.js";
import type { DataStatusEnvironment, DataStatusTarget } from "./data-status-service.js";

interface AdminRouteDependencies {
  auth: AdminAuthService;
  profiles: ProfileRepository;
  changePlayerServer: ChangePlayerServerService;
  directory: AdminDirectoryService;
  management: AdminManagementService;
  moderationIncidents: ModerationIncidentService;
  inspectIrisKakaoDatabase: (event: import("../integration/iris-normalizer.js").NormalizedIrisEvent) => Promise<IrisKakaoDatabaseSnapshot>;
  retainedEventContents: RetainedEventContentService;
  currency: CurrencyService;
  managedBackup?: ManagedBackupCommandService;
  dataBackup?: DataBackupService;
  dataRestore?: DataRestoreService;
  secureCookies: boolean;
}

const SESSION_COOKIE = "hoibot_admin_session";

type MutationBody = { reason?: unknown; confirmed?: unknown };

function readPage(query: { page?: string; limit?: string }): { page: number; limit: number; offset: number } {
  const page = Math.max(Number(query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
  return { page, limit, offset: (page - 1) * limit };
}

function readMutation(request: FastifyRequest, body: MutationBody | undefined): { idempotencyKey: string; reason: string } {
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 헤더가 필요합니다.", 422);
  if (typeof body?.reason !== "string" || body.reason.trim() === "") throw new ApplicationError("REASON_REQUIRED", "변경 사유가 필요합니다.", 422);
  if (body.confirmed !== true) throw new ApplicationError("CONFIRMATION_REQUIRED", "변경 내용을 다시 확인해 주세요.", 422);
  return { idempotencyKey, reason: body.reason.trim() };
}

async function authenticate(request: FastifyRequest, dependencies: AdminRouteDependencies, requireCsrf: boolean): Promise<AdminSession> {
  const token = request.cookies[SESSION_COOKIE] ?? "";
  const csrf = requireCsrf ? request.headers["x-csrf-token"] : undefined;
  if (requireCsrf && typeof csrf !== "string") throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  return dependencies.auth.authenticate(token, typeof csrf === "string" ? csrf : undefined);
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 86_400 });
}

function requireSuperAdmin(session: AdminSession): void {
  if (!session.roleCodes.includes("super_admin")) throw new ApplicationError("SUPER_ADMIN_REQUIRED", "최고관리자만 수행할 수 있습니다.", 403);
}

function requireBackupDependency<T>(value: T | undefined): T {
  if (value === undefined) throw new ApplicationError("BACKUP_RECOVERY_UNAVAILABLE", "백업·복구 웹 연결이 준비되지 않았습니다.", 503);
  return value;
}

function readRestoreSelection(body: { environment?: unknown; target?: unknown; generation?: unknown }): {
  environment: DataStatusEnvironment;
  target: DataStatusTarget;
  generation: DataRestoreGeneration;
} {
  const environment = body.environment === "prod" || body.environment === "dev" ? body.environment : undefined;
  const target = body.target === "member" || body.target === "member_pet" || body.target === "petSkillData" || body.target === "petHomeActivityData" ? body.target : undefined;
  const generation = body.generation === 1 || body.generation === 2 ? body.generation : undefined;
  if (environment === undefined || target === undefined || generation === undefined) throw new ApplicationError("RESTORE_SELECTION_INVALID", "환경, 대상, 백업 세대를 확인해 주세요.", 422);
  return { environment, target, generation };
}

// 관리자 인증·운영·권한 관리 REST API를 등록합니다.
export async function registerAdminRoutes(app: FastifyInstance, dependencies: AdminRouteDependencies): Promise<void> {
  app.post<{ Body: { loginId?: unknown; password?: unknown } }>("/api/v1/admin/sessions", async (request, reply) => {
    if (typeof request.body?.loginId !== "string" || typeof request.body?.password !== "string") throw new ApplicationError("INVALID_LOGIN_REQUEST", "loginId와 password가 필요합니다.", 422);
    const result = await dependencies.auth.login(request.body.loginId, request.body.password);
    setSessionCookie(reply, result.sessionToken, dependencies.secureCookies);
    return reply.code(201).send({ ok: true, session: { operatorId: result.operatorId, loginId: result.loginId, displayName: result.displayName, roleCodes: result.roleCodes, permissions: result.permissions }, csrfToken: result.csrfToken, requestId: request.id });
  });

  app.get("/api/v1/admin/sessions/current", async (request) => ({ ok: true, session: await authenticate(request, dependencies, false), requestId: request.id }));

  app.delete("/api/v1/admin/sessions/current", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE] ?? "";
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string") throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
    await dependencies.auth.logout(token, csrf);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/v1/admin/overview", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "overview.read");
    return { ok: true, overview: await dependencies.management.overview(), requestId: request.id };
  });

  app.get<{ Querystring: { search?: string; page?: string; limit?: string } }>("/api/v1/admin/players", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "player.read");
    const paging = readPage(request.query);
    const [items, total] = await Promise.all([dependencies.profiles.list(request.query.search, paging.limit, paging.offset), dependencies.profiles.count(request.query.search)]);
    return { ok: true, items, page: paging.page, limit: paging.limit, total, requestId: request.id };
  });

  app.get<{ Params: { playerId: string } }>("/api/v1/admin/players/:playerId", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "player.read");
    const profile = await dependencies.profiles.findByPlayerId(request.params.playerId);
    if (profile === null) throw new ApplicationError("PLAYER_NOT_FOUND", "회원을 찾을 수 없습니다.", 404);
    const restrictions = await dependencies.management.listRestrictions(request.params.playerId);
    return { ok: true, player: { ...profile, restrictions }, requestId: request.id };
  });

  app.post<{ Params: { playerId: string; currencyCode: string }; Body: MutationBody & { delta?: unknown; expectedVersion?: unknown } }>("/api/v1/admin/players/:playerId/currencies/:currencyCode/adjustments", async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "game.currency.change");
    const mutation = readMutation(request, request.body);
    if (typeof request.body?.delta !== "string" || (typeof request.body.expectedVersion !== "string" && typeof request.body.expectedVersion !== "number")) {
      throw new ApplicationError("INVALID_CURRENCY_ADJUSTMENT", "delta와 expectedVersion이 필요합니다.", 422);
    }
    const profile = await dependencies.profiles.findByPlayerId(request.params.playerId);
    if (profile === null) throw new ApplicationError("PLAYER_NOT_FOUND", "회원을 찾을 수 없습니다.", 404);
    const result = await dependencies.currency.adjust({
      playerId: request.params.playerId,
      currencyCode: request.params.currencyCode,
      delta: request.body.delta,
      expectedVersion: String(request.body.expectedVersion),
      reasonCode: "ADMIN_WEB_CURRENCY_ADJUST",
      reason: mutation.reason,
      idempotencyKey: mutation.idempotencyKey,
      actor: { type: "admin_operator", id: session.operatorId },
      sourceCode: "admin_api"
    });
    return { ok: true, ...result, requestId: request.id };
  });

  app.put<{ Params: { playerId: string }; Body: MutationBody & { serverCode?: unknown; expectedVersion?: unknown } }>("/api/v1/admin/players/:playerId/server-assignment", async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "player.server.assign");
    const mutation = readMutation(request, request.body);
    if (typeof request.body?.serverCode !== "string" || (typeof request.body.expectedVersion !== "string" && typeof request.body.expectedVersion !== "number")) throw new ApplicationError("INVALID_SERVER_ASSIGNMENT", "serverCode와 expectedVersion이 필요합니다.", 422);
    const result = await dependencies.changePlayerServer.execute({ playerId: request.params.playerId, serverCode: request.body.serverCode, expectedVersion: String(request.body.expectedVersion), reason: mutation.reason, idempotencyKey: mutation.idempotencyKey, actorId: session.operatorId, sourceCode: "admin_api" });
    return { ok: true, ...result, requestId: request.id };
  });

  app.get("/api/v1/admin/game-servers", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "player.read");
    const items = await dependencies.directory.listGameServers();
    return { ok: true, items, page: 1, limit: items.length, total: items.length, requestId: request.id };
  });

  app.get<{ Querystring: { status?: string; page?: string; limit?: string } }>("/api/v1/admin/external-identities", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "identity.read");
    const paging = readPage(request.query); const result = await dependencies.directory.listExternalIdentities(request.query.status, paging.limit, paging.offset);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.put<{ Params: { identityId: string }; Body: MutationBody & { playerId?: unknown } }>("/api/v1/admin/external-identities/:identityId/player-assignment", async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "identity.assign");
    const mutation = readMutation(request, request.body);
    if (typeof request.body?.playerId !== "string") throw new ApplicationError("PLAYER_ID_REQUIRED", "playerId가 필요합니다.", 422);
    const result = await dependencies.directory.approveIdentity({ identityId: request.params.identityId, playerId: request.body.playerId, reason: mutation.reason, actorId: session.operatorId, idempotencyKey: mutation.idempotencyKey });
    return { ok: true, ...result, requestId: request.id };
  });

  app.get<{ Querystring: { page?: string; limit?: string } }>("/api/v1/admin/audit-entries", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "audit.read");
    const paging = readPage(request.query); const result = await dependencies.directory.listAudit(paging.limit, paging.offset);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.get<{ Querystring: { page?: string; limit?: string } }>("/api/v1/admin/channel-activity", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "activity.read");
    const paging = readPage(request.query); const result = await dependencies.directory.listChannelActivity(paging.limit, paging.offset);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.get<{ Querystring: { page?: string; limit?: string; type?: string } }>("/api/v1/admin/moderation-incidents", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "incident.read");
    const paging = readPage(request.query);
    const kind = request.query.type === "deleted" || request.query.type === "edited" ? request.query.type : "all";
    const result = await dependencies.directory.listModerationIncidents(paging.limit, paging.offset, kind);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.get<{ Querystring: { page?: string; limit?: string; group?: string } }>("/api/v1/admin/monitoring-events", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "monitoring.read");
    const paging = readPage(request.query);
    const group = request.query.group === "media" || request.query.group === "event"
      ? request.query.group : "all";
    const result = await dependencies.directory.listMonitoringEvents(paging.limit, paging.offset, group);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.get<{ Querystring: { page?: string; limit?: string } }>("/api/v1/admin/retained-event-contents", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "monitoring.read");
    const paging = readPage(request.query); const result = await dependencies.directory.listRetainedEventContents(paging.limit, paging.offset);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.get<{ Params: { contentId: string } }>("/api/v1/admin/retained-event-contents/:contentId", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "event.content.read");
    const content = await dependencies.retainedEventContents.readDetail(request.params.contentId, session.operatorId);
    if (content === null) throw new ApplicationError("RETAINED_CONTENT_NOT_FOUND", "보관된 이벤트 내용을 찾을 수 없습니다.", 404);
    return { ok: true, content, requestId: request.id };
  });

  app.get<{ Params: { contentId: string } }>("/api/v1/admin/retained-event-contents/:contentId/media", async (request, reply) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "event.content.read");
    const media = await dependencies.retainedEventContents.readMedia(request.params.contentId, session.operatorId);
    if (media === null) throw new ApplicationError("RETAINED_MEDIA_NOT_FOUND", "보관된 미디어를 찾을 수 없습니다.", 404);
    return reply.header("cache-control", "private, no-store").type(media.mimeType).send(media.data);
  });

  app.get<{ Querystring: { page?: string; limit?: string; channelId?: string; externalIdentityId?: string } }>("/api/v1/admin/channel-membership-events", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "monitoring.read");
    const paging = readPage(request.query);
    const hasFilter = request.query.channelId !== undefined || request.query.externalIdentityId !== undefined;
    if (hasFilter && (!/^\d+$/.test(request.query.channelId ?? "") || !/^\d+$/.test(request.query.externalIdentityId ?? ""))) {
      throw new ApplicationError("MEMBERSHIP_FILTER_INVALID", "방과 사용자 식별자를 모두 확인해 주세요.", 422);
    }
    const filter = hasFilter
      ? { channelId: request.query.channelId!, externalIdentityId: request.query.externalIdentityId! }
      : undefined;
    const result = await dependencies.directory.listMembershipEvents(paging.limit, paging.offset, filter);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.get<{ Querystring: { page?: string; limit?: string } }>("/api/v1/admin/channel-membership-patterns", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "monitoring.read");
    const paging = readPage(request.query); const result = await dependencies.directory.listMembershipPatterns(paging.limit, paging.offset);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.get<{ Params: { incidentId: string } }>("/api/v1/admin/moderation-incidents/:incidentId/content", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "incident.content.read");
    const incident = await dependencies.moderationIncidents.findByNumber(request.params.incidentId);
    if (incident === null) throw new ApplicationError("INCIDENT_NOT_FOUND", "삭제 감지 기록을 찾을 수 없습니다.", 404);
    const snapshot = await dependencies.inspectIrisKakaoDatabase(incident.lookupEvent);
    const recoverMessage = (source: IrisKakaoDatabaseSnapshot["targetChatLog"] | undefined) => source === undefined
      ? { status: "not_found" as const }
      : source.error !== undefined
        ? { status: "failed" as const }
        : source.rows.length !== 1 || typeof source.rows[0]?.message !== "string"
          ? { status: "not_found" as const }
          : { status: "recovered" as const, content: source.rows[0].message.slice(0, 1_000) };
    const originalMessage = recoverMessage(snapshot.targetChatLog);
    const editedMessage = incident.incidentType === "message_edited"
      ? { before: recoverMessage(snapshot.previousTargetChatLog), after: originalMessage }
      : undefined;
    await dependencies.moderationIncidents.recordContentRead(
      incident.incidentId, session.operatorId,
      editedMessage === undefined ? originalMessage.status : `before_${editedMessage.before.status}_after_${editedMessage.after.status}`
    );
    return {
      ok: true,
      incident: {
        id: incident.incidentId, incidentType: incident.incidentType,
        roomName: snapshot.roomName ?? null,
        displayName: snapshot.nicknameSource === "iris_sender" ? null : snapshot.nickname ?? null,
        originalMessage,
        editedMessage
      },
      requestId: request.id
    };
  });

  app.get<{ Querystring: { page?: string; limit?: string } }>("/api/v1/admin/delivery-failures", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "monitoring.read");
    const paging = readPage(request.query); const result = await dependencies.directory.listDeliveryFailures(paging.limit, paging.offset);
    return { ok: true, ...result, page: paging.page, limit: paging.limit, requestId: request.id };
  });

  app.post<{ Body: MutationBody }>("/api/v1/admin/backups/managed", async (request, reply) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "managed_backup.execute");
    const mutation = readMutation(request, request.body);
    const result = await requireBackupDependency(dependencies.managedBackup).backupForOperator({ operatorId: session.operatorId, ...mutation });
    return reply.code(201).send({ ok: true, ...result, requestId: request.id });
  });

  app.post<{ Body: MutationBody }>("/api/v1/admin/backups/dev-sync", async (request, reply) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "data_backup.execute");
    const mutation = readMutation(request, request.body);
    const result = await requireBackupDependency(dependencies.dataBackup).backupForOperator({ operatorId: session.operatorId, ...mutation });
    return reply.code(201).send({ ok: true, ...result, requestId: request.id });
  });

  app.post<{ Body: { environment?: unknown; target?: unknown; generation?: unknown } }>("/api/v1/admin/restores/preview", async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "data_restore.execute");
    const selection = readRestoreSelection(request.body ?? {});
    const preview = await requireBackupDependency(dependencies.dataRestore).previewForOperator({ operatorId: session.operatorId, ...selection });
    return { ok: true, preview, requestId: request.id };
  });

  app.post<{ Body: MutationBody & { environment?: unknown; target?: unknown; generation?: unknown; confirmationToken?: unknown } }>("/api/v1/admin/restores", async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "data_restore.execute");
    const mutation = readMutation(request, request.body);
    const selection = readRestoreSelection(request.body ?? {});
    if (typeof request.body?.confirmationToken !== "string" || request.body.confirmationToken === "") throw new ApplicationError("RESTORE_CONFIRMATION_TOKEN_REQUIRED", "dry-run 확인 토큰이 필요합니다.", 422);
    const result = await requireBackupDependency(dependencies.dataRestore).restoreForOperator({ operatorId: session.operatorId, ...mutation, ...selection, confirmationToken: request.body.confirmationToken });
    return { ok: true, ...result, requestId: request.id };
  });

  app.post<{ Params: { playerId: string }; Body: MutationBody & { restrictionType?: unknown; endsAt?: unknown } }>("/api/v1/admin/players/:playerId/restrictions", async (request, reply) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "account.restrict"); const mutation = readMutation(request, request.body);
    if (request.body?.restrictionType !== "temporary_suspension" && request.body?.restrictionType !== "permanent_suspension") throw new ApplicationError("INVALID_RESTRICTION_TYPE", "제재 유형이 올바르지 않습니다.", 422);
    const result = await dependencies.management.createRestriction({ ...mutation, operatorId: session.operatorId, playerId: request.params.playerId, restrictionType: request.body.restrictionType, endsAt: typeof request.body.endsAt === "string" ? request.body.endsAt : undefined });
    return reply.code(201).send({ ok: true, ...result, requestId: request.id });
  });

  app.patch<{ Params: { restrictionId: string }; Body: MutationBody & { status?: unknown } }>("/api/v1/admin/restrictions/:restrictionId", async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "account.restrict"); const mutation = readMutation(request, request.body);
    if (request.body?.status !== "revoked") throw new ApplicationError("INVALID_RESTRICTION_STATUS", "제재 상태는 revoked로만 변경할 수 있습니다.", 422);
    return { ok: true, ...await dependencies.management.updateRestriction({ ...mutation, operatorId: session.operatorId, restrictionId: request.params.restrictionId, status: "revoked" }), requestId: request.id };
  });

  app.get("/api/v1/admin/account-deletion-requests", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "account.deletion.manage"); const items = await dependencies.management.listDeletionRequests();
    return { ok: true, items, page: 1, limit: 200, total: items.length, requestId: request.id };
  });

  app.patch<{ Params: { requestId: string }; Body: MutationBody & { status?: unknown } }>("/api/v1/admin/account-deletion-requests/:requestId", async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "account.deletion.manage"); const mutation = readMutation(request, request.body);
    if (request.body?.status !== "recovered") throw new ApplicationError("INVALID_DELETION_STATUS", "탈퇴 요청은 recovered로만 변경할 수 있습니다.", 422);
    return { ok: true, ...await dependencies.management.updateDeletionRequest({ ...mutation, operatorId: session.operatorId, requestId: request.params.requestId, status: "recovered" }), requestId: request.id };
  });

  app.get("/api/v1/admin/account-cleanup-runs", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "account.deletion.manage"); const items = await dependencies.management.listCleanupRuns();
    return { ok: true, items, page: 1, limit: 200, total: items.length, requestId: request.id };
  });

  app.get("/api/v1/admin/operators", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "operator.read"); const items = await dependencies.management.listOperators();
    return { ok: true, items, page: 1, limit: items.length, total: items.length, requestId: request.id };
  });

  app.post<{ Body: MutationBody & { loginId?: unknown; displayName?: unknown; password?: unknown; roleCode?: unknown } }>("/api/v1/admin/operators", async (request, reply) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "operator.manage"); requireSuperAdmin(session); const mutation = readMutation(request, request.body);
    if (typeof request.body?.loginId !== "string" || typeof request.body.displayName !== "string" || typeof request.body.password !== "string" || (request.body.roleCode !== "manager" && request.body.roleCode !== "super_admin")) throw new ApplicationError("INVALID_OPERATOR", "운영자 생성 정보가 올바르지 않습니다.", 422);
    const result = await dependencies.management.createOperator({ ...mutation, operatorId: session.operatorId, loginId: request.body.loginId, displayName: request.body.displayName, password: request.body.password, roleCode: request.body.roleCode });
    return reply.code(201).send({ ok: true, ...result, requestId: request.id });
  });

  app.get<{ Params: { operatorId: string } }>("/api/v1/admin/operators/:operatorId", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "operator.read");
    return { ok: true, operator: await dependencies.management.getOperator(request.params.operatorId), requestId: request.id };
  });

  app.patch<{ Params: { operatorId: string }; Body: MutationBody & { displayName?: unknown; status?: unknown } }>("/api/v1/admin/operators/:operatorId", async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "operator.manage"); requireSuperAdmin(session); const mutation = readMutation(request, request.body);
    const status = request.body?.status === "active" || request.body?.status === "suspended" ? request.body.status : undefined;
    const displayName = typeof request.body?.displayName === "string" ? request.body.displayName : undefined;
    if (status === undefined && displayName === undefined) throw new ApplicationError("OPERATOR_CHANGE_REQUIRED", "변경할 운영자 정보가 필요합니다.", 422);
    return { ok: true, ...await dependencies.management.updateOperator({ ...mutation, operatorId: session.operatorId, targetOperatorId: request.params.operatorId, status, displayName }), requestId: request.id };
  });

  for (const method of ["PUT", "DELETE"] as const) app.route<{ Params: { operatorId: string; roleCode: string }; Body: MutationBody }>({ method, url: "/api/v1/admin/operators/:operatorId/roles/:roleCode", handler: async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "authorization.manage"); requireSuperAdmin(session); const mutation = readMutation(request, request.body);
    if (request.params.roleCode !== "manager" && request.params.roleCode !== "super_admin") throw new ApplicationError("INVALID_ROLE", "역할 코드가 올바르지 않습니다.", 422);
    return { ok: true, ...await dependencies.management.setRole({ ...mutation, operatorId: session.operatorId, targetOperatorId: request.params.operatorId, roleCode: request.params.roleCode, remove: method === "DELETE" }), requestId: request.id };
  }});

  for (const method of ["PUT", "DELETE"] as const) app.route<{ Params: { operatorId: string; permissionCode: string }; Body: MutationBody & { effect?: unknown } }>({ method, url: "/api/v1/admin/operators/:operatorId/permission-overrides/:permissionCode", handler: async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, "authorization.manage"); requireSuperAdmin(session); const mutation = readMutation(request, request.body);
    const effect = request.body?.effect === "deny" ? "deny" : "allow";
    return { ok: true, ...await dependencies.management.setPermissionOverride({ ...mutation, operatorId: session.operatorId, targetOperatorId: request.params.operatorId, permissionCode: request.params.permissionCode, effect, remove: method === "DELETE" }), requestId: request.id };
  }});

  app.get<{ Params: { playerId: string } }>("/api/v1/admin/players/:playerId/passes", async (request) => {
    const session = await authenticate(request, dependencies, false); requirePermission(session, "pass.read"); const items = await dependencies.management.listPasses(request.params.playerId);
    return { ok: true, items, page: 1, limit: items.length, total: items.length, requestId: request.id };
  });

  for (const method of ["PUT", "DELETE"] as const) app.route<{ Params: { playerId: string; passCode: string }; Body: MutationBody & { permanent?: unknown; startsAt?: unknown; endsAt?: unknown } }>({ method, url: "/api/v1/admin/players/:playerId/passes/:passCode", handler: async (request) => {
    const session = await authenticate(request, dependencies, true); requirePermission(session, method === "DELETE" ? "pass.revoke" : "pass.grant"); const mutation = readMutation(request, request.body);
    return { ok: true, ...await dependencies.management.setPass({ ...mutation, operatorId: session.operatorId, playerId: request.params.playerId, passCode: request.params.passCode, permanent: request.body?.permanent === true, startsAt: typeof request.body?.startsAt === "string" ? request.body.startsAt : undefined, endsAt: typeof request.body?.endsAt === "string" ? request.body.endsAt : undefined, revoke: method === "DELETE" }), requestId: request.id };
  }});
}
