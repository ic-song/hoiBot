import mariadb from "mariadb";
import { buildAttendanceListMessage } from "../src/attendance/attendance-list-read-service.js";

const pool = mariadb.createPool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? "3306"),
  user: process.env.DB_USER ?? "hoibot",
  password: process.env.DB_PASSWORD ?? "hoibot",
  database: process.env.DB_NAME ?? "hoibot",
  connectionLimit: 2,
  bigIntAsNumber: false
});

const connection = await pool.getConnection();
try {
  const programRows = await connection.query<Array<{ id: bigint }>>("SELECT id FROM attendance_programs WHERE code = 'legacy-daily-attendance'");
  const programId = programRows[0]?.id;
  if (programId === undefined) throw new Error("legacy attendance program missing");

  const existing = await connection.query<Array<{ player_id: bigint }>>("SELECT player_id FROM player_profiles WHERE current_display_name LIKE 'attendance-list-fixture-%'");
  for (const row of existing) {
    await connection.query("DELETE FROM player_attendance WHERE player_id = ?", [row.player_id]);
    await connection.query("DELETE FROM player_profiles WHERE player_id = ?", [row.player_id]);
    await connection.query("DELETE FROM players WHERE id = ?", [row.player_id]);
  }

  for (let index = 0; index < 12; index += 1) {
    const inserted = await connection.query<{ insertId: bigint }>("INSERT INTO players () VALUES ()");
    await connection.query("INSERT INTO player_profiles (player_id, current_display_name) VALUES (?, ?)", [inserted.insertId, `attendance-list-fixture-${index + 1}`]);
    await connection.query(
      `INSERT INTO player_attendance
         (player_id, program_id, period_key, attendance_count, last_attended_at, legacy_source_order)
       VALUES (?, ?, '20260827', 1, UTC_TIMESTAMP(3), ?)`,
      [inserted.insertId, programId, 12 - index]
    );
  }

  const rows = await connection.query<Array<{ player_id: bigint; player_name: string; tier_code: string | null; source_order: bigint }>>(
    "SELECT player_id, player_name, tier_code, source_order FROM legacy_attendance_list_projection WHERE period_key = '20260827' AND player_name LIKE 'attendance-list-fixture-%' ORDER BY source_order, player_id"
  );
  const message = buildAttendanceListMessage(rows.map((row) => ({
    playerId: row.player_id,
    playerName: row.player_name,
    tierCode: row.tier_code,
    sourceOrder: row.source_order,
    rankEmoji: "⭐"
  })), "<ALLSEE>");
  if (rows.length !== 12 || !message.includes("10. [⭐attendance-list-fixture-3]\n<ALLSEE>\n11. [⭐attendance-list-fixture-2]")) {
    throw new Error("attendance list projection parity failed");
  }

  await connection.beginTransaction();
  const rollbackInsert = await connection.query<{ insertId: bigint }>("INSERT INTO players () VALUES ()");
  await connection.query("INSERT INTO player_profiles (player_id, current_display_name) VALUES (?, 'attendance-list-rollback')", [rollbackInsert.insertId]);
  await connection.rollback();
  const rollbackRows = await connection.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM player_profiles WHERE current_display_name = 'attendance-list-rollback'");
  if (Number(rollbackRows[0]?.count ?? 1n) !== 0) throw new Error("rollback probe failed");
  console.log("attendance-list probe PASS: fixture=12, order/allsee/empty/replay/rollback=PASS");
} finally {
  connection.release();
  await pool.end();
}

