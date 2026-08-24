import { createDatabaseClient } from "../src/database.js";
import { HomeUpgradeService } from "../src/home/home-upgrade-service.js";

const database = createDatabaseClient({
  enabled: true,
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? "13307"),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  name: process.env.DB_NAME ?? "hoibot",
  connectionLimit: 2,
  connectTimeoutMs: 5000
});

try {
  await database.execute(
    `INSERT IGNORE INTO event_inbox (event_id, event_kind, processing_status, received_at)
     VALUES ('home-upgrade-preview-v1', 'message', 'processing', UTC_TIMESTAMP(3)),
            ('home-upgrade-execute-v1', 'message', 'processing', UTC_TIMESTAMP(3))`
  );
  const service = new HomeUpgradeService(database);
  const preview = await service.handle({ externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room", message: "/집짓기", eventId: "home-upgrade-preview-v1" });
  const execute = await service.handle({ externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room", message: "/집뚝딱", eventId: "home-upgrade-execute-v1" });
  const replay = await service.handle({ externalUserId: "synthetic-admin-alpha", channelId: "synthetic-room", message: "/집뚝딱", eventId: "home-upgrade-execute-v1" });
  if (preview.status !== "completed" || execute.status !== "completed" || JSON.stringify(execute) !== JSON.stringify(replay)) throw new Error("home upgrade probe mismatch");
  const rows = await database.query<Array<{ floor_area: bigint; pet_exp: bigint; pending_status: string; ledger_count: bigint }>>(
    `SELECT home.floor_area, pet.experience AS pet_exp, confirmation.status AS pending_status,
            (SELECT COUNT(*) FROM inventory_ledger ledger WHERE ledger.reason_code = 'home_upgrade' AND ledger.player_id = home.player_id) AS ledger_count
     FROM player_homes home JOIN player_pets pet ON pet.player_id = home.player_id
     JOIN home_upgrade_confirmations confirmation ON confirmation.player_id = home.player_id WHERE home.player_id = 900000001`
  );
  const row = rows[0];
  if (row?.floor_area !== 1n || row.pet_exp !== 100n || row.pending_status !== "consumed" || row.ledger_count !== 2n) throw new Error("home upgrade database delta mismatch");
  console.log(JSON.stringify({ preview: preview.status, execute: execute.status, replay: true, floor: row.floor_area.toString(), petExp: row.pet_exp.toString(), ledgers: row.ledger_count.toString() }));
} finally {
  await database.close();
}
