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

// 운영 데이터 없이 관리자 웹 셸을 검수할 합성 API 서버를 구성합니다.
export async function buildSyntheticAdminWebShellApp() {
  const app = Fastify({ logger: false });
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
  return app;
}

const entrypoint = process.argv[1] === undefined ? "" : pathToFileURL(process.argv[1]).href;
if (import.meta.url === entrypoint) {
  const app = await buildSyntheticAdminWebShellApp();
  const port = Number(process.env.ADMIN_WEB_PREVIEW_PORT ?? 3103);
  await app.listen({ host: "127.0.0.1", port });
  console.log(`Synthetic admin web preview: http://127.0.0.1:${port}/admin`);
}
