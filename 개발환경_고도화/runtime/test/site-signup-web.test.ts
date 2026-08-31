import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { registerSiteSignupWebRoutes } from "../src/signup/site-signup-web.js";
import { SITE_SIGNUP_CLIENT } from "../src/signup/site-signup-web-assets.js";

describe("site signup web shell", () => {
  it("serves a secure mobile-first form and same-origin client", async () => {
    const app = Fastify();
    await registerSiteSignupWebRoutes(app);
    const [page, styles, client] = await Promise.all([
      app.inject({ method: "GET", url: "/signup/" }),
      app.inject({ method: "GET", url: "/signup/assets/signup.css" }),
      app.inject({ method: "GET", url: "/signup/assets/signup.js" })
    ]);

    assert.equal(page.statusCode, 200);
    assert.equal(page.headers["x-frame-options"], "DENY");
    assert.match(page.body, /name="loginId"/);
    assert.match(page.body, /name="acceptTerms"/);
    assert.match(page.body, /<h2 tabindex="-1">카카오톡에서 인증해 주세요<\/h2>/);
    assert.doesNotMatch(page.body, /<script[^>]*>[^<]+<\/script>/);
    assert.match(styles.body, /@media \(min-width: 820px\)/);
    assert.match(styles.body, /prefers-reduced-motion/);
    assert.match(client.body, /\/api\/v1\/verification-challenges/);
    assert.match(client.body, /setInterval\(checkStatus, 5000\)/);
    assert.doesNotThrow(() => new Function(SITE_SIGNUP_CLIENT));
    await app.close();
  });
});
