import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { GuildTerritoryAttackService } from "../src/guild/guild-territory-attack-service.js";

const suite = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const createTestDatabase = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 12, connectTimeoutMs: 5_000 });

suite("guild territory attack MariaDB resilience", () => {
  let db: DatabaseClient;
  const prefix = `territory-attack-resilience-${Date.now()}`;
  const base = BigInt(Date.now()) * 100_000n;
  let sequence = 0n;
  type Arena = { war: bigint; actor: bigint; actorGuild: bigint; external: string; room: string };

  const seedArena = async (): Promise<Arena> => {
    sequence += 100n;
    const actor = base + sequence + 1n, defender = base + sequence + 2n, actorGuild = base + sequence + 3n, defenderGuild = base + sequence + 4n, operation = base + sequence + 5n, war = base + sequence + 6n;
    const suffix = sequence.toString(), external = `${prefix}-user-${suffix}`, room = `${prefix}-room-${suffix}`;
    await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1)", [actor, defender]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,'합성 복원공격자',0,1),(?,'합성 복원방어자',0,1)", [actor, defender]);
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 복원공격자','linked')", [actor, external]);
    await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,?,?,'active',1),(?,?,?,'active',1)", [actorGuild, `SYN-RES-A-${prefix}-${suffix}`, "합성 복원공격길드", defenderGuild, `SYN-RES-D-${prefix}-${suffix}`, "합성 복원방어길드"]);
    await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'member',UTC_TIMESTAMP(3)),(?,?,'member',UTC_TIMESTAMP(3))", [actorGuild, actor, defenderGuild, defender]);
    await db.execute("INSERT INTO guild_territory_rift_authorizations(guild_id,player_id,authority_code,active,version) VALUES (?,?,'sword_master',TRUE,1)", [actorGuild, actor]);
    await db.execute("INSERT INTO operations(id,operation_key,idempotency_scope,idempotency_key,actor_type,source_code,status,created_at,completed_at) VALUES (?,UUID(),'synthetic.territory.attack.start',?,'system','synthetic','completed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation, `${prefix}-start-${suffix}`]);
    await db.execute("INSERT INTO guild_territory_wars(id,war_key,active,lifecycle_state,start_ready,current_turn_no,started_at,start_operation_id,rift_event_history_json,version) VALUES (?,?,TRUE,'ACTIVE_READY',TRUE,1,UTC_TIMESTAMP(3),?,JSON_ARRAY(),1)", [war, `${prefix}-war-${suffix}`, operation]);
    await db.execute("INSERT INTO guild_territory_ready_guilds(war_id,guild_id,ready) VALUES (?,?,TRUE),(?,?,TRUE)", [war, actorGuild, war, defenderGuild]);
    await db.execute("INSERT INTO guild_territory_turns(war_id,generation_version,ordinal,guild_id,attacker_player_id,attack_limit,attacks_used,turn_state) VALUES (?,1,1,?,?,30,0,'ACTIVE'),(?,1,2,?,?,30,0,'PENDING')", [war, actorGuild, actor, war, defenderGuild, defender]);
    for (let territoryNo = 1; territoryNo <= 7; territoryNo += 1) await db.execute("INSERT INTO guild_territory_occupations(war_id,territory_no,territory_name,owner_guild_id,owner_player_id,version) VALUES (?,?,?,NULL,NULL,1)", [war, territoryNo, `복원합성영지${territoryNo}`]);
    await db.execute("INSERT INTO guild_territory_combat_snapshots(war_id,generation_version,player_id,guild_id,castle_charm,critical_bps,critical_multiplier_bps,pet_snapshot_json,source_operation_id) VALUES (?,1,?,?,100,0,20000,JSON_OBJECT('kind','synthetic'),?),(?,1,?,?,100,0,20000,JSON_OBJECT('kind','synthetic'),?)", [war, actor, actorGuild, operation, war, defender, defenderGuild, operation]);
    await db.execute("INSERT INTO guild_territory_start_scopes(scope_code,war_id,version) VALUES ('world',?,1) ON DUPLICATE KEY UPDATE war_id=VALUES(war_id),version=version+1", [war]);
    return { war, actor, actorGuild, external, room };
  };

  const seedEvent = async (arena: Arena, eventId: string) => db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, arena.room, arena.external]);
  const mutationCount = async (eventId: string) => Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='guild.territory.attack.execute' AND idempotency_key=?", [eventId]))[0]!.count_value);

  before(async () => {
    db = createTestDatabase();
    await db.execute("DELETE FROM guild_territory_attack_item_candidates");
    await db.execute("UPDATE guild_territory_attack_policy_versions SET status='ACTIVE',contribution_medal_bps=10000,contribution_medal_quantity=1,evidence_label='synthetic-resilience-fixture',rift_event_base_bps=0,instability_bps_per_point=0,normal_rift_base_bps=10000,rift_bias_bps_per_point=0,rift_evidence_label='synthetic-resilience-fixture',activated_at=UTC_TIMESTAMP(3) WHERE policy_scope_code='world-attack' AND policy_version=1");
    for (const [code, name] of [["territory_defense_ticket", "합성 방어권"], ["territory_attack_ticket", "합성 공격권"], ["guild_contribution_medal", "합성 공헌훈장"]]) await db.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,?,'ITEM',TRUE,JSON_OBJECT('fixture',TRUE),TRUE,1) ON DUPLICATE KEY UPDATE active=TRUE", [code, name]);
  });

  after(async () => { if (db) { await db.execute("DROP TRIGGER IF EXISTS trg_synthetic_territory_attack_fail"); await db.close(); } });

  it("keeps SHADOW dispatch mutation-free", async () => {
    const arena = await seedArena();
    const eventId = `${prefix}-shadow`;
    await db.execute("UPDATE command_registry SET rollout_state='SHADOW',enabled=TRUE WHERE command_code='GUILD_TERRITORY_ATTACK_EXECUTE'");
    const result = await new GuildTerritoryAttackService(db).handleIris({ eventId, externalUserId: arena.external, channelId: arena.room, message: "/영지공격 2" });
    assert.deepEqual(result, { status: "shadow" });
    assert.equal(await mutationCount(eventId), 0);
    assert.equal(Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_territory_attack_item_candidates"))[0]!.count_value), 0);
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='GUILD_TERRITORY_ATTACK_EXECUTE'");
  });

  it("serializes concurrent duplicate delivery and writes one operation", async () => {
    const arena = await seedArena();
    const eventId = `${prefix}-concurrent-duplicate`;
    await seedEvent(arena, eventId);
    const input = { eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 2 };
    const [first, second] = await Promise.all([new GuildTerritoryAttackService(db).attack(input), new GuildTerritoryAttackService(db).attack(input)]);
    assert.deepEqual(second, first);
    assert.equal(await mutationCount(eventId), 1);
    assert.equal(Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_territory_attack_runs WHERE event_key=?", [eventId]))[0]!.count_value), 1);
    assert.equal(Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_territory_attack_item_candidates"))[0]!.count_value), 4);
  });

  it("rolls back counts, fund, draw, audit, and outbox after a forced late failure", async () => {
    const arena = await seedArena();
    const eventId = `${prefix}-rollback`;
    await seedEvent(arena, eventId);
    await db.execute("DROP TRIGGER IF EXISTS trg_synthetic_territory_attack_fail");
    await db.execute("CREATE TRIGGER trg_synthetic_territory_attack_fail BEFORE INSERT ON guild_territory_attack_runs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic attack rollback'");
    await assert.rejects(() => new GuildTerritoryAttackService(db).attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 2 }), /synthetic attack rollback/);
    await db.execute("DROP TRIGGER IF EXISTS trg_synthetic_territory_attack_fail");
    assert.equal(await mutationCount(eventId), 0);
    assert.equal(Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_resource_accounts WHERE guild_id=?", [arena.actorGuild]))[0]!.count_value), 0);
    assert.equal(Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_territory_player_attack_states WHERE war_id=?", [arena.war]))[0]!.count_value), 0);
    assert.equal(Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_key=?", [eventId]))[0]!.count_value), 0);
  });

  it("replays the persisted result after service recreation", async () => {
    const arena = await seedArena();
    const eventId = `${prefix}-restart-replay`;
    await seedEvent(arena, eventId);
    const input = { eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 2 };
    const first = await new GuildTerritoryAttackService(db).attack(input);
    const restartedDatabase = createTestDatabase();
    try {
      const replay = await new GuildTerritoryAttackService(restartedDatabase).attack(input);
      assert.deepEqual(replay, first);
      assert.equal(await mutationCount(eventId), 1);
    } finally {
      await restartedDatabase.close();
    }
  });
});
