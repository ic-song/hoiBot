import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AdminSession } from "./auth-service.js";
import type {
  PetSkillCatalogCrudProvider,
  PetSkillCatalogInput,
} from "../pet/pet-skill-catalog.js";
import type { ConfigurationMutationResult } from "../configuration/configuration-catalog.js";
import { ApplicationError } from "../shared/application-error.js";

interface AdminSessionAuthenticator {
  authenticate(sessionToken: string, csrfToken?: string): Promise<AdminSession>;
}

type PetSkillCatalogProvider = Pick<PetSkillCatalogCrudProvider,
  "readCurrent" | "readVersion" | "createDraft" | "publish" | "rollback" | "retire" | "discardDraft">;

export interface AdminPetSkillCatalogWebRouteDependencies {
  auth: AdminSessionAuthenticator;
  catalog: PetSkillCatalogProvider;
}

type MutationBody = { reason?: unknown; confirmed?: unknown };
const SESSION_COOKIE = "hoibot_admin_session";

// 설정 version을 브라우저 number 정밀도 손실이 없는 decimal string으로 제한합니다.
function readVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new ApplicationError("PET_SKILL_CATALOG_VERSION_INVALID", `${label}은 0 이상의 decimal string이어야 합니다.`, 422);
  }
  return value;
}

// 전체 카탈로그 draft 입력의 최상위 모양만 확인하고 도메인 검증은 기존 provider에 위임합니다.
function readCatalog(value: unknown): PetSkillCatalogInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApplicationError("PET_SKILL_CATALOG_INPUT_REQUIRED", "펫스킬 카탈로그 입력이 필요합니다.", 422);
  }
  const catalog = value as Partial<PetSkillCatalogInput>;
  if (typeof catalog.catalogVersion !== "string" || !Array.isArray(catalog.definitions) || !Array.isArray(catalog.compatibilityGroups) || typeof catalog.drawPolicy !== "object" || catalog.drawPolicy === null || Array.isArray(catalog.drawPolicy)) {
    throw new ApplicationError("PET_SKILL_CATALOG_INPUT_INVALID", "definition, 호환 그룹과 추첨 정책 형식을 확인해 주세요.", 422);
  }
  return catalog as PetSkillCatalogInput;
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
async function authenticate(request: FastifyRequest, dependencies: AdminPetSkillCatalogWebRouteDependencies, requireCsrf: boolean): Promise<AdminSession> {
  const csrfToken = requireCsrf ? request.headers["x-csrf-token"] : undefined;
  if (requireCsrf && (typeof csrfToken !== "string" || csrfToken.trim() === "")) {
    throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  }
  const session = await dependencies.auth.authenticate(request.cookies[SESSION_COOKIE] ?? "", typeof csrfToken === "string" ? csrfToken : undefined);
  if (!session.roleCodes.some((role) => role === "manager" || role === "super_admin")) {
    throw new ApplicationError("PET_SKILL_CATALOG_ADMIN_REQUIRED", "펫스킬 카탈로그 관리 권한이 없습니다.", 403);
  }
  return session;
}

// provider mutation 결과를 공통 관리자 응답 envelope로 반환합니다.
function mutationResponse(result: ConfigurationMutationResult, request: FastifyRequest) {
  return { ok: true, result, requestId: request.id };
}

// 기존 typed 펫스킬 provider를 관리자 REST 조회·version lifecycle 경로에 연결합니다.
export async function registerAdminPetSkillCatalogWebRoutes(app: FastifyInstance, dependencies: AdminPetSkillCatalogWebRouteDependencies): Promise<void> {
  app.get("/api/v1/admin/pet-skill-catalog", async (request) => {
    await authenticate(request, dependencies, false);
    return { ok: true, catalog: await dependencies.catalog.readCurrent(), requestId: request.id };
  });

  app.get<{ Params: { version: string } }>("/api/v1/admin/pet-skill-catalog/versions/:version", async (request) => {
    await authenticate(request, dependencies, false);
    const catalog = await dependencies.catalog.readVersion(readVersion(request.params.version, "version"));
    if (catalog === null) throw new ApplicationError("PET_SKILL_CATALOG_VERSION_NOT_FOUND", "펫스킬 카탈로그 version을 찾을 수 없습니다.", 404);
    return { ok: true, catalog, requestId: request.id };
  });

  app.post<{ Body: MutationBody & { expectedActiveVersion?: unknown; baseVersion?: unknown; catalog?: unknown } }>("/api/v1/admin/pet-skill-catalog/drafts", async (request, reply) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    const result = await dependencies.catalog.createDraft({
      actorId: session.operatorId,
      idempotencyKey: common.idempotencyKey,
      reason: common.reason,
      expectedActiveVersion: readVersion(request.body?.expectedActiveVersion, "expectedActiveVersion"),
      ...(request.body?.baseVersion === undefined ? {} : { baseVersion: readVersion(request.body.baseVersion, "baseVersion") }),
      catalog: readCatalog(request.body?.catalog),
    });
    return reply.code(201).send(mutationResponse(result, request));
  });

  app.post<{ Params: { draftVersion: string }; Body: MutationBody & { expectedActiveVersion?: unknown } }>("/api/v1/admin/pet-skill-catalog/drafts/:draftVersion/publish", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    return mutationResponse(await dependencies.catalog.publish({ actorId: session.operatorId, idempotencyKey: common.idempotencyKey, reason: common.reason, expectedActiveVersion: readVersion(request.body?.expectedActiveVersion, "expectedActiveVersion"), draftVersion: readVersion(request.params.draftVersion, "draftVersion") }), request);
  });

  app.post<{ Body: MutationBody & { expectedActiveVersion?: unknown; targetVersion?: unknown } }>("/api/v1/admin/pet-skill-catalog/rollback", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    return mutationResponse(await dependencies.catalog.rollback({ actorId: session.operatorId, idempotencyKey: common.idempotencyKey, reason: common.reason, expectedActiveVersion: readVersion(request.body?.expectedActiveVersion, "expectedActiveVersion"), targetVersion: readVersion(request.body?.targetVersion, "targetVersion") }), request);
  });

  app.post<{ Body: MutationBody & { expectedActiveVersion?: unknown } }>("/api/v1/admin/pet-skill-catalog/retire", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    return mutationResponse(await dependencies.catalog.retire({ actorId: session.operatorId, idempotencyKey: common.idempotencyKey, reason: common.reason, expectedActiveVersion: readVersion(request.body?.expectedActiveVersion, "expectedActiveVersion") }), request);
  });

  app.delete<{ Params: { draftVersion: string }; Body: MutationBody }>("/api/v1/admin/pet-skill-catalog/drafts/:draftVersion", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    return mutationResponse(await dependencies.catalog.discardDraft({ actorId: session.operatorId, idempotencyKey: common.idempotencyKey, reason: common.reason, draftVersion: readVersion(request.params.draftVersion, "draftVersion") }), request);
  });
}
