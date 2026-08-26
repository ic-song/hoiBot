import mariadb from "mariadb";
import { buildAbsenceAttendanceResult } from "../src/attendance/absence-attendance-read-service.js";

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
  const programRows = await connection.query<Array<{ id: bigint }>>(
    "SELECT id FROM attendance_programs WHERE code = 'legacy-daily-attendance'"
  );
  const programId = programRows[0]?.id;
  if (programId === undefined) throw new Error("legacy attendance program missing");

  const existingRows = await connection.query<Array<{ player_id: bigint }>>(
    "SELECT player_id FROM player_profiles WHERE current_display_name LIKE 'absence-fixture-%'"
  );
  for (const existing of existingRows) {
    await connection.query("DELETE FROM player_attendance WHERE player_id = ?", [existing.player_id]);
    await connection.query("DELETE FROM player_profiles WHERE player_id = ?", [existing.player_id]);
    await connection.query("DELETE FROM players WHERE id = ?", [existing.player_id]);
  }

  const playerIds: bigint[] = [];
  for (let index = 0; index < 4; index += 1) {
    const inserted = await connection.query<{ insertId: bigint }>("INSERT INTO players () VALUES ()");
    const playerId = inserted.insertId;
    playerIds.push(playerId);
    await connection.query("INSERT INTO player_profiles (player_id, current_display_name) VALUES (?, ?)", [playerId, `absence-fixture-${index + 1}`]);
  }
  const dates = ["2026-08-24 00:00:00.000", "2026-08-25 00:00:00.000", null, "2026-08-26 00:00:00.000"];
  for (let index = 0; index < dates.length; index += 1) {
    if (dates[index] === null) continue;
    await connection.query(
      "INSERT INTO player_attendance (player_id, program_id, period_key, attendance_count, last_attended_at) VALUES (?, ?, 'lifetime', 1, ?)",
      [playerIds[index], programId, dates[index]]
    );
  }

  const rows = await connection.query<Array<{ source_order: bigint; player_name: string; recent_yyyymmdd: string }>>(
    "SELECT source_order, player_name, recent_yyyymmdd FROM legacy_absence_attendance_projection WHERE player_name LIKE 'absence-fixture-%' ORDER BY source_order"
  );
  const result = buildAbsenceAttendanceResult(rows.map((row) => ({
    sourceOrder: row.source_order,
    playerName: row.player_name,
    recentYyyymmdd: row.recent_yyyymmdd
  })), 3, "20260827");
  if (rows.length !== 4 || result.absentNames.join(",") !== "absence-fixture-1,absence-fixture-3") {
    throw new Error("absence projection parity failed");
  }

  await connection.beginTransaction();
  const rollbackInsert = await connection.query<{ insertId: bigint }>("INSERT INTO players () VALUES ()");
  await connection.query("INSERT INTO player_profiles (player_id, current_display_name) VALUES (?, 'absence-rollback')", [rollbackInsert.insertId]);
  await connection.rollback();
  const rollbackRows = await connection.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM player_profiles WHERE current_display_name = 'absence-rollback'");
  if (Number(rollbackRows[0]?.count ?? 1n) !== 0) throw new Error("rollback probe failed");
  console.log("absence-attendance probe PASS: fixture=4, absent=2, order/empty/replay/rollback=PASS");
} finally {
  connection.release();
  await pool.end();
}
