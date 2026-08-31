import type { FastifyInstance, FastifyReply } from "fastify";
import { SITE_SIGNUP_CLIENT, SITE_SIGNUP_HTML, SITE_SIGNUP_STYLES } from "./site-signup-web-assets.js";

// 공개 가입 화면 응답에 캐시 금지와 브라우저 보안 헤더를 적용합니다.
function secureSignupReply(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store")
    .header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    .header("referrer-policy", "no-referrer")
    .header("x-content-type-options", "nosniff")
    .header("x-frame-options", "DENY");
}

// 기존 사용자 인증 API를 소비하는 공개 회원가입 셸 경로를 등록합니다.
export async function registerSiteSignupWebRoutes(app: FastifyInstance): Promise<void> {
  app.get("/signup", async (_request, reply) => secureSignupReply(reply).type("text/html; charset=utf-8").send(SITE_SIGNUP_HTML));
  app.get("/signup/", async (_request, reply) => secureSignupReply(reply).type("text/html; charset=utf-8").send(SITE_SIGNUP_HTML));
  app.get("/signup/assets/signup.css", async (_request, reply) => secureSignupReply(reply).type("text/css; charset=utf-8").send(SITE_SIGNUP_STYLES));
  app.get("/signup/assets/signup.js", async (_request, reply) => secureSignupReply(reply).type("text/javascript; charset=utf-8").send(SITE_SIGNUP_CLIENT));
}
