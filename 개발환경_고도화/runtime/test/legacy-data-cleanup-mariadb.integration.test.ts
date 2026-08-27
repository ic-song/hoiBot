import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { LegacyDataCleanupService } from "../src/admin/legacy-data-cleanup-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("legacy data cleanup MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let operatorExternalId: string;
  let unauthorizedExternalId: string;
  let firstPlayerId: bigint;
  let secondPlayerId: bigint;
  let sourceItemId: bigint;
  let targetItemId: bigint;
  let guildId: bigint;
  let guildRingItemId: bigint;
  const token = "legacy-data-cleanup-token";
  const roomId = "990000000000574";

  before(async () => {
    const suffix = Date.now().toString();
    operatorExternalId = `legacy-cleanup-operator-${suffix}`;
    unauthorizedExternalId = `legacy-cleanup-user-${suffix}`;
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_LEGACY_DATA_CLEANUP'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?, 'synthetic','active')",
      [`legacy-cleanup-${suffix}`, "합성 데이터 관리자"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`legacy-cleanup-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const [externalId, name] of [[operatorExternalId, "합성 데이터 관리자"], [unauthorizedExternalId, "합성 일반 사용자"]]) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const playerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [playerId, name]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [playerId, externalId, name]);
      if (externalId === operatorExternalId) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
      }
    }
    const createPlayer = async (name: string, balance: string): Promise<bigint> => {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const id = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [id, name]);
      await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',?,1)", [id, balance]);
      return id;
    };
    firstPlayerId = await createPlayer("합성 정리 대상1", "10.875");
    secondPlayerId = await createPlayer("합성 정리 대상2", "20.125");
    await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,'캐슬공격권⚔','ITEM',1,JSON_OBJECT('synthetic',TRUE),1,1)", [`ITEM-SYNTHETIC-CASTLE-${suffix}`]);
    sourceItemId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code=?", [`ITEM-SYNTHETIC-CASTLE-${suffix}`]))[0]!.id;
    targetItemId = (await database.query<Array<{ id: bigint }>>("SELECT MIN(id) AS id FROM item_definitions WHERE display_name='영지공격권⚔' AND active=1"))[0]!.id;
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,2,1),(?,?,4,1),(?,?,3,1)",
      [firstPlayerId, sourceItemId, secondPlayerId, sourceItemId, firstPlayerId, targetItemId]);
    await database.execute(`INSERT INTO player_legacy_ring_reward_snapshots(
      player_id,ring_name,ring_grade,enhancement_level,raid_charm,castle_charm,legacy_ring_present,calculation_error,claim_status,source_version,version
    ) VALUES (?,'합성 반지','일반',1,10,20,1,0,'pending','synthetic',1)`, [firstPlayerId]);
    await database.execute("INSERT INTO guilds(code,display_name,status,version) VALUES (?,'합성길드','active',1)", [`LEGACY-CLEANUP-${suffix}`]);
    guildId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM guilds WHERE code=?", [`LEGACY-CLEANUP-${suffix}`]))[0]!.id;
    guildRingItemId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='ITEM-LEGACY-GUILD-RING'"))[0]!.id;
    await database.execute("INSERT INTO guild_warehouse_stacks(guild_id,item_id,quantity,version) VALUES (?,?,7,1)", [guildId, guildRingItemId]);
    process.env.LEGACY_DATA_CLEANUP_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.LEGACY_DATA_CLEANUP_COMMAND_ENABLED;
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  const createApp = (replies: Array<{ room: string; data: string }>) => {
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "legacy-cleanup-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    return buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
  };

  it("routes, cleans all normalized targets, replays, blocks unauthorized/Shadow and rolls back failures", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = createApp(replies);
    const send = async (eventId: string, userId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: "/데이터정리", room: "고도화데이터정리방", sender: "합성 관리자", json: { _id: eventId, chat_id: roomId, user_id: userId } } });
    const eventId = `legacy-cleanup-${Date.now()}`;
    const response = await send(eventId, operatorExternalId);
    assert.equal(response.statusCode, 202, response.body);
    assert.match(replies.at(-1)?.data ?? "", /변경된 아이템 수량 : 6개/);
    assert.match(replies.at(-1)?.data ?? "", /정리된 유저 : 2명/);
    assert.match(replies.at(-1)?.data ?? "", /반지 삭제 유저 : 1명/);
    assert.match(replies.at(-1)?.data ?? "", /삭제 수량 : 💍x7/);
    const balances = await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id IN (?,?) ORDER BY player_id", [firstPlayerId, secondPlayerId]);
    assert.deepEqual(balances, [{ balance: "10.000" }, { balance: "20.000" }]);
    const stacks = await database.query<Array<{ player_id: bigint; item_id: bigint; quantity: bigint }>>("SELECT player_id,item_id,quantity FROM inventory_stacks WHERE player_id IN (?,?) ORDER BY player_id,item_id", [firstPlayerId, secondPlayerId]);
    assert.deepEqual(stacks, [{ player_id: firstPlayerId, item_id: targetItemId, quantity: 5n }, { player_id: secondPlayerId, item_id: targetItemId, quantity: 4n }]);
    assert.equal((await database.query<Array<{ present: number }>>("SELECT legacy_ring_present AS present FROM player_legacy_ring_reward_snapshots WHERE player_id=?", [firstPlayerId]))[0]!.present, 0);
    assert.equal(Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM guild_warehouse_stacks WHERE guild_id=? AND item_id=?", [guildId, guildRingItemId]))[0]!.count), 0);
    const evidence = (await database.query<Array<{ runs: bigint; audits: bigint; outbox: bigint; inventory_ledgers: bigint; currency_ledgers: bigint; guild_ledgers: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM legacy_data_cleanup_runs WHERE request_key=?) AS runs,
              (SELECT COUNT(*) FROM command_audit WHERE action_code='ADMIN_LEGACY_DATA_CLEANUP') AS audits,
              (SELECT COUNT(*) FROM outbox_messages outbox JOIN legacy_data_cleanup_runs run ON run.operation_id=outbox.operation_id WHERE run.request_key=?) AS outbox,
              (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code LIKE 'LEGACY_DATA_CLEANUP_%') AS inventory_ledgers,
              (SELECT COUNT(*) FROM currency_ledger WHERE reason_code='LEGACY_DATA_CLEANUP_POINT_FLOOR') AS currency_ledgers,
              (SELECT COUNT(*) FROM guild_warehouse_ledger WHERE reason_code='LEGACY_DATA_CLEANUP_RING_DELETE') AS guild_ledgers`,
      [`iris:${eventId}`, `iris:${eventId}`]))[0]!;
    assert.deepEqual(evidence, { runs: 1n, audits: 1n, outbox: 1n, inventory_ledgers: 4n, currency_ledgers: 2n, guild_ledgers: 1n });
    const replay = await new LegacyDataCleanupService(database).execute({ eventId: `iris:${eventId}`, externalUserId: operatorExternalId, destinationId: roomId });
    assert.equal(replay.replayed, true);

    const forbidden = await send(`legacy-cleanup-forbidden-${Date.now()}`, unauthorizedExternalId);
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_LEGACY_DATA_CLEANUP'");
    await database.execute("UPDATE currency_accounts SET balance='30.500',version=version+1 WHERE player_id=? AND currency_code='point'", [firstPlayerId]);
    const shadowEvent = `legacy-cleanup-shadow-${Date.now()}`;
    assert.equal((await send(shadowEvent, operatorExternalId)).statusCode, 202);
    assert.equal((await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='point'", [firstPlayerId]))[0]!.balance, "30.500");
    assert.equal((await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowEvent}`]))[0]!.route, "SHADOW");

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_LEGACY_DATA_CLEANUP'");
    await database.execute("UPDATE player_legacy_ring_reward_snapshots SET legacy_ring_present=1,version=version+1 WHERE player_id=?", [firstPlayerId]);
    await database.execute("INSERT INTO guild_warehouse_stacks(guild_id,item_id,quantity,version) VALUES (?,?,9,1)", [guildId, guildRingItemId]);
    await database.execute("CREATE TRIGGER synthetic_legacy_cleanup_outbox_failure BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic cleanup outbox failure'");
    const rollbackEvent = `legacy-cleanup-rollback-${Date.now()}`;
    try {
      assert.equal((await send(rollbackEvent, operatorExternalId)).statusCode, 500);
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS synthetic_legacy_cleanup_outbox_failure");
    }
    assert.equal((await database.query<Array<{ balance: string }>>("SELECT CAST(balance AS CHAR) AS balance FROM currency_accounts WHERE player_id=? AND currency_code='point'", [firstPlayerId]))[0]!.balance, "30.500");
    assert.equal((await database.query<Array<{ present: number }>>("SELECT legacy_ring_present AS present FROM player_legacy_ring_reward_snapshots WHERE player_id=?", [firstPlayerId]))[0]!.present, 1);
    assert.equal((await database.query<Array<{ quantity: bigint }>>("SELECT quantity FROM guild_warehouse_stacks WHERE guild_id=? AND item_id=?", [guildId, guildRingItemId]))[0]!.quantity, 9n);
    assert.equal(Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM legacy_data_cleanup_runs WHERE request_key=?", [`iris:${rollbackEvent}`]))[0]!.count), 0);
    await app.close();
  });
});
