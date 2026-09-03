import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatabaseClient } from "../src/database.js";
import {
  STARTUP_DATABASE_IDENTITY_QUERY,
  assertVerifiedEnvironmentContext,
  createEnvironmentContext,
  verifyStartupDatabaseIdentity
} from "../src/runtime/environment-context.js";

type QueryOnlyDatabase = Pick<DatabaseClient, "query">;

function databaseReturning(rows: unknown): { database: QueryOnlyDatabase; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    database: {
      query: async <T>(sql: string): Promise<T> => {
        queries.push(sql);
        return rows as T;
      }
    }
  };
}

describe("startup database identity verification", () => {
  it("runs SELECT DATABASE() exactly and returns a distinct branded frozen context on an exact match", async () => {
    const context = createEnvironmentContext({ environmentCode: "prod", databaseIdentity: "hoibot_prod" });
    const fake = databaseReturning([{ database_identity: "hoibot_prod" }]);

    const verified = await verifyStartupDatabaseIdentity(fake.database, context);

    assert.equal(STARTUP_DATABASE_IDENTITY_QUERY, "SELECT DATABASE() AS database_identity");
    assert.deepEqual(fake.queries, [STARTUP_DATABASE_IDENTITY_QUERY]);
    assert.notEqual(verified, context);
    assert.deepEqual(verified, context);
    assert.equal(Object.isFrozen(verified), true);
    assert.doesNotThrow(() => assertVerifiedEnvironmentContext(verified));
    assert.throws(() => assertVerifiedEnvironmentContext(context), /must be issued/);
    assert.throws(() => assertVerifiedEnvironmentContext(Object.freeze({ ...verified })), /must be issued/);
  });

  it("rejects case, whitespace, null, and empty differences without normalization", async () => {
    const context = createEnvironmentContext({ environmentCode: "prod", databaseIdentity: "hoibot_prod" });
    for (const actual of ["HOIBOT_PROD", "hoibot_prod ", " hoibot_prod", null, ""]) {
      const fake = databaseReturning([{ database_identity: actual }]);
      await assert.rejects(
        verifyStartupDatabaseIdentity(fake.database, context),
        actual === null || actual === "" ? /null or empty identity/ : /byte-for-byte/
      );
    }
  });

  it("rejects missing or ambiguous SELECT DATABASE() results", async () => {
    const context = createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "hoibot_dev" });
    await assert.rejects(
      verifyStartupDatabaseIdentity(databaseReturning([]).database, context),
      /exactly one row/
    );
    await assert.rejects(
      verifyStartupDatabaseIdentity(databaseReturning([
        { database_identity: "hoibot_dev" },
        { database_identity: "hoibot_dev" }
      ]).database, context),
      /exactly one row/
    );
  });

  it("rejects forged mutable or namespace-mismatched contexts before querying", async () => {
    const mutable = {
      environmentCode: "dev" as const,
      databaseIdentity: "hoibot_dev",
      requestNamespace: "hoibot:dev:hoibot_dev"
    };
    const wrongNamespace = Object.freeze({
      ...mutable,
      requestNamespace: "hoibot:prod:hoibot_dev"
    });
    const fake = databaseReturning([{ database_identity: "hoibot_dev" }]);

    await assert.rejects(verifyStartupDatabaseIdentity(fake.database, mutable), /must be immutable/);
    await assert.rejects(verifyStartupDatabaseIdentity(fake.database, wrongNamespace), /does not match/);
    assert.deepEqual(fake.queries, []);
  });

  it("propagates query failures and never substitutes a configured identity", async () => {
    const context = createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "hoibot_dev" });
    const failure = new Error("connection unavailable");
    const database: QueryOnlyDatabase = {
      query: async <T>(): Promise<T> => { throw failure; }
    };

    await assert.rejects(verifyStartupDatabaseIdentity(database, context), (error) => error === failure);
  });
});
