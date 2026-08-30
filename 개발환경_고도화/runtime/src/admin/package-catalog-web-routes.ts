import type { FastifyInstance, FastifyRequest } from "fastify";
import { requirePermission, type AdminSession } from "./auth-service.js";
import { PackageCatalogCommandError, type PackageCatalogRewardInput } from "../package/package-catalog-admin-command.js";
import type { MariaPackageCatalogAdminRepository } from "../package/mariadb-package-catalog-admin.js";
import type { PackageCatalogWebAdapter } from "../package/package-catalog-web-adapter.js";
import { ApplicationError } from "../shared/application-error.js";

interface AdminSessionAuthenticator {
  authenticate(sessionToken: string, csrfToken?: string): Promise<AdminSession>;
}

type PackageSnapshotProvider = Pick<MariaPackageCatalogAdminRepository, "readSnapshot">;
type PackageMutationProvider = Pick<PackageCatalogWebAdapter, "mutate">;

export interface AdminPackageCatalogWebRouteDependencies {
  auth: AdminSessionAuthenticator;
  snapshot: PackageSnapshotProvider;
  catalog: PackageMutationProvider;
}

type MutationBody = { expectedCatalogVersion?: unknown; reason?: unknown; confirmed?: unknown };
const SESSION_COOKIE = "hoibot_admin_session";
const SOURCE_CODE = "admin_web";

// 브라우저 JSON number 정밀도 손실 없이 양의 decimal string을 bigint로 변환합니다.
function readPositiveDecimalString(value: unknown, code: string, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new ApplicationError(code, label + " 값은 양의 decimal string이어야 합니다.", 422);
  }
  return BigInt(value);
}

// package web adapter가 지원하는 POINT/ITEM 보상 배열만 bigint로 변환합니다.
function readRewards(value: unknown): PackageCatalogRewardInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApplicationError("PACKAGE_REWARD_INVALID", "보상을 한 개 이상 입력해 주세요.", 422);
  }
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new ApplicationError("PACKAGE_REWARD_INVALID", "보상 정보를 확인해 주세요.", 422);
    }
    const reward = candidate as { rewardType?: unknown; assetCode?: unknown; quantity?: unknown };
    if ((reward.rewardType !== "POINT" && reward.rewardType !== "ITEM") || typeof reward.assetCode !== "string" || reward.assetCode.trim() === "") {
      throw new ApplicationError("PACKAGE_REWARD_INVALID", "보상 정보를 확인해 주세요.", 422);
    }
    return { rewardType: reward.rewardType, assetCode: reward.assetCode.trim(), quantity: readPositiveDecimalString(reward.quantity, "PACKAGE_REWARD_INVALID", "quantity") };
  });
}

// CSRF·멱등성·사유·확인·caller catalog version 공통 계약을 검증합니다.
function readMutation(request: FastifyRequest, body: MutationBody | undefined) {
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 헤더가 필요합니다.", 422);
  }
  if (typeof body?.reason !== "string" || body.reason.trim() === "") {
    throw new ApplicationError("REASON_REQUIRED", "변경 사유가 필요합니다.", 422);
  }
  if (body.confirmed !== true) throw new ApplicationError("CONFIRMATION_REQUIRED", "변경 내용을 다시 확인해 주세요.", 422);
  return {
    idempotencyKey: idempotencyKey.trim(),
    expectedCatalogVersion: readPositiveDecimalString(body.expectedCatalogVersion, "PACKAGE_CATALOG_VERSION_INVALID", "expectedCatalogVersion"),
    reason: body.reason.trim(),
  };
}

// 현재 관리자 세션, mutation CSRF와 package.catalog.manage 권한을 재검사합니다.
async function authenticate(request: FastifyRequest, dependencies: AdminPackageCatalogWebRouteDependencies, requireCsrf: boolean): Promise<AdminSession> {
  const csrfToken = requireCsrf ? request.headers["x-csrf-token"] : undefined;
  if (requireCsrf && (typeof csrfToken !== "string" || csrfToken.trim() === "")) {
    throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  }
  const session = await dependencies.auth.authenticate(request.cookies[SESSION_COOKIE] ?? "", typeof csrfToken === "string" ? csrfToken : undefined);
  requirePermission(session, "package.catalog.manage");
  return session;
}

// 기존 package command error를 공통 REST status와 error envelope로 변환합니다.
async function normalizePackageError<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (!(error instanceof PackageCatalogCommandError)) throw error;
    const statusCode = error.code === "FORBIDDEN" ? 403
      : error.code === "PACKAGE_NOT_FOUND" ? 404
        : ["PACKAGE_CATALOG_VERSION_CONFLICT", "PACKAGE_CATALOG_IDEMPOTENCY_CONFLICT", "PACKAGE_CATALOG_REQUEST_IN_PROGRESS"].includes(error.code) ? 409 : 422;
    throw new ApplicationError(error.code, error.message, statusCode);
  }
}

// bigint 결과를 손실 없는 공통 REST mutation envelope로 직렬화합니다.
function mutationResponse(result: Awaited<ReturnType<PackageMutationProvider["mutate"]>>, request: FastifyRequest) {
  return { ok: true, result: { replayed: result.replayed, catalogVersion: result.catalogVersion.toString(), packageId: result.packageId, message: result.message }, requestId: request.id };
}

// 기존 package web adapter의 지원 동작만 인증된 관리자 REST API에 연결합니다.
export async function registerAdminPackageCatalogWebRoutes(app: FastifyInstance, dependencies: AdminPackageCatalogWebRouteDependencies): Promise<void> {
  app.get("/api/v1/admin/package-catalog", async (request) => {
    await authenticate(request, dependencies, false);
    const snapshot = await dependencies.snapshot.readSnapshot();
    return { ok: true, catalog: { catalogKey: "PACKAGE_CATALOG", catalogVersion: snapshot.catalogVersion.toString(), entries: snapshot.entries.map((entry) => ({ packageId: entry.packageId, displayName: entry.displayName, displayOrder: entry.displayOrder, active: entry.active, expectedVersion: entry.rowVersion.toString() })) }, requestId: request.id };
  });

  app.post<{ Body: MutationBody & { displayName?: unknown; description?: unknown; rewards?: unknown } }>("/api/v1/admin/package-catalog/packages", async (request, reply) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    const displayName = request.body?.displayName;
    const description = request.body?.description;
    if (typeof displayName !== "string" || typeof description !== "string") throw new ApplicationError("PACKAGE_FIELDS_REQUIRED", "패키지 이름과 설명을 입력해 주세요.", 422);
    const result = await normalizePackageError(() => dependencies.catalog.mutate({ actorOperatorId: session.operatorId, sourceCode: SOURCE_CODE, idempotencyKey: common.idempotencyKey, expectedCatalogVersion: common.expectedCatalogVersion, reason: common.reason, mutation: { action: "ADD", displayName, description, rewards: readRewards(request.body.rewards) } }));
    return reply.code(201).send(mutationResponse(result, request));
  });

  app.patch<{ Params: { packageId: string }; Body: MutationBody & { rewards?: unknown } }>("/api/v1/admin/package-catalog/packages/:packageId", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    const result = await normalizePackageError(() => dependencies.catalog.mutate({ actorOperatorId: session.operatorId, sourceCode: SOURCE_CODE, idempotencyKey: common.idempotencyKey, expectedCatalogVersion: common.expectedCatalogVersion, reason: common.reason, mutation: { action: "EDIT", packageId: request.params.packageId, rewards: readRewards(request.body.rewards) } }));
    return mutationResponse(result, request);
  });

  app.delete<{ Params: { packageId: string }; Body: MutationBody }>("/api/v1/admin/package-catalog/packages/:packageId", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    const result = await normalizePackageError(() => dependencies.catalog.mutate({ actorOperatorId: session.operatorId, sourceCode: SOURCE_CODE, idempotencyKey: common.idempotencyKey, expectedCatalogVersion: common.expectedCatalogVersion, reason: common.reason, mutation: { action: "REMOVE", packageId: request.params.packageId } }));
    return mutationResponse(result, request);
  });

  app.post<{ Params: { packageId: string }; Body: MutationBody }>("/api/v1/admin/package-catalog/packages/:packageId/enable", async (request) => {
    const session = await authenticate(request, dependencies, true);
    const common = readMutation(request, request.body);
    const result = await normalizePackageError(() => dependencies.catalog.mutate({ actorOperatorId: session.operatorId, sourceCode: SOURCE_CODE, idempotencyKey: common.idempotencyKey, expectedCatalogVersion: common.expectedCatalogVersion, reason: common.reason, mutation: { action: "ENABLE", packageId: request.params.packageId } }));
    return mutationResponse(result, request);
  });
}
