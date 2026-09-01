import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AdminSession } from "./auth-service.js";
import type {
  ConfigurationCatalogProvider,
  ConfigurationMutationResult,
  ConfigurationValueInput,
} from "../configuration/configuration-catalog.js";
import { ApplicationError } from "../shared/application-error.js";

interface AdminSessionAuthenticator {
  authenticate(sessionToken: string, csrfToken?: string): Promise<AdminSession>;
}

type ConfigurationProvider = Pick<ConfigurationCatalogProvider,
  "listManagedSets" | "readCurrent" | "readVersion" | "createDraft" | "publish" | "rollback" | "retire" | "discardDraft">;

export interface AdminConfigurationCatalogWebRouteDependencies {
  auth: AdminSessionAuthenticator;
  catalog: ConfigurationProvider;
}

type MutationBody = { reason?: unknown; confirmed?: unknown };
const SESSION_COOKIE = "hoibot_admin_session";

// 설정 version을 브라우저 number 정밀도 손실이 없는 decimal string으로 제한합니다.
function readVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new ApplicationError("CONFIGURATION_VERSION_INVALID", `${label}은 0 이상의 decimal string이어야 합니다.`, 422);
  }
  return value;
}

// draft changes의 key/value 입력 모양만 확인하고 상세 type 검증은 공용 provider에 위임합니다.
function readChanges(value: unknown): ConfigurationValueInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApplicationError("CONFIGURATION_CHANGES_INVALID", "변경 항목을 한 개 이상 입력해 주세요.", 422);
  }
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new ApplicationError("CONFIGURATION_CHANGES_INVALID", "변경 항목 형식을 확인해 주세요.", 422);
    }
    const change = candidate as { key?: unknown; value?: unknown };
    if (typeof change.key !== "string" || change.key.trim() === "") {
      throw new ApplicationError("CONFIGURATION_CHANGES_INVALID", "변경 key를 확인해 주세요.", 422);
    }
    return { key: change.key.trim(), value: change.value };
  });
}

// 관리자 mutation 공통 헤더와 명시적 사유·확인 값을 검증합니다.
function readMutation(request: FastifyRequest, body: MutationBody | undefined): { idempotencyKey: string; reason: string } {
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 헤더가 필요합니다.", 422);
  }
  if (typeof body?.reason !== "string" || body.reason.trim() === "") {
    throw new ApplicationError("REASON_REQUIRED", "변경 사유가 필요합니다.", 422);
  }
  if (body.confirmed !== true) throw new ApplicationError("CONFIRMATION_REQUIRED", "변경 내용을 다시 확인해 주세요.", 422);
  return { idempotencyKey: idempotencyKey.trim(), reason: body.reason.trim() };
}

// 현재 세션과 mutation CSRF를 재검사하고 manager 이상 역할만 허용합니다.
async function authenticate(request: FastifyRequest, dependencies: AdminConfigurationCatalogWebRouteDependencies, requireCsrf: boolean): Promise<AdminSession> {
  const csrfToken = requireCsrf ? request.headers["x-csrf-token"] : undefined;
  if (requireCsrf && (typeof csrfToken !== "string" || csrfToken.trim() === "")) {
    throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  }
  const session = await dependencies.auth.authenticate(request.cookies[SESSION_COOKIE] ?? "", typeof csrfToken === "string" ? csrfToken : undefined);
  if (!session.roleCodes.some((role) => role === "manager" || role === "super_admin")) {
    throw new ApplicationError("CONFIGURATION_CATALOG_ADMIN_REQUIRED", "설정 카탈로그 관리 권한이 없습니다.", 403);
  }
  return session;
}

// provider mutation 결과를 공통 관리자 응답 envelope로 반환합니다.
function mutationResponse(result: ConfigurationMutationResult, request: FastifyRequest) {
  return { ok: true, result, requestId: request.id };
}

// 기존 ConfigurationCatalogProvider를 관리자 REST 조회·CRUD 경로에 연결합니다.
export async function registerAdminConfigurationCatalogWebRoutes(app: FastifyInstance, dependencies: AdminConfigurationCatalogWebRouteDependencies): Promise<void> {
  app.get("/api/v1/admin/configuration-catalog", async (request) => {
    await authenticate(request, dependencies, false);
    const definitions = dependencies.catalog.listManagedSets();
    const sets = await Promise.all(definitions.map(async (definition) => ({
      setCode: definition.setCode,
      label: definition.label,
      keys: definition.keys,
      current: await dependencies.catalog.readCurrent(definition.setCode),
    })));
    return { ok: true, sets, requestId: request.id };
  });

  app.get<{ Params: { setCode: string; version: string } }>("/api/v1/admin/configuration-catalog/sets/:setCode/versions/:version", async (request) => {
    await authenticate(request, dependencies, false);
    const snapshot = await dependencies.catalog.readVersion(request.params.setCode, readVersion(request.params.version, "version"));
    if (snapshot === null) throw new ApplicationError("CONFIGURATION_VERSION_NOT_FOUND", "설정 version을 찾을 수 없습니다.", 404);
    return { ok: true, snapshot, requestId: request.id };
  });

  app.post<{ Params: { setCode: string }; Body: MutationBody & { expectedActiveVersion?: unknown; baseVersion?: unknown; changes?: unknown } }>("/api/v1/admin/configuration-catalog/sets/:setCode/drafts", async (request, reply) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    const result = await dependencies.catalog.createDraft({
      setCode: request.params.setCode,
      actorId: session.operatorId,
      idempotencyKey: common.idempotencyKey,
      reason: common.reason,
      expectedActiveVersion: readVersion(request.body?.expectedActiveVersion, "expectedActiveVersion"),
      ...(request.body?.baseVersion === undefined ? {} : { baseVersion: readVersion(request.body.baseVersion, "baseVersion") }),
      changes: readChanges(request.body?.changes),
    });
    return reply.code(201).send(mutationResponse(result, request));
  });

  app.post<{ Params: { setCode: string; draftVersion: string }; Body: MutationBody & { expectedActiveVersion?: unknown } }>("/api/v1/admin/configuration-catalog/sets/:setCode/drafts/:draftVersion/publish", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    return mutationResponse(await dependencies.catalog.publish({ setCode: request.params.setCode, actorId: session.operatorId, idempotencyKey: common.idempotencyKey, reason: common.reason, expectedActiveVersion: readVersion(request.body?.expectedActiveVersion, "expectedActiveVersion"), draftVersion: readVersion(request.params.draftVersion, "draftVersion") }), request);
  });

  app.post<{ Params: { setCode: string }; Body: MutationBody & { expectedActiveVersion?: unknown; targetVersion?: unknown } }>("/api/v1/admin/configuration-catalog/sets/:setCode/rollback", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    return mutationResponse(await dependencies.catalog.rollback({ setCode: request.params.setCode, actorId: session.operatorId, idempotencyKey: common.idempotencyKey, reason: common.reason, expectedActiveVersion: readVersion(request.body?.expectedActiveVersion, "expectedActiveVersion"), targetVersion: readVersion(request.body?.targetVersion, "targetVersion") }), request);
  });

  app.post<{ Params: { setCode: string }; Body: MutationBody & { expectedActiveVersion?: unknown } }>("/api/v1/admin/configuration-catalog/sets/:setCode/retire", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    return mutationResponse(await dependencies.catalog.retire({ setCode: request.params.setCode, actorId: session.operatorId, idempotencyKey: common.idempotencyKey, reason: common.reason, expectedActiveVersion: readVersion(request.body?.expectedActiveVersion, "expectedActiveVersion") }), request);
  });

  app.delete<{ Params: { setCode: string; draftVersion: string }; Body: MutationBody }>("/api/v1/admin/configuration-catalog/sets/:setCode/drafts/:draftVersion", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    return mutationResponse(await dependencies.catalog.discardDraft({ setCode: request.params.setCode, actorId: session.operatorId, idempotencyKey: common.idempotencyKey, reason: common.reason, draftVersion: readVersion(request.params.draftVersion, "draftVersion") }), request);
  });
}
