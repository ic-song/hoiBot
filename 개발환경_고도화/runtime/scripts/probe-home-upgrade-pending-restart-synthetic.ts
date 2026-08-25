import assert from "node:assert/strict";
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
const phase = process.argv[2];
const service = new HomeUpgradeService(database);

// 재기동 전후 독립 실행 event의 inbox FK를 준비합니다.
async function seedEvent(eventId: string): Promise<void> {
  await database.execute(
    "INSERT IGNORE INTO event_inbox (event_id, event_kind, processing_status, received_at) VALUES (?, 'message', 'processing', UTC_TIMESTAMP(3))",
    [eventId]
  );
}

try {
  if (phase === "prepare") {
    await database.execute("DELETE FROM home_upgrade_confirmations WHERE player_id=900000001");
    await database.execute("UPDATE home_upgrade_definitions SET version=1, active=TRUE WHERE floor_area IN (1,2)");
    await database.execute("UPDATE player_homes SET floor_area=0, base_experience=0, version=version+1 WHERE player_id=900000001");
    await database.execute("UPDATE player_pets SET experience=0, version=version+1 WHERE player_id=900000001");
    await database.execute(
      `UPDATE inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
       SET stack.quantity=CASE item.code WHEN 'synthetic-home-wood' THEN 10 ELSE 5 END, stack.version=stack.version+1
       WHERE stack.player_id=900000001 AND item.code IN ('synthetic-home-wood','synthetic-home-stone')`
    );
    await seedEvent("home-upgrade-pending-restart-preview");
    const result = await service.handle({ externalUserId: "synthetic-admin-alpha", channelId: "synthetic-home-restart", message: "/집짓기", eventId: "home-upgrade-pending-restart-preview" });
    assert.equal(result.status, "completed");
    const pending = await database.query<Array<{ status: string }>>("SELECT status FROM home_upgrade_confirmations WHERE player_id=900000001");
    assert.equal(pending[0]?.status, "pending");
    console.log(JSON.stringify({ phase, pending: true }));
  } else if (phase === "resume") {
    await seedEvent("home-upgrade-pending-restart-execute");
    const result = await service.handle({ externalUserId: "synthetic-admin-alpha", channelId: "synthetic-home-restart", message: "/집뚝딱", eventId: "home-upgrade-pending-restart-execute" });
    assert.equal(result.status, "completed");
    const rows = await database.query<Array<{ floor_area: bigint; pet_exp: bigint; status: string }>>(
      `SELECT home.floor_area, pet.experience AS pet_exp, confirmation.status
       FROM player_homes home JOIN player_pets pet ON pet.player_id=home.player_id
       JOIN home_upgrade_confirmations confirmation ON confirmation.player_id=home.player_id
       WHERE home.player_id=900000001`
    );
    assert.equal(BigInt(rows[0]!.floor_area), 1n);
    assert.equal(BigInt(rows[0]!.pet_exp), 100n);
    assert.equal(rows[0]!.status, "consumed");
    console.log(JSON.stringify({ phase, floor: "1", petExp: "100", pending: "consumed" }));
  } else {
    throw new Error("phase must be prepare or resume");
  }
} finally {
  await database.close();
}
