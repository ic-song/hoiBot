import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("member ticket tier recalculate MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "tier-recalculate-token", roomId = "990000000000410", operatorExternalId = "tier-recalculate-operator";
  let targetId: bigint, regularItemId: bigint;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='MEMBER_TICKET_TIER_RECALCULATE'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('tier-recalculate-op','티어 관리자','synthetic','active')");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='tier-recalculate-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    const tiers = await database.query<Array<{ tier_code: string; display_name: string }>>(
      "SELECT definition.tier_code,definition.display_name FROM tier_definition_publications publication JOIN tier_definitions definition ON definition.version_id=publication.version_id WHERE publication.publication_key='ACTIVE' AND definition.display_name IN('새싹','실버')"
    );
    const tier = (name: string) => tiers.find((row) => row.display_name === name)!.tier_code;
    const items = await database.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM item_definitions WHERE code IN('ITEM-RWD-022','tier_advanced_ticket')");
    regularItemId = items.find((row) => row.code === "ITEM-RWD-022")!.id;
    for (const [externalId, name, initialTier, ticketCount] of [[operatorExternalId, "티어 관리자", tier("새싹"), 0], ["tier-target", "티어 대상", tier("새싹"), 10]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,tier_code,version) VALUES (?,?,?,1)", [player.id, name, initialTier]);
      await database.execute("INSERT INTO player_pets(player_id,display_name,experience,version) VALUES (?,?,'5',1)", [player.id, `${name}펫`]);
      await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'🌱',?)", [player.id, player.id]);
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, name]);
      if (externalId === operatorExternalId) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
      } else targetId = player.id;
      if (ticketCount > 0) await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)", [player.id, regularItemId, ticketCount]);
    }
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("routes, updates atomically, replays, shadows and rolls back audit failure", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "tier-recalculate-pepper", DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = (eventId: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: "/티어적용", room: "고도화티어방", sender: "티어 관리자", json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId } } });

    const eventId = `tier-recalculate-${Date.now()}`;
    assert.equal((await send(eventId)).statusCode, 202);
    assert.match(replies.at(-1)!.data, /티어 대상 - 이전 티어: 새싹[\s\S]*새로운 티어: 실버/);
    const state = async () => (await database.query<Array<{ tier_name: string; rank_emoji: string; experience: bigint; version: bigint }>>(
      `SELECT definition.display_name tier_name,legacy.rank_emoji,pet.experience,profile.version FROM player_profiles profile
       JOIN tier_definition_publications publication ON publication.publication_key='ACTIVE'
       JOIN tier_definitions definition ON definition.version_id=publication.version_id AND definition.tier_code=profile.tier_code
       JOIN player_pets pet ON pet.player_id=profile.player_id JOIN player_legacy_rank_profiles legacy ON legacy.player_id=profile.player_id WHERE profile.player_id=?`, [targetId]))[0]!;
    assert.deepEqual(await state(), { tier_name: "실버", rank_emoji: "🥈", experience: 105n, version: 2n });
    await send(eventId);
    assert.deepEqual(await state(), { tier_name: "실버", rank_emoji: "🥈", experience: 105n, version: 2n });

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='MEMBER_TICKET_TIER_RECALCULATE'");
    const shadow = `tier-recalculate-shadow-${Date.now()}`;
    await send(shadow);
    assert.equal((await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadow}`]))[0]!.route, "SHADOW");

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='MEMBER_TICKET_TIER_RECALCULATE'");
    await database.execute("UPDATE inventory_stacks SET quantity=0,version=version+1 WHERE player_id=? AND item_id=?", [targetId, regularItemId]);
    await database.execute("CREATE TRIGGER synthetic_tier_recalculate_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic tier audit failure'");
    assert.equal((await send(`tier-recalculate-failed-${Date.now()}`)).statusCode, 500);
    await database.execute("DROP TRIGGER synthetic_tier_recalculate_audit_failure");
    assert.deepEqual(await state(), { tier_name: "실버", rank_emoji: "🥈", experience: 105n, version: 2n });
    assert.equal(await database.verifyRollback(), true);
    await app.close();
  });
});
