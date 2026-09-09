import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PetExploreEventControlCommandService } from "../src/pet/pet-explore-event-control-command-service.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

integration("pet explore event control command consumer MariaDB integration", () => {
  let database: DatabaseClient;
  const prefix = `pet-event-consumer-${Date.now()}`;
  const externalUserId = `${prefix}-operator`;

  before(async () => {
    database = createDatabaseClient(loadConfig().database);
    const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const identity = await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 운영자','linked')", [player.insertId, externalUserId]);
    const operator = await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'합성 운영자','synthetic-not-a-real-password','active')", [`${prefix}-login`]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.insertId, identity.insertId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin'", [operator.insertId]);
    await database.execute("UPDATE pet_explore_runtime_config SET event_mine_active=FALSE,guild_raid_active=FALSE,version=1,updated_operation_id=NULL WHERE config_id=1");
    const round = await database.execute("INSERT INTO pet_explore_rounds(round_key,state_code) VALUES (?,'open')", [`${prefix}-round`]);
    const participant = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    await database.execute("INSERT INTO pet_explore_participations(participation_key,round_id,player_id,destination_code,state_code) VALUES (?,?,?,'diamond_mine_event','active')", [`${prefix}-participant`, round.insertId, participant.insertId]);
  });

  after(async () => database.close());

  it("routes four aliases in SHADOW and preserves mutation replay, relocation and command evidence", async () => {
    const registry = (await database.query<Array<{ aliases: bigint; handler: string; rollout: string }>>(
      "SELECT (SELECT COUNT(*) FROM command_aliases WHERE command_code='PET_EXPLORE_EVENT_CONTROL' AND active=TRUE) aliases,handler_key handler,rollout_state rollout FROM command_registry WHERE command_code='PET_EXPLORE_EVENT_CONTROL'",
    ))[0]!;
    assert.deepEqual([registry.aliases.toString(), registry.handler, registry.rollout], ["4", "pet_explore_event_control", "SHADOW"]);
    const service = new PetExploreEventControlCommandService(database);
    const shadow = await service.handleDispatchedIris({ eventId: `${prefix}-shadow`, externalUserId, channelId: "synthetic-room", message: "/레이드이벤트활성화" });
    assert.equal(shadow.status, "shadow");
    await database.execute(
      "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('a',64),'processed',UTC_TIMESTAMP(3)),(?,?,?,?,'message','incoming',REPEAT('b',64),'processed',UTC_TIMESTAMP(3))",
      [`${prefix}-on`, `${prefix}-on`, "synthetic-room", externalUserId, `${prefix}-off`, `${prefix}-off`, "synthetic-room", externalUserId],
    );
    const on = await service.execute({ eventId: `${prefix}-on`, externalUserId, channelId: "synthetic-room", message: "/펫탐험이벤트활성화" });
    const off = await service.execute({ eventId: `${prefix}-off`, externalUserId, channelId: "synthetic-room", message: "/펫탐험이벤트비활성화" });
    const replay = await service.execute({ eventId: `${prefix}-off`, externalUserId, channelId: "synthetic-room", message: "/펫탐험이벤트비활성화" });
    assert.deepEqual([on?.replayed, off?.replayed, replay?.replayed], [false, false, true]);
    assert.match(off?.data ?? "", /참가자 [1-9]\d*명은 일반 광산/);
    const evidence = (await database.query<Array<{ executions: bigint; changes: bigint; relocations: bigint; activeParticipants: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM command_executions WHERE command_code='PET_EXPLORE_EVENT_CONTROL' AND event_id IN (?,?)) executions,(SELECT COUNT(*) FROM pet_explore_event_control_changes change_row JOIN operations operation ON operation.id=change_row.operation_id WHERE operation.idempotency_key IN (?,?)) changes,(SELECT COUNT(*) FROM pet_explore_event_control_relocations relocation JOIN operations operation ON operation.id=relocation.operation_id WHERE operation.idempotency_key=?) relocations,(SELECT COUNT(*) FROM pet_explore_participations participation JOIN pet_explore_rounds round_state ON round_state.id=participation.round_id WHERE round_state.round_key=? AND participation.destination_code='diamond_mine_event' AND participation.state_code='active') activeParticipants",
      [`${prefix}-on`, `${prefix}-off`, `${prefix}-on`, `${prefix}-off`, `${prefix}-off`, `${prefix}-round`],
    ))[0]!;
    assert.deepEqual([evidence.executions.toString(), evidence.changes.toString(), evidence.activeParticipants.toString()], ["2", "2", "0"]);
    assert.ok(evidence.relocations >= 1n);
  });
});
