import { pathToFileURL } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig, type AppConfig } from "./config.js";
import { createDatabaseClient, type DatabaseClient } from "./database.js";
import { GuildTerritoryWarStateStartService } from "./guild/guild-territory-war-state-start-service.js";
import { OutboxWorker } from "./integration/outbox-worker.js";
import { PrivateChatDenialNotificationService } from "./integration/private-chat-denial-notification-service.js";
import {
  assertVerifiedEnvironmentContext,
  createEnvironmentContext,
  verifyStartupDatabaseIdentity,
  type VerifiedEnvironmentContext
} from "./runtime/environment-context.js";

type RuntimeApp = ReturnType<typeof buildApp>;
type OutboxRunner = Pick<OutboxWorker, "runOnce">;
type GuildTerritoryTransitionRunner = Pick<GuildTerritoryWarStateStartService, "runDueTransitions">;
type PrivateChatDenialReconciliationRunner = Pick<PrivateChatDenialNotificationService, "reconcilePending">;

export interface ServerStartupDependencies {
  createDatabase?: (config: AppConfig["database"]) => DatabaseClient;
  verifyDatabaseIdentity?: typeof verifyStartupDatabaseIdentity;
  buildRuntimeApp?: typeof buildApp;
  createOutboxRunner?: (database: DatabaseClient, deliver: (message: { room: string; data: string }) => Promise<void>) => OutboxRunner;
  createGuildTerritoryTransitionRunner?: (database: DatabaseClient) => GuildTerritoryTransitionRunner;
  createPrivateChatDenialReconciliationRunner?: (database: DatabaseClient, environmentContext: VerifiedEnvironmentContext) => PrivateChatDenialReconciliationRunner;
  setRecurring?: (callback: () => void, milliseconds: number) => NodeJS.Timeout;
}

export interface StartedServer {
  readonly app: RuntimeApp;
  readonly database: DatabaseClient | undefined;
  readonly environmentContext: VerifiedEnvironmentContext | undefined;
  shutdown(signal?: string): Promise<void>;
}

// 서버 프로세스의 background outbox 재시도 전송기입니다.
async function deliverIrisText(config: AppConfig, message: { room: string; data: string }): Promise<void> {
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

/**
 * DB identity 검증을 앱 구성보다 먼저 완료하고, listen 성공 뒤에만 background outbox를 시작합니다.
 */
export async function startServer(
  config: AppConfig,
  dependencies: ServerStartupDependencies = {}
): Promise<StartedServer> {
  const createDatabase = dependencies.createDatabase ?? createDatabaseClient;
  const verifyDatabaseIdentity = dependencies.verifyDatabaseIdentity ?? verifyStartupDatabaseIdentity;
  const buildRuntimeApp = dependencies.buildRuntimeApp ?? buildApp;
  const createOutboxRunner = dependencies.createOutboxRunner
    ?? ((database, deliver) => new OutboxWorker(database, deliver));
  const createGuildTerritoryTransitionRunner = dependencies.createGuildTerritoryTransitionRunner
    ?? ((database) => new GuildTerritoryWarStateStartService(database));
  const createPrivateChatDenialReconciliationRunner = dependencies.createPrivateChatDenialReconciliationRunner
    ?? ((database, context) => new PrivateChatDenialNotificationService(database, context));
  const setRecurring = dependencies.setRecurring
    ?? ((callback: () => void, milliseconds: number) => setInterval(callback, milliseconds) as NodeJS.Timeout);
  let database: DatabaseClient | undefined;
  let environmentContext: VerifiedEnvironmentContext | undefined;
  let app: RuntimeApp | undefined;
  let outboxTimer: NodeJS.Timeout | undefined;
  let guildTerritoryTransitionTimer: NodeJS.Timeout | undefined;
  let guildTerritoryTransitionInFlight: Promise<void> | undefined;
  let privateChatDenialReconciliationTimer: NodeJS.Timeout | undefined;
  let privateChatDenialReconciliationInFlight: Promise<void> | undefined;
  let shuttingDown = false;

  try {
    if (config.database.enabled) {
      if (config.environmentCode === undefined) {
        throw new Error("HOIBOT_ENVIRONMENT_CODE must be explicitly set before database startup.");
      }
      const context = createEnvironmentContext({
        environmentCode: config.environmentCode,
        databaseIdentity: config.database.name
      });
      database = createDatabase(config.database);
      environmentContext = await verifyDatabaseIdentity(database, context);
      assertVerifiedEnvironmentContext(environmentContext);
    }

    app = buildRuntimeApp(config, { database, environmentContext });
    await app.listen({ host: config.host, port: config.port });

    if (database !== undefined) {
      const worker = createOutboxRunner(database, (message) => deliverIrisText(config, message));
      const guildTerritoryTransitionWorker = createGuildTerritoryTransitionRunner(database);
      const privateChatDenialReconciliationWorker = createPrivateChatDenialReconciliationRunner(database, environmentContext!);
      const runGuildTerritoryTransitions = (): Promise<void> => {
        if (guildTerritoryTransitionInFlight !== undefined) return guildTerritoryTransitionInFlight;
        const current = Promise.resolve()
          .then(() => guildTerritoryTransitionWorker.runDueTransitions())
          .then(() => undefined)
          .finally(() => {
            if (guildTerritoryTransitionInFlight === current) guildTerritoryTransitionInFlight = undefined;
          });
        guildTerritoryTransitionInFlight = current;
        return current;
      };
      const runPrivateChatDenialReconciliation = (): Promise<void> => {
        if (privateChatDenialReconciliationInFlight !== undefined) return privateChatDenialReconciliationInFlight;
        const current = Promise.resolve()
          .then(() => privateChatDenialReconciliationWorker.reconcilePending())
          .then(() => undefined)
          .finally(() => {
            if (privateChatDenialReconciliationInFlight === current) privateChatDenialReconciliationInFlight = undefined;
          });
        privateChatDenialReconciliationInFlight = current;
        return current;
      };
      await runGuildTerritoryTransitions();
      await runPrivateChatDenialReconciliation();
      outboxTimer = setRecurring(() => {
        void worker.runOnce().catch((error) => app!.log.error({ err: error }, "outbox.worker.failed"));
      }, 5_000);
      outboxTimer.unref();
      guildTerritoryTransitionTimer = setRecurring(() => {
        void runGuildTerritoryTransitions().catch((error) => app!.log.error({ err: error }, "guild-territory.transition-worker.failed"));
      }, 1_000);
      guildTerritoryTransitionTimer.unref();
      privateChatDenialReconciliationTimer = setRecurring(() => {
        void runPrivateChatDenialReconciliation().catch((error) => app!.log.error({ err: error }, "private-chat-denial.reconciliation-worker.failed"));
      }, 5_000);
      privateChatDenialReconciliationTimer.unref();
    }
    app.log.info({ host: config.host, port: config.port, version: config.version }, "server.started");
  } catch (error) {
    if (app !== undefined) await app.close();
    else await database?.close();
    throw error;
  }

  const startedApp = app;
  return {
    app: startedApp,
    database,
    environmentContext,
    async shutdown(signal = "APPLICATION") {
      if (shuttingDown) return;
      shuttingDown = true;
      if (outboxTimer !== undefined) clearInterval(outboxTimer);
      if (guildTerritoryTransitionTimer !== undefined) clearInterval(guildTerritoryTransitionTimer);
      if (privateChatDenialReconciliationTimer !== undefined) clearInterval(privateChatDenialReconciliationTimer);
      startedApp.log.info({ signal }, "server.shutdown.started");
      if (guildTerritoryTransitionInFlight !== undefined) {
        try {
          await guildTerritoryTransitionInFlight;
        } catch (error) {
          startedApp.log.error({ err: error }, "guild-territory.transition-worker.drain-failed");
        }
      }
      if (privateChatDenialReconciliationInFlight !== undefined) {
        try {
          await privateChatDenialReconciliationInFlight;
        } catch (error) {
          startedApp.log.error({ err: error }, "private-chat-denial.reconciliation-worker.drain-failed");
        }
      }
      await startedApp.close();
      startedApp.log.info("server.shutdown.completed");
    }
  };
}

async function runServerProcess(): Promise<void> {
  let started: StartedServer | undefined;
  const shutdown = (signal: string) => { void started?.shutdown(signal); };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  try {
    started = await startServer(loadConfig());
  } catch (error) {
    console.error("server.start.failed", error);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  await runServerProcess();
}
