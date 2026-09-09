import type { FastifyInstance, FastifyRequest } from "fastify";
import { requirePermission, type AdminSession } from "./auth-service.js";
import type { AdminBalanceDomain, AdminBalanceReadProjection } from "./admin-balance-read-model.js";
import type {
  AdminBalanceApplyInput,
  AdminBalanceMutationPreviewInput,
  AdminBalanceMutationProvider,
  AdminBalanceRollbackInput,
  AdminBalanceValueChangeInput,
} from "./admin-balance-mutation-provider.js";
import { ApplicationError } from "../shared/application-error.js";

interface AdminSessionAuthenticator {
  authenticate(sessionToken: string, csrfToken?: string): Promise<AdminSession>;
}

export interface AdminBalanceWebRouteDependencies {
  auth: AdminSessionAuthenticator;
  reader: { read(): Promise<AdminBalanceReadProjection> };
  mutation: Pick<AdminBalanceMutationProvider, "preview" | "apply" | "rollback">;
}

type PreviewBody = {
  mode?: unknown;
  expectedVersion?: unknown;
  reason?: unknown;
  changes?: unknown;
  targetVersion?: unknown;
};

type ExecuteBody = PreviewBody & { confirmationToken?: unknown; confirmed?: unknown };

const SESSION_COOKIE = "hoibot_admin_session";
export const ADMIN_BALANCE_PERMISSION = "admin.balance.manage";
const DOMAINS: readonly AdminBalanceDomain[] = ["home_badge", "home_furniture", "pendant"];

// REST 경로의 도메인을 승인된 세 provider로만 제한합니다.
function readDomain(value: string): AdminBalanceDomain {
  if (!DOMAINS.includes(value as AdminBalanceDomain)) {
    throw new ApplicationError("BALANCE_DOMAIN_INVALID", "관리 가능한 수치 도메인이 아닙니다.", 404);
  }
  return value as AdminBalanceDomain;
}

// 브라우저에서 손실 없이 전달된 정수 버전 문자열을 검증합니다.
function readVersion(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new ApplicationError("BALANCE_VERSION_INVALID", `${field}은 0 이상의 정수 문자열이어야 합니다.`, 422);
  }
  return value;
}

// typed key/value 변경 배열만 provider에 전달합니다.
function readChanges(value: unknown): AdminBalanceValueChangeInput[] {
  if (!Array.isArray(value)) throw new ApplicationError("BALANCE_CHANGES_INVALID", "변경 항목 배열이 필요합니다.", 422);
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) throw new ApplicationError("BALANCE_CHANGES_INVALID", "변경 항목을 확인해 주세요.", 422);
    const entry = candidate as { key?: unknown; value?: unknown };
    if (typeof entry.key !== "string" || entry.key.trim() === "" || typeof entry.value !== "string") {
      throw new ApplicationError("BALANCE_CHANGES_INVALID", "변경 key와 decimal string 값이 필요합니다.", 422);
    }
    return { key: entry.key.trim(), value: entry.value };
  });
}

// 사유와 preview 입력을 공통 provider 계약으로 변환합니다.
function readPreviewBody(domain: AdminBalanceDomain, operatorId: string, body: PreviewBody | undefined): AdminBalanceMutationPreviewInput {
  if (typeof body?.reason !== "string") throw new ApplicationError("BALANCE_REASON_REQUIRED", "변경 사유가 필요합니다.", 422);
  const common = { domain, operatorId, expectedVersion: readVersion(body.expectedVersion, "expectedVersion"), reason: body.reason };
  if (body.mode === "apply") return { ...common, mode: "apply", changes: readChanges(body.changes) };
  if (body.mode === "rollback") return { ...common, mode: "rollback", targetVersion: readVersion(body.targetVersion, "targetVersion") };
  throw new ApplicationError("BALANCE_MODE_INVALID", "preview mode는 apply 또는 rollback이어야 합니다.", 422);
}

// CSRF와 현재 최소권한을 세션에서 재검사합니다. 권한 seed는 별도 GAP으로 유지합니다.
async function authenticate(request: FastifyRequest, dependencies: AdminBalanceWebRouteDependencies, requireCsrf: boolean): Promise<AdminSession> {
  const csrfToken = requireCsrf ? request.headers["x-csrf-token"] : undefined;
  if (requireCsrf && (typeof csrfToken !== "string" || csrfToken.trim() === "")) {
    throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  }
  const session = await dependencies.auth.authenticate(request.cookies[SESSION_COOKIE] ?? "", typeof csrfToken === "string" ? csrfToken : undefined);
  requirePermission(session, ADMIN_BALANCE_PERMISSION);
  return session;
}

// 실행 요청의 멱등성 key와 preview 확인 계약을 검증합니다.
function readExecution(request: FastifyRequest, body: ExecuteBody | undefined): { idempotencyKey: string; confirmationToken: string } {
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 헤더가 필요합니다.", 422);
  if (body?.confirmed !== true || typeof body.confirmationToken !== "string" || body.confirmationToken.trim() === "") {
    throw new ApplicationError("BALANCE_CONFIRMATION_REQUIRED", "preview 확인 토큰과 재확인이 필요합니다.", 422);
  }
  return { idempotencyKey: idempotencyKey.trim(), confirmationToken: body.confirmationToken.trim() };
}

// 읽기 projection에 exact domain·group·검색 필터를 적용합니다.
function filterProjection(projection: AdminBalanceReadProjection, query: { domain?: string; group?: string; search?: string }): AdminBalanceReadProjection {
  const domain = query.domain === undefined || query.domain === "" ? undefined : readDomain(query.domain);
  const group = query.group?.trim();
  const search = query.search?.trim().toLocaleLowerCase("ko-KR");
  if ((group?.length ?? 0) > 191 || (search?.length ?? 0) > 100) throw new ApplicationError("BALANCE_FILTER_INVALID", "검색 조건이 너무 깁니다.", 422);
  return {
    domains: projection.domains.filter((item) => domain === undefined || item.domain === domain).map((item) => ({
      ...item,
      values: item.values.filter((value) => (!group || value.group === group)
        && (!search || [value.key, value.label, value.group].some((candidate) => candidate.toLocaleLowerCase("ko-KR").includes(search)))),
    })),
  };
}

// 읽기 모델과 WBS638 provider만 소비하는 관리자 확률·수치 REST를 등록합니다.
export async function registerAdminBalanceWebRoutes(app: FastifyInstance, dependencies: AdminBalanceWebRouteDependencies): Promise<void> {
  app.get<{ Querystring: { domain?: string; group?: string; search?: string } }>("/api/v1/admin/balance", async (request) => {
    await authenticate(request, dependencies, false);
    const projection = filterProjection(await dependencies.reader.read(), request.query);
    return { ok: true, ...projection, relatedLinks: { audit: "/api/v1/admin/audit-entries", monitoring: "/api/v1/admin/monitoring-events" }, requestId: request.id };
  });

  app.post<{ Params: { domain: string }; Body: PreviewBody }>("/api/v1/admin/balance/:domain/preview", async (request) => {
    const session = await authenticate(request, dependencies, true);
    return { ok: true, preview: await dependencies.mutation.preview(readPreviewBody(readDomain(request.params.domain), session.operatorId, request.body)), requestId: request.id };
  });

  app.post<{ Params: { domain: string }; Body: ExecuteBody }>("/api/v1/admin/balance/:domain/apply", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const domain = readDomain(request.params.domain);
    const preview = readPreviewBody(domain, session.operatorId, { ...request.body, mode: "apply" });
    const execution = readExecution(request, request.body);
    if (preview.mode !== "apply") throw new ApplicationError("BALANCE_MODE_INVALID", "apply 요청 형식이 올바르지 않습니다.", 422);
    const input: AdminBalanceApplyInput = { domain, operatorId: session.operatorId, expectedVersion: preview.expectedVersion, reason: preview.reason, changes: preview.changes, ...execution, confirmed: true };
    return { ok: true, result: await dependencies.mutation.apply(input), requestId: request.id };
  });

  app.post<{ Params: { domain: string }; Body: ExecuteBody }>("/api/v1/admin/balance/:domain/rollback", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const domain = readDomain(request.params.domain);
    const preview = readPreviewBody(domain, session.operatorId, { ...request.body, mode: "rollback" });
    const execution = readExecution(request, request.body);
    if (preview.mode !== "rollback") throw new ApplicationError("BALANCE_MODE_INVALID", "rollback 요청 형식이 올바르지 않습니다.", 422);
    const input: AdminBalanceRollbackInput = { domain, operatorId: session.operatorId, expectedVersion: preview.expectedVersion, reason: preview.reason, targetVersion: preview.targetVersion, ...execution, confirmed: true };
    return { ok: true, result: await dependencies.mutation.rollback(input), requestId: request.id };
  });
}
