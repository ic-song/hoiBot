import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = dirname(fileURLToPath(import.meta.url));
const targets = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 }
];

const pages = await fetch("http://127.0.0.1:9333/json/list").then((response) => response.json());
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
  const id = requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Page.enable");
await send("Runtime.enable");
const results = [];
for (const target of targets) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: target.width,
    height: target.height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send("Page.navigate", { url: "http://127.0.0.1:3310/app" });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const evaluated = await send("Runtime.evaluate", {
    expression: `({
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight
      },
      route: location.pathname,
      activeView: document.getElementById("app-view").hidden ? "login" : "app"
    })`,
    returnByValue: true
  });
  const metrics = evaluated.result.value;
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  await writeFile(join(outputDir, `app-${target.width}.png`), Buffer.from(screenshot.data, "base64"));
  results.push({
    ...metrics,
    overflowX: metrics.document.scrollWidth - metrics.document.clientWidth,
    pass: metrics.activeView === "app" && metrics.document.scrollWidth === metrics.document.clientWidth
  });
}

socket.close();
await writeFile(join(outputDir, "responsive-results.json"), `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(JSON.stringify(results));
