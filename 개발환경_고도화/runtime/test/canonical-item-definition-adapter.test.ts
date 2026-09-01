import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseWriteResult } from "../src/database.js";
import { CanonicalItemDefinitionRepository, createCanonicalDomainItemProvider } from "../src/package/current-domain-package-runtime.js";

function database(rows: unknown[]): { client: DatabaseClient; sql: string[] } {
  const sql: string[] = [];
  const client: DatabaseClient = {
    ping: async () => undefined,
    query: async <T>(statement: string): Promise<T> => { sql.push(statement); return rows as T; },
    execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 0n, insertId: 0n }),
    withTransaction: async () => { throw new Error("unexpected transaction"); },
    verifyRollback: async () => true,
    close: async () => undefined,
  };
  return { client, sql };
}

describe("canonical item definition adapter", () => {
  it("resolves a direct-bag stable code from canonical item_definitions only", async () => {
    const scripted = database([{
      item_id: "legacy_bag_8aa52459621254e1",
      item_type: "STACK",
      item_name: "자동대깨호😝(1일)",
      stackable: 1,
      metadata_json: { domain: "direct_bag" },
      enabled: 1,
    }]);
    const result = await new CanonicalItemDefinitionRepository(scripted.client).findById("legacy_bag_8aa52459621254e1");
    assert.deepEqual([result?.id, result?.type, result?.enabled], ["legacy_bag_8aa52459621254e1", "STACK", true]);
    assert.match(scripted.sql[0]!, /FROM item_definitions/);
    assert.doesNotMatch(scripted.sql[0]!, /package_item_definitions/);
  });

  it("returns unavailable for an unknown code and exposes the shared ItemProvider contract", async () => {
    const scripted = database([]);
    assert.equal(await new CanonicalItemDefinitionRepository(scripted.client).findById("unknown"), undefined);
    const provider = createCanonicalDomainItemProvider(scripted.client);
    assert.equal(typeof provider.remove, "function");
  });
});
