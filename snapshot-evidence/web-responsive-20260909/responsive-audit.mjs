import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const evidenceDirectory = new URL("./", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const profileDirectory = join(evidenceDirectory, `.chrome-profile-${process.pid}`);
const debuggingPort = 9333;
await rm(profileDirectory, { recursive: true, force: true });
await mkdir(profileDirectory, { recursive: true });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${profileDirectory}`,
  "about:blank"
], { stdio: "ignore", windowsHide: true });

async function retryJson(url, init) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Unable to reach ${url}`);
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
  if (message.id === undefined) return;
  const waiter = pending.get(message.id);
  if (waiter === undefined) return;
  pending.delete(message.id);
  if (message.error !== undefined) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Page.enable");
await send("Runtime.enable");

const cases = [
  { name: "login", path: "/login" },
  { name: "signup", path: "/signup" },
  { name: "recover-account", path: "/recover-account" }
];
const widths = [375, 768, 1024, 1440];
const report = [];

for (const pageCase of cases) {
  for (const width of widths) {
    const height = width < 820 ? 812 : 900;
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send("Page.navigate", { url: `http://127.0.0.1:3310${pageCase.path}` });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
    const evaluated = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const root = document.documentElement;
        const body = document.body;
        const visible = [...document.querySelectorAll("body *")].filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
        });
        const offenders = visible.map((element) => {
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName, id: element.id, className: String(element.className || ""), left: rect.left, right: rect.right };
        }).filter((item) => item.left < -1 || item.right > innerWidth + 1).slice(0, 10);
        const layout = document.querySelector(".login-layout, .signup-layout, .page-shell");
        return {
          path: location.pathname,
          title: document.title,
          innerWidth,
          innerHeight,
          clientWidth: root.clientWidth,
          scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
          horizontalOverflow: Math.max(root.scrollWidth, body.scrollWidth) > root.clientWidth,
          offenders,
          min620: matchMedia("(min-width: 620px)").matches,
          min820: matchMedia("(min-width: 820px)").matches,
          layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : null
        };
      })()`
    });
    report.push({ case: pageCase.name, width, ...evaluated.result.value });
    await writeFile(join(evidenceDirectory, "responsive-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(join(evidenceDirectory, `${pageCase.name}-${width}-audit.png`), Buffer.from(screenshot.data, "base64"));
  }
}

await writeFile(join(evidenceDirectory, "responsive-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
chrome.kill();
await new Promise((resolve) => setTimeout(resolve, 500));
await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
console.log(JSON.stringify(report));
