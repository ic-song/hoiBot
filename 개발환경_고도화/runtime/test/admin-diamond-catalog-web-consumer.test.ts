import assert from "node:assert/strict";
import { describe, it } from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import {
  registerAdminDiamondShopCatalogWebRoutes,
  type AdminDiamondShopCatalogWebRouteDependencies,
} from "../src/admin/diamond-shop-catalog-web-routes.js";
import { ApplicationError } from "../src/shared/application-error.js";
import {
  syntheticDiamondCatalogAdminSession,
  syntheticDiamondCatalogMutationHeaders,
  syntheticDiamondCatalogSnapshot,
} from "./fixtures/admin-diamond-catalog-web-consumer.js";

type CatalogProvider = AdminDiamondShopCatalogWebRouteDependencies["catalog"];

// 운영 DB 없이 REST 인증·직렬화·provider 전달 계약을 검증할 앱을 구성합니다.
async function buildApp(input: { roleCodes?: string[]; catalog?: Partial<CatalogProvider> } = {}) {
  const authCalls: Array<{ sessionToken: string; csrfToken?: string }> = [];
  const session = { ...syntheticDiamondCatalogAdminSession, roleCodes: input.roleCodes ?? syntheticDiamondCatalogAdminSession.roleCodes };
  const catalog: CatalogProvider = {
    readSnapshot: input.catalog?.readSnapshot ?? (async () => syntheticDiamondCatalogSnapshot),
    add: input.catalog?.add ?? (async () => ({ status: "added", replayed: false, productId: "added-product", catalogVersion: "15", operationId: "501", auditId: "601" })),
    softDisable: input.catalog?.softDisable ?? (async () => ({ status: "disabled", replayed: false, productId: syntheticDiamondCatalogSnapshot.items[0].productId, catalogVersion: "15", operationId: "502", auditId: "602" })),
  };
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.setErrorHandler(async (error, request, reply) => {
    const applicationError = error instanceof ApplicationError;
    const statusCode = applicationError ? error.statusCode : 500;
    return reply.code(statusCode).send({
      ok: false,
      error: { code: applicationError ? error.code : "INTERNAL_SERVER_ERROR", message: applicationError ? error.message : "서버 오류" },
      requestId: request.id,
    });
  });
  await registerAdminDiamondShopCatalogWebRoutes(app, {
    auth: {
      authenticate: async (sessionToken, csrfToken) => {
        authCalls.push({ sessionToken, csrfToken });
        return session;
      },
    },
    catalog,
  });
  return { app, authCalls };
}

describe("admin diamond catalog web consumer", () => {
  it("serializes every bigint catalog field as a lossless decimal string", async () => {
    const { app, authCalls } = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/diamond-shop/catalog", headers: { cookie: syntheticDiamondCatalogMutationHeaders.cookie } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().catalog, {
        catalogVersion: "14",
        bootstrapSource: "legacy.defaultShop",
        bootstrapVersion: "v2400-synthetic",
        bootstrapStatus: "verified",
        items: [{
          productId: "00000000-0000-0000-0000-000000002366",
          displayName: "합성 초대형 다이아 상품",
          quantity: "123456789012345678901234567890",
          price: "9007199254740993",
          displayOrder: 1,
          version: "3",
        }],
      });
      assert.deepEqual(authCalls, [{ sessionToken: "synthetic-session-token", csrfToken: undefined }]);
    } finally {
      await app.close();
    }
  });

  it("allows only current manager or super_admin sessions", async () => {
    const { app } = await buildApp({ roleCodes: ["operations_reader"] });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/diamond-shop/catalog", headers: { cookie: syntheticDiamondCatalogMutationHeaders.cookie } });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "DIAMOND_SHOP_ADMIN_REQUIRED");
    } finally {
      await app.close();
    }
  });

  it("requires CSRF, Idempotency-Key, reason, confirmation, and decimal-string caller version", async () => {
    const { app } = await buildApp();
    const body = { displayName: "합성 추가", quantity: "10", price: "5", expectedVersion: "14", reason: "합성 검증", confirmed: true };
    try {
      const missingCsrf = await app.inject({ method: "POST", url: "/api/v1/admin/diamond-shop/catalog/items", headers: { cookie: syntheticDiamondCatalogMutationHeaders.cookie, "idempotency-key": "required-1" }, payload: body });
      assert.equal(missingCsrf.statusCode, 403);
      assert.equal(missingCsrf.json().error.code, "CSRF_TOKEN_REQUIRED");
      const missingKey = await app.inject({ method: "POST", url: "/api/v1/admin/diamond-shop/catalog/items", headers: { cookie: syntheticDiamondCatalogMutationHeaders.cookie, "x-csrf-token": "synthetic-csrf-token" }, payload: body });
      assert.equal(missingKey.statusCode, 422);
      assert.equal(missingKey.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
      const numericVersion = await app.inject({ method: "POST", url: "/api/v1/admin/diamond-shop/catalog/items", headers: syntheticDiamondCatalogMutationHeaders, payload: { ...body, expectedVersion: 14 } });
      assert.equal(numericVersion.statusCode, 422);
      assert.equal(numericVersion.json().error.code, "DIAMOND_SHOP_CATALOG_VERSION_INVALID");
    } finally {
      await app.close();
    }
  });

  it("passes POST add values to the existing provider as bigint and returns 201", async () => {
    let received: Parameters<CatalogProvider["add"]>[0] | undefined;
    const { app, authCalls } = await buildApp({ catalog: { add: async (input) => {
      received = input;
      return { status: "added", replayed: false, productId: "stable-added-product", catalogVersion: "15", operationId: "501", auditId: "601" };
    } } });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/diamond-shop/catalog/items",
        headers: syntheticDiamondCatalogMutationHeaders,
        payload: { displayName: "합성 추가", quantity: "123456789012345678901234567890", price: "9007199254740993", expectedVersion: "14", reason: "합성 추가 검증", confirmed: true },
      });
      assert.equal(response.statusCode, 201);
      assert.equal(received?.quantity, 123456789012345678901234567890n);
      assert.equal(received?.price, 9007199254740993n);
      assert.equal(received?.expectedVersion, 14n);
      assert.equal(received?.operatorId, syntheticDiamondCatalogAdminSession.operatorId);
      assert.deepEqual(authCalls[0], { sessionToken: "synthetic-session-token", csrfToken: "synthetic-csrf-token" });
    } finally {
      await app.close();
    }
  });

  it("soft-disables the stable productId and preserves replay results", async () => {
    let received: Parameters<CatalogProvider["softDisable"]>[0] | undefined;
    const productId = syntheticDiamondCatalogSnapshot.items[0].productId;
    const { app } = await buildApp({ catalog: { softDisable: async (input) => {
      received = input;
      return { status: "disabled", replayed: true, productId, catalogVersion: "15", operationId: "502", auditId: "602" };
    } } });
    try {
      const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/diamond-shop/catalog/items/" + productId, headers: syntheticDiamondCatalogMutationHeaders, payload: { expectedVersion: "14", reason: "합성 비활성화", confirmed: true } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().result.replayed, true);
      assert.equal(received?.productId, productId);
      assert.equal(received?.expectedVersion, 14n);
    } finally {
      await app.close();
    }
  });

  it("normalizes provider optimistic conflicts as the common 409 envelope", async () => {
    const { app } = await buildApp({ catalog: { add: async () => {
      throw new ApplicationError("DIAMOND_SHOP_CATALOG_CONFLICT", "다이아상점 목록이 먼저 변경되었습니다.", 409);
    } } });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/diamond-shop/catalog/items", headers: syntheticDiamondCatalogMutationHeaders, payload: { displayName: "충돌 상품", quantity: "1", price: "1", expectedVersion: "13", reason: "합성 충돌", confirmed: true } });
      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json().error, { code: "DIAMOND_SHOP_CATALOG_CONFLICT", message: "다이아상점 목록이 먼저 변경되었습니다." });
    } finally {
      await app.close();
    }
  });
});
