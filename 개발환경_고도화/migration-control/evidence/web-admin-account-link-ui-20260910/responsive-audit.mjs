import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = dirname(fileURLToPath(import.meta.url));
const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 }
];
const pages = await fetch("http://127.0.0.1:9334/json/list").then((response) => response.json());
const page = pages.find((candidate) => candidate.type === "page");
if (!page) throw new Error("Chrome DevTools page target을 찾지 못했습니다.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let requestId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
function send(method, params = {}) {
  requestId += 1;
  socket.send(JSON.stringify({ id: requestId, method, params }));
  return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
await send("Page.enable");
await send("Runtime.enable");
const results = [];
for (const target of viewports) {
  await send("Emulation.setDeviceMetricsOverride", { ...target, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:3311/admin" });
  await new Promise((resolve) => setTimeout(resolve, 350));
  await evaluate(`fetch("/api/v1/admin/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loginId: "shadow.manager", password: "synthetic" }) })`);
  await send("Page.navigate", { url: "http://127.0.0.1:3311/admin/players/40001/account-links" });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const metrics = await evaluate(`({
    viewport: { width: innerWidth, height: innerHeight },
    path: location.pathname,
    documentWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    panelVisible: Boolean(document.querySelector(".account-link-panel")),
    cardCount: document.querySelectorAll(".account-link-card").length,
    focusedId: document.activeElement && document.activeElement.id,
    loginText: document.querySelector(".account-link-fields")?.textContent || "",
    forbiddenRendered: /portal-synthetic-01|link-synthetic-01|18446744073709551614/.test(document.getElementById("player-account-links")?.textContent || ""),
    mutationControlCount: document.querySelectorAll(".account-link-panel button, .account-link-panel form").length,
    rowTargetHeight: document.querySelector("[data-player-id]")?.getBoundingClientRect().height || 0
  })`);
  const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(outputDir, `account-links-${target.width}.png`), Buffer.from(screenshot.data, "base64"));
  const pass = metrics.path === "/admin/players/40001/account-links"
    && metrics.documentWidth === metrics.clientWidth
    && metrics.panelVisible && metrics.cardCount === 1
    && metrics.focusedId === "account-link-title"
    && metrics.loginText.includes("s******r") && metrics.loginText.includes("k********y")
    && !metrics.forbiddenRendered && metrics.mutationControlCount === 0
    && metrics.rowTargetHeight >= 44;
  results.push({ ...metrics, overflowX: metrics.documentWidth - metrics.clientWidth, pass });
}
socket.close();
await writeFile(join(outputDir, "responsive-results.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), resultCount: results.length, results }, null, 2)}\n`);
if (results.some((result) => !result.pass)) throw new Error(JSON.stringify(results));
console.log(JSON.stringify(results));
