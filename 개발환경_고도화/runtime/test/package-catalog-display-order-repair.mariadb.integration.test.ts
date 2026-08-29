import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
let database: DatabaseClient;

(configured ? describe : describe.skip)("package catalog display order repair", () => {
  before(() => {
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 2,
      connectTimeoutMs: 5_000,
    });
  });

  after(async () => database.close());

  it("keeps every visible package order unique and dense after moving the trial box to 59", async () => {
    const rows = await database.query<Array<{ package_id: string; display_order: number }>>(
      "SELECT package_id,display_order FROM package_catalog WHERE deleted_at IS NULL ORDER BY display_order,package_id",
    );
    const trial = rows.find((row) => row.package_id === "PKG-TRIAL-BOX");
    assert.equal(trial?.display_order, 59);
    assert.deepEqual(rows.map((row) => row.display_order), rows.map((_, index) => index + 1));
  });

  it("does not change row version when the repair is replayed", async () => {
    const beforeRows = await database.query<Array<{ row_version: bigint }>>(
      "SELECT row_version FROM package_catalog WHERE package_id='PKG-TRIAL-BOX'",
    );
    const replay = await database.execute(
      "UPDATE package_catalog SET display_order=59,row_version=row_version+1 WHERE package_id='PKG-TRIAL-BOX' AND display_order=39 AND deleted_at IS NULL",
    );
    const afterRows = await database.query<Array<{ row_version: bigint }>>(
      "SELECT row_version FROM package_catalog WHERE package_id='PKG-TRIAL-BOX'",
    );
    assert.equal(replay.affectedRows, 0n);
    assert.equal(afterRows[0]?.row_version, beforeRows[0]?.row_version);
  });

  it("restores order 59 when a later transaction fails", async () => {
    await assert.rejects(
      database.withTransaction(async (transaction) => {
        await transaction.execute(
          "UPDATE package_catalog SET display_order=39,row_version=row_version+1 WHERE package_id='PKG-TRIAL-BOX'",
        );
        throw new Error("forced package display order rollback");
      }),
      /forced package display order rollback/,
    );
    const rows = await database.query<Array<{ display_order: number }>>(
      "SELECT display_order FROM package_catalog WHERE package_id='PKG-TRIAL-BOX'",
    );
    assert.equal(rows[0]?.display_order, 59);
  });
});
