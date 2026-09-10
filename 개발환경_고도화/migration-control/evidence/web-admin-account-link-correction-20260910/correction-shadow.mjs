import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "../../../runtime/node_modules/fastify/fastify.js";
import cookie from "../../../runtime/node_modules/@fastify/cookie/index.js";
import { AdminAccountLinkReadService } from "../../../runtime/src/admin/admin-account-link-read-service.ts";
import { registerAdminAccountLinkReadRoutes } from "../../../runtime/src/admin/admin-account-link-read-routes.ts";
import { registerAdminWebShellRoutes } from "../../../runtime/src/admin/web-shell.ts";
import { ApplicationError } from "../../../runtime/src/shared/application-error.ts";
import { syntheticAdminPlayer } from "../../../runtime/test/fixtures/admin-web-shell.ts";

const evidenceDirectory = fileURLToPath(new URL("./", import.meta.url));
const profileDirectory = join(tmpdir(), `hoibot-wbs013a-correction-${process.pid}`);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 3327;
const debuggingPort = 9347;
const rawLoginId = "operator-login-secret";
const rawExternalUserKey = "kakao-external-secret";
const forbiddenValues = ["portal-secret-01", "link-secret-01", "18446744073709551614", rawLoginId, rawExternalUserKey];
const allowedSession = {
  sessionId: "session-shadow",
  operatorId: "operator-shadow",
  loginId: "shadow.manager",
  displayName: "합성 운영자",
  roleCodes: ["manager"],
  permissions: ["player.read"],
};
const queries = [];
const routeResponses = [];

const reader = new AdminAccountLinkReadService({
  async query(sql, params) {
    const playerId = params?.[0]?.toString() ?? "";
    queries.push({ playerId, sql: sql.replace(/\s+/g, " ").trim() });
    if (/FROM players/i.test(sql)) {
      return playerId === "49999" ? [] : [{ player_id: BigInt(playerId) }];
    }
    if (playerId === "50000") throw new Error("scripted read failure");
    if (playerId === "40002") return [];
    return [{
      player_role: "REPRESENTATIVE",
      link_status: "ACTIVE",
      portal_account_status: "ACTIVE",
      login_id: rawLoginId,
      platform_code: "KAKAO",
      context_type: "ROOM",
      selection_status: "ACTIVE",
      external_user_key: rawExternalUserKey,
    }];
  },
});

const auth = {
  async authenticate(sessionToken) {
    if (sessionToken === "expired" || sessionToken === "") {
      throw new ApplicationError("ADMIN_AUTH_REQUIRED", "관리자 로그인이 필요합니다.", 401);
    }
    if (sessionToken === "denied") return { ...allowedSession, permissions: [] };
    return allowedSession;
  },
};

const app = Fastify({ logger: false });
await app.register(cookie);
app.setErrorHandler(async (error, request, reply) => {
  const applicationError = error instanceof ApplicationError;
  await reply.code(applicationError ? error.statusCode : 500).send({
    ok: false,
    error: {
      code: applicationError ? error.code : "INTERNAL_SERVER_ERROR",
      message: applicationError ? error.message : "서버가 요청을 처리하지 못했습니다.",
    },
    requestId: request.id,
  });
});
app.addHook("onSend", async (request, reply, payload) => {
  if (request.url.startsWith("/api/v1/admin/players/") && request.url.includes("/account-links")) {
    routeResponses.push({ method: request.method, url: request.url, statusCode: reply.statusCode, payload: String(payload) });
  }
  return payload;
});
await registerAdminWebShellRoutes(app);
app.get("/api/v1/admin/sessions/current", async () => ({ ok: true, session: allowedSession, requestId: "shadow-session" }));
app.get("/api/v1/admin/players", async () => ({ ok: true, items: [syntheticAdminPlayer], page: 1, limit: 25, total: 1, requestId: "shadow-players" }));
app.get("/api/v1/admin/players/:playerId", async (request) => ({
  ok: true,
  player: { ...syntheticAdminPlayer, playerId: request.params.playerId, displayName: `합성회원 ${request.params.playerId}` },
  requestId: "shadow-player",
}));
await registerAdminAccountLinkReadRoutes(app, { auth, reader });
await app.listen({ host: "127.0.0.1", port });

await rm(profileDirectory, { recursive: true, force: true });
await mkdir(profileDirectory, { recursive: true });
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profileDirectory}`, "about:blank",
], { stdio: "ignore", windowsHide: true });

async function retryJson(url, init) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response.json();
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("Chrome CDP 연결 실패");
}

const target = await retryJson(`http://127.0.0.1:${debuggingPort}/json/new?about:blank`, { method: "PUT" });
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`화면 상태 대기 실패: ${expression}`);
}
async function setSession(value) {
  await send("Network.clearBrowserCookies");
  await send("Network.setCookie", {
    name: "hoibot_admin_session", value, url: `http://127.0.0.1:${port}`, httpOnly: true, sameSite: "Lax",
  });
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
const scenarios = [
  { name: "success-375", playerId: "40001", session: "allowed", width: 375, height: 812, wait: 'document.querySelectorAll(".account-link-card").length === 1' },
  { name: "success-768", playerId: "40001", session: "allowed", width: 768, height: 1024, wait: 'document.querySelectorAll(".account-link-card").length === 1' },
  { name: "success-1024", playerId: "40001", session: "allowed", width: 1024, height: 900, wait: 'document.querySelectorAll(".account-link-card").length === 1' },
  { name: "success-1440", playerId: "40001", session: "allowed", width: 1440, height: 1000, wait: 'document.querySelectorAll(".account-link-card").length === 1' },
  { name: "empty", playerId: "40002", session: "allowed", width: 768, height: 900, wait: 'document.querySelector("#player-account-links .empty-state") !== null' },
  { name: "unauthorized-401", playerId: "40001", session: "expired", width: 768, height: 900, wait: 'document.querySelector("#login-view:not([hidden])") !== null && document.activeElement?.id === "login-id"' },
  { name: "forbidden-403", playerId: "40001", session: "denied", width: 768, height: 900, wait: 'document.querySelector("#player-account-links .error-state")?.textContent.includes("권한") === true' },
  { name: "not-found-404", playerId: "49999", session: "allowed", width: 768, height: 900, wait: 'document.querySelector("#player-account-links .error-state")?.textContent.includes("찾을 수 없습니다") === true' },
  { name: "server-error-500", playerId: "50000", session: "allowed", width: 768, height: 900, wait: 'document.querySelector("#player-account-links .error-state")?.textContent.includes("불러오지 못했습니다") === true' },
];
const browserResults = [];
try {
  for (const scenario of scenarios) {
    await send("Emulation.setDeviceMetricsOverride", { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: scenario.width === 375 });
    await setSession(scenario.session);
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/admin/players/${scenario.playerId}/account-links` });
    await waitFor(scenario.wait);
    const metrics = await evaluate(`(() => {
      const root = document.documentElement;
      const body = document.body;
      const panel = document.querySelector(".account-link-panel");
      const text = body.textContent || "";
      return {
        path: location.pathname,
        statusText: document.querySelector("#player-account-links")?.textContent || document.querySelector("#login-error")?.textContent || "",
        focusedId: document.activeElement?.id || "",
        cardCount: document.querySelectorAll(".account-link-card").length,
        overflowX: Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth,
        rowTargetHeight: document.querySelector("[data-player-id]")?.getBoundingClientRect().height || 0,
        accountPanelMutationControls: panel?.querySelectorAll("form, button:not([data-account-link-retry])").length || 0,
        retryCount: panel?.querySelectorAll("[data-account-link-retry]").length || 0,
        maskedLoginVisible: text.includes("o********t"),
        maskedExternalVisible: text.includes("k********t"),
        forbiddenValuesVisible: ${JSON.stringify(forbiddenValues)}.filter((value) => text.includes(value)),
      };
    })()`);
    const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(join(evidenceDirectory, `${scenario.name}.png`), Buffer.from(screenshot.data, "base64"));
    browserResults.push({ ...scenario, ...metrics });
  }
} finally {
  socket.close();
  chrome.kill();
  await app.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
}

const successResults = browserResults.filter((result) => result.name.startsWith("success-"));
const mutationHttpRequests = routeResponses.filter((entry) => !["GET", "HEAD", "OPTIONS"].includes(entry.method));
const rawLeak = routeResponses.filter((entry) => forbiddenValues.some((value) => entry.payload.includes(value)));
const selectProjections = queries.filter((entry) => /portal_game_account_links/i.test(entry.sql)).map((entry) => entry.sql.split(/\sFROM\s/i)[0]);
const forbiddenProjection = selectProjections.filter((projection) => /portal\.portal_account_id|link\.portal_game_account_link_id|selection\.selection_version/i.test(projection));
const pass = successResults.length === 4
  && successResults.every((result) => result.cardCount === 1 && result.focusedId === "account-link-title" && result.overflowX <= 0
    && result.rowTargetHeight >= 44 && result.accountPanelMutationControls === 0 && result.maskedLoginVisible
    && result.maskedExternalVisible && result.forbiddenValuesVisible.length === 0)
  && browserResults.find((result) => result.name === "empty")?.cardCount === 0
  && browserResults.find((result) => result.name === "unauthorized-401")?.focusedId === "login-id"
  && ["forbidden-403", "not-found-404", "server-error-500"].every((name) => browserResults.find((result) => result.name === name)?.retryCount === 1)
  && rawLeak.length === 0 && forbiddenProjection.length === 0 && mutationHttpRequests.length === 0
  && queries.every((entry) => /^SELECT\b/i.test(entry.sql));
const output = {
  evidenceSchemaVersion: "web-admin-account-link-correction-v1",
  captureMethod: "actual AdminAccountLinkReadService + actual registerAdminAccountLinkReadRoutes + actual admin web shell + Chrome CDP",
  serviceInput: { loginId: rawLoginId, externalUserKey: rawExternalUserKey },
  browserResults,
  routeResponses,
  queries,
  checks: { forbiddenProjectionCount: forbiddenProjection.length, rawResponseLeakCount: rawLeak.length, mutationHttpRequestCount: mutationHttpRequests.length },
  pass,
};
await writeFile(join(evidenceDirectory, "raw-results.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
if (!pass) throw new Error(JSON.stringify(output));
console.log(JSON.stringify({ pass, scenarios: browserResults.length, routeResponses: routeResponses.length, queries: queries.length }));
