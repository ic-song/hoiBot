import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { GuildTerritoryWarStateStartService } from "../src/guild/guild-territory-war-state-start-service.js";

const suite = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

suite("guild territory single authority MariaDB", () => {
  let db: DatabaseClient;
  const base = BigInt(Date.now()) * 10_000n;
  const player = base + 1n;
  const guild = base + 2n;
  const operation = base + 3n;
  const war = base + 4n;
  const prefix = `territory-authority-${Date.now()}`;
  let scopeBefore: { war_id: bigint; version: bigint; updated_at: Date } | undefined;
  let scopeOverwritten = false;

  before(async () => {
    db = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 4,
      connectTimeoutMs: 5_000,
    });
    scopeBefore = (await db.query<Array<{ war_id: bigint; version: bigint; updated_at: Date }>>("SELECT war_id,version,updated_at FROM guild_territory_start_scopes WHERE scope_code='world'"))[0];
    await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1)", [player]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,'합성 권위공격자',0,1)", [player]);
    await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,?,?,'active',1)", [guild, `SYN-AUTH-${base}`, "합성 권위길드"]);
    await db.execute("INSERT INTO operations(id,operation_key,idempotency_scope,idempotency_key,actor_type,source_code,status,created_at,completed_at) VALUES (?,UUID(),'synthetic.territory.authority',?,'system','synthetic','completed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation, prefix]);
    await db.execute("INSERT INTO guild_territory_wars(id,war_key,active,lifecycle_state,start_ready,pending_start_token,pending_start_due_at,opening_due_at,start_operation_id,rift_event_history_json,version) VALUES (?,?,FALSE,'PENDING_START',FALSE,'authority-token',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 SECOND),DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 SECOND),?,JSON_ARRAY(),2)", [war, `${prefix}-war`, operation]);
    await db.execute("INSERT INTO guild_territory_start_scopes(scope_code,war_id,version) VALUES ('world',?,1) ON DUPLICATE KEY UPDATE war_id=VALUES(war_id),version=version+1", [war]);
    scopeOverwritten = true;
    await db.execute("INSERT INTO guild_territory_start_destinations(destination_id,destination_kind,position_no,active) VALUES (?,'CASTLE',1,TRUE) ON DUPLICATE KEY UPDATE active=TRUE", [`${prefix}-room`]);
    await db.execute("INSERT INTO guild_territory_turns(war_id,generation_version,ordinal,guild_id,attacker_player_id,attack_limit,attacks_used,turn_state) VALUES (?,2,1,?,?,30,0,'PENDING')", [war, guild, player]);
    await db.execute("INSERT INTO guild_territory_scheduled_transitions(transition_key,war_id,transition_code,scheduled_for,status,operation_id,expected_war_version,payload_json,version) VALUES (?,?, 'START_OPENING',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 SECOND),'PENDING',?,2,?,1)", [`${prefix}-opening`, war, operation, JSON.stringify({ token: "authority-token", generationVersion: "2" })]);
  });

  after(async () => {
    if (db) {
      const errors: unknown[] = [];
      const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { errors.push(error); } };
      try {
        if (scopeOverwritten) await attempt(() => db.execute("DELETE FROM guild_territory_start_scopes WHERE scope_code='world' AND war_id=?", [war]));
        await attempt(() => db.execute("DELETE FROM command_audit WHERE operation_id=?", [operation]));
        await attempt(() => db.execute("DELETE FROM outbox_messages WHERE operation_id=?", [operation]));
        await attempt(() => db.execute("DELETE FROM guild_territory_scheduled_transitions WHERE war_id=?", [war]));
        await attempt(() => db.execute("DELETE FROM guild_territory_turns WHERE war_id=?", [war]));
        await attempt(() => db.execute("DELETE FROM guild_territory_wars WHERE id=?", [war]));
        await attempt(() => db.execute("DELETE FROM guild_territory_start_destinations WHERE destination_id=? AND destination_kind='CASTLE'", [`${prefix}-room`]));
        await attempt(() => db.execute("DELETE FROM operations WHERE id=?", [operation]));
        await attempt(() => db.execute("DELETE FROM player_profiles WHERE player_id=?", [player]));
        await attempt(() => db.execute("DELETE FROM players WHERE id=?", [player]));
        await attempt(() => db.execute("DELETE FROM guilds WHERE id=?", [guild]));
        if (scopeOverwritten && scopeBefore !== undefined) {
          await attempt(() => db.execute("INSERT INTO guild_territory_start_scopes(scope_code,war_id,version,updated_at) VALUES ('world',?,?,?) ON DUPLICATE KEY UPDATE war_id=VALUES(war_id),version=VALUES(version),updated_at=VALUES(updated_at)", [scopeBefore!.war_id, scopeBefore!.version, scopeBefore!.updated_at]));
        }
      } finally {
        try { await db.close(); } catch (error) { errors.push(error); }
      }
      if (errors.length > 0) throw new AggregateError(errors, "guild territory authority MariaDB cleanup failed");
    }
  });

  it("recovers one overdue transition after recreation and replays with zero DML", async () => {
    const at = new Date(Date.now() + 60_000);
    assert.deepEqual(await new GuildTerritoryWarStateStartService(db).runDueTransitions(20, at), { processed: 1, skipped: 0 });
    const first = (await db.query<Array<{ active: number; lifecycle_state: string; version: bigint }>>("SELECT active,lifecycle_state,version FROM guild_territory_wars WHERE id=?", [war]))[0]!;
    assert.deepEqual({ active: Number(first.active), lifecycle: first.lifecycle_state, version: first.version.toString() }, { active: 1, lifecycle: "ACTIVE_OPENING", version: "3" });
    const beforeReplay = (await db.query<Array<{ outbox_count: bigint; audit_count: bigint }>>("SELECT (SELECT COUNT(*) FROM outbox_messages WHERE operation_id=?) outbox_count,(SELECT COUNT(*) FROM command_audit WHERE operation_id=?) audit_count", [operation, operation]))[0]!;
    assert.deepEqual(await new GuildTerritoryWarStateStartService(db).runDueTransitions(20, at), { processed: 0, skipped: 0 });
    const afterReplay = (await db.query<Array<{ outbox_count: bigint; audit_count: bigint }>>("SELECT (SELECT COUNT(*) FROM outbox_messages WHERE operation_id=?) outbox_count,(SELECT COUNT(*) FROM command_audit WHERE operation_id=?) audit_count", [operation, operation]))[0]!;
    assert.deepEqual(afterReplay, beforeReplay);
  });

  it("rolls back before touching a due transition when authority is contradictory", async () => {
    await db.execute("INSERT INTO guild_territory_scheduled_transitions(transition_key,war_id,transition_code,scheduled_for,status,operation_id,expected_war_version,payload_json,version) VALUES (?,?,'ENABLE_ATTACKS',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND),'PENDING',?,3,?,1)", [`${prefix}-ready`, war, operation, JSON.stringify({ token: "authority-token", generationVersion: "2" })]);
    await db.execute("UPDATE guild_territory_wars SET active=FALSE,lifecycle_state='ACTIVE_OPENING',opening_token='authority-token' WHERE id=?", [war]);
    await assert.rejects(() => new GuildTerritoryWarStateStartService(db).runDueTransitions(20, new Date(Date.now() + 60_000)), /활성 상태/);
    const transition = (await db.query<Array<{ status: string; version: bigint }>>("SELECT status,version FROM guild_territory_scheduled_transitions WHERE transition_key=?", [`${prefix}-ready`]))[0]!;
    assert.deepEqual({ status: transition.status, version: transition.version.toString() }, { status: "PENDING", version: "1" });
  });
});
