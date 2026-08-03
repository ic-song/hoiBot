import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config);
let shuttingDown = false;

// 종료 신호를 받으면 진행 중인 요청을 마무리하고 서버를 닫습니다.
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
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
  app.log.info({ host: config.host, port: config.port, version: config.version }, "server.started");
} catch (error) {
  app.log.fatal({ err: error }, "server.start.failed");
  process.exitCode = 1;
}
