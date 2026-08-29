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

// 운영 데이터 없이 관리자 웹 셸을 검수할 합성 API 서버를 구성합니다.
export async function buildSyntheticAdminWebShellApp() {
  const app = Fastify({ logger: false });
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
  return app;
}

const entrypoint = process.argv[1] === undefined ? "" : pathToFileURL(process.argv[1]).href;
if (import.meta.url === entrypoint) {
  const app = await buildSyntheticAdminWebShellApp();
  const port = Number(process.env.ADMIN_WEB_PREVIEW_PORT ?? 3103);
  await app.listen({ host: "127.0.0.1", port });
  console.log(`Synthetic admin web preview: http://127.0.0.1:${port}/admin`);
}
