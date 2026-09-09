import type { FastifyInstance, FastifyReply } from "fastify";
import { USER_SHELL_CLIENT, USER_SHELL_HTML, USER_SHELL_STYLES } from "./user-shell-assets.js";

// 이용자 웹 셸 응답에 캐시 금지와 브라우저 보안 헤더를 적용합니다.
function secureUserShellReply(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store")
    .header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    .header("referrer-policy", "no-referrer")
    .header("x-content-type-options", "nosniff")
    .header("x-frame-options", "DENY");
}

// 기존 사용자 인증 API를 소비하는 로그인·이용자 홈 셸 경로를 등록합니다.
export async function registerUserShellRoutes(app: FastifyInstance): Promise<void> {
  const serveShell = async (_request: unknown, reply: FastifyReply) =>
    secureUserShellReply(reply).type("text/html; charset=utf-8").send(USER_SHELL_HTML);

  app.get("/", serveShell);
  app.get("/login", serveShell);
  app.get("/login/", serveShell);
  app.get("/app", serveShell);
  app.get("/app/", serveShell);
  app.get("/site/assets/user-shell.css", async (_request, reply) =>
    secureUserShellReply(reply).type("text/css; charset=utf-8").send(USER_SHELL_STYLES));
  app.get("/site/assets/user-shell.js", async (_request, reply) =>
    secureUserShellReply(reply).type("text/javascript; charset=utf-8").send(USER_SHELL_CLIENT));
}
