import type { FastifyInstance, FastifyReply } from "fastify";
import {
  ACCOUNT_RECOVERY_CLIENT,
  ACCOUNT_RECOVERY_HTML,
  ACCOUNT_RECOVERY_STYLES
} from "./account-recovery-assets.js";

const BROWSER_SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
} as const;

function send(reply: FastifyReply, type: string, body: string) {
  return reply.headers(BROWSER_SECURITY_HEADERS).type(type).send(body);
}

// 계정 탈퇴 요청과 유예 중 복구 화면 및 정적 자산을 등록합니다.
export async function registerAccountRecoveryRoutes(app: FastifyInstance): Promise<void> {
  for (const path of ["/account/delete", "/account/delete/", "/recover-account", "/recover-account/"]) {
    app.get(path, async (_request, reply) => send(reply, "text/html; charset=utf-8", ACCOUNT_RECOVERY_HTML));
  }
  app.get("/site/assets/account-recovery.css", async (_request, reply) =>
    send(reply, "text/css; charset=utf-8", ACCOUNT_RECOVERY_STYLES)
  );
  app.get("/site/assets/account-recovery.js", async (_request, reply) =>
    send(reply, "text/javascript; charset=utf-8", ACCOUNT_RECOVERY_CLIENT)
  );
}
