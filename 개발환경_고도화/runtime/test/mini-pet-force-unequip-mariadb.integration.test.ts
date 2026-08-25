import assert from "node:assert/strict";
import { it } from "node:test";
import mariadb from "mariadb";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MiniPetForceUnequipService } from "../src/mini-pet/force-unequip-service.js";

const enabled = process.env.HOIBOT_ISOLATED_MARIADB === "1";

it("force-unequips one stable pet once and preserves it in the bag", { skip: !enabled }, async () => {
  const pool = mariadb.createPool({ host: process.env.MARIADB_HOST!, port: Number(process.env.MARIADB_PORT),
    user: process.env.MARIADB_USER!, password: process.env.MARIADB_PASSWORD!, database: process.env.MARIADB_DATABASE!,
    connectionLimit: 2, bigIntAsNumber: false });
  const database = { async withTransaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const tx = { query: async <R>(sql: string, parameters?: unknown[]) => connection.query(sql, parameters) as Promise<R>,
        execute: async (sql: string, parameters?: unknown[]): Promise<DatabaseWriteResult> => {
          const result = await connection.query(sql, parameters) as { affectedRows?: number | bigint; insertId?: number | bigint };
          return { affectedRows: BigInt(result.affectedRows ?? 0), insertId: BigInt(result.insertId ?? 0) };
        } } as DatabaseTransaction;
      const result = await work(tx); await connection.commit(); return result;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  } } as DatabaseClient;

  try {
    const connection = await pool.getConnection();
    try {
      await connection.query("INSERT INTO players(id) VALUES(1)");
      await connection.query("INSERT INTO player_profiles(player_id,current_display_name) VALUES(1,'강제해제대상')");
      await connection.query("INSERT INTO external_identities(id,provider_code,external_user_id,status) VALUES(71,'kakao','force-admin','linked')");
      await connection.query("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES(71,'force-admin','강제해제 운영자','hash','active')");
      await connection.query("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES(71,71)");
      await connection.query("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 71,id FROM admin_roles WHERE code='super_admin'");
      await connection.query("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES('force-event','message','processed',UTC_TIMESTAMP(3))");
      await connection.query("INSERT INTO mini_pet_projection_environment_identity(singleton_id,environment_code,database_identity) VALUES(1,'dev','00000000-0000-0000-0000-000000000057')");
      await connection.query("INSERT INTO mini_pet_definitions(id,code,display_name) VALUES(900071,'force-equipped','장착펫')");
      await connection.query("INSERT INTO owned_mini_pets(id,player_id,mini_pet_definition_id,custom_name,equipped) VALUES(700071,1,900071,'장착펫',TRUE)");
      await connection.query("INSERT INTO mini_pet_inventory_player_states(player_id,bag_shape_code,capacity_limit) VALUES(1,'array',100)");
      await connection.query("INSERT INTO mini_pet_inventory_owned_states(owned_mini_pet_id,player_id,stable_owned_id,sort_index) VALUES(700071,1,'00000000-0000-0000-0000-000000700071',NULL)");
      await connection.query("INSERT INTO mini_pet_owned_lifecycle(owned_mini_pet_id,player_id,state_code) VALUES(700071,1,'active')");
    } finally { connection.release(); }

    const service = new MiniPetForceUnequipService(database);
    const input = { externalUserId: "force-admin", channelId: "force-room", eventId: "force-event",
      message: "/미니펫해제 강제해제대상", environmentCode: "dev" as const };
    const first = await service.execute(input); const replay = await service.execute(input);
    assert.equal(first.status, "unequipped"); assert.equal(first.afterSortIndex, 1); assert.equal(replay.replayed, true);

    const verify = await pool.getConnection();
    try {
      const owned = await verify.query<Array<{ equipped: number }>>("SELECT equipped FROM owned_mini_pets WHERE id=700071");
      const state = await verify.query<Array<{ stable_owned_id: string; sort_index: number }>>("SELECT stable_owned_id,sort_index FROM mini_pet_inventory_owned_states WHERE owned_mini_pet_id=700071");
      const events = await verify.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM mini_pet_force_unequip_events");
      const operations = await verify.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope='mini_pet.force_unequip:71'");
      const outbox = await verify.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM outbox_messages");
      assert.equal(Boolean(owned[0]!.equipped), false);
      assert.equal(state[0]!.stable_owned_id, "00000000-0000-0000-0000-000000700071"); assert.equal(state[0]!.sort_index, 1);
      assert.equal(Number(events[0]!.count_value), 1); assert.equal(Number(operations[0]!.count_value), 1); assert.equal(Number(outbox[0]!.count_value), 1);
    } finally { verify.release(); }
  } finally { await pool.end(); }
});
