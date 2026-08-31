import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, createScopedDatabaseClient, type DatabaseClient } from "../src/database.js";
import { calculateTierTransitionDelta, resolveTierByTickets, TierAuthorityProvider } from "../src/player/tier-authority-provider.js";

const enabled = process.env.RUN_MARIADB_INTEGRATION === "true";

// MariaDB 통합검사 필수 환경변수를 반환합니다.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// 격리 MariaDB 설정으로 새 연결을 생성합니다.
function connect(): DatabaseClient {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_ENABLED: "true",
    DATABASE_HOST: required("DATABASE_HOST"),
    DATABASE_PORT: required("DATABASE_PORT"),
    DATABASE_USER: required("DATABASE_USER"),
    DATABASE_PASSWORD: required("DATABASE_PASSWORD"),
    DATABASE_NAME: required("DATABASE_NAME"),
    IRIS_SHARED_TOKEN: "tier-authority-integration-token",
    USER_VERIFICATION_PEPPER: "tier-authority-integration-pepper"
  });
  return createDatabaseClient(config.database);
}

describe("tier authority provider MariaDB", { skip: !enabled }, () => {
  let database: DatabaseClient;

  before(() => { database = connect(); });
  after(async () => { if (database) await database.close(); });

  it("loads 41 canonical rows and preserves legacy boundaries and deltas", async () => {
    const first = await new TierAuthorityProvider(database).loadPublished();
    assert.equal(first.definitions.length, 41);
    assert.equal(first.definitions[0]!.displayName, "새싹");
    assert.equal(first.definitions[10]!.displayName, "킹");
    assert.equal(first.definitions[40]!.displayName, "피닉스");
    assert.equal(resolveTierByTickets(first.definitions, 6000n, 49n).displayName, "챌린저");
    assert.equal(resolveTierByTickets(first.definitions, 6000n, 50n).displayName, "킹");
    assert.equal(resolveTierByTickets(first.definitions, 2000000n, 5500n).displayName, "피닉스");
    assert.equal(calculateTierTransitionDelta(first.definitions, first.definitions[8]!.tierCode, first.definitions[11]!.tierCode), 14500n);
    assert.equal(calculateTierTransitionDelta(first.definitions, first.definitions[11]!.tierCode, first.definitions[8]!.tierCode), -14500n);

    await assert.rejects(database.withTransaction(async (transaction) => {
      await transaction.execute("UPDATE tier_definition_versions SET status='DRAFT' WHERE id=?", [first.versionId]);
      await assert.rejects(new TierAuthorityProvider(createScopedDatabaseClient(transaction)).loadPublished(), /PUBLICATION_INVALID/);
      throw new Error("TIER_AUTHORITY_ROLLBACK_PROBE");
    }), /ROLLBACK_PROBE/);
    assert.equal(await database.verifyRollback(), true);

    await database.close();
    database = connect();
    const reconnected = await new TierAuthorityProvider(database).loadPublished();
    assert.equal(reconnected.versionCode, first.versionCode);
    assert.equal(reconnected.sourceFingerprint, first.sourceFingerprint);
    assert.deepEqual(reconnected.definitions, first.definitions);
  });
});
