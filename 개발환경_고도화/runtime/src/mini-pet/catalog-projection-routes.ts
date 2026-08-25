import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApplicationError } from "../shared/application-error.js";
import type { MiniPetCatalogProjectionService } from "./catalog-projection-service.js";
import type { MiniPetCatalogEntry, MiniPetEnvironmentCode, MiniPetProjectionCode } from "./catalog-projection-repository.js";

const BODY_KEYS = new Set(["projectionCode", "environmentCode", "poolVersion", "snapshotAt", "providerEventId", "viewerExternalUserId", "targetPlayerId", "replyDestinationId"]);
const PROJECTIONS = new Set(["catalog", "inventory", "equipped_rank", "admin_info", "collection", "grade_stats", "draw_rates"]);
const PUBLISH_KEYS = new Set(["environmentCode", "poolVersion", "catalogKind", "definitionVersion", "ownedSnapshotVersion", "snapshotAt", "gradeTable", "allowedGrades", "stageRewards", "entries", "publisherExternalUserId"]);
const ENTRY_KEYS = new Set(["definitionId", "definitionCode", "name", "gradeCode", "grade", "emoji", "sourceOrder", "filterKey", "rawProbability", "normalizedRate", "allowed"]);

interface Dependencies {
  service: Pick<MiniPetCatalogProjectionService, "read" | "publishSnapshot">;
  tokenGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// provider body를 자유 필드 없는 plain record로 제한합니다.
function requireRecord(value: unknown, allowedKeys: ReadonlySet<string> = BODY_KEYS): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApplicationError("MINIPET_READ_BODY_REQUIRED", "미니펫 조회 요청이 필요합니다.", 400);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) throw new ApplicationError("MINIPET_READ_FIELD_INVALID", "허용되지 않은 미니펫 조회 필드가 있습니다.", 400);
  return record;
}

// 필수 문자열을 공백 제거 후 반환합니다.
function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new ApplicationError("MINIPET_READ_FIELD_REQUIRED", `${key} 값이 필요합니다.`, 400);
  return value.trim();
}

// snapshot publish body의 object/array 필드를 명시적으로 제한합니다.
function requirePublishBody(value: unknown): Record<string, unknown> {
  return requireRecord(value, PUBLISH_KEYS);
}

// 종류별 catalog entry의 필수 필드와 런타임 타입을 검증합니다.
function requireCatalogEntry(value: unknown): MiniPetCatalogEntry {
  const entry = requireRecord(value, ENTRY_KEYS);
  const sourceOrder = entry.sourceOrder;
  const rawProbability = entry.rawProbability;
  const normalizedRate = entry.normalizedRate;
  if (!Number.isInteger(sourceOrder) || Number(sourceOrder) < 0
    || (rawProbability !== null && typeof rawProbability !== "string")
    || (normalizedRate !== null && typeof normalizedRate !== "string")
    || typeof entry.allowed !== "boolean") {
    throw new ApplicationError("MINIPET_PUBLISH_ENTRY_INVALID", "catalog entry의 숫자 또는 허용 필드가 올바르지 않습니다.", 400);
  }
  return {
    definitionId: requireString(entry, "definitionId"), definitionCode: requireString(entry, "definitionCode"),
    name: requireString(entry, "name"), gradeCode: requireString(entry, "gradeCode"), grade: requireString(entry, "grade"),
    emoji: requireString(entry, "emoji"), sourceOrder: Number(sourceOrder), filterKey: requireString(entry, "filterKey"),
    rawProbability: rawProbability as string | null, normalizedRate: normalizedRate as string | null,
    allowed: entry.allowed
  };
}

// read projection 전용 exact route를 등록합니다.
export function registerMiniPetCatalogProjectionRoutes(app: FastifyInstance, dependencies: Dependencies): void {
  app.post("/api/v1/providers/mini-pet/read-projection", { preHandler: dependencies.tokenGuard }, async (request) => {
    const body = requireRecord(request.body);
    const projectionCode = requireString(body, "projectionCode");
    const environmentCode = requireString(body, "environmentCode");
    if (!PROJECTIONS.has(projectionCode)) throw new ApplicationError("MINIPET_PROJECTION_INVALID", "지원하지 않는 미니펫 projection입니다.", 400);
    if (environmentCode !== "prod" && environmentCode !== "dev") throw new ApplicationError("MINIPET_ENVIRONMENT_INVALID", "environmentCode 값이 올바르지 않습니다.", 400);
    const targetPlayerId = body.targetPlayerId === undefined ? undefined : requireString(body, "targetPlayerId");
    const replyDestinationId = body.replyDestinationId === undefined ? undefined : requireString(body, "replyDestinationId");
    const viewerExternalUserId = body.viewerExternalUserId === undefined ? undefined : requireString(body, "viewerExternalUserId");
    const data = await dependencies.service.read({
      projectionCode: projectionCode as MiniPetProjectionCode,
      environmentCode: environmentCode as MiniPetEnvironmentCode,
      poolVersion: requireString(body, "poolVersion"), snapshotAt: requireString(body, "snapshotAt"),
      providerEventId: requireString(body, "providerEventId"),
      ...(viewerExternalUserId === undefined ? {} : { viewerExternalUserId }),
      ...(targetPlayerId === undefined ? {} : { targetPlayerId }),
      ...(replyDestinationId === undefined ? {} : { replyDestinationId })
    });
    return { ok: true, data, requestId: request.id };
  });

  app.post("/api/v1/providers/mini-pet/publish-snapshot", { preHandler: dependencies.tokenGuard }, async (request) => {
    const body = requirePublishBody(request.body);
    if (!Array.isArray(body.allowedGrades) || !Array.isArray(body.entries)
      || typeof body.gradeTable !== "object" || body.gradeTable === null || Array.isArray(body.gradeTable)
      || typeof body.stageRewards !== "object" || body.stageRewards === null || Array.isArray(body.stageRewards)) {
      throw new ApplicationError("MINIPET_PUBLISH_BODY_INVALID", "snapshot catalog 구조가 올바르지 않습니다.", 400);
    }
    const catalogKind = requireString(body, "catalogKind");
    if (catalogKind !== "draw_rate" && catalogKind !== "fixed_reward") {
      throw new ApplicationError("MINIPET_CATALOG_KIND_INVALID", "catalogKind가 올바르지 않습니다.", 400);
    }
    const entries = body.entries.map(requireCatalogEntry);
    const data = await dependencies.service.publishSnapshot({
      environmentCode: requireString(body, "environmentCode") as MiniPetEnvironmentCode,
      poolVersion: requireString(body, "poolVersion"), catalogKind,
      definitionVersion: requireString(body, "definitionVersion"), ownedSnapshotVersion: requireString(body, "ownedSnapshotVersion"),
      snapshotAt: requireString(body, "snapshotAt"), gradeTable: body.gradeTable as Record<string, string>,
      allowedGrades: body.allowedGrades.map(String), stageRewards: body.stageRewards as Record<string, unknown>,
      entries, publisherExternalUserId: requireString(body, "publisherExternalUserId")
    });
    return { ok: true, data, requestId: request.id };
  });
}
