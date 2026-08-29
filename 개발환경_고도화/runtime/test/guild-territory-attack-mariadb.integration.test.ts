import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { deterministicGuildTerritoryDrawBps, GuildTerritoryAttackService } from "../src/guild/guild-territory-attack-service.js";

const suite = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

suite("guild territory attack MariaDB integration", () => {
  let db: DatabaseClient;
  const prefix = `territory-attack-${Date.now()}`;
  const base = BigInt(Date.now()) * 100_000n;
  let sequence = 0n;
  type Arena = { war: bigint; generation: bigint; actor: bigint; defender: bigint; actorGuild: bigint; defenderGuild: bigint; external: string; room: string };

  const seedEvent = async (arena: Arena, eventId: string) => {
    await db.execute(
      "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))",
      [eventId, eventId, arena.room, arena.external],
    );
  };

  const seedArena = async (options: { currentActor?: boolean; actorOwned?: number[]; occupied?: number[]; actorTurnUsed?: number; attackLimit?: number } = {}): Promise<Arena> => {
    sequence += 100n;
    const actor = base + sequence + 1n;
    const defender = base + sequence + 2n;
    const actorGuild = base + sequence + 3n;
    const defenderGuild = base + sequence + 4n;
    const operation = base + sequence + 5n;
    const war = base + sequence + 6n;
    const generation = 1n;
    const suffix = sequence.toString();
    const external = `${prefix}-user-${suffix}`;
    const room = `${prefix}-room-${suffix}`;
    const currentActor = options.currentActor ?? true;
    const attackLimit = options.attackLimit ?? 30;
    await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1)", [actor, defender]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,'합성 공격자',0,1),(?,'합성 방어자',0,1)", [actor, defender]);
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 공격자','linked')", [actor, external]);
    await db.execute("INSERT INTO guilds(id,code,display_name,status,version) VALUES (?,?,?,'active',1),(?,?,?,'active',1)", [actorGuild, `SYN-ATK-A-${prefix}-${suffix}`, "합성 공격길드", defenderGuild, `SYN-ATK-D-${prefix}-${suffix}`, "합성 방어길드"]);
    await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,'member',UTC_TIMESTAMP(3)),(?,?,'member',UTC_TIMESTAMP(3))", [actorGuild, actor, defenderGuild, defender]);
    await db.execute("INSERT INTO guild_territory_rift_authorizations(guild_id,player_id,authority_code,active,version) VALUES (?,?,'sword_master',TRUE,1)", [actorGuild, actor]);
    await db.execute("INSERT INTO operations(id,operation_key,idempotency_scope,idempotency_key,actor_type,source_code,status,created_at,completed_at) VALUES (?,UUID(),'synthetic.territory.attack.start',?,'system','synthetic','completed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation, `${prefix}-start-${suffix}`]);
    await db.execute("INSERT INTO guild_territory_wars(id,war_key,active,lifecycle_state,start_ready,current_turn_no,started_at,start_operation_id,rift_event_history_json,version) VALUES (?,?,TRUE,'ACTIVE_READY',TRUE,1,UTC_TIMESTAMP(3),?,JSON_ARRAY(),1)", [war, `${prefix}-war-${suffix}`, operation]);
    await db.execute("INSERT INTO guild_territory_ready_guilds(war_id,guild_id,ready) VALUES (?,?,TRUE),(?,?,TRUE)", [war, actorGuild, war, defenderGuild]);
    await db.execute(
      "INSERT INTO guild_territory_turns(war_id,generation_version,ordinal,guild_id,attacker_player_id,attack_limit,attacks_used,turn_state) VALUES (?,?,?,?,?,?,?,'ACTIVE'),(?,?,?,?,?,?,0,'PENDING')",
      currentActor
        ? [war, generation, 1, actorGuild, actor, attackLimit, options.actorTurnUsed ?? 0, war, generation, 2, defenderGuild, defender, attackLimit]
        : [war, generation, 1, defenderGuild, defender, attackLimit, 0, war, generation, 2, actorGuild, actor, attackLimit],
    );
    if (!currentActor && (options.actorTurnUsed ?? 0) > 0) {
      await db.execute("UPDATE guild_territory_turns SET attacks_used=? WHERE war_id=? AND generation_version=? AND guild_id=?", [options.actorTurnUsed, war, generation, actorGuild]);
    }
    const actorOwned = new Set(options.actorOwned ?? []);
    const occupied = new Set(options.occupied ?? [1]);
    for (let territoryNo = 1; territoryNo <= 7; territoryNo += 1) {
      const actorOwns = actorOwned.has(territoryNo);
      const hasOwner = actorOwns || occupied.has(territoryNo);
      await db.execute(
        "INSERT INTO guild_territory_occupations(war_id,territory_no,territory_name,owner_guild_id,owner_player_id,version) VALUES (?,?,?,?,?,1)",
        [war, territoryNo, `합성영지${territoryNo}`, hasOwner ? (actorOwns ? actorGuild : defenderGuild) : null, hasOwner ? (actorOwns ? actor : defender) : null],
      );
    }
    await db.execute("INSERT INTO guild_territory_combat_snapshots(war_id,generation_version,player_id,guild_id,castle_charm,critical_bps,critical_multiplier_bps,pet_snapshot_json,source_operation_id) VALUES (?,?,?,?,100,0,20000,JSON_OBJECT('kind','synthetic'),?),(?,?,?,?,100,0,20000,JSON_OBJECT('kind','synthetic'),?)", [war, generation, actor, actorGuild, operation, war, generation, defender, defenderGuild, operation]);
    await db.execute("INSERT INTO guild_territory_start_scopes(scope_code,war_id,version) VALUES ('world',?,1) ON DUPLICATE KEY UPDATE war_id=VALUES(war_id),version=version+1", [war]);
    return { war, generation, actor, defender, actorGuild, defenderGuild, external, room };
  };

  const findEvent = (arena: Arena, drawCode: string, predicate: (draw: number) => boolean) => {
    for (let index = 0; index < 200_000; index += 1) {
      const eventId = `${prefix}-${arena.war}-${drawCode}-${index}`;
      if (predicate(deterministicGuildTerritoryDrawBps(`${eventId}|${arena.war}|${arena.generation}|${drawCode}`))) return eventId;
    }
    throw new Error(`synthetic event not found for ${drawCode}`);
  };

  const operationIdFor = async (eventId: string) => (await db.query<Array<{ operation_id: bigint }>>("SELECT operation_id FROM guild_territory_attack_runs WHERE event_key=?", [eventId]))[0]!.operation_id;

  before(async () => {
    db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 12, connectTimeoutMs: 5_000 });
    await db.execute("UPDATE guild_territory_attack_policy_versions SET status='ACTIVE',contribution_medal_bps=10000,contribution_medal_quantity=2,evidence_label='synthetic-fixture-only',rift_event_base_bps=0,instability_bps_per_point=0,normal_rift_base_bps=10000,rift_bias_bps_per_point=0,rift_evidence_label='synthetic-fixture-only',activated_at=UTC_TIMESTAMP(3) WHERE policy_scope_code='world-attack' AND policy_version=1");
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=TRUE WHERE command_code='GUILD_TERRITORY_ATTACK_EXECUTE'");
    await db.execute("UPDATE guild_territory_war_control SET dimension_gate_enabled=TRUE WHERE control_code='current'");
    await db.execute("UPDATE guild_territory_attack_feature_controls SET remember_event_enabled=TRUE WHERE control_code='current'");
    for (const [code, name] of [["territory_defense_ticket", "합성 방어권"], ["territory_attack_ticket", "합성 공격권"], ["guild_contribution_medal", "합성 공헌훈장"]]) {
      await db.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES (?,?,'ITEM',TRUE,JSON_OBJECT('fixture',TRUE),TRUE,1) ON DUPLICATE KEY UPDATE active=TRUE", [code, name]);
    }
  });

  after(async () => { if (db) await db.close(); });

  it("captures an unoccupied territory and replays every mutation exactly once", async () => {
    const arena = await seedArena({ occupied: [1] });
    const eventId = `${prefix}-capture`;
    await seedEvent(arena, eventId);
    const service = new GuildTerritoryAttackService(db);
    const result = await service.attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 2 });
    assert.equal(result.resultCode, "unoccupied_captured");
    assert.deepEqual(await service.attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 2 }), result);
    const operationId = await operationIdFor(eventId);
    const counts = (await db.query<Array<{ runs: bigint; draws: bigint; audits: bigint; outbox: bigint }>>("SELECT (SELECT COUNT(*) FROM guild_territory_attack_runs WHERE operation_id=?) runs,(SELECT COUNT(*) FROM guild_territory_attack_random_draws WHERE operation_id=?) draws,(SELECT COUNT(*) FROM command_audit WHERE operation_id=?) audits,(SELECT COUNT(*) FROM outbox_messages WHERE operation_id=?) outbox", [operationId, operationId, operationId, operationId]))[0]!;
    assert.deepEqual(Object.values(counts).map(Number), [1, 2, 1, 1]);
    assert.equal(String((await db.query<Array<{ balance: string }>>("SELECT balance FROM guild_resource_accounts WHERE guild_id=? AND currency_code='POINT'", [arena.actorGuild]))[0]!.balance), "50000000.000");
    assert.equal(Number((await db.query<Array<{ attacks_used: number }>>("SELECT attacks_used FROM guild_territory_player_attack_states WHERE war_id=? AND player_id=?", [arena.war, arena.actor]))[0]!.attacks_used), 1);
    assert.equal(String((await db.query<Array<{ quantity: bigint }>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='guild_contribution_medal'", [arena.actor]))[0]!.quantity), "2");
  });

  it("consumes count and doubled fund before blocking target 7 at the ownership cap", async () => {
    const arena = await seedArena({ actorOwned: [1, 2, 3], occupied: [] });
    const eventId = `${prefix}-max-owned`;
    await seedEvent(arena, eventId);
    const result = await new GuildTerritoryAttackService(db).attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 7 });
    assert.equal(result.status, "blocked_max_owned");
    assert.equal(result.playerAttacksUsed, 1);
    assert.equal(result.guildAttacksUsed, 1);
    assert.equal(String((await db.query<Array<{ balance: string }>>("SELECT balance FROM guild_resource_accounts WHERE guild_id=? AND currency_code='POINT'", [arena.actorGuild]))[0]!.balance), "100000000.000");
  });

  it("covers both deterministic dimension branches", async () => {
    for (const [hit, code, used] of [[true, "dimension_player_eliminated", 3], [false, "dimension_guild_penalty", 5]] as const) {
      const arena = await seedArena();
      const eventId = findEvent(arena, "dimension_outcome", (draw) => hit ? draw < 8_000 : draw >= 8_000);
      await seedEvent(arena, eventId);
      const result = await new GuildTerritoryAttackService(db).attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 8 });
      assert.equal(result.resultCode, code);
      assert.equal(result.guildAttacksUsed, used);
    }
  });

  it("covers remember success, failure, and deterministic occupied-territory release", async () => {
    for (const succeeds of [true, false]) {
      const arena = await seedArena({ occupied: [1, 3, 5] });
      const eventId = findEvent(arena, "remember_success", (draw) => succeeds ? draw < 3_000 : draw >= 3_000);
      await seedEvent(arena, eventId);
      const result = await new GuildTerritoryAttackService(db).attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 9 });
      assert.equal(result.resultCode, succeeds ? "remember_released" : "remember_failed");
      if (succeeds) {
        assert.ok(result.releasedTerritoryNo !== null);
        const owner = (await db.query<Array<{ owner_guild_id: bigint | null }>>("SELECT owner_guild_id FROM guild_territory_occupations WHERE war_id=? AND territory_no=?", [arena.war, result.releasedTerritoryNo]))[0]!.owner_guild_id;
        assert.equal(owner, null);
      }
    }
  });

  it("records contribution, defense, attack, and critical draws independently in combat order", async () => {
    const arena = await seedArena({ occupied: [1] });
    let eventId = "";
    for (let index = 0; index < 200_000; index += 1) {
      const candidate = `${prefix}-combat-chain-${index}`;
      const defense = deterministicGuildTerritoryDrawBps(`${candidate}|${arena.war}|${arena.generation}|defense_ticket`);
      const attack = deterministicGuildTerritoryDrawBps(`${candidate}|${arena.war}|${arena.generation}|attack_ticket`);
      if (defense >= 2_000 && attack >= 1_000) { eventId = candidate; break; }
    }
    assert.notEqual(eventId, "");
    const items = await db.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM item_definitions WHERE code IN ('territory_defense_ticket','territory_attack_ticket')");
    const idByCode = new Map(items.map((row) => [row.code, row.id]));
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1),(?,?,1,1)", [arena.defender, idByCode.get("territory_defense_ticket"), arena.actor, idByCode.get("territory_attack_ticket")]);
    await seedEvent(arena, eventId);
    const result = await new GuildTerritoryAttackService(db).attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 1 });
    assert.equal(result.resultCode, "snapshot_defender_win");
    const operationId = await operationIdFor(eventId);
    const draws = await db.query<Array<{ draw_code: string }>>("SELECT draw_code FROM guild_territory_attack_random_draws WHERE operation_id=? ORDER BY sequence_no", [operationId]);
    assert.deepEqual(draws.map((row) => row.draw_code), ["contribution_medal", "defense_ticket", "attack_ticket", "attacker_critical", "defender_critical", "rift_event"]);
  });

  it("checks contribution-cube defense separately after a surprise attack activates", async () => {
    const arena = await seedArena({ occupied: [1] });
    await db.execute("UPDATE guild_territory_combat_snapshots SET surprise_defense_bonus_bps=10000 WHERE war_id=? AND player_id=?", [arena.war, arena.defender]);
    const attackItem = (await db.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code='territory_attack_ticket'"))[0]!.id;
    await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1)", [arena.actor, attackItem]);
    const eventId = findEvent(arena, "attack_ticket", (draw) => draw < 1_000);
    await seedEvent(arena, eventId);
    const result = await new GuildTerritoryAttackService(db).attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 1 });
    assert.equal(result.resultCode, "contribution_cube_defense_win");
    const operationId = await operationIdFor(eventId);
    const draws = await db.query<Array<{ draw_code: string }>>("SELECT draw_code FROM guild_territory_attack_random_draws WHERE operation_id=? ORDER BY sequence_no", [operationId]);
    assert.deepEqual(draws.map((row) => row.draw_code), ["contribution_medal", "attack_ticket", "contribution_cube_defense", "rift_event"]);
  });

  it("persists a policy-driven great rift and resets instability after combat", async () => {
    const arena = await seedArena({ occupied: [1] });
    await db.execute("UPDATE guild_territory_wars SET instability_adjust=5,rift_bias=-70 WHERE id=?", [arena.war]);
    await db.execute("UPDATE guild_territory_attack_policy_versions SET rift_event_base_bps=10000,normal_rift_base_bps=0 WHERE policy_scope_code='world-attack' AND policy_version=1");
    const eventId = `${prefix}-great-rift`;
    await seedEvent(arena, eventId);
    const result = await new GuildTerritoryAttackService(db).attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 2 });
    assert.equal(result.riftEventStatus, "great_rift");
    assert.notEqual(result.riftTargetGuildId, null);
    const state = (await db.query<Array<{ instability: string; count_value: bigint }>>("SELECT CAST(instability_adjust AS CHAR) instability,rift_event_count count_value FROM guild_territory_wars WHERE id=?", [arena.war]))[0]!;
    assert.deepEqual([state.instability, Number(state.count_value)], ["0.000", 1]);
    assert.equal(Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_territory_rift_events WHERE operation_id=(SELECT operation_id FROM guild_territory_attack_runs WHERE event_key=?)", [eventId]))[0]!.count_value), 1);
    await db.execute("UPDATE guild_territory_attack_policy_versions SET rift_event_base_bps=0,normal_rift_base_bps=10000 WHERE policy_scope_code='world-attack' AND policy_version=1");
  });

  it("applies penalty five on a wrong turn or eliminates a guild with less than five remaining", async () => {
    const penaltyArena = await seedArena({ currentActor: false, attackLimit: 10 });
    const penaltyEvent = `${prefix}-wrong-turn-penalty`;
    await seedEvent(penaltyArena, penaltyEvent);
    const penalty = await new GuildTerritoryAttackService(db).attack({ eventId: penaltyEvent, externalUserId: penaltyArena.external, channelId: penaltyArena.room, targetNo: 1 });
    assert.equal(penalty.resultCode, "wrong_turn_penalty");
    assert.equal(penalty.guildAttacksUsed, 5);
    assert.equal(Number((await db.query<Array<{ eliminated: number }>>("SELECT eliminated FROM guild_territory_player_attack_states WHERE war_id=? AND player_id=?", [penaltyArena.war, penaltyArena.actor]))[0]!.eliminated), 1);
    const eliminatedArena = await seedArena({ currentActor: false, attackLimit: 10, actorTurnUsed: 7 });
    const eliminatedEvent = `${prefix}-wrong-turn-eliminated`;
    await seedEvent(eliminatedArena, eliminatedEvent);
    const eliminated = await new GuildTerritoryAttackService(db).attack({ eventId: eliminatedEvent, externalUserId: eliminatedArena.external, channelId: eliminatedArena.room, targetNo: 1 });
    assert.equal(eliminated.resultCode, "wrong_turn_eliminated");
    assert.equal(Number((await db.query<Array<{ eliminated: number }>>("SELECT eliminated FROM guild_territory_guild_attack_states WHERE war_id=? AND guild_id=?", [eliminatedArena.war, eliminatedArena.actorGuild]))[0]!.eliminated), 1);
  });

  it("settles the same generation automatically when no pending turn remains", async () => {
    const arena = await seedArena({ occupied: [1], attackLimit: 1 });
    await db.execute("UPDATE guild_territory_turns SET turn_state='SKIPPED',version=version+1 WHERE war_id=? AND ordinal=2", [arena.war]);
    const eventId = `${prefix}-auto-finish`;
    await seedEvent(arena, eventId);
    const result = await new GuildTerritoryAttackService(db).attack({ eventId, externalUserId: arena.external, channelId: arena.room, targetNo: 2 });
    assert.equal(result.finishResult?.status, "finished");
    const war = (await db.query<Array<{ active: number; lifecycle_state: string }>>("SELECT active,lifecycle_state FROM guild_territory_wars WHERE id=?", [arena.war]))[0]!;
    assert.deepEqual([Number(war.active), war.lifecycle_state], [0, "READY"]);
    assert.equal(Number((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_territory_finish_runs WHERE war_id=?", [arena.war]))[0]!.count_value), 1);
  });
});
