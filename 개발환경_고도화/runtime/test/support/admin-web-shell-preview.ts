import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { registerAdminWebShellRoutes } from "../../src/admin/web-shell.js";
import { buildRestoreConfirmationToken } from "../../src/admin/data-restore-service.js";
import {
  syntheticAdminAudit,
  syntheticAdminOverview,
  syntheticAdminPlayer,
  syntheticAdminRestrictions,
  syntheticAdminSession,
  syntheticMonitoringEvent
} from "../fixtures/admin-web-shell.js";
import { syntheticDiamondCatalogResponse } from "../fixtures/admin-diamond-catalog-web-consumer.js";
import { syntheticPackageCatalogResponse } from "../fixtures/admin-package-catalog-web-consumer.js";
import { syntheticObjectCatalogObject } from "../fixtures/admin-object-catalog-web-consumer.js";
import type { AdminBalanceDomainProjection } from "../../src/admin/admin-balance-read-model.js";

// 운영 데이터 없이 관리자 웹 셸을 검수할 합성 API 서버를 구성합니다.
export async function buildSyntheticAdminWebShellApp() {
  const app = Fastify({ logger: false });
  let catalog: {
    catalogVersion: string;
    bootstrapSource: string;
    bootstrapVersion: string;
    bootstrapStatus: string;
    items: Array<{ productId: string; displayName: string; quantity: string; price: string; displayOrder: number; version: string }>;
  } = { ...syntheticDiamondCatalogResponse, items: syntheticDiamondCatalogResponse.items.map((item) => ({ ...item })) };
  const completed = new Map<string, Record<string, unknown>>();
  let packageCatalog: {
    catalogKey: string;
    catalogVersion: string;
    entries: Array<{ packageId: string; displayName: string; displayOrder: number; active: boolean; expectedVersion: string }>;
  } = { ...syntheticPackageCatalogResponse, entries: syntheticPackageCatalogResponse.entries.map((entry) => ({ ...entry })) };
  const completedPackages = new Map<string, Record<string, unknown>>();
  const objects = new Map([[syntheticObjectCatalogObject.objectKey, { ...syntheticObjectCatalogObject }]]);
  const completedObjects = new Map<string, Record<string, unknown>>();
  let loggedIn = false;
  let nextRestrictionId = 62000;
  let nextAuditId = 82000;
  const restrictions: Array<Record<string, unknown>> = syntheticAdminRestrictions.map((restriction) => ({ ...restriction }));
  const currencyAccounts = syntheticAdminPlayer.currencyAccounts.map((account) => ({ ...account }));
  const replays = new Map<string, Record<string, unknown>>();
  let nextBackupRunId = 91000;
  let restoreRevision = 12n;
  const restoreSourceRevision = "sha256:" + "a".repeat(64);
  const restoreSourceHash = "b".repeat(64);
  let balanceDomains: AdminBalanceDomainProjection[] = [
    { domain: "home_badge", label: "홈뱃지 조건", version: "41", source: "synthetic:badge", values: [
      { domain: "home_badge", key: "home_badge.visit.criteria.totalVisits", group: "home_badge.visit", sumGroup: null, label: "🏠 방문왕 · 누적 방문", value: "100", unit: "회", min: "0", max: "9007199254740991", step: "1", version: "41", editable: true, source: "synthetic:badge" },
      { domain: "home_badge", key: "home_badge.like.criteria.receivedHomeLikes", group: "home_badge.like", sumGroup: null, label: "💗 인기홈 · 받은 좋아홈", value: "50", unit: "회", min: "0", max: "9007199254740991", step: "1", version: "41", editable: true, source: "synthetic:badge" }
    ] },
    { domain: "home_furniture", label: "가구 뽑기", version: "14", source: "synthetic:furniture", values: [
      { domain: "home_furniture", key: "home_furniture.grade.1.probability", group: "home_furniture.grade.1", sumGroup: "home_furniture.grade.probability", label: "일반 등급 확률", value: "70", unit: "%", min: "0", max: "100", step: "0.01", version: "14", editable: true, source: "synthetic:furniture" },
      { domain: "home_furniture", key: "home_furniture.grade.2.probability", group: "home_furniture.grade.2", sumGroup: "home_furniture.grade.probability", label: "희귀 등급 확률", value: "20", unit: "%", min: "0", max: "100", step: "0.01", version: "14", editable: true, source: "synthetic:furniture" },
      { domain: "home_furniture", key: "home_furniture.grade.3.probability", group: "home_furniture.grade.3", sumGroup: "home_furniture.grade.probability", label: "전설 등급 확률", value: "10", unit: "%", min: "0", max: "100", step: "0.01", version: "14", editable: true, source: "synthetic:furniture" }
    ] },
    { domain: "pendant", label: "펜던트 강화", version: "9", source: "synthetic:pendant", values: [
      { domain: "pendant", key: "pendant.level.1.success_rate", group: "pendant.level.1", sumGroup: null, label: "+1 성공 확률", value: "95", unit: "%", min: "0", max: "100", step: "0.0001", version: "9", editable: true, source: "synthetic:pendant" },
      { domain: "pendant", key: "pendant.level.1.point_cost", group: "pendant.level.1", sumGroup: null, label: "+1 포인트 비용", value: "1000", unit: "포인트", min: "0", max: "18446744073709551615", step: "1", version: "9", editable: true, source: "synthetic:pendant" }
    ] }
  ];
  const balancePreviews = new Map<string, { mode: "apply" | "rollback"; domain: string; expectedVersion: string; targetVersion: string | null; reason: string; changes: Array<{ key: string; value: string }> }>();
  const completedBalances = new Map<string, Record<string, unknown>>();

  // 합성 재화 문자열을 실제 decimal(30,3)과 같은 1/1000 단위 정수로 변환합니다.
  function parseDecimal3(value: string): bigint | undefined {
    const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(value);
    if (match === null) return undefined;
    const scale = BigInt((match[3] ?? "").padEnd(3, "0"));
    const amount = BigInt(match[2]!) * 1000n + scale;
    return match[1] === "-" ? -amount : amount;
  }

  // 합성 1/1000 단위 정수를 불필요한 소수 0 없이 API 문자열로 변환합니다.
  function formatDecimal3(value: bigint): string {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const fraction = (absolute % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
    return `${negative ? "-" : ""}${absolute / 1000n}${fraction === "" ? "" : `.${fraction}`}`;
  }

  // 현재 합성 재화 상태를 기존 balance map과 version 배열로 함께 노출합니다.
  function currentSyntheticPlayer() {
    return {
      ...syntheticAdminPlayer,
      currencies: Object.fromEntries(currencyAccounts.map((account) => [account.code, account.balance])),
      currencyAccounts: currencyAccounts.map((account) => ({ ...account })),
      restrictions
    };
  }

  // 합성 변경 요청의 인증·권한·CSRF 공통 계약을 검증합니다.
  function authorizeMutation(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, permission = "account.restrict", requireIdempotency = true) {
    if (!loggedIn) return reply.code(401).send({ ok: false, error: { code: "AUTH_REQUIRED", message: "로그인이 필요합니다." } });
    if (request.headers["x-synthetic-permission"] === "deny") return reply.code(403).send({ ok: false, error: { code: "PERMISSION_DENIED", message: `${permission} 권한이 필요합니다.` } });
    if (request.headers["x-csrf-token"] !== "synthetic-csrf-token") return reply.code(403).send({ ok: false, error: { code: "CSRF_INVALID", message: "CSRF 토큰이 올바르지 않습니다." } });
    if (requireIdempotency && (typeof request.headers["idempotency-key"] !== "string" || request.headers["idempotency-key"].trim() === "")) return reply.code(422).send({ ok: false, error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Idempotency-Key가 필요합니다." } });
    return undefined;
  }

  // 합성 변경 본문에 공통 사유와 확인 값이 있는지 검증합니다.
  function validateMutationBody(body: { reason?: unknown; confirmed?: unknown }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) {
    if (typeof body.reason !== "string" || body.reason.trim() === "") return reply.code(422).send({ ok: false, error: { code: "REASON_REQUIRED", message: "조치 사유가 필요합니다." } });
    if (body.confirmed !== true) return reply.code(422).send({ ok: false, error: { code: "CONFIRMATION_REQUIRED", message: "명시적 확인이 필요합니다." } });
    return undefined;
  }

  await registerAdminWebShellRoutes(app);
  app.post("/api/v1/admin/sessions", async () => {
    loggedIn = true;
    return { ok: true, session: syntheticAdminSession, csrfToken: "synthetic-csrf-token" };
  });
  app.get("/api/v1/admin/sessions/current", async (_request, reply) => loggedIn
    ? { ok: true, session: syntheticAdminSession, requestId: "synthetic-session" }
    : reply.code(401).send({ ok: false, error: { code: "AUTH_REQUIRED", message: "로그인이 필요합니다." }, requestId: "synthetic-session" }));
  app.delete("/api/v1/admin/sessions/current", async (request, reply) => {
    if (request.headers["x-csrf-token"] !== "synthetic-csrf-token") return reply.code(403).send({ ok: false, error: { code: "CSRF_INVALID", message: "CSRF 토큰이 올바르지 않습니다." } });
    loggedIn = false;
    return reply.code(204).send();
  });
  app.get("/api/v1/admin/overview", async () => ({ ok: true, overview: syntheticAdminOverview, requestId: "synthetic-overview" }));
  app.get("/api/v1/admin/players", async () => ({ ok: true, items: [currentSyntheticPlayer()], page: 1, limit: 25, total: 1, requestId: "synthetic-players" }));
  app.get<{ Params: { playerId: string } }>("/api/v1/admin/players/:playerId", async (request, reply) => request.params.playerId === syntheticAdminPlayer.playerId
    ? { ok: true, player: currentSyntheticPlayer(), requestId: "synthetic-player" }
    : reply.code(404).send({ ok: false, error: { code: "PLAYER_NOT_FOUND", message: "합성 회원을 찾을 수 없습니다." }, requestId: "synthetic-player" }));
  app.post<{ Params: { playerId: string }; Body: { restrictionType?: unknown; endsAt?: unknown; reason?: unknown; confirmed?: unknown } }>("/api/v1/admin/players/:playerId/restrictions", async (request, reply) => {
    const authorization = authorizeMutation(request, reply);
    if (authorization !== undefined) return authorization;
    const invalidBody = validateMutationBody(request.body ?? {}, reply);
    if (invalidBody !== undefined) return invalidBody;
    if (request.params.playerId !== syntheticAdminPlayer.playerId) return reply.code(404).send({ ok: false, error: { code: "PLAYER_NOT_FOUND", message: "합성 회원을 찾을 수 없습니다." } });
    if (request.body.restrictionType !== "temporary_suspension" && request.body.restrictionType !== "permanent_suspension") return reply.code(422).send({ ok: false, error: { code: "INVALID_RESTRICTION_TYPE", message: "제재 유형이 올바르지 않습니다." } });
    if (request.body.restrictionType === "temporary_suspension" && typeof request.body.endsAt !== "string") return reply.code(422).send({ ok: false, error: { code: "RESTRICTION_END_REQUIRED", message: "기간 정지는 종료 시각이 필요합니다." } });
    const replayKey = "create:" + request.headers["idempotency-key"];
    const replay = replays.get(replayKey);
    if (replay !== undefined) return { ok: true, ...replay, requestId: "synthetic-replay" };
    if (request.headers["x-synthetic-audit-failure"] === "true") return reply.code(500).send({ ok: false, error: { code: "SYNTHETIC_AUDIT_FAILURE", message: "command_audit 합성 실패" } });
    const restriction = {
      id: String(nextRestrictionId++), restrictionType: request.body.restrictionType, status: "active",
      reason: request.body.reason as string, startsAt: new Date().toISOString(),
      endsAt: request.body.restrictionType === "temporary_suspension" ? request.body.endsAt as string : null
    };
    restrictions.unshift(restriction);
    const result = { restrictionId: restriction.id, playerId: request.params.playerId, restrictionType: restriction.restrictionType, endsAt: restriction.endsAt, auditId: String(nextAuditId++) };
    replays.set(replayKey, result);
    return reply.code(201).send({ ok: true, ...result, requestId: "synthetic-create" });
  });
  app.patch<{ Params: { restrictionId: string }; Body: { status?: unknown; reason?: unknown; confirmed?: unknown } }>("/api/v1/admin/restrictions/:restrictionId", async (request, reply) => {
    const authorization = authorizeMutation(request, reply);
    if (authorization !== undefined) return authorization;
    const invalidBody = validateMutationBody(request.body ?? {}, reply);
    if (invalidBody !== undefined) return invalidBody;
    if (request.body.status !== "revoked") return reply.code(422).send({ ok: false, error: { code: "INVALID_RESTRICTION_STATUS", message: "제재 상태가 올바르지 않습니다." } });
    const replayKey = "revoke:" + request.headers["idempotency-key"];
    const replay = replays.get(replayKey);
    if (replay !== undefined) return { ok: true, ...replay, requestId: "synthetic-replay" };
    const restriction = restrictions.find((candidate) => candidate.id === request.params.restrictionId && candidate.status === "active");
    if (restriction === undefined) return reply.code(404).send({ ok: false, error: { code: "RESTRICTION_NOT_FOUND", message: "활성 제재를 찾을 수 없습니다." } });
    if (request.headers["x-synthetic-audit-failure"] === "true") return reply.code(500).send({ ok: false, error: { code: "SYNTHETIC_AUDIT_FAILURE", message: "command_audit 합성 실패" } });
    restriction.status = "revoked";
    const result = { restrictionId: request.params.restrictionId, playerId: syntheticAdminPlayer.playerId, status: "revoked", auditId: String(nextAuditId++) };
    replays.set(replayKey, result);
    return { ok: true, ...result, requestId: "synthetic-revoke" };
  });
  app.post<{ Params: { playerId: string; currencyCode: string }; Body: { delta?: unknown; expectedVersion?: unknown; reason?: unknown; confirmed?: unknown } }>("/api/v1/admin/players/:playerId/currencies/:currencyCode/adjustments", async (request, reply) => {
    const authorization = authorizeMutation(request, reply, "game.currency.change");
    if (authorization !== undefined) return authorization;
    const invalidBody = validateMutationBody(request.body ?? {}, reply);
    if (invalidBody !== undefined) return invalidBody;
    if (request.params.playerId !== syntheticAdminPlayer.playerId) return reply.code(404).send({ ok: false, error: { code: "PLAYER_NOT_FOUND", message: "합성 회원을 찾을 수 없습니다." } });
    if (typeof request.body.delta !== "string" || (typeof request.body.expectedVersion !== "string" && typeof request.body.expectedVersion !== "number")) return reply.code(422).send({ ok: false, error: { code: "INVALID_CURRENCY_ADJUSTMENT", message: "delta와 expectedVersion이 필요합니다." } });
    const delta = parseDecimal3(request.body.delta);
    if (delta === undefined || delta === 0n) return reply.code(422).send({ ok: false, error: { code: "ZERO_CURRENCY_DELTA", message: "재화 변경량은 0일 수 없습니다." } });
    const replayKey = `currency:${request.params.playerId}:${request.params.currencyCode}:${request.headers["idempotency-key"]}`;
    const replay = replays.get(replayKey);
    if (replay !== undefined) return { ok: true, ...replay, requestId: "synthetic-replay" };
    const account = currencyAccounts.find((candidate) => candidate.code === request.params.currencyCode);
    if (account === undefined) return reply.code(404).send({ ok: false, error: { code: "CURRENCY_NOT_FOUND", message: "사용 가능한 재화를 찾을 수 없습니다." } });
    if (account.version !== String(request.body.expectedVersion)) return reply.code(409).send({ ok: false, error: { code: "CURRENCY_VERSION_CONFLICT", message: "재화 잔액이 먼저 변경되었습니다." } });
    const nextBalance = parseDecimal3(account.balance)! + delta;
    if (nextBalance < 0n) return reply.code(409).send({ ok: false, error: { code: "INSUFFICIENT_CURRENCY", message: "재화 잔액이 부족합니다." } });
    if (request.headers["x-synthetic-audit-failure"] === "true" || request.headers["x-synthetic-outbox-failure"] === "true") return reply.code(500).send({ ok: false, error: { code: "SYNTHETIC_TRANSACTION_FAILURE", message: "합성 감사/outbox 실패" } });
    account.balance = formatDecimal3(nextBalance);
    account.version = (BigInt(account.version) + 1n).toString();
    const result = { balance: account.balance, version: account.version, auditId: String(nextAuditId++) };
    replays.set(replayKey, result);
    return { ok: true, ...result, requestId: "synthetic-currency-adjust" };
  });
  for (const backup of [
    { path: "/api/v1/admin/backups/managed", permission: "managed_backup.execute", scope: "managed", files: ["member.json", "guildData.json"] },
    { path: "/api/v1/admin/backups/dev-sync", permission: "data_backup.execute", scope: "dev-sync", files: ["member.json", "member_pet.json"] }
  ]) {
    app.post<{ Body: { reason?: unknown; confirmed?: unknown } }>(backup.path, async (request, reply) => {
      const authorization = authorizeMutation(request, reply, backup.permission);
      if (authorization !== undefined) return authorization;
      const invalidBody = validateMutationBody(request.body ?? {}, reply);
      if (invalidBody !== undefined) return invalidBody;
      const replayKey = `backup:${backup.scope}:${request.headers["idempotency-key"]}`;
      const replay = replays.get(replayKey);
      if (replay !== undefined) return { ok: true, ...replay, requestId: "synthetic-replay" };
      if (request.headers["x-synthetic-audit-failure"] === "true") return reply.code(500).send({ ok: false, error: { code: "SYNTHETIC_AUDIT_FAILURE", message: "command_audit 합성 실패" } });
      const result = backup.scope === "managed"
        ? { runId: String(nextBackupRunId++), sourceRevisionKey: restoreSourceRevision, targetCount: backup.files.length, presentFiles: backup.files, missingFiles: [], outboxId: null, auditId: String(nextAuditId++) }
        : { runId: String(nextBackupRunId++), sourceRevisionKey: restoreSourceRevision, copiedCount: backup.files.length, copiedFiles: backup.files, outboxId: null, auditId: String(nextAuditId++) };
      replays.set(replayKey, result);
      return reply.code(201).send({ ok: true, ...result, requestId: "synthetic-backup" });
    });
  }
  app.post<{ Body: { environment?: unknown; target?: unknown; generation?: unknown } }>("/api/v1/admin/restores/preview", async (request, reply) => {
    const authorization = authorizeMutation(request, reply, "data_restore.execute", false);
    if (authorization !== undefined) return authorization;
    const environment = request.body?.environment;
    const target = request.body?.target;
    const generation = request.body?.generation;
    if ((environment !== "prod" && environment !== "dev") || (target !== "member" && target !== "member_pet" && target !== "petSkillData" && target !== "petHomeActivityData") || (generation !== 1 && generation !== 2)) return reply.code(422).send({ ok: false, error: { code: "RESTORE_SELECTION_INVALID", message: "복구 선택값이 올바르지 않습니다." } });
    if (request.headers["x-synthetic-backup-unavailable"] === "true") return { ok: true, preview: { environment, target, generation, available: false, sourceRevisionKey: null, sourceHash: null, beforeRevision: null, confirmationToken: null } };
    const beforeRevision = restoreRevision.toString();
    return { ok: true, preview: { environment, target, generation, available: true, sourceRevisionKey: restoreSourceRevision, sourceHash: restoreSourceHash, beforeRevision, confirmationToken: buildRestoreConfirmationToken({ environment, target, generation, sourceRevisionKey: restoreSourceRevision, sourceHash: restoreSourceHash, beforeRevision }) }, requestId: "synthetic-restore-preview" };
  });
  app.post<{ Body: { environment?: unknown; target?: unknown; generation?: unknown; confirmationToken?: unknown; reason?: unknown; confirmed?: unknown } }>("/api/v1/admin/restores", async (request, reply) => {
    const authorization = authorizeMutation(request, reply, "data_restore.execute");
    if (authorization !== undefined) return authorization;
    const invalidBody = validateMutationBody(request.body ?? {}, reply);
    if (invalidBody !== undefined) return invalidBody;
    const environment = request.body.environment;
    const target = request.body.target;
    const generation = request.body.generation;
    if ((environment !== "prod" && environment !== "dev") || (target !== "member" && target !== "member_pet" && target !== "petSkillData" && target !== "petHomeActivityData") || (generation !== 1 && generation !== 2)) return reply.code(422).send({ ok: false, error: { code: "RESTORE_SELECTION_INVALID", message: "복구 선택값이 올바르지 않습니다." } });
    const replayKey = `restore:${environment}:${target}:${generation}:${request.headers["idempotency-key"]}`;
    const replay = replays.get(replayKey);
    if (replay !== undefined) return { ok: true, ...replay, requestId: "synthetic-replay" };
    const beforeRevision = restoreRevision.toString();
    const expected = buildRestoreConfirmationToken({ environment, target, generation, sourceRevisionKey: restoreSourceRevision, sourceHash: restoreSourceHash, beforeRevision });
    if (request.body.confirmationToken !== expected) return reply.code(409).send({ ok: false, error: { code: "RESTORE_PREVIEW_STALE", message: "dry-run 결과가 오래되었습니다." } });
    if (request.headers["x-synthetic-audit-failure"] === "true" || request.headers["x-synthetic-snapshot-failure"] === "true") return reply.code(500).send({ ok: false, error: { code: "SYNTHETIC_TRANSACTION_FAILURE", message: "snapshot/audit 합성 실패" } });
    restoreRevision += 1n;
    const result = { environment, target, generation, restored: true, sourceRevisionKey: restoreSourceRevision, sourceHash: restoreSourceHash, beforeRevision, afterRevision: restoreRevision.toString(), outboxId: null, snapshotId: String(nextBackupRunId++), auditId: String(nextAuditId++) };
    replays.set(replayKey, result);
    return { ok: true, ...result, requestId: "synthetic-restore" };
  });
  app.get("/api/v1/admin/audit-entries", async () => ({ ok: true, items: [syntheticAdminAudit], page: 1, limit: 25, total: 1, requestId: "synthetic-audit" }));
  app.get("/api/v1/admin/channel-activity", async () => ({ ok: true, items: [{
    channelId: "3001", externalChannelId: "synthetic-channel", externalIdentityId: "2001",
    verifiedDisplayName: "합성회원", observedDisplayName: "합성회원", activityDate: "2026-08-30",
    messageCount: "84", mediaCount: "4", replyCount: "6", mentionCount: "2", eventCount: "96",
    lastEventAt: "2026-08-30T01:03:00.000Z"
  }], page: 1, limit: 25, total: 1, requestId: "synthetic-activity" }));
  app.get("/api/v1/admin/moderation-incidents", async () => ({ ok: true, items: [{
    id: "92001", eventId: "synthetic-incident-001", incidentType: "message_deleted", status: "detected",
    channelId: "3001", externalChannelId: "synthetic-channel", channelName: "합성 운영방",
    externalIdentityId: "2001", verifiedDisplayName: "합성회원", occurredAt: "2026-08-30T01:04:00.000Z"
  }], page: 1, limit: 25, total: 1, requestId: "synthetic-incidents" }));
  app.get("/api/v1/admin/monitoring-events", async () => ({ ok: true, items: [syntheticMonitoringEvent], page: 1, limit: 25, total: 1, requestId: "synthetic-monitoring" }));
  app.get("/api/v1/admin/delivery-failures", async () => ({ ok: true, items: [{
    id: "93001", providerCode: "iris", status: "failed", attemptCount: "3", errorCode: "SYNTHETIC_TIMEOUT",
    createdAt: "2026-08-30T01:05:00.000Z"
  }], page: 1, limit: 25, total: 1, requestId: "synthetic-failures" }));
  app.get("/api/v1/admin/balance", async (_request, reply) => loggedIn
    ? { ok: true, domains: balanceDomains, relatedLinks: { audit: "/api/v1/admin/audit-entries", monitoring: "/api/v1/admin/monitoring-events" }, requestId: "synthetic-balance" }
    : reply.code(401).send({ ok: false, error: { code: "AUTH_REQUIRED", message: "로그인이 필요합니다." } }));
  app.post<{ Params: { domain: string }; Body: { mode: "apply" | "rollback"; expectedVersion: string; reason: string; changes?: Array<{ key: string; value: string }>; targetVersion?: string } }>("/api/v1/admin/balance/:domain/preview", async (request, reply) => {
    const denied = authorizeMutation(request, reply, "admin.balance.manage", false); if (denied !== undefined) return denied;
    const domain = balanceDomains.find((item) => item.domain === request.params.domain);
    if (domain === undefined) return reply.code(404).send({ ok: false, error: { code: "BALANCE_DOMAIN_INVALID", message: "관리 가능한 수치 도메인이 아닙니다." } });
    if (domain.version !== request.body.expectedVersion) return reply.code(409).send({ ok: false, error: { code: "BALANCE_VERSION_CONFLICT", message: "수치 버전이 먼저 변경되었습니다." } });
    const changes = request.body.mode === "apply" ? (request.body.changes ?? []) : domain.values.filter((value) => value.editable).map((value) => ({ key: value.key, value: value.value }));
    const diff = changes.map((change) => { const value = domain.values.find((item) => item.key === change.key)!; return { key: change.key, label: value.label, before: value.value, after: change.value, unit: value.unit }; });
    const token = "sha256:synthetic-" + request.params.domain + "-" + request.body.mode + "-" + request.body.expectedVersion;
    balancePreviews.set(token, { mode: request.body.mode, domain: request.params.domain, expectedVersion: request.body.expectedVersion, targetVersion: request.body.targetVersion ?? null, reason: request.body.reason, changes });
    return { ok: true, preview: { mode: request.body.mode, domain: request.params.domain, expectedVersion: request.body.expectedVersion, targetVersion: request.body.targetVersion ?? null, changes: diff, confirmationToken: token }, requestId: "synthetic-balance-preview" };
  });
  for (const mode of ["apply", "rollback"] as const) app.post<{ Params: { domain: string }; Body: { expectedVersion: string; reason: string; changes?: Array<{ key: string; value: string }>; targetVersion?: string; confirmationToken: string; confirmed: boolean } }>(`/api/v1/admin/balance/:domain/${mode}`, async (request, reply) => {
    const denied = authorizeMutation(request, reply, "admin.balance.manage"); if (denied !== undefined) return denied;
    const replayKey = `balance:${mode}:${request.params.domain}:${request.headers["idempotency-key"]}`;
    const replay = completedBalances.get(replayKey); if (replay !== undefined) return { ok: true, result: { ...replay, replayed: true }, requestId: "synthetic-balance-replay" };
    const preview = balancePreviews.get(request.body.confirmationToken);
    if (request.body.confirmed !== true || preview === undefined || preview.mode !== mode || preview.domain !== request.params.domain || preview.expectedVersion !== request.body.expectedVersion) return reply.code(409).send({ ok: false, error: { code: "BALANCE_CONFIRMATION_STALE", message: "preview 결과가 오래되었습니다." } });
    const domain = balanceDomains.find((item) => item.domain === request.params.domain)!;
    const nextVersion = (BigInt(domain.version) + 1n).toString();
    const beforeVersion = domain.version;
    balanceDomains = balanceDomains.map((item) => item.domain === request.params.domain ? {
      ...item,
      version: nextVersion,
      values: item.values.map((value) => ({ ...value, value: preview.changes.find((change) => change.key === value.key)?.value ?? value.value, version: nextVersion }))
    } : item);
    const result = { mode, domain: request.params.domain, beforeVersion, version: nextVersion, targetVersion: preview.targetVersion, changes: preview.changes, operationId: "synthetic-balance-operation", auditId: String(nextAuditId++), outboxId: "synthetic-balance-outbox", replayed: false };
    completedBalances.set(replayKey, result);
    return { ok: true, result, requestId: "synthetic-balance-execute" };
  });
  app.get("/api/v1/admin/diamond-shop/catalog", async () => ({ ok: true, catalog, requestId: "synthetic-diamond-catalog" }));
  app.post<{ Body: { displayName: string; quantity: string; price: string; expectedVersion: string } }>("/api/v1/admin/diamond-shop/catalog/items", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completed.get(key);
    if (prior !== undefined) return reply.code(201).send({ ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-diamond-add-replay" });
    if (request.body.expectedVersion !== catalog.catalogVersion) return reply.code(409).send({ ok: false, error: { code: "DIAMOND_SHOP_CATALOG_CONFLICT", message: "다이아상점 목록이 먼저 변경되었습니다." }, requestId: "synthetic-diamond-conflict" });
    const nextVersion = (BigInt(catalog.catalogVersion) + 1n).toString();
    const productId = "synthetic-" + (catalog.items.length + 1) + "-0000-0000-000000002366";
    catalog = { ...catalog, catalogVersion: nextVersion, items: [...catalog.items, { productId, displayName: request.body.displayName, quantity: request.body.quantity, price: request.body.price, displayOrder: catalog.items.length + 1, version: "1" }] };
    const result = { status: "added", replayed: false, productId, catalogVersion: nextVersion, operationId: "synthetic-add-operation", auditId: "synthetic-add-audit" };
    completed.set(key, result);
    return reply.code(201).send({ ok: true, result, requestId: "synthetic-diamond-add" });
  });
  app.delete<{ Params: { productId: string }; Body: { expectedVersion: string } }>("/api/v1/admin/diamond-shop/catalog/items/:productId", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completed.get(key);
    if (prior !== undefined) return { ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-diamond-disable-replay" };
    if (request.body.expectedVersion !== catalog.catalogVersion) return reply.code(409).send({ ok: false, error: { code: "DIAMOND_SHOP_CATALOG_CONFLICT", message: "다이아상점 목록이 먼저 변경되었습니다." }, requestId: "synthetic-diamond-conflict" });
    if (!catalog.items.some((item) => item.productId === request.params.productId)) return reply.code(404).send({ ok: false, error: { code: "DIAMOND_SHOP_PRODUCT_NOT_FOUND", message: "다이아상점 상품을 찾을 수 없습니다." }, requestId: "synthetic-diamond-not-found" });
    const nextVersion = (BigInt(catalog.catalogVersion) + 1n).toString();
    catalog = { ...catalog, catalogVersion: nextVersion, items: catalog.items.filter((item) => item.productId !== request.params.productId) };
    const result = { status: "disabled", replayed: false, productId: request.params.productId, catalogVersion: nextVersion, operationId: "synthetic-disable-operation", auditId: "synthetic-disable-audit" };
    completed.set(key, result);
    return { ok: true, result, requestId: "synthetic-diamond-disable" };
  });
  app.get("/api/v1/admin/package-catalog", async () => ({ ok: true, catalog: packageCatalog, requestId: "synthetic-package-catalog" }));
  app.post<{ Body: { displayName: string; expectedCatalogVersion: string } }>("/api/v1/admin/package-catalog/packages", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completedPackages.get(key);
    if (prior !== undefined) return reply.code(201).send({ ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-package-add-replay" });
    if (request.body.expectedCatalogVersion !== packageCatalog.catalogVersion) return reply.code(409).send({ ok: false, error: { code: "PACKAGE_CATALOG_VERSION_CONFLICT", message: "패키지 목록이 먼저 변경되었습니다." }, requestId: "synthetic-package-conflict" });
    const nextVersion = (BigInt(packageCatalog.catalogVersion) + 1n).toString();
    const packageId = "PKG-CUSTOM-" + nextVersion;
    packageCatalog = { ...packageCatalog, catalogVersion: nextVersion, entries: [...packageCatalog.entries, { packageId, displayName: request.body.displayName, displayOrder: packageCatalog.entries.length + 1, active: true, expectedVersion: "1" }] };
    const result = { replayed: false, packageId, catalogVersion: nextVersion, message: "패키지가 추가되었습니다." };
    completedPackages.set(key, result);
    return reply.code(201).send({ ok: true, result, requestId: "synthetic-package-add" });
  });
  app.patch<{ Params: { packageId: string }; Body: { expectedCatalogVersion: string } }>("/api/v1/admin/package-catalog/packages/:packageId", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completedPackages.get(key);
    if (prior !== undefined) return { ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-package-edit-replay" };
    if (request.body.expectedCatalogVersion !== packageCatalog.catalogVersion) return reply.code(409).send({ ok: false, error: { code: "PACKAGE_CATALOG_VERSION_CONFLICT", message: "패키지 목록이 먼저 변경되었습니다." }, requestId: "synthetic-package-conflict" });
    if (!packageCatalog.entries.some((entry) => entry.packageId === request.params.packageId)) return reply.code(404).send({ ok: false, error: { code: "PACKAGE_NOT_FOUND", message: "패키지를 찾을 수 없습니다." }, requestId: "synthetic-package-not-found" });
    const nextVersion = (BigInt(packageCatalog.catalogVersion) + 1n).toString();
    packageCatalog = { ...packageCatalog, catalogVersion: nextVersion, entries: packageCatalog.entries.map((entry) => entry.packageId === request.params.packageId ? { ...entry, expectedVersion: (BigInt(entry.expectedVersion) + 1n).toString() } : entry) };
    const result = { replayed: false, packageId: request.params.packageId, catalogVersion: nextVersion, message: "패키지 보상이 수정되었습니다." };
    completedPackages.set(key, result);
    return { ok: true, result, requestId: "synthetic-package-edit" };
  });
  app.delete<{ Params: { packageId: string }; Body: { expectedCatalogVersion: string } }>("/api/v1/admin/package-catalog/packages/:packageId", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completedPackages.get(key);
    if (prior !== undefined) return { ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-package-remove-replay" };
    if (request.body.expectedCatalogVersion !== packageCatalog.catalogVersion) return reply.code(409).send({ ok: false, error: { code: "PACKAGE_CATALOG_VERSION_CONFLICT", message: "패키지 목록이 먼저 변경되었습니다." }, requestId: "synthetic-package-conflict" });
    if (!packageCatalog.entries.some((entry) => entry.packageId === request.params.packageId)) return reply.code(404).send({ ok: false, error: { code: "PACKAGE_NOT_FOUND", message: "패키지를 찾을 수 없습니다." }, requestId: "synthetic-package-not-found" });
    const nextVersion = (BigInt(packageCatalog.catalogVersion) + 1n).toString();
    packageCatalog = { ...packageCatalog, catalogVersion: nextVersion, entries: packageCatalog.entries.filter((entry) => entry.packageId !== request.params.packageId).map((entry, index) => ({ ...entry, displayOrder: index + 1 })) };
    const result = { replayed: false, packageId: request.params.packageId, catalogVersion: nextVersion, message: "패키지가 목록에서 제거되었습니다." };
    completedPackages.set(key, result);
    return { ok: true, result, requestId: "synthetic-package-remove" };
  });
  app.post<{ Params: { packageId: string }; Body: { expectedCatalogVersion: string } }>("/api/v1/admin/package-catalog/packages/:packageId/enable", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completedPackages.get(key);
    if (prior !== undefined) return { ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-package-enable-replay" };
    if (request.body.expectedCatalogVersion !== packageCatalog.catalogVersion) return reply.code(409).send({ ok: false, error: { code: "PACKAGE_CATALOG_VERSION_CONFLICT", message: "패키지 목록이 먼저 변경되었습니다." }, requestId: "synthetic-package-conflict" });
    if (!packageCatalog.entries.some((entry) => entry.packageId === request.params.packageId)) return reply.code(404).send({ ok: false, error: { code: "PACKAGE_NOT_FOUND", message: "패키지를 찾을 수 없습니다." }, requestId: "synthetic-package-not-found" });
    const nextVersion = (BigInt(packageCatalog.catalogVersion) + 1n).toString();
    packageCatalog = { ...packageCatalog, catalogVersion: nextVersion, entries: packageCatalog.entries.map((entry) => entry.packageId === request.params.packageId ? { ...entry, active: true, expectedVersion: (BigInt(entry.expectedVersion) + 1n).toString() } : entry) };
    const result = { replayed: false, packageId: request.params.packageId, catalogVersion: nextVersion, message: "패키지가 활성화되었습니다." };
    completedPackages.set(key, result);
    return { ok: true, result, requestId: "synthetic-package-enable" };
  });
  app.get<{ Params: { objectKey: string } }>("/api/v1/admin/object-catalog/objects/:objectKey", async (request, reply) => {
    const object = objects.get(request.params.objectKey);
    if (object === undefined) return reply.code(404).send({ ok: false, error: { code: "OBJECT_NOT_FOUND", message: "object_key를 찾을 수 없습니다." }, requestId: "synthetic-object-not-found" });
    return { ok: true, object, requestId: "synthetic-object-read" };
  });
  app.post<{ Body: { objectKey: string; objectType: string; displayName: string; active: boolean; metadata: Record<string, unknown> } }>("/api/v1/admin/object-catalog/objects", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completedObjects.get(key);
    if (prior !== undefined) return reply.code(201).send({ ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-object-register-replay" });
    if (objects.has(request.body.objectKey)) return reply.code(409).send({ ok: false, error: { code: "OBJECT_CONFLICT", message: "object_key가 이미 존재합니다." }, requestId: "synthetic-object-conflict" });
    const object = { definitionId: "18446744073709551614", objectKey: request.body.objectKey, objectType: request.body.objectType as Parameters<typeof objects.set>[1]["objectType"], displayName: request.body.displayName, version: "1", active: request.body.active, metadata: request.body.metadata };
    objects.set(object.objectKey, object);
    const result = { status: "registered", replayed: false, object, operationId: "237401", auditId: "237402" };
    completedObjects.set(key, result);
    return reply.code(201).send({ ok: true, result, requestId: "synthetic-object-register" });
  });
  app.patch<{ Params: { objectKey: string }; Body: { expectedVersion: string; displayName: string; metadata: Record<string, unknown> } }>("/api/v1/admin/object-catalog/objects/:objectKey", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completedObjects.get(key);
    if (prior !== undefined) return { ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-object-update-replay" };
    const current = objects.get(request.params.objectKey);
    if (current === undefined) return reply.code(404).send({ ok: false, error: { code: "OBJECT_NOT_FOUND", message: "object_key를 찾을 수 없습니다." }, requestId: "synthetic-object-not-found" });
    if (current.version !== request.body.expectedVersion) return reply.code(409).send({ ok: false, error: { code: "OBJECT_VERSION_CONFLICT", message: "object version이 변경되었습니다." }, requestId: "synthetic-object-version-conflict" });
    const object = { ...current, displayName: request.body.displayName, metadata: request.body.metadata, version: (BigInt(current.version) + 1n).toString() };
    objects.set(object.objectKey, object);
    const result = { status: "updated", replayed: false, object, operationId: "237403", auditId: "237404" };
    completedObjects.set(key, result);
    return { ok: true, result, requestId: "synthetic-object-update" };
  });
  app.post<{ Params: { objectKey: string }; Body: { expectedVersion: string; active: boolean } }>("/api/v1/admin/object-catalog/objects/:objectKey/active", async (request, reply) => {
    const key = String(request.headers["idempotency-key"] ?? "");
    const prior = completedObjects.get(key);
    if (prior !== undefined) return { ok: true, result: { ...prior, replayed: true }, requestId: "synthetic-object-active-replay" };
    const current = objects.get(request.params.objectKey);
    if (current === undefined) return reply.code(404).send({ ok: false, error: { code: "OBJECT_NOT_FOUND", message: "object_key를 찾을 수 없습니다." }, requestId: "synthetic-object-not-found" });
    if (current.version !== request.body.expectedVersion) return reply.code(409).send({ ok: false, error: { code: "OBJECT_VERSION_CONFLICT", message: "object version이 변경되었습니다." }, requestId: "synthetic-object-version-conflict" });
    const object = { ...current, active: request.body.active, version: (BigInt(current.version) + 1n).toString() };
    objects.set(object.objectKey, object);
    const result = { status: object.active ? "activated" : "deactivated", replayed: false, object, operationId: "237405", auditId: "237406" };
    completedObjects.set(key, result);
    return { ok: true, result, requestId: "synthetic-object-active" };
  });
  return app;
}

const entrypoint = process.argv[1] === undefined ? "" : pathToFileURL(process.argv[1]).href;
if (import.meta.url === entrypoint) {
  const app = await buildSyntheticAdminWebShellApp();
  const port = Number(process.env.ADMIN_WEB_PREVIEW_PORT ?? 3103);
  await app.listen({ host: "127.0.0.1", port });
  console.log(`Synthetic admin web preview: http://127.0.0.1:${port}/admin`);
}
