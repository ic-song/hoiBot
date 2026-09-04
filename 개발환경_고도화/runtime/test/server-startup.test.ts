import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { assertVerifiedEnvironmentContext } from "../src/runtime/environment-context.js";
import { startServer } from "../src/server.js";

function database(identity: string, events: string[]): DatabaseClient {
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: async <T>(sql: string) => {
      events.push(`query:${sql}`);
      return [{ database_identity: identity }] as T;
    },
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 0n, insertId: 0n }),
    withTransaction: async <T>(_work: (transaction: DatabaseTransaction) => Promise<T>) => {
      throw new Error("Unexpected transaction during startup test.");
    },
    close: async () => { events.push("close"); }
  };
}

function enabledConfig() {
  return {
    ...loadConfig({
      NODE_ENV: "test",
      IRIS_SHARED_TOKEN: "test-shared-token-1234",
      DATABASE_ENABLED: "true",
      HOIBOT_ENVIRONMENT_CODE: "dev",
      DATABASE_HOST: "127.0.0.1",
      DATABASE_USER: "hoibot_app",
      DATABASE_PASSWORD: "test-password",
      DATABASE_NAME: "hoi_bot"
    }),
    host: "127.0.0.1",
    port: 0
  };
}

describe("server startup database boundary", () => {
  it("verifies the database before building routes and starts outbox only after listen", async () => {
    const events: string[] = [];
    const db = database("hoi_bot", events);
    const started = await startServer(enabledConfig(), {
      createDatabase: () => { events.push("create-database"); return db; },
      buildRuntimeApp: (config, dependencies) => {
        events.push("build-routes");
        assertVerifiedEnvironmentContext(dependencies?.environmentContext);
        const app = buildApp(config, dependencies);
        app.addHook("onListen", async () => { events.push("listen"); });
        return app;
      },
      createOutboxRunner: () => {
        events.push("create-outbox");
        return { runOnce: async () => 0 };
      },
      setRecurring: () => {
        events.push("start-outbox");
        return setInterval(() => undefined, 60_000);
      }
    });

    assert.deepEqual(events.slice(0, 6), [
      "create-database",
      "query:SELECT DATABASE() AS database_identity",
      "build-routes",
      "listen",
      "create-outbox",
      "start-outbox"
    ]);
    assert.equal(started.environmentContext?.requestNamespace, "hoibot:dev:hoi_bot");
    await started.shutdown("TEST");
    assert.equal(events.at(-1), "close");
  });

  it("closes the database without building routes, listening, or starting outbox on identity mismatch", async () => {
    const events: string[] = [];
    const db = database("HOI_BOT", events);
    let buildCalls = 0;
    let outboxStarts = 0;

    await assert.rejects(() => startServer(enabledConfig(), {
      createDatabase: () => { events.push("create-database"); return db; },
      buildRuntimeApp: (config, dependencies) => {
        buildCalls += 1;
        return buildApp(config, dependencies);
      },
      setRecurring: () => {
        outboxStarts += 1;
        return setInterval(() => undefined, 60_000);
      }
    }), /byte-for-byte/);

    assert.equal(buildCalls, 0);
    assert.equal(outboxStarts, 0);
    assert.deepEqual(events, [
      "create-database",
      "query:SELECT DATABASE() AS database_identity",
      "close"
    ]);
  });

  it("rejects an unbranded verification result before app construction", async () => {
    const events: string[] = [];
    const db = database("hoi_bot", events);
    let buildCalls = 0;

    await assert.rejects(() => startServer(enabledConfig(), {
      createDatabase: () => db,
      verifyDatabaseIdentity: async (_database, context) => context as never,
      buildRuntimeApp: (config, dependencies) => {
        buildCalls += 1;
        return buildApp(config, dependencies);
      }
    }), /must be issued by verifyStartupDatabaseIdentity/);

    assert.equal(buildCalls, 0);
    assert.deepEqual(events, ["close"]);
  });
});
