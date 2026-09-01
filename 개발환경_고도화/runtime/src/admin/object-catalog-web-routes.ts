import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AdminSession } from "./auth-service.js";
import {
  OBJECT_TYPES,
  ObjectCatalogError,
  type ObjectAliasInput,
  type ObjectCatalogService,
  type ObjectSourceBindingInput,
  type ObjectType,
} from "../catalog/object-catalog.js";
import type { ObjectCatalogWebAdapterProvider } from "../catalog/object-catalog-web-adapter-provider.js";
import { ApplicationError } from "../shared/application-error.js";
import type { AdminAssetCatalogReadModel } from "./asset-catalog-read-model.js";

interface AdminSessionAuthenticator {
  authenticate(sessionToken: string, csrfToken?: string): Promise<AdminSession>;
}

type ObjectReader = Pick<ObjectCatalogService, "getByKey">;
type ObjectMutationProvider = Pick<ObjectCatalogWebAdapterProvider, "register" | "update" | "setActive">;
type AssetCatalogReader = Pick<AdminAssetCatalogReadModel, "read">;

export interface AdminObjectCatalogWebRouteDependencies {
  auth: AdminSessionAuthenticator;
  reader: ObjectReader;
  catalog: ObjectMutationProvider;
  management: AssetCatalogReader;
}

type MutationBody = { reason?: unknown; confirmed?: unknown };
const SESSION_COOKIE = "hoibot_admin_session";
const SOURCE = "admin-object-web";

function readString(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApplicationError(code, `${label} 값이 필요합니다.`, 422);
  }
  return value.trim();
}

function readExpectedVersion(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new ApplicationError("OBJECT_CATALOG_VERSION_INVALID", "expectedVersion 값은 양의 decimal string이어야 합니다.", 422);
  }
  return value;
}

function readObjectType(value: unknown): ObjectType {
  if (typeof value !== "string" || !OBJECT_TYPES.includes(value as ObjectType)) {
    throw new ApplicationError("OBJECT_CATALOG_TYPE_INVALID", "objectType 값을 확인해 주세요.", 422);
  }
  return value as ObjectType;
}

function readMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApplicationError("OBJECT_CATALOG_METADATA_INVALID", "metadata는 JSON object여야 합니다.", 422);
  }
  return value as Record<string, unknown>;
}

function readAliases(value: unknown): ObjectAliasInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ApplicationError("OBJECT_CATALOG_ALIAS_INVALID", "aliases 배열을 확인해 주세요.", 422);
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) throw new ApplicationError("OBJECT_CATALOG_ALIAS_INVALID", "alias 값을 확인해 주세요.", 422);
    const alias = candidate as { type?: unknown; value?: unknown };
    if (!["display_name", "legacy_name", "legacy_code", "command_name"].includes(String(alias.type)) || typeof alias.value !== "string" || alias.value.trim() === "") {
      throw new ApplicationError("OBJECT_CATALOG_ALIAS_INVALID", "alias 값을 확인해 주세요.", 422);
    }
    return { type: alias.type as ObjectAliasInput["type"], value: alias.value.trim() };
  });
}

function readSourceBindings(value: unknown): ObjectSourceBindingInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApplicationError("OBJECT_CATALOG_SOURCE_REQUIRED", "canonical source binding이 필요합니다.", 422);
  }
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) throw new ApplicationError("OBJECT_CATALOG_SOURCE_INVALID", "source binding을 확인해 주세요.", 422);
    const source = candidate as { system?: unknown; table?: unknown; key?: unknown };
    if (!["LEGACY_JSON", "LEGACY_DB", "RUNTIME_DB"].includes(String(source.system)) || typeof source.table !== "string" || source.table.trim() === "" || typeof source.key !== "string" || source.key.trim() === "") {
      throw new ApplicationError("OBJECT_CATALOG_SOURCE_INVALID", "source binding을 확인해 주세요.", 422);
    }
    return { system: source.system as ObjectSourceBindingInput["system"], table: source.table.trim(), key: source.key.trim() };
  });
}

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

async function authenticate(request: FastifyRequest, dependencies: AdminObjectCatalogWebRouteDependencies, requireCsrf: boolean): Promise<AdminSession> {
  const csrfToken = requireCsrf ? request.headers["x-csrf-token"] : undefined;
  if (requireCsrf && (typeof csrfToken !== "string" || csrfToken.trim() === "")) {
    throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  }
  const session = await dependencies.auth.authenticate(request.cookies[SESSION_COOKIE] ?? "", typeof csrfToken === "string" ? csrfToken : undefined);
  if (!session.roleCodes.some((role) => role === "manager" || role === "super_admin")) {
    throw new ApplicationError("OBJECT_CATALOG_ADMIN_REQUIRED", "object catalog 관리 권한이 없습니다.", 403);
  }
  return session;
}

async function normalizeObjectError<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (!(error instanceof ObjectCatalogError)) throw error;
    const statusCode = error.code === "OBJECT_NOT_FOUND" ? 404 : error.code === "OBJECT_VALIDATION" ? 422 : 409;
    throw new ApplicationError(error.code, error.message, statusCode);
  }
}

function mutationResponse(result: Awaited<ReturnType<ObjectMutationProvider["register"]>>, request: FastifyRequest) {
  return { ok: true, result, requestId: request.id };
}

export async function registerAdminObjectCatalogWebRoutes(app: FastifyInstance, dependencies: AdminObjectCatalogWebRouteDependencies): Promise<void> {
  app.get<{ Querystring: { query?: string; objectType?: string; active?: string; page?: string; limit?: string } }>("/api/v1/admin/object-catalog/objects", async (request) => {
    await authenticate(request, dependencies, false);
    const page = request.query.page === undefined ? 1 : Number(request.query.page);
    const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApplicationError("OBJECT_CATALOG_PAGE_INVALID", "page와 limit 값을 확인해 주세요.", 422);
    if (request.query.objectType !== undefined && !OBJECT_TYPES.includes(request.query.objectType as ObjectType)) throw new ApplicationError("OBJECT_CATALOG_TYPE_INVALID", "objectType 값을 확인해 주세요.", 422);
    if (request.query.active !== undefined && !["true", "false"].includes(request.query.active)) throw new ApplicationError("OBJECT_CATALOG_ACTIVE_INVALID", "active 값은 true 또는 false여야 합니다.", 422);
    return { ok: true, catalog: await dependencies.management.read({ query: request.query.query?.trim() || undefined, objectType: request.query.objectType, active: request.query.active === undefined ? undefined : request.query.active === "true", page, limit }), requestId: request.id };
  });

  app.get<{ Params: { objectKey: string } }>("/api/v1/admin/object-catalog/objects/:objectKey", async (request) => {
    await authenticate(request, dependencies, false);
    const object = await normalizeObjectError(() => dependencies.reader.getByKey(request.params.objectKey, true));
    return { ok: true, object, requestId: request.id };
  });

  app.post<{ Body: MutationBody & { objectKey?: unknown; objectType?: unknown; displayName?: unknown; active?: unknown; metadata?: unknown; aliases?: unknown; sourceBindings?: unknown } }>(
    "/api/v1/admin/object-catalog/objects",
    async (request, reply) => {
      const session = await authenticate(request, dependencies, true);
      const common = readMutation(request, request.body);
      if (request.body?.active !== undefined && typeof request.body.active !== "boolean") throw new ApplicationError("OBJECT_CATALOG_ACTIVE_INVALID", "active 값을 확인해 주세요.", 422);
      const result = await dependencies.catalog.register({
        source: SOURCE,
        operatorId: session.operatorId,
        idempotencyKey: common.idempotencyKey,
        reason: common.reason,
        objectKey: readString(request.body?.objectKey, "OBJECT_CATALOG_KEY_INVALID", "objectKey"),
        objectType: readObjectType(request.body?.objectType),
        displayName: readString(request.body?.displayName, "OBJECT_CATALOG_DISPLAY_NAME_INVALID", "displayName"),
        active: request.body?.active as boolean | undefined,
        metadata: readMetadata(request.body?.metadata ?? {}),
        aliases: readAliases(request.body?.aliases),
        sourceBindings: readSourceBindings(request.body?.sourceBindings),
      });
      return reply.code(201).send(mutationResponse(result, request));
    },
  );

  app.patch<{ Params: { objectKey: string }; Body: MutationBody & { objectType?: unknown; expectedVersion?: unknown; displayName?: unknown; metadata?: unknown } }>(
    "/api/v1/admin/object-catalog/objects/:objectKey",
    async (request) => {
      const session = await authenticate(request, dependencies, true);
      const common = readMutation(request, request.body);
      const current = await normalizeObjectError(() => dependencies.reader.getByKey(request.params.objectKey, true));
      const result = await dependencies.catalog.update({
        source: SOURCE,
        operatorId: session.operatorId,
        idempotencyKey: common.idempotencyKey,
        reason: common.reason,
        objectKey: request.params.objectKey,
        objectType: readObjectType(request.body?.objectType),
        expectedVersion: readExpectedVersion(request.body?.expectedVersion),
        displayName: readString(request.body?.displayName, "OBJECT_CATALOG_DISPLAY_NAME_INVALID", "displayName"),
        active: current.active,
        metadata: readMetadata(request.body?.metadata ?? {}),
      });
      return mutationResponse(result, request);
    },
  );

  app.post<{ Params: { objectKey: string }; Body: MutationBody & { objectType?: unknown; expectedVersion?: unknown; active?: unknown } }>(
    "/api/v1/admin/object-catalog/objects/:objectKey/active",
    async (request) => {
      const session = await authenticate(request, dependencies, true);
      const common = readMutation(request, request.body);
      if (typeof request.body?.active !== "boolean") throw new ApplicationError("OBJECT_CATALOG_ACTIVE_INVALID", "active 값이 필요합니다.", 422);
      const result = await dependencies.catalog.setActive({
        source: SOURCE,
        operatorId: session.operatorId,
        idempotencyKey: common.idempotencyKey,
        reason: common.reason,
        objectKey: request.params.objectKey,
        objectType: readObjectType(request.body?.objectType),
        expectedVersion: readExpectedVersion(request.body?.expectedVersion),
        active: request.body.active,
      });
      return mutationResponse(result, request);
    },
  );
}
