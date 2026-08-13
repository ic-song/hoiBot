import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabaseClient } from "./database.js";
import { OutboxWorker } from "./integration/outbox-worker.js";

const config = loadConfig();
const database = config.database.enabled ? createDatabaseClient(config.database) : undefined;
const app = buildApp(config, { database });
let shuttingDown = false;
let outboxTimer: NodeJS.Timeout | undefined;

// 서버 프로세스의 background outbox 재시도 전송기입니다.
async function deliverIrisText(message: { room: string; data: string }): Promise<void> {
  const response = await fetch(`${config.irisBaseUrl}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "text", room: message.room, data: message.data }),
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok || (await response.json() as { success?: unknown }).success !== true) {
    throw new Error("Iris outbox delivery failed.");
  }
}

// 종료 신호를 받으면 진행 중인 요청을 마무리하고 서버를 닫습니다.
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (outboxTimer !== undefined) clearInterval(outboxTimer);
  app.log.info({ signal }, "server.shutdown.started");
  await app.close();
  app.log.info("server.shutdown.completed");
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({ host: config.host, port: config.port });
  if (database !== undefined) {
    const worker = new OutboxWorker(database, deliverIrisText);
    outboxTimer = setInterval(() => {
      void worker.runOnce().catch((error) => app.log.error({ err: error }, "outbox.worker.failed"));
    }, 5_000);
    outboxTimer.unref();
  }
  app.log.info({ host: config.host, port: config.port, version: config.version }, "server.started");
} catch (error) {
  app.log.fatal({ err: error }, "server.start.failed");
  await app.close();
  process.exitCode = 1;
}
