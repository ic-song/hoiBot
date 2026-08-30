import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { registerAdminWebShellRoutes } from "../../src/admin/web-shell.js";
import {
  syntheticAdminAudit,
  syntheticAdminOverview,
  syntheticAdminPlayer,
  syntheticAdminSession,
  syntheticMonitoringEvent
} from "../fixtures/admin-web-shell.js";
import { syntheticDiamondCatalogResponse } from "../fixtures/admin-diamond-catalog-web-consumer.js";
import { syntheticPackageCatalogResponse } from "../fixtures/admin-package-catalog-web-consumer.js";
import { syntheticObjectCatalogObject } from "../fixtures/admin-object-catalog-web-consumer.js";

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
  await registerAdminWebShellRoutes(app);
  app.post("/api/v1/admin/sessions", async () => ({ ok: true, session: syntheticAdminSession, csrfToken: "synthetic-csrf-token" }));
  app.get("/api/v1/admin/sessions/current", async () => ({ ok: true, session: syntheticAdminSession, requestId: "synthetic-session" }));
  app.delete("/api/v1/admin/sessions/current", async (_request, reply) => reply.code(204).send());
  app.get("/api/v1/admin/overview", async () => ({ ok: true, overview: syntheticAdminOverview, requestId: "synthetic-overview" }));
  app.get("/api/v1/admin/players", async () => ({ ok: true, items: [syntheticAdminPlayer], page: 1, limit: 25, total: 1, requestId: "synthetic-players" }));
  app.get<{ Params: { playerId: string } }>("/api/v1/admin/players/:playerId", async (request, reply) => request.params.playerId === syntheticAdminPlayer.playerId
    ? { ok: true, player: syntheticAdminPlayer, requestId: "synthetic-player" }
    : reply.code(404).send({ ok: false, error: { code: "PLAYER_NOT_FOUND", message: "합성 회원을 찾을 수 없습니다." }, requestId: "synthetic-player" }));
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
