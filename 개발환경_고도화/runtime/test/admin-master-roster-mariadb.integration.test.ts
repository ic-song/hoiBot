import assert from "node:assert/strict";
import { it } from "node:test";
import mariadb from "mariadb";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { AdminMasterRosterService } from "../src/admin/master-roster-service.js";

const enabled = process.env.HOIBOT_ISOLATED_MARIADB === "1";

it("lists and removes a catalogued master with durable replay", { skip: !enabled }, async () => {
  const pool = mariadb.createPool({ host: process.env.MARIADB_HOST!, port: Number(process.env.MARIADB_PORT),
    user: process.env.MARIADB_USER!, password: process.env.MARIADB_PASSWORD!, database: process.env.MARIADB_DATABASE!,
    connectionLimit: 2, bigIntAsNumber: false });
  const database = {
    async withTransaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const transaction = {
          query: async <R>(sql: string, params?: unknown[]) => connection.query(sql, params) as Promise<R>,
          execute: async (sql: string, params?: unknown[]): Promise<DatabaseWriteResult> => {
            const result = await connection.query(sql, params) as { affectedRows?: number | bigint; insertId?: number | bigint };
            return { affectedRows: BigInt(result.affectedRows ?? 0), insertId: BigInt(result.insertId ?? 0) };
          }
        } as DatabaseTransaction;
        const result = await work(transaction);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  } as DatabaseClient;

  try {
    const connection = await pool.getConnection();
    try {
      await connection.query("INSERT INTO players(id) VALUES(1),(2)");
      await connection.query("INSERT INTO player_profiles(player_id,current_display_name) VALUES(1,'총괄'),(2,'대상')");
      await connection.query("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES(91,1,'kakao','master-user','linked'),(92,2,'kakao','target-user','linked')");
      await connection.query("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES(7,'master','총괄','fixture','active'),(8,'target','대상','fixture','active')");
      await connection.query("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES(7,91),(8,92)");
      await connection.query("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 7,id FROM admin_roles WHERE code='super_admin'");
      await connection.query("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 8,id FROM admin_roles WHERE code='super_admin'");
      await connection.query("INSERT INTO admin_sessions(operator_id,token_hash,csrf_secret_hash,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(8,REPEAT('a',64),REPEAT('b',64),UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 HOUR))");
      await connection.query("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES('master-list-1','message','processed',UTC_TIMESTAMP(3)),('master-remove-1','message','processed',UTC_TIMESTAMP(3))");
    } finally {
      connection.release();
    }

    const service = new AdminMasterRosterService(database);
    const listed = await service.execute({ externalUserId: "master-user", channelId: "room",
      eventId: "master-list-1", message: "/마스터명단" });
    const removed = await service.execute({ externalUserId: "master-user", channelId: "room",
      eventId: "master-remove-1", message: "/마스터제거, 대상" });
    const replay = await service.execute({ externalUserId: "master-user", channelId: "room",
      eventId: "master-remove-1", message: "/마스터제거, 대상" });
    assert.equal(listed.masterCount, 2);
    assert.equal(removed.operatorDisabled, true);
    assert.equal(replay.replayed, true);

    const verification = await pool.getConnection();
    try {
      const rows = await verification.query<Array<{ target_master_roles: bigint; inactive: bigint; revoked_sessions: bigint;
        history: bigint; operations: bigint; outbox: bigint }>>(
        `SELECT
          (SELECT COUNT(*) FROM admin_operator_roles assignment JOIN admin_roles role ON role.id=assignment.role_id WHERE assignment.operator_id=8 AND role.code='super_admin') target_master_roles,
          (SELECT COUNT(*) FROM admin_operators WHERE id=8 AND status='inactive') inactive,
          (SELECT COUNT(*) FROM admin_sessions WHERE operator_id=8 AND revoked_at IS NOT NULL) revoked_sessions,
          (SELECT COUNT(*) FROM admin_role_assignment_history WHERE target_operator_id=8 AND action_code='revoked') history,
          (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'admin.master-roster:%') operations,
          (SELECT COUNT(*) FROM outbox_messages) outbox`
      );
      assert.deepEqual([
        Number(rows[0]!.target_master_roles), Number(rows[0]!.inactive), Number(rows[0]!.revoked_sessions),
        Number(rows[0]!.history), Number(rows[0]!.operations), Number(rows[0]!.outbox)
      ], [0, 1, 1, 1, 2, 2]);
    } finally {
      verification.release();
    }
  } finally {
    await pool.end();
  }
});
