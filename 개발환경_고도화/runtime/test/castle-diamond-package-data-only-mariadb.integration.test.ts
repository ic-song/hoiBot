import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("castle diamond package data-only MariaDB parity", { skip: !enabled }, () => {
  let database: DatabaseClient;

  before(() => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"),
      connectionLimit: 3, connectTimeoutMs: 5_000 });
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("keeps PKG-213 disabled with exact rewards, source metadata and no executable alias", async () => {
    const catalog = (await database.query<Array<{
      package_id: string; consume_item_id: string; max_open_count: number; block_castle: number;
      definition_status: string; enabled: number;
    }>>(
      "SELECT package_id,consume_item_id,max_open_count,block_castle,definition_status,enabled FROM package_catalog WHERE package_id='PKG-213'"
    ))[0]!;
    assert.deepEqual(catalog, {
      package_id: "PKG-213", consume_item_id: "ITEM-PACKAGE-213", max_open_count: 1,
      block_castle: 1, definition_status: "EXACT_LEGACY_DRAFT", enabled: 0
    });

    const rewards = await database.query<Array<{ reward_order: number; item_id: string; quantity: string }>>(
      "SELECT reward_order,item_id,CAST(quantity AS CHAR) AS quantity FROM package_rewards WHERE package_id='PKG-213' ORDER BY reward_order"
    );
    assert.deepEqual(rewards.map((reward) => [reward.item_id, reward.quantity]), [
      ["ITEM-RWD-042", "200"], ["ITEM-RWD-065", "6"], ["ITEM-RWD-026", "2200"]
    ]);

    const source = (await database.query<Array<{ canonical_route: string; executable: number }>>(
      "SELECT canonical_route,executable FROM package_catalog_source_commands WHERE package_id='PKG-213' AND source_command='/다이아오픈'"
    ))[0]!;
    assert.deepEqual(source, { canonical_route: "/패키지사용", executable: 0 });

    const aliases = await database.query<Array<{ alias_count: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM package_command_aliases WHERE package_id='PKG-213' OR command_text='/다이아오픈')
        + (SELECT COUNT(*) FROM command_aliases WHERE command_text='/다이아오픈') AS alias_count`
    );
    assert.equal(Number(aliases[0]!.alias_count), 0);
  });
});
