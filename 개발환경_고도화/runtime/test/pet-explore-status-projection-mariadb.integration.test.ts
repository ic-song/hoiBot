import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PetExploreStatusProjectionService } from "../src/pet/pet-explore-status-projection-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("pet explore status projection MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = Date.now().toString();
  const externalId = `pet-explore-status-${suffix}`;
  const event = `pet-explore-status-event-${suffix}`;
  const displayName = `탐험 관리자 ${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code IN ('PET_EXPLORE_MAP_READ','PET_EXPLORE_USER_CHECK_READ')");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, displayName]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,'x','active')", [`pet-explore-status-${suffix}`, displayName]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`pet-explore-status-${suffix}`]))[0]!;
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE external_user_id=?", [externalId]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('a',64),'parsed','processing',UTC_TIMESTAMP(3))", [event, event]);
    await database.execute("INSERT INTO pet_explore_rounds(round_key,state_code,version) VALUES (?,'open',1)", [`status-${suffix}`]);
    const round = (await database.query<Array<{ id: bigint }>>("SELECT id FROM pet_explore_rounds WHERE round_key=?", [`status-${suffix}`]))[0]!;
    await database.execute("INSERT INTO pet_explore_participations(participation_key,round_id,player_id,destination_code,state_code,version) VALUES (?,?,?,'pet_enhancement_mine','active',1)", [`status-${suffix}:${player.id.toString()}`, round.id, player.id]);
    const participation = (await database.query<Array<{ id: bigint }>>("SELECT id FROM pet_explore_participations WHERE participation_key=?", [`status-${suffix}:${player.id.toString()}`]))[0]!;
    await database.execute("INSERT INTO pet_explore_settlement_participant_source_projections(participation_id,round_id,player_id,source_revision,source_hash,threshold_components_json,source_gap_codes_json) VALUES (?,?,?,'status-test',REPEAT('b',64),?,JSON_ARRAY())", [participation.id, round.id, player.id, JSON.stringify({ base: 500, tier: 100, experience: 200, lord: 0, trait: 0, pendant: 50, homeBadge: 50, upItem: 0, penalty: 0, premium: 0 })]);
    await database.execute("INSERT INTO pet_explore_auto_fixed_configs(player_id,destination_code,version) VALUES (?,'luck_mine',1)", [player.id]);
    await database.execute("INSERT INTO player_pet_explore_rank_stats(player_name,win_count,lose_count,source_order) VALUES (?,7,2,0)", [displayName]);
  });

  after(async () => { if (database) await database.close(); });

  it("reads map and admin user detail while Shadow remains side-effect free", async () => {
    const service = new PetExploreStatusProjectionService(database);
    const map = await service.handleIris({ eventId: event, externalUserId: externalId, channelId: "room", message: "/지도" });
    assert.equal(map.status, "changed");
    if (map.status === "changed") assert.match(map.data, /현재 탐험: 펫강화 광산/);
    const detailEvent = `${event}-detail`;
    await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('c',64),'parsed','processing',UTC_TIMESTAMP(3))", [detailEvent, detailEvent]);
    const detail = await service.handleIris({ eventId: detailEvent, externalUserId: externalId, channelId: "room", message: "/탐험유저확인 1" });
    assert.equal(detail.status, "changed");
    if (detail.status === "changed") assert.match(detail.data, /7승 2패/);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PET_EXPLORE_MAP_READ'");
    const shadowEvent = `${event}-shadow`;
    await database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('d',64),'parsed','processing',UTC_TIMESTAMP(3))", [shadowEvent, shadowEvent]);
    const shadow = await service.handleIris({ eventId: shadowEvent, externalUserId: externalId, channelId: "room", message: "/지도" });
    assert.equal(shadow.status, "shadow");
  });
});
