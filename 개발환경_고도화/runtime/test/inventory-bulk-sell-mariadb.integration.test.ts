import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("inventory bulk sell MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "bulk-sell-iris-token";
  const roomId = "990000000000252";
  const externalUserId = "bulk-sell-player";
  let playerId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='INVENTORY_BULK_SELL'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    playerId = player.id.toString();
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 전체판매회원','linked')", [player.id, externalUserId]);
    await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active,version) VALUES ('TEST-BULK-SELLABLE','합성 판매품','ITEM',TRUE,TRUE,1),('TEST-BULK-PROTECTED','합성 보호품','ITEM',TRUE,TRUE,1)");
    const items = await database.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM item_definitions WHERE code IN ('TEST-BULK-SELLABLE','TEST-BULK-PROTECTED') ORDER BY code");
    for (const item of items) {
      await database.execute("INSERT INTO item_sale_policies(item_id,sellable,unit_price,source_code,row_version) VALUES (?,?,?,?,1)",
        [item.id, item.code === "TEST-BULK-SELLABLE" ? 1 : 0, "100000", "synthetic"]);
      await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)",
        [player.id, item.id, item.code === "TEST-BULK-SELLABLE" ? 3 : 7]);
    }
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("sells eligible stacks once, preserves protected stacks, and leaves Shadow mutation-free", async () => {
    const seedCount = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM legacy_non_sellable_item_seed");
    assert.equal(Number(seedCount[0]!.count), 537);
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "bulk-sell-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const eventId = `bulk-sell-${Date.now()}`;
    const payload = { msg: "/전체판매", room: "고도화팻테스트방", sender: "합성 전체판매회원",
      json: { _id: eventId, chat_id: roomId, user_id: externalUserId } };
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(replies.at(-1)?.data, "가방 전체 판매가 완료되었습니다.\n판매 수량: 3개\n획득 포인트: 🅟300,000");
    const stacks = await database.query<Array<{ code: string; quantity: bigint }>>(
      "SELECT item.code,stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code LIKE 'TEST-BULK-%' ORDER BY item.code", [playerId]);
    assert.deepEqual(stacks.map((row) => [row.code, Number(row.quantity)]), [["TEST-BULK-PROTECTED", 7], ["TEST-BULK-SELLABLE", 0]]);
    const account = (await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]))[0]!;
    assert.equal(account.balance, "300000.000");
    const ledger = await database.query<Array<{ inventory_count: bigint; currency_count: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE player_id=? AND reason_code='inventory_bulk_sell') AS inventory_count,(SELECT COUNT(*) FROM currency_ledger WHERE player_id=? AND reason_code='inventory_bulk_sell') AS currency_count", [playerId, playerId]);
    assert.deepEqual([Number(ledger[0]!.inventory_count), Number(ledger[0]!.currency_count)], [1, 1]);

    const duplicate = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    assert.equal(duplicate.statusCode, 202, duplicate.body);
    assert.equal(replies.length, 1);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='INVENTORY_BULK_SELL'");
    const shadowId = `${eventId}-shadow`;
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { ...payload, json: { ...payload.json, _id: shadowId } } });
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    const after = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM currency_ledger WHERE player_id=? AND reason_code='inventory_bulk_sell'", [playerId]);
    assert.equal(Number(after[0]!.count), 1);

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='INVENTORY_BULK_SELL'");
    await database.execute("UPDATE inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id SET stack.quantity=2,stack.version=stack.version+1 WHERE stack.player_id=? AND item.code='TEST-BULK-SELLABLE'", [playerId]);
    await database.execute("CREATE TRIGGER fail_bulk_sell_currency_ledger BEFORE INSERT ON currency_ledger FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced bulk sell rollback'");
    try {
      const rollbackId = `${eventId}-rollback`;
      const failed = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
        payload: { ...payload, json: { ...payload.json, _id: rollbackId } } });
      assert.equal(failed.statusCode, 500);
      const rollbackStack = (await database.query<Array<{ quantity: bigint }>>(
        "SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='TEST-BULK-SELLABLE'", [playerId]))[0]!;
      const rollbackAccount = (await database.query<Array<{ balance: string }>>(
        "SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='point'", [playerId]))[0]!;
      const rollbackLedger = await database.query<Array<{ inventory_count: bigint; operation_count: bigint }>>(
        "SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE player_id=? AND reason_code='inventory_bulk_sell') AS inventory_count,(SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'inventory.bulk-sell:%') AS operation_count", [playerId]);
      assert.deepEqual([Number(rollbackStack.quantity), rollbackAccount.balance,
        Number(rollbackLedger[0]!.inventory_count), Number(rollbackLedger[0]!.operation_count)], [2, "300000.000", 1, 1]);
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS fail_bulk_sell_currency_ledger");
      await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='INVENTORY_BULK_SELL'");
    }
    await app.close();
  });
});
