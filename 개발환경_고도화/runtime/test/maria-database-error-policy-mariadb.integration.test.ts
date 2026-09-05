import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, createScopedDatabaseClient, type DatabaseClient } from "../src/database.js";
import { classifyMariaDatabaseError, withMariaTransactionRetry } from "../src/shared/maria-database-error-policy.js";

const integration = process.env.RFA03_ERROR_RETRY_MARIADB_TEST === "true" ? describe : describe.skip;
const parentTable = "rfa03_lease2564_parent";
const childTable = "rfa03_lease2564_child";

integration("RFA03 isolated MariaDB code/errno policy", () => {
  let database: DatabaseClient;

  before(async () => {
    database = createDatabaseClient({
      enabled: true,
      host: process.env.DATABASE_HOST!, port: Number(process.env.DATABASE_PORT!),
      user: process.env.DATABASE_USER!, password: process.env.DATABASE_PASSWORD!, name: process.env.DATABASE_NAME!,
      connectionLimit: 4, connectTimeoutMs: 5_000,
    });
    await database.execute(`DROP TABLE IF EXISTS ${childTable}`);
    await database.execute(`DROP TABLE IF EXISTS ${parentTable}`);
    await database.execute(`CREATE TABLE ${parentTable} (object_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, business_key VARCHAR(50) NOT NULL, PRIMARY KEY (object_id), UNIQUE KEY uq_rfa03_business (business_key)) ENGINE=InnoDB`);
    await database.execute(`CREATE TABLE ${childTable} (child_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, object_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, PRIMARY KEY (child_id), CONSTRAINT fk_rfa03_child_object FOREIGN KEY (object_id) REFERENCES ${parentTable}(object_id)) ENGINE=InnoDB`);
  });

  after(async () => {
    if (database !== undefined) {
      await database.execute(`DROP TABLE IF EXISTS ${childTable}`);
      await database.execute(`DROP TABLE IF EXISTS ${parentTable}`);
      await database.close();
    }
  });

  it("observes real 1062 and 1452 without confusing business UNIQUE/FK with a CUID8 PK collision", async () => {
    await database.execute(`INSERT INTO ${parentTable}(object_id,business_key) VALUES ('a1234567','one')`);
    const capture = async (sql: string): Promise<unknown> => {
      try { await database.execute(sql); }
      catch (error) { return error; }
      throw new Error("RFA03_EXPECTED_MARIA_ERROR_MISSING");
    };
    const primary = await capture(`INSERT INTO ${parentTable}(object_id,business_key) VALUES ('a1234567','two')`);
    assert.deepEqual({ code: (primary as { code: string }).code, errno: (primary as { errno: number }).errno }, { code: "ER_DUP_ENTRY", errno: 1062 });
    assert.equal(classifyMariaDatabaseError(primary, { candidate: "a1234567" }).kind, "CUID8_PRIMARY_KEY_COLLISION");

    const unique = await capture(`INSERT INTO ${parentTable}(object_id,business_key) VALUES ('b1234567','one')`);
    assert.deepEqual({ code: (unique as { code: string }).code, errno: (unique as { errno: number }).errno }, { code: "ER_DUP_ENTRY", errno: 1062 });
    assert.equal(classifyMariaDatabaseError(unique, { candidate: "b1234567" }).kind, "BUSINESS_UNIQUE_CONFLICT");

    const foreignKey = await capture(`INSERT INTO ${childTable}(child_id,object_id) VALUES ('c1234567','z1234567')`);
    assert.deepEqual({ code: (foreignKey as { code: string }).code, errno: (foreignKey as { errno: number }).errno }, { code: "ER_NO_REFERENCED_ROW_2", errno: 1452 });
    assert.equal(classifyMariaDatabaseError(foreignKey, { candidate: "c1234567" }).kind, "FOREIGN_KEY_CONFLICT");
  });

  it("restarts a fresh transaction only for domain-approved real 1213/1205 server errors", async () => {
    for (const conflict of [
      { errno: 1213, sqlState: "40001", kind: "TRANSACTION_DEADLOCK" },
      { errno: 1205, sqlState: "HY000", kind: "TRANSACTION_LOCK_WAIT_TIMEOUT" },
    ] as const) {
      let observed: unknown;
      try {
        await database.withTransaction((transaction) => transaction.query(`SIGNAL SQLSTATE '${conflict.sqlState}' SET MYSQL_ERRNO=${conflict.errno}, MESSAGE_TEXT='RFA03 observed conflict'`));
      } catch (error) { observed = error; }
      assert.deepEqual({ code: (observed as { code: string }).code, errno: (observed as { errno: number }).errno }, {
        code: conflict.errno === 1213 ? "ER_LOCK_DEADLOCK" : "ER_LOCK_WAIT_TIMEOUT", errno: conflict.errno,
      });
      assert.equal(classifyMariaDatabaseError(observed).kind, conflict.kind);

      let scopedObserved: unknown;
      try {
        await database.withTransaction(async (parent) => withMariaTransactionRetry(
          createScopedDatabaseClient(parent), { maxAttempts: 2, allowRetry: () => true },
          (current) => current.query(`SIGNAL SQLSTATE '${conflict.sqlState}' SET MYSQL_ERRNO=${conflict.errno}, MESSAGE_TEXT='RFA03 scoped conflict'`),
        ));
      } catch (error) { scopedObserved = error; }
      assert.deepEqual({ code: (scopedObserved as { code: string }).code, errno: (scopedObserved as { errno: number }).errno }, {
        code: conflict.errno === 1213 ? "ER_LOCK_DEADLOCK" : "ER_LOCK_WAIT_TIMEOUT", errno: conflict.errno,
      });
      assert.equal(classifyMariaDatabaseError(scopedObserved).kind, conflict.kind);

      let attempts = 0;
      const transactions: object[] = [];
      const result = await withMariaTransactionRetry(database, { maxAttempts: 2, allowRetry: (kind) => kind === conflict.kind }, async (transaction) => {
        attempts += 1;
        transactions.push(transaction);
        if (attempts === 1) await transaction.query(`SIGNAL SQLSTATE '${conflict.sqlState}' SET MYSQL_ERRNO=${conflict.errno}, MESSAGE_TEXT='RFA03 synthetic conflict'`);
        return "committed";
      });
      assert.equal(result, "committed");
      assert.equal(attempts, 2);
      assert.notEqual(transactions[0], transactions[1]);
    }
  });
});
