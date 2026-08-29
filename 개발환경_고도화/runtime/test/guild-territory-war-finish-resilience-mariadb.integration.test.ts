import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { GuildTerritoryWarFinishService } from "../src/guild/guild-territory-war-finish-service.js";

const suite = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

suite("guild territory war finish MariaDB resilience", () => {
  let db: DatabaseClient;
  const prefix = `territory-finish-resilience-${Date.now()}`;
  const base = BigInt(Date.now()) * 1_000n;
  const operatorPlayer = base + 1n;
  const ownerPlayer = base + 2n;
  const operator = base + 3n;
  const room = `${prefix}-room`;
  const external = `${prefix}-operator`;
  let sequence = 10n;

  const seedWar = async (active: boolean, lifecycle: string) => {
    sequence += 10n;
    const guild = base + sequence + 1n;
    const war = base + sequence + 2n;
    const startOperation = base + sequence + 3n;
    const suffix = sequence.toString();
    await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,?,?,'active',1)", [guild, `SYN-FIN-${base}-${suffix}`, `합성 종료길드 ${suffix}`]);
    await db.execute("INSERT INTO guild_profile_details(guild_id,territory_booster,tax_rate,version) VALUES (?,3,0,1)", [guild]);
    await db.execute("INSERT INTO operations(id,operation_key,idempotency_scope,idempotency_key,actor_type,source_code,status,created_at,completed_at) VALUES (?,UUID(),'synthetic.start',?,'system','synthetic','completed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [startOperation, `${prefix}-start-${suffix}`]);
    await db.execute("INSERT INTO guild_territory_wars(id,war_key,active,lifecycle_state,start_ready,started_at,start_operation_id,rift_event_history_json,version) VALUES (?,?,?, ?,TRUE,UTC_TIMESTAMP(3),?,JSON_ARRAY(),1)", [war, `${prefix}-war-${suffix}`, active, lifecycle, startOperation]);
    if (active) {
      for (let territory = 1; territory <= 7; territory += 1) {
        await db.execute("INSERT INTO guild_territory_occupations(war_id,territory_no,territory_name,owner_guild_id,owner_player_id,version) VALUES (?,?,?,?,?,1)", [war, territory, `영지${territory}`, guild, ownerPlayer]);
      }
    }
    await db.execute("INSERT INTO guild_territory_start_scopes(scope_code,war_id,version) VALUES ('world',?,1) ON DUPLICATE KEY UPDATE war_id=VALUES(war_id),version=version+1", [war]);
    return { guild, war, startOperation };
  };

  const seedEvent = async (eventId: string) => {
    await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('3',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, external]);
  };

  before(async () => {
    db = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 8,
      connectTimeoutMs: 5_000,
    });
    await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1)", [operatorPlayer, ownerPlayer]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,'합성 종료운영자',0,1),(?,'합성 종료성주',0,1)", [operatorPlayer, ownerPlayer]);
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 종료운영자','linked')", [operatorPlayer, external]);
    const identity = (await db.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [external]))[0]!.id;
    await db.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,?,?,'synthetic','active')", [operator, `${prefix}-login`, "합성 종료운영자"]);
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator, identity]);
    await db.execute("INSERT INTO guild_territory_finish_operator_allowlist(operator_id,external_channel_id,active,source_label) VALUES (?,?,TRUE,'synthetic')", [operator, room]);
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='GUILD_TERRITORY_WAR_FINISH'");
  });

  after(async () => {
    if (db) {
      await db.execute("DROP TRIGGER IF EXISTS trg_synthetic_territory_finish_fail");
      await db.close();
    }
  });

  it("keeps shadow and unauthorized requests silent", async () => {
    const service = new GuildTerritoryWarFinishService(db);
    await db.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='GUILD_TERRITORY_WAR_FINISH'");
    assert.deepEqual(await service.handleIris({ eventId: `${prefix}-shadow`, externalUserId: external, channelId: room, message: "/길드영지종료" }), { status: "shadow" });
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='GUILD_TERRITORY_WAR_FINISH'");
    assert.deepEqual(await service.handleIris({ eventId: `${prefix}-unauthorized`, externalUserId: `${external}-missing`, channelId: room, message: "/길드영지종료" }), { status: "handled_no_reply" });
  });

  it("cancels a pending generation and skips scheduled transitions", async () => {
    const seeded = await seedWar(false, "PENDING_START");
    const eventId = `${prefix}-pending`;
    await seedEvent(eventId);
    for (const code of ["START_OPENING", "ENABLE_ATTACKS"]) {
      await db.execute("INSERT INTO guild_territory_scheduled_transitions(transition_key,war_id,transition_code,scheduled_for,status,operation_id,expected_war_version,payload_json,version) VALUES (?,?,?,UTC_TIMESTAMP(3),'PENDING',?,1,JSON_OBJECT(),1)", [`${prefix}-${code}`, seeded.war, code, seeded.startOperation]);
    }
    const result = await new GuildTerritoryWarFinishService(db).finish({ eventId, channelId: room, trigger: "manual", operatorId: operator });
    assert.equal(result.status, "cancelled_pending");
    assert.equal(result.pendingTransitionsSkipped, 2);
    const war = (await db.query<Array<{ active: number; lifecycle_state: string }>>("SELECT active,lifecycle_state FROM guild_territory_wars WHERE id=?", [seeded.war]))[0]!;
    assert.deepEqual({ active: Number(war.active), lifecycle: war.lifecycle_state }, { active: 0, lifecycle: "READY" });
    const transitions = await db.query<Array<{ status: string }>>("SELECT status FROM guild_territory_scheduled_transitions WHERE war_id=? ORDER BY transition_code", [seeded.war]);
    assert.deepEqual(transitions.map((row) => row.status), ["SKIPPED", "SKIPPED"]);
  });

  it("serializes manual and automatic finish and survives service recreation", async () => {
    const seeded = await seedWar(true, "ACTIVE_READY");
    const manualEvent = `${prefix}-race-manual`;
    const automaticEvent = `${prefix}-race-auto`;
    const replayEvent = `${prefix}-restart-replay`;
    await seedEvent(manualEvent);
    await seedEvent(automaticEvent);
    await seedEvent(replayEvent);
    const [manual, automatic] = await Promise.all([
      new GuildTerritoryWarFinishService(db).finish({ eventId: manualEvent, channelId: room, trigger: "manual", operatorId: operator, expectedWarVersion: 1n }),
      new GuildTerritoryWarFinishService(db).finish({ eventId: automaticEvent, channelId: room, trigger: "auto", expectedWarVersion: 1n }),
    ]);
    assert.equal(manual.finishKey, automatic.finishKey);
    const replay = await new GuildTerritoryWarFinishService(db).finish({ eventId: replayEvent, channelId: room, trigger: "event" });
    assert.equal(replay.finishKey, manual.finishKey);
    assert.equal(Number((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM guild_territory_finish_runs WHERE war_id=?", [seeded.war]))[0]!.count), 1);
    assert.equal(Number((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM guild_territory_finish_entries AS entry JOIN guild_territory_finish_runs AS run ON run.id=entry.finish_run_id WHERE run.war_id=?", [seeded.war]))[0]!.count), 7);
    const resources = await db.query<Array<{ currency_code: string; balance: string }>>("SELECT currency_code,balance FROM guild_resource_accounts WHERE guild_id=? ORDER BY currency_code", [seeded.guild]);
    assert.deepEqual(resources.map((row) => [row.currency_code, String(row.balance)]), [["POINT", "2000000000.000"], ["diamond", "20.000"]]);
    assert.equal(String((await db.query<Array<{ score: string }>>("SELECT score FROM guild_territory_score_accounts WHERE guild_id=?", [seeded.guild]))[0]!.score), "100");
  });

  it("rolls back every mutation when settlement entry persistence fails", async () => {
    const seeded = await seedWar(true, "ACTIVE_READY");
    const eventId = `${prefix}-rollback`;
    await seedEvent(eventId);
    await db.execute("DROP TRIGGER IF EXISTS trg_synthetic_territory_finish_fail");
    await db.execute("CREATE TRIGGER trg_synthetic_territory_finish_fail BEFORE INSERT ON guild_territory_finish_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic finish rollback'");
    await assert.rejects(() => new GuildTerritoryWarFinishService(db).finish({ eventId, channelId: room, trigger: "event", expectedWarVersion: 1n }), /synthetic finish rollback/);
    await db.execute("DROP TRIGGER IF EXISTS trg_synthetic_territory_finish_fail");
    const war = (await db.query<Array<{ active: number; lifecycle_state: string }>>("SELECT active,lifecycle_state FROM guild_territory_wars WHERE id=?", [seeded.war]))[0]!;
    assert.deepEqual({ active: Number(war.active), lifecycle: war.lifecycle_state }, { active: 1, lifecycle: "ACTIVE_READY" });
    assert.equal(Number((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM guild_territory_finish_runs WHERE war_id=?", [seeded.war]))[0]!.count), 0);
    assert.equal(Number((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM guild_resource_accounts WHERE guild_id=?", [seeded.guild]))[0]!.count), 0);
  });
});
