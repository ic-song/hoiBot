import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CurrentPlayerBagService } from "../../../runtime/src/inventory/current-player-bag-service.ts";
import { USER_SHELL_CLIENT, USER_SHELL_HTML, USER_SHELL_STYLES } from "../../../runtime/src/site-web/user-shell-assets.ts";

const evidenceDirectory = fileURLToPath(new URL("./", import.meta.url));
const profileDirectory = join(tmpdir(), `hoibot-wbs011d-chrome-${process.pid}`);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 3312;
const debuggingPort = 9335;
const furnitureFixture = {
  ownerLabel: "Shadow 용사",
  items: [
    { displayName: "아주 긴 이름의 별빛 왕실 소파 가구", gradeDisplayName: "전설", charm: "18446744073709551615" },
    { displayName: "달빛 탁자", gradeDisplayName: "희귀", charm: "9" }
  ]
};
const service = new CurrentPlayerBagService({
  async findCurrentPlayerBag() {
    return { ownerLabel: "Shadow 용사", advertisement: "", items: [{ displayName: "일반 회귀 아이템", quantity: "2" }] };
  },
  async findCurrentPlayerFurnitureBag() { return furnitureFixture; }
});

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/account/inventory") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(USER_SHELL_HTML);
    return;
  }
  if (url.pathname === "/site/assets/user-shell.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(USER_SHELL_STYLES);
    return;
  }
  if (url.pathname === "/site/assets/user-shell.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(USER_SHELL_CLIENT);
    return;
  }
  if (url.pathname === "/api/v1/sessions/current") {
    json(response, 200, { session: { loginId: "shadow01", playerId: "101", systemAccountName: "호이월드" }, csrfToken: "shadow-csrf" });
    return;
  }
  if (url.pathname === "/api/v1/player-profiles/current") {
    json(response, 200, { profile: { displayName: "Shadow 용사", currencyAccounts: [{ code: "point", balance: "12345678901234567890" }, { code: "diamond", balance: "7000" }] } });
    return;
  }
  if (url.pathname === "/api/v1/inventory/current") {
    const category = url.searchParams.get("category");
    if (category !== "general" && category !== "furniture") {
      json(response, 422, { error: { code: "BAG_CATEGORY_INVALID" } });
      return;
    }
    const payload = await service.execute({ currentPlayerId: "101", category, limit: Number(url.searchParams.get("limit")), offset: Number(url.searchParams.get("offset")) });
    json(response, 200, payload);
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
await rm(profileDirectory, { recursive: true, force: true });
await mkdir(profileDirectory, { recursive: true });
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profileDirectory}`, "about:blank"], { stdio: "ignore", windowsHide: true });

async function retryJson(url, init) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const result = await fetch(url, init);
      if (result.ok) return result.json();
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Chrome CDP 연결 실패");
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
  const message = JSON.parse(event.data);
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
  return result.result.value;
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`화면 상태 대기 실패: ${expression}`);
}

await send("Page.enable");
await send("Runtime.enable");
const widths = [375, 768, 1024, 1440];
const report = [];
for (const width of widths) {
  const height = width === 375 ? 812 : 900;
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/account/inventory` });
  await waitFor(`document.querySelector("#inventory-state").textContent === "조회 완료"`);
  const general = await evaluate(`(() => ({
    requestCategory: document.querySelector("#inventory-general-tab").getAttribute("aria-selected"),
    item: document.querySelector(".inventory-item-name").textContent,
    point: document.querySelector("#header-point-balance-value").textContent,
    diamond: document.querySelector("#header-diamond-balance-value").textContent
  }))()`);
  await evaluate(`document.querySelector("#inventory-furniture-tab").click()`);
  await waitFor(`document.querySelector("#inventory-furniture-tab").getAttribute("aria-selected") === "true" && document.querySelector("#inventory-state").textContent === "조회 완료"`);
  const furniture = await evaluate(`(() => {
    const root = document.documentElement;
    const body = document.body;
    const row = document.querySelector(".inventory-item");
    const tab = document.querySelector("#inventory-furniture-tab");
    return {
      innerWidth,
      scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
      horizontalOverflow: Math.max(root.scrollWidth, body.scrollWidth) > root.clientWidth,
      selected: tab.getAttribute("aria-selected"),
      tabHeight: tab.getBoundingClientRect().height,
      focusedHeading: document.activeElement && document.activeElement.id,
      owner: document.querySelector("#inventory-owner").textContent,
      name: row.querySelector(".inventory-item-name").textContent,
      grade: row.querySelector(".inventory-item-details").children[0].textContent,
      charm: row.querySelector(".inventory-item-details").children[1].textContent,
      quantity: row.querySelector(".inventory-item-quantity").textContent,
      exposedInternalId: document.body.textContent.includes("do-not-show"),
      point: document.querySelector("#header-point-balance-value").textContent,
      diamond: document.querySelector("#header-diamond-balance-value").textContent
    };
  })()`);
  report.push({ width, height, general, furniture });
  const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(join(evidenceDirectory, `furniture-${width}.png`), Buffer.from(screenshot.data, "base64"));
}
await writeFile(join(evidenceDirectory, "responsive-results.json"), `${JSON.stringify({ schemaVersion: "web-current-player-bag-category-ui-shadow-v1", captureMethod: "actual CurrentPlayerBagService fixture + Chrome CDP", providerInput: furnitureFixture, viewports: report }, null, 2)}\n`, "utf8");
socket.close();
chrome.kill();
await new Promise((resolve) => server.close(resolve));
await new Promise((resolve) => setTimeout(resolve, 300));
await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
console.log(JSON.stringify(report));
