import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { SpiritInfoService } from "../src/pet/spirit-info-service.js";

const enabled = process.env.RUN_SPIRIT_INFO_CANONICAL_MARIADB_INTEGRATION === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";
const integration = enabled ? describe : describe.skip;
let database: DatabaseClient | undefined;
let savepointSequence = 0;

const openDatabase = (): DatabaseClient => createDatabaseClient({
  enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
  user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"),
  connectionLimit: 2, connectTimeoutMs: 5_000
});

function transactionClient(transaction: DatabaseTransaction): DatabaseClient {
  return {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: transaction.query,
    execute: transaction.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      const savepoint = `lease2553_${++savepointSequence}`;
      await transaction.execute(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work(transaction);
        await transaction.execute(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await transaction.execute(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await transaction.execute(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    },
    close: async () => undefined
  };
}

integration("spirit info canonical consumer MariaDB", () => {
  after(async () => { if (database !== undefined) await database.close(); });

  it("reads the grade through the CUID bridge, exact-replays, stays silent without DML, and rolls the fixture back", async () => {
    database = openDatabase();
    const baseline = await database.query<Array<{ players: bigint; definitions: bigint; bridges: bigint; operations: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM players) players,(SELECT COUNT(*) FROM canonical_equipment_grade_definitions) definitions,(SELECT COUNT(*) FROM canonical_elemental_grade_definition_bridges) bridges,(SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes");
    assert.deepEqual(await database.query("SELECT COUNT(*) migration_count FROM schema_migrations WHERE version='477_elemental_grade_definition_bridge.sql'"), [{ migration_count: 1n }]);
    const sentinel = new Error("LEASE2553_FIXTURE_ROLLBACK");
    await assert.rejects(database.withTransaction(async (transaction) => {
      const suffix = Date.now().toString();
      const operatorExternal = `lease2553-operator-${suffix}`;
      const silentExternal = `lease2553-silent-${suffix}`;
      const eventId = `lease2553-event-${suffix}`;
      const operator = await transaction.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      await transaction.execute("INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'호이 남',TRUE,1)", [operator.insertId]);
      await transaction.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked')", [operator.insertId, operatorExternal]);
      const pet = await transaction.execute("INSERT INTO player_pets(player_id,display_name,pet_type_code,version) VALUES (?,'합성 펫','lease2553',1)", [operator.insertId]);
      await transaction.execute("INSERT INTO player_pet_elementals(player_pet_id,display_name,grade_code,grade_display_name,enhancement_level,version) VALUES (?,'피닉스🐦‍🔥','ELEMENTAL-GRADE-007','정령왕',7,1)", [pet.insertId]);

      assert.deepEqual(await transaction.query("SELECT COUNT(*) count_value FROM canonical_elemental_grade_definition_bridges WHERE elemental_grade_order=7"), [{ count_value: 0n }]);
      const scoped = transactionClient(transaction);
      await assert.rejects(() => new SpiritInfoService(scoped).read({ eventId: `${eventId}-missing`, externalUserId: operatorExternal, destinationId: "lease2553-room", displayName: "호이 남", displayNameTrust: "trusted" }), /consistency violation/);
      assert.deepEqual(await transaction.query("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='spirit.info_read'"), [{ count_value: 0n }]);

      await transaction.execute("INSERT INTO canonical_equipment_grade_definitions(equipment_grade_definition_id,source_definition_pointer,equipment_family,equipment_grade_name,equipment_grade_emoji,enhancement_success_probability,enhancement_drop_probability,item_cost_quantity,point_cost_amount,maximum_enhancement_level,battle_base_experience_amount,battle_experience_per_enhancement_amount,raid_base_experience_amount,raid_experience_per_enhancement_amount,castle_base_experience_amount,castle_experience_per_enhancement_amount,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('s2530007','/elemental/lease2553-spirit-info','elemental','합성 정령왕','⚙️',1,0,10,7500000,100,8000,15,10000,25,8000,15,TRUE,'lease2553','2026-09-05 12:00:00','lease2553','2026-09-05 12:00:00')");
      await transaction.execute("INSERT INTO canonical_elemental_grade_definition_bridges(elemental_grade_definition_bridge_id,equipment_grade_definition_id,elemental_grade_order,source_identifier_sha256,binding_fingerprint,numeric_tuple_sha256,numeric_order_sha256,bridge_manifest_sha256,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('b2530007','s2530007',7,REPEAT('a',64),REPEAT('b',64),REPEAT('c',64),REPEAT('d',64),REPEAT('e',64),'lease2553','2026-09-05 12:00:00','lease2553','2026-09-05 12:00:00')");
      await transaction.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('f',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, "lease2553-room", operatorExternal]);

      const input = { eventId, externalUserId: operatorExternal, destinationId: "lease2553-room", displayName: "호이 남", displayNameTrust: "trusted" as const };
      const result = await new SpiritInfoService(scoped).read(input);
      assert.deepEqual(result.replies.map((reply) => reply.data), [
        '{"upgrade":7,"name":"피닉스🐦‍🔥","grade":"정령왕"}',
        '{"battleExp":8105,"raidExp":10175,"castleExp":8105,"message":""}'
      ]);
      const beforeReplay = await transaction.query<Array<{ operations: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=?) operations,(SELECT COUNT(*) FROM outbox_messages WHERE operation_id=(SELECT id FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=?)) outboxes", [eventId, eventId]);
      assert.deepEqual(await new SpiritInfoService(scoped).read(input), result);
      assert.deepEqual(await transaction.query("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=?) operations,(SELECT COUNT(*) FROM outbox_messages WHERE operation_id=(SELECT id FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=?)) outboxes", [eventId, eventId]), beforeReplay);

      const silent = await transaction.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      await transaction.execute("INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'다른 사용자',TRUE,1)", [silent.insertId]);
      await transaction.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'다른 사용자','linked')", [silent.insertId, silentExternal]);
      const beforeSilent = await transaction.query<Array<{ operations: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes");
      assert.deepEqual(await new SpiritInfoService(scoped).read({ eventId: `${eventId}-silent`, externalUserId: silentExternal, destinationId: "lease2553-room", displayName: "다른 사용자", displayNameTrust: "trusted" }), { status: "silent", replies: [] });
      assert.deepEqual(await transaction.query("SELECT (SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes"), beforeSilent);

      const beforeFailure = await transaction.query<Array<{ operations: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes");
      await assert.rejects(() => new SpiritInfoService(scoped).read({ eventId: `${eventId}-failure`, externalUserId: operatorExternal, destinationId: "x".repeat(192), displayName: "호이 남", displayNameTrust: "trusted" }), /too long|ER_DATA_TOO_LONG/i);
      assert.deepEqual(await transaction.query("SELECT (SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes"), beforeFailure);
      throw sentinel;
    }), (error: unknown) => error === sentinel);
    assert.deepEqual(await database.query("SELECT (SELECT COUNT(*) FROM players) players,(SELECT COUNT(*) FROM canonical_equipment_grade_definitions) definitions,(SELECT COUNT(*) FROM canonical_elemental_grade_definition_bridges) bridges,(SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes"), baseline);

    const restartSuffix = `${Date.now()}-restart`;
    const restartExternal = `lease2553-operator-${restartSuffix}`;
    const driftExternal = `lease2553-drift-${restartSuffix}`;
    const restartEvent = `lease2553-event-${restartSuffix}`;
    let restartPlayerId = 0n;
    let driftPlayerId = 0n;
    let committedResult: Awaited<ReturnType<SpiritInfoService["read"]>>;
    await database.withTransaction(async (transaction) => {
      const operator = await transaction.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      restartPlayerId = operator.insertId;
      await transaction.execute("INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'프로필 불일치',TRUE,1)", [operator.insertId]);
      await transaction.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'프로필 불일치','linked')", [operator.insertId, restartExternal]);
      const pet = await transaction.execute("INSERT INTO player_pets(player_id,display_name,pet_type_code,version) VALUES (?,'합성 펫','lease2553',1)", [operator.insertId]);
      await transaction.execute("INSERT INTO player_pet_elementals(player_pet_id,display_name,grade_code,grade_display_name,enhancement_level,version) VALUES (?,'피닉스🐦‍🔥','ELEMENTAL-GRADE-007','정령왕',7,1)", [pet.insertId]);
      const drift = await transaction.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      driftPlayerId = drift.insertId;
      await transaction.execute("INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'다른 사용자',TRUE,1)", [drift.insertId]);
      await transaction.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'다른 사용자','linked')", [drift.insertId, driftExternal]);
      await transaction.execute("INSERT INTO canonical_equipment_grade_definitions(equipment_grade_definition_id,source_definition_pointer,equipment_family,equipment_grade_name,equipment_grade_emoji,enhancement_success_probability,enhancement_drop_probability,item_cost_quantity,point_cost_amount,maximum_enhancement_level,battle_base_experience_amount,battle_experience_per_enhancement_amount,raid_base_experience_amount,raid_experience_per_enhancement_amount,castle_base_experience_amount,castle_experience_per_enhancement_amount,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('s2530007','/elemental/lease2553-spirit-info','elemental','합성 정령왕','⚙️',1,0,10,7500000,100,8000,15,10000,25,8000,15,TRUE,'lease2553','2026-09-05 12:00:00','lease2553','2026-09-05 12:00:00')");
      await transaction.execute("INSERT INTO canonical_elemental_grade_definition_bridges(elemental_grade_definition_bridge_id,equipment_grade_definition_id,elemental_grade_order,source_identifier_sha256,binding_fingerprint,numeric_tuple_sha256,numeric_order_sha256,bridge_manifest_sha256,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('b2530007','s2530007',7,REPEAT('a',64),REPEAT('b',64),REPEAT('c',64),REPEAT('d',64),REPEAT('e',64),'lease2553','2026-09-05 12:00:00','lease2553','2026-09-05 12:00:00')");
      await transaction.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('f',64),'processed',UTC_TIMESTAMP(3))", [restartEvent, restartEvent, "lease2553-room", restartExternal]);
      committedResult = await new SpiritInfoService(transactionClient(transaction)).read({ eventId: restartEvent, externalUserId: restartExternal, destinationId: "lease2553-room", displayName: "호이 남", displayNameTrust: "trusted" });
    });
    await database.close();
    database = openDatabase();
    const committedOperation = (await database.query<Array<{ id: bigint }>>("SELECT id FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=?", [restartEvent]))[0]!;
    const replayInput = { eventId: restartEvent, externalUserId: restartExternal, destinationId: "lease2553-room", displayName: "호이 남", displayNameTrust: "trusted" as const };
    const replayState = () => database!.query<Array<{ operations: bigint; outboxes: bigint; enhancement: bigint }>>("SELECT (SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes,(SELECT elemental.enhancement_level FROM player_pet_elementals elemental JOIN player_pets pet ON pet.id=elemental.player_pet_id WHERE pet.player_id=?) enhancement", [restartPlayerId]);
    for (const [column, drift, original] of [["provider_code", "other", "iris"], ["destination_id", "other-room", "lease2553-room"], ["message_type", "image", "text"]] as const) {
      await database.execute(`UPDATE outbox_messages SET ${column}=? WHERE operation_id=? ORDER BY id LIMIT 1`, [drift, committedOperation.id]);
      const beforeDriftReplay = await replayState();
      await assert.rejects(() => new SpiritInfoService(database!).read(replayInput), /SPIRIT_INFO_REPLAY_OUTBOX_DRIFT/);
      assert.deepEqual(await replayState(), beforeDriftReplay);
      await database.execute(`UPDATE outbox_messages SET ${column}=? WHERE operation_id=? ORDER BY id LIMIT 1`, [original, committedOperation.id]);
    }
    await database.execute("UPDATE player_profiles SET current_display_name='재시작 후 변경' WHERE player_id=?", [restartPlayerId]);
    await database.execute("DELETE FROM canonical_elemental_grade_definition_bridges WHERE elemental_grade_definition_bridge_id='b2530007'");
    await database.execute("UPDATE canonical_equipment_grade_definitions SET active_flag=FALSE WHERE equipment_grade_definition_id='s2530007'");
    const beforeRestartReplay = await database.query<Array<{ operations: bigint; outboxes: bigint }>>("SELECT (SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes");
    assert.deepEqual(await new SpiritInfoService(database).read(replayInput), committedResult!);
    assert.deepEqual(await database.query("SELECT (SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes"), beforeRestartReplay);
    await assert.rejects(() => new SpiritInfoService(database!).read({ ...replayInput, destinationId: "lease2553-other" }), /payload drift/);
    await assert.rejects(() => new SpiritInfoService(database!).read({ ...replayInput, externalUserId: driftExternal }), /actor drift/);

    await database.withTransaction(async (transaction) => {
      const operation = (await transaction.query<Array<{ id: bigint }>>("SELECT id FROM operations WHERE idempotency_scope='spirit.info_read' AND idempotency_key=?", [restartEvent]))[0]!;
      const pet = (await transaction.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [restartPlayerId]))[0]!;
      await transaction.execute("DELETE FROM command_executions WHERE operation_id=?", [operation.id]);
      await transaction.execute("DELETE FROM command_audit WHERE operation_id=?", [operation.id]);
      await transaction.execute("DELETE FROM outbox_messages WHERE operation_id=?", [operation.id]);
      await transaction.execute("DELETE FROM operations WHERE id=?", [operation.id]);
      await transaction.execute("DELETE FROM event_inbox WHERE event_id=?", [restartEvent]);
      await transaction.execute("DELETE FROM player_pet_elementals WHERE player_pet_id=?", [pet.id]);
      await transaction.execute("DELETE FROM player_pets WHERE id=?", [pet.id]);
      await transaction.execute("DELETE FROM external_identities WHERE external_user_id IN (?,?)", [restartExternal, driftExternal]);
      await transaction.execute("DELETE FROM player_profiles WHERE player_id IN (?,?)", [restartPlayerId, driftPlayerId]);
      await transaction.execute("DELETE FROM players WHERE id IN (?,?)", [restartPlayerId, driftPlayerId]);
      await transaction.execute("DELETE FROM canonical_equipment_grade_definitions WHERE equipment_grade_definition_id='s2530007'");
    });
    assert.deepEqual(await database.query("SELECT (SELECT COUNT(*) FROM players) players,(SELECT COUNT(*) FROM canonical_equipment_grade_definitions) definitions,(SELECT COUNT(*) FROM canonical_elemental_grade_definition_bridges) bridges,(SELECT COUNT(*) FROM operations) operations,(SELECT COUNT(*) FROM outbox_messages) outboxes"), baseline);
  });
});
