import type { FastifyInstance, FastifyReply } from "fastify";
import { ADMIN_WEB_CLIENT, ADMIN_WEB_HTML, ADMIN_WEB_STYLES } from "./web-shell-assets.js";

// 관리자 웹 셸 응답에 브라우저 보안·캐시 금지 헤더를 적용합니다.
function secureWebReply(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store")
    .header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    .header("referrer-policy", "no-referrer")
    .header("x-content-type-options", "nosniff")
    .header("x-frame-options", "DENY");
}

// 기존 관리자 REST API를 사용하는 정적 웹 셸 경로를 등록합니다.
export async function registerAdminWebShellRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin", async (_request, reply) => secureWebReply(reply).type("text/html; charset=utf-8").send(ADMIN_WEB_HTML));
  app.get("/admin/", async (_request, reply) => secureWebReply(reply).type("text/html; charset=utf-8").send(ADMIN_WEB_HTML));
  app.get("/admin/players/:playerId/account-links", async (_request, reply) => secureWebReply(reply).type("text/html; charset=utf-8").send(ADMIN_WEB_HTML));
  for (const path of [
    "/admin/catalog/diamond-shop",
    "/admin/catalog/pet-skills",
    "/admin/catalog/items",
    "/admin/catalog/furniture",
    "/admin/catalog/mini-pets"
  ]) {
    for (const route of [path, `${path}/`]) {
      app.get(route, async (_request, reply) => secureWebReply(reply).type("text/html; charset=utf-8").send(ADMIN_WEB_HTML));
    }
  }
  app.get("/admin/assets/admin.css", async (_request, reply) => secureWebReply(reply).type("text/css; charset=utf-8").send(ADMIN_WEB_STYLES));
  app.get("/admin/assets/admin.js", async (_request, reply) => secureWebReply(reply).type("text/javascript; charset=utf-8").send(ADMIN_WEB_CLIENT));
}
