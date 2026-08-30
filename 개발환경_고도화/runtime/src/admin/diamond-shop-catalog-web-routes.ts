import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AdminSession } from "./auth-service.js";
import { ApplicationError } from "../shared/application-error.js";
import type {
  DiamondShopCatalogWebAdapterProvider,
  DiamondShopCatalogWebMutationResult,
} from "../shop/diamond-shop-catalog-web-adapter-provider.js";

interface AdminSessionAuthenticator {
  authenticate(sessionToken: string, csrfToken?: string): Promise<AdminSession>;
}

type DiamondCatalogWebProvider = Pick<DiamondShopCatalogWebAdapterProvider, "readSnapshot" | "add" | "softDisable">;

export interface AdminDiamondShopCatalogWebRouteDependencies {
  auth: AdminSessionAuthenticator;
  catalog: DiamondCatalogWebProvider;
}

type MutationBody = {
  expectedVersion?: unknown;
  reason?: unknown;
  confirmed?: unknown;
};

const SESSION_COOKIE = "hoibot_admin_session";

// 브라우저 JSON number의 정밀도 손실 없이 decimal string을 bigint로 변환합니다.
function readDecimalString(value: unknown, code: string, label: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ApplicationError(code, label + " 값은 decimal string이어야 합니다.", 422);
  }
  return BigInt(value);
}

// CSRF·멱등성·사유·확인·caller version 공통 변경 계약을 검증합니다.
function readMutation(request: FastifyRequest, body: MutationBody | undefined): {
  idempotencyKey: string;
  expectedVersion: bigint;
  reason: string;
} {
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    throw new ApplicationError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 헤더가 필요합니다.", 422);
  }
  if (typeof body?.reason !== "string" || body.reason.trim() === "") {
    throw new ApplicationError("REASON_REQUIRED", "변경 사유가 필요합니다.", 422);
  }
  if (body.confirmed !== true) {
    throw new ApplicationError("CONFIRMATION_REQUIRED", "변경 내용을 다시 확인해 주세요.", 422);
  }
  return {
    idempotencyKey: idempotencyKey.trim(),
    expectedVersion: readDecimalString(body.expectedVersion, "DIAMOND_SHOP_CATALOG_VERSION_INVALID", "expectedVersion"),
    reason: body.reason.trim(),
  };
}

// 현재 관리자 세션과 mutation CSRF를 검증하고 최신 역할을 반환합니다.
async function authenticate(
  request: FastifyRequest,
  dependencies: AdminDiamondShopCatalogWebRouteDependencies,
  requireCsrf: boolean,
): Promise<AdminSession> {
  const sessionToken = request.cookies[SESSION_COOKIE] ?? "";
  const csrfToken = requireCsrf ? request.headers["x-csrf-token"] : undefined;
  if (requireCsrf && (typeof csrfToken !== "string" || csrfToken.trim() === "")) {
    throw new ApplicationError("CSRF_TOKEN_REQUIRED", "CSRF 토큰이 필요합니다.", 403);
  }
  return dependencies.auth.authenticate(sessionToken, typeof csrfToken === "string" ? csrfToken : undefined);
}

// 다이아상점 웹 소비자를 기존 manager/super_admin 역할로만 제한합니다.
function requireCatalogRole(session: AdminSession): void {
  if (!session.roleCodes.some((roleCode) => roleCode === "manager" || roleCode === "super_admin")) {
    throw new ApplicationError("DIAMOND_SHOP_ADMIN_REQUIRED", "다이아상점 관리 권한이 없습니다.", 403);
  }
}

// provider mutation 결과를 공통 REST envelope로 반환합니다.
function mutationResponse(result: DiamondShopCatalogWebMutationResult, request: FastifyRequest) {
  return { ok: true, result, requestId: request.id };
}

// 기존 diamond web provider를 인증된 관리자 REST API에 연결합니다.
export async function registerAdminDiamondShopCatalogWebRoutes(
  app: FastifyInstance,
  dependencies: AdminDiamondShopCatalogWebRouteDependencies,
): Promise<void> {
  app.get("/api/v1/admin/diamond-shop/catalog", async (request) => {
    const session = await authenticate(request, dependencies, false);
    requireCatalogRole(session);
    const snapshot = await dependencies.catalog.readSnapshot();
    return {
      ok: true,
      catalog: {
        catalogVersion: snapshot.catalogVersion.toString(),
        bootstrapSource: snapshot.bootstrapSource,
        bootstrapVersion: snapshot.bootstrapVersion,
        bootstrapStatus: snapshot.bootstrapStatus,
        items: snapshot.items.map((item) => ({
          productId: item.productId,
          displayName: item.displayName,
          quantity: item.quantity.toString(),
          price: item.price.toString(),
          displayOrder: item.displayOrder,
          version: item.version.toString(),
        })),
      },
      requestId: request.id,
    };
  });

  app.post<{ Body: MutationBody & { displayName?: unknown; quantity?: unknown; price?: unknown } }>(
    "/api/v1/admin/diamond-shop/catalog/items",
    async (request, reply) => {
      const session = await authenticate(request, dependencies, true);
      requireCatalogRole(session);
      const mutation = readMutation(request, request.body);
      if (typeof request.body?.displayName !== "string") {
        throw new ApplicationError("DIAMOND_SHOP_PRODUCT_NAME_INVALID", "상품 이름이 필요합니다.", 422);
      }
      const result = await dependencies.catalog.add({
        source: "admin-web",
        operatorId: session.operatorId,
        idempotencyKey: mutation.idempotencyKey,
        expectedVersion: mutation.expectedVersion,
        reason: mutation.reason,
        displayName: request.body.displayName,
        quantity: readDecimalString(request.body.quantity, "DIAMOND_SHOP_PRODUCT_VALUE_INVALID", "quantity"),
        price: readDecimalString(request.body.price, "DIAMOND_SHOP_PRODUCT_VALUE_INVALID", "price"),
      });
      return reply.code(201).send(mutationResponse(result, request));
    },
  );

  app.delete<{ Params: { productId: string }; Body: MutationBody }>(
    "/api/v1/admin/diamond-shop/catalog/items/:productId",
    async (request) => {
      const session = await authenticate(request, dependencies, true);
      requireCatalogRole(session);
      const mutation = readMutation(request, request.body);
      const result = await dependencies.catalog.softDisable({
        source: "admin-web",
        operatorId: session.operatorId,
        idempotencyKey: mutation.idempotencyKey,
        expectedVersion: mutation.expectedVersion,
        reason: mutation.reason,
        productId: request.params.productId,
      });
      return mutationResponse(result, request);
    },
  );
}
