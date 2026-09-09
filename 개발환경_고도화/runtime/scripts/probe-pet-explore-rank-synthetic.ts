import mariadb from "mariadb";
import { buildPetExploreRankMessage } from "../src/pet/pet-explore-rank-service.js";

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
  await connection.beginTransaction();
  await connection.query("DELETE FROM player_pet_explore_rank_stats");
  for (let index = 0; index < 31; index += 1) {
    const playerName = `fixture-${String(index).padStart(2, "0")}`;
    const win = index === 30 ? 29 : 60 - Math.floor(index / 2);
    const lose = index % 3;
    await connection.query(
      `INSERT INTO player_pet_explore_rank_stats
         (player_name, win_count, lose_count, source_order)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE win_count = VALUES(win_count), lose_count = VALUES(lose_count), source_order = VALUES(source_order)`,
      [playerName, win, lose, index]
    );
  }
  await connection.commit();

  const rows = await connection.query<Array<{ player_name: string; win_count: bigint; lose_count: bigint }>>(
    "SELECT player_name, win_count, lose_count FROM player_pet_explore_rank_stats WHERE win_count >= 30"
  );
  const message = buildPetExploreRankMessage(rows.map((row) => ({
    playerName: row.player_name,
    win: Number(row.win_count),
    lose: Number(row.lose_count),
    rankLabel: row.player_name
  })), { allsee: "<ALLSEE>", nextIntervalText: "NEXT" });
  if (!message.includes("<ALLSEE>") || !message.endsWith("NEXT")) throw new Error("rank message parity failed");

  await connection.beginTransaction();
  await connection.query("INSERT INTO player_pet_explore_rank_stats (player_name, win_count, lose_count, source_order) VALUES ('rollback-probe', 99, 0, 999)");
  await connection.rollback();
  const rollbackRows = await connection.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM player_pet_explore_rank_stats WHERE player_name = 'rollback-probe'");
  if (Number(rollbackRows[0]?.count ?? 1n) !== 0) throw new Error("rollback probe failed");

  const countRows = await connection.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM player_pet_explore_rank_stats");
  if (Number(countRows[0]?.count ?? 0n) !== 31) throw new Error("fixture or replay count mismatch");
  console.log("pet-explore-rank probe PASS: fixture=31, eligible=30, allsee/replay/rollback=PASS");
} finally {
  connection.release();
  await pool.end();
}

