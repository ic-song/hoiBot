import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import mariadb from "mariadb";
import { MariaPlayerContextProvider } from "../src/account-platform/player-context-provider.js";
import { PetTitleAdminAppWiringIngress } from "../src/admin/pet-title-admin-app-wiring-ingress.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import { CommandDispatcher, MariaCommandRouteReader } from "../src/dispatch/command-dispatcher.js";
import { PetTitleCanonicalMutationProvider } from "../src/pet/pet-title-canonical-mutation-provider.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const enabled = process.env.PET_TITLE_ADMIN_BATCH_MARIADB === "1";
const prefix = `pa${Date.now().toString(36).slice(-6)}${randomBytes(2).toString("hex")}`;
const stableId = (label: string): string => createHash("sha256").update(`${prefix}:${label}`).digest("hex").slice(0, 8);
const ids = {
  canonicalPlayer: stableId("canonical-player"), portal: stableId("portal"), link: stableId("link"),
  identity: stableId("identity"), context: stableId("context"), membership: stableId("membership"),
  selection: stableId("selection"), title: stableId("title"), ownedOne: stableId("owned-one"), ownedTwo: stableId("owned-two"), ownedThree: stableId("owned-three"),
};
const room = `${prefix}-room`, external = `${prefix}-operator`;
const eventIds = [`${prefix}-shadow`, `${prefix}-reset`, `${prefix}-fault`];
let db: DatabaseClient;
let originalRollout: { rollout_state: string; enabled: number } | undefined;

// 동일 event replay를 새 composition root에서도 검증하도록 ingress를 매번 재구성합니다.
async function ingress(): Promise<PetTitleAdminAppWiringIngress> {
  const environment = await verifyStartupDatabaseIdentity(db, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: process.env.DATABASE_NAME! }));
  return new PetTitleAdminAppWiringIngress(
    new MariaAppWiringOperationProvider(db as never, environment),
    new CommandDispatcher(new MariaCommandRouteReader(db), { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }),
    new MariaPlayerContextProvider(),
    new PetTitleCanonicalMutationProvider(),
  );
}

// destructive reset이 전용 schema의 fixture 외 보유 행을 건드리지 못하게 차단합니다.
async function assertFixtureIsolation(expectedOwned: number): Promise<void> {
  const rows = await db.query<Array<{ owned_pet_title_id: string; player_id: string }>>(
    "SELECT owned_pet_title_id,player_id FROM canonical_owned_pet_title_instances WHERE ownership_status='owned' ORDER BY owned_pet_title_id",
  );
  assert.equal(rows.length, expectedOwned, "dedicated schema must contain only expected owned-title fixtures");
  assert.ok(rows.every((row) => row.player_id === ids.canonicalPlayer && [ids.ownedOne, ids.ownedTwo, ids.ownedThree].includes(row.owned_pet_title_id)));
}

// 실행별 claim·batch·outbox와 fixture 보유 상태를 한 번에 비교합니다.
async function counts() {
  return (await db.query<Array<{ claims: bigint; batches: bigint; targets: bigint; links: bigint; outbox: bigint; owned: bigint }>>(
    `SELECT (SELECT COUNT(*) FROM canonical_app_wiring_operations WHERE external_request_id LIKE ?) claims,
            (SELECT COUNT(*) FROM canonical_pet_title_batch_operations WHERE request_key LIKE ?) batches,
            (SELECT COUNT(*) FROM canonical_pet_title_batch_operation_targets target JOIN canonical_pet_title_batch_operations batch ON batch.pet_title_batch_operation_id=target.pet_title_batch_operation_id WHERE batch.request_key LIKE ?) targets,
            (SELECT COUNT(*) FROM canonical_app_wiring_receipt_links link JOIN canonical_app_wiring_operations claim ON claim.app_wiring_operation_id=link.app_wiring_operation_id WHERE claim.external_request_id LIKE ?) links,
            (SELECT COUNT(*) FROM outbox_messages WHERE destination_id=?) outbox,
            (SELECT COUNT(*) FROM canonical_owned_pet_title_instances WHERE player_id=? AND ownership_status='owned') owned`,
    [`${prefix}%`, `%${prefix}%`, `%${prefix}%`, `${prefix}%`, room, ids.canonicalPlayer],
  ))[0]!;
}

describe("PET-TITLE admin batch app-wiring MariaDB", { skip: !enabled }, () => {
  before(async () => {
    assert.match(process.env.DATABASE_NAME ?? "", /^hoibot_wbs743_(?:it|test)[a-z0-9_]*$/, "PET_TITLE batch test requires a dedicated WBS743 schema");
    db = createDatabaseClient({ enabled: true, host: process.env.DATABASE_HOST!, port: Number(process.env.DATABASE_PORT), user: process.env.DATABASE_USER!, password: process.env.DATABASE_PASSWORD!, name: process.env.DATABASE_NAME!, connectionLimit: 6, connectTimeoutMs: 5000 });
    originalRollout = (await db.query<Array<{ rollout_state: string; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code='ADMIN_PET_TITLE_STORE_RESET'"))[0];
    const audit = ["test:pet-title-admin", "2026-09-05 12:00:00", "test:pet-title-admin", "2026-09-05 12:00:00"];
    const player = await db.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const account = await db.execute("INSERT INTO user_accounts(login_id,password_hash,system_account_name,gender_code,status) VALUES (?,'synthetic',?,'unspecified','active')", [`${prefix}-login`, `${prefix}-account`]);
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,terms_agreed,version) VALUES (?,'배치운영자',TRUE,1)", [player.insertId]);
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'배치운영자','linked')", [player.insertId, external]);
    const identity = (await db.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [external]))[0]!.id;
    const operator = await db.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'배치운영자','synthetic','active')", [`${prefix}-admin`]);
    const role = (await db.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='manager'"))[0]!.id;
    await db.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.insertId, identity]);
    await db.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.insertId, role]);
    await db.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,'LEGACY_DB',?,?,?,?,?)", [ids.canonicalPlayer, player.insertId.toString(), ...audit]);
    await db.execute("INSERT INTO canonical_portal_accounts(portal_account_id,legacy_user_account_id,portal_account_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'ACTIVE',?,?,?,?)", [ids.portal, account.insertId, ...audit]);
    await db.execute("INSERT INTO portal_game_account_links(portal_game_account_link_id,portal_account_id,player_id,player_role,registration_sequence,link_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'REPRESENTATIVE',1,'ACTIVE',?,?,?,?)", [ids.link, ids.portal, player.insertId, ...audit]);
    await db.execute("INSERT INTO account_platform_identities(platform_identity_id,portal_account_id,platform_code,identity_scope_key,external_user_key,identity_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,'KAKAO',?,?,'ACTIVE',?,?,?,?)", [ids.identity, ids.portal, room, external, ...audit]);
    await db.execute("INSERT INTO account_platform_contexts(platform_context_id,platform_code,context_type,external_context_key,context_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,'KAKAO','ROOM',?,'ACTIVE',?,?,?,?)", [ids.context, room, ...audit]);
    await db.execute("INSERT INTO account_platform_context_memberships(platform_context_membership_id,platform_identity_id,platform_context_id,membership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'ACTIVE',?,?,?,?)", [ids.membership, ids.identity, ids.context, ...audit]);
    await db.execute("INSERT INTO account_platform_active_player_selections(active_player_selection_id,platform_context_membership_id,portal_game_account_link_id,active_player_id,selection_status,selection_version,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,'ACTIVE',1,?,?,?,?)", [ids.selection, ids.membership, ids.link, player.insertId, ...audit]);
    await db.execute("INSERT INTO canonical_pet_title_definitions(pet_title_id,title_name,base_sale_price,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,'배치대상',0,TRUE,?,?,?,?)", [ids.title, ...audit]);
    await db.execute("INSERT INTO canonical_owned_pet_title_instances(owned_pet_title_id,player_id,pet_title_id,acquisition_sequence,acquired_time,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,1,'2026-09-05 12:00:00','owned',?,?,?,?)", [ids.ownedOne, ids.canonicalPlayer, ids.title, ...audit]);
    await db.execute("INSERT INTO canonical_pet_title_selections(player_id,owned_pet_title_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?)", [ids.canonicalPlayer, ids.ownedOne, ...audit]);
    for (const eventId of eventIds) await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('a',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, external]);
  });

  after(async () => {
    if (db !== undefined) {
      if (originalRollout !== undefined) await db.execute("UPDATE command_registry SET rollout_state=?,enabled=? WHERE command_code='ADMIN_PET_TITLE_STORE_RESET'", [originalRollout.rollout_state, originalRollout.enabled]);
      await db.close();
    }
  });

  it("keeps SHADOW DML-free, rejects child-evidence drift, and replays after provider restart", async () => {
    const service = await ingress(), shadowBefore = await counts();
    assert.deepEqual(await service.reset({ eventId: eventIds[0]!, externalUserId: external, channelId: room, message: "/펫타이틀파일생성" }), { status: "shadow" });
    assert.deepEqual(await counts(), shadowBefore);
    const audit = ["test:pet-title-admin", "2026-09-05 12:00:00", "test:pet-title-admin", "2026-09-05 12:00:00"];
    await db.execute("INSERT INTO canonical_owned_pet_title_instances(owned_pet_title_id,player_id,pet_title_id,acquisition_sequence,acquired_time,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,2,'2026-09-05 12:00:00','owned',?,?,?,?)", [ids.ownedTwo, ids.canonicalPlayer, ids.title, ...audit]);
    await assertFixtureIsolation(2);
    await db.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_PET_TITLE_STORE_RESET'");
    const first = await service.reset({ eventId: eventIds[1]!, externalUserId: external, channelId: room, message: "/펫타이틀파일생성" });
    assert.equal(first.status, "changed");
    const afterFirst = await counts();
    assert.deepEqual([afterFirst.batches, afterFirst.targets, afterFirst.links, afterFirst.owned], [1n, 2n, 1n, 0n]);
    const batch = (await db.query<Array<{ pet_title_batch_operation_id: string }>>("SELECT pet_title_batch_operation_id FROM canonical_pet_title_batch_operations WHERE request_key=?", [`IRIS:${eventIds[1]}`]))[0]!;
    const target = (await db.query<Array<{ selection_status_before: string; reason_type: string }>>("SELECT selection_status_before,reason_type FROM canonical_pet_title_batch_operation_targets WHERE pet_title_batch_operation_id=? AND owned_pet_title_id=?", [batch.pet_title_batch_operation_id, ids.ownedOne]))[0]!;
    assert.deepEqual(target, { selection_status_before: "SELECTED", reason_type: "ADMIN_RESET" });
    await db.execute("UPDATE canonical_pet_title_batch_operation_targets SET selection_status_before='NOT_SELECTED' WHERE pet_title_batch_operation_id=? AND owned_pet_title_id=?", [batch.pet_title_batch_operation_id, ids.ownedOne]);
    await assert.rejects(() => ingress().then((restarted) => restarted.reset({ eventId: eventIds[1]!, externalUserId: external, channelId: room, message: "/펫타이틀파일생성" })), /PET_TITLE_BATCH_(?:TARGET|RESULT)_DRIFT/);
    await db.execute("UPDATE canonical_pet_title_batch_operation_targets SET selection_status_before='SELECTED' WHERE pet_title_batch_operation_id=? AND owned_pet_title_id=?", [batch.pet_title_batch_operation_id, ids.ownedOne]);
    await db.execute("UPDATE canonical_pet_title_batch_operation_targets SET reason_type='ADMIN_SYNC' WHERE pet_title_batch_operation_id=? AND owned_pet_title_id=?", [batch.pet_title_batch_operation_id, ids.ownedTwo]);
    await assert.rejects(() => ingress().then((restarted) => restarted.reset({ eventId: eventIds[1]!, externalUserId: external, channelId: room, message: "/펫타이틀파일생성" })), /PET_TITLE_BATCH_TARGET_INVALID/);
    await db.execute("UPDATE canonical_pet_title_batch_operation_targets SET reason_type='ADMIN_RESET' WHERE pet_title_batch_operation_id=? AND owned_pet_title_id=?", [batch.pet_title_batch_operation_id, ids.ownedTwo]);
    await assert.rejects(() => db.execute("UPDATE canonical_pet_title_batch_operation_participants SET participant_role='OWNER' WHERE pet_title_batch_operation_id=?", [batch.pet_title_batch_operation_id]), /CONSTRAINT|chk_odbt_472_02_rule_01/i);
    await db.execute("UPDATE canonical_pet_title_batch_operation_participants SET affected_title_count=1 WHERE pet_title_batch_operation_id=?", [batch.pet_title_batch_operation_id]);
    await assert.rejects(() => ingress().then((restarted) => restarted.reset({ eventId: eventIds[1]!, externalUserId: external, channelId: room, message: "/펫타이틀파일생성" })), /PET_TITLE_BATCH_PARTICIPANT_DRIFT/);
    await db.execute("UPDATE canonical_pet_title_batch_operation_participants SET affected_title_count=2 WHERE pet_title_batch_operation_id=?", [batch.pet_title_batch_operation_id]);
    const replay = await (await ingress()).reset({ eventId: eventIds[1]!, externalUserId: external, channelId: room, message: "/펫타이틀파일생성" });
    assert.equal(replay.status, "changed");
    assert.deepEqual(await counts(), afterFirst);
  });

  it("serializes reset on the shared PET_TITLE scope before selection and ownership", async () => {
    const audit = ["test:pet-title-admin", "2026-09-05 12:00:00", "test:pet-title-admin", "2026-09-05 12:00:00"];
    await db.execute("INSERT INTO canonical_owned_pet_title_instances(owned_pet_title_id,player_id,pet_title_id,acquisition_sequence,acquired_time,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,3,'2026-09-05 12:00:00','owned',?,?,?,?)", [ids.ownedThree, ids.canonicalPlayer, ids.title, ...audit]);
    await assertFixtureIsolation(1);
    const blocker = await mariadb.createConnection({ host: process.env.DATABASE_HOST!, port: Number(process.env.DATABASE_PORT), user: process.env.DATABASE_USER!, password: process.env.DATABASE_PASSWORD!, database: process.env.DATABASE_NAME!, bigIntAsNumber: false });
    try {
      await blocker.beginTransaction();
      await blocker.query("SELECT pet_title_global_lock_id FROM canonical_pet_title_global_locks WHERE lock_key='PET_TITLE' FOR UPDATE");
      const running = (await ingress()).reset({ eventId: eventIds[2]!, externalUserId: external, channelId: room, message: "/펫타이틀파일생성" });
      const state = await Promise.race([running.then(() => "settled", () => "rejected"), new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 200))]);
      assert.equal(state, "waiting");
      await blocker.commit();
      const result = await running;
      assert.equal(result.status, "changed");
      assert.equal((await counts()).owned, 0n);
    } finally {
      try { await blocker.rollback(); } finally { await blocker.end(); }
    }
  });
});
