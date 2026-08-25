import assert from "node:assert/strict";
import { it } from "node:test";
import mariadb from "mariadb";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { TerritoryProtectionGrantService } from "../src/admin/territory-protection-grant-service.js";

const enabled = process.env.HOIBOT_ISOLATED_MARIADB === "1";
it("grants both territory tickets atomically and replays without duplication", { skip: !enabled }, async () => {
  const pool = mariadb.createPool({ host: process.env.MARIADB_HOST!, port: Number(process.env.MARIADB_PORT), user: process.env.MARIADB_USER!, password: process.env.MARIADB_PASSWORD!, database: process.env.MARIADB_DATABASE!, connectionLimit: 2, bigIntAsNumber: false });
  const database = { async withTransaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> { const c = await pool.getConnection(); try { await c.beginTransaction(); const tx = { query: async <R>(s: string, p?: unknown[]) => c.query(s, p) as Promise<R>, execute: async (s: string, p?: unknown[]): Promise<DatabaseWriteResult> => { const r = await c.query(s, p) as { affectedRows?: number | bigint; insertId?: number | bigint }; return { affectedRows: BigInt(r.affectedRows ?? 0), insertId: BigInt(r.insertId ?? 0) }; } } as DatabaseTransaction; const result = await work(tx); await c.commit(); return result; } catch (error) { await c.rollback(); throw error; } finally { c.release(); } } } as DatabaseClient;
  try {
    const c = await pool.getConnection(); try {
      await c.query("INSERT INTO players(id) VALUES(1),(2)");
      await c.query("INSERT INTO player_profiles(player_id,current_display_name) VALUES(1,'관리자'),(2,'대상')");
      await c.query("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES(91,1,'kakao','admin-user','linked')");
      await c.query("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES(7,'territory-admin','공방관리자','fixture','active')");
      await c.query("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES(7,91)");
      await c.query("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT 7,id FROM admin_roles WHERE code='super_admin'");
      await c.query("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES('territory-grant-1','message','processed',UTC_TIMESTAMP(3))");
    } finally { c.release(); }
    const service = new TerritoryProtectionGrantService(database);
    const command = { externalUserId: "admin-user", channelId: "territory-room", eventId: "territory-grant-1", message: "/공방3, 대상" };
    const first = await service.execute(command); const replay = await service.execute(command);
    assert.equal(first.grantQuantity, "3"); assert.equal(replay.replayed, true);
    const v = await pool.getConnection(); try {
      const rows = await v.query<Array<{ code: string; quantity: bigint }>>("SELECT item.code,stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=2 ORDER BY item.code");
      const counts = await v.query<Array<{ ledgers: bigint; operations: bigint; outbox: bigint; audits: bigint }>>("SELECT (SELECT COUNT(*) FROM inventory_ledger) ledgers,(SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'admin.territory-protection-grant:%') operations,(SELECT COUNT(*) FROM outbox_messages) outbox,(SELECT COUNT(*) FROM command_audit WHERE action_code='territory.protection.grant') audits");
      assert.deepEqual(rows.map((row) => [row.code, Number(row.quantity)]), [["legacy-territory-absolute-defense-ticket", 3], ["legacy-territory-surprise-attack-ticket", 3]]);
      assert.deepEqual([Number(counts[0]!.ledgers), Number(counts[0]!.operations), Number(counts[0]!.outbox), Number(counts[0]!.audits)], [2, 1, 1, 1]);
    } finally { v.release(); }
  } finally { await pool.end(); }
});
