import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { HomeBadgeInventoryService } from "../src/home/home-badge-inventory-service.js";

const enabled = process.env.HOME_BADGE_INVENTORY_SHADOW_TEST === "true";
const database = enabled ? createDatabaseClient(loadConfig().database) : null;
const service = database === null ? null : new HomeBadgeInventoryService(database);
after(async () => { if (database !== null) await database.close(); });

describe("home badge inventory Shadow", { skip: !enabled }, () => {
  it("keeps 204 ordering, status icons, allsee and stored replay", async () => {
    assert.ok(service !== null);
    const all = await service.execute({
      eventId: "badge-shadow-all", externalUserId: "home-badge-inventory-user",
      destinationId: "isolated-home-badge-room", message: "/홈뱃지전체"
    });
    assert.equal(all.message.split("\n").filter((line) => /^(✅|▫️|🗑) \[/.test(line)).length, 204);
    assert.match(all.message, /✅ \[F01\]/);
    assert.match(all.message, /▫️ \[LOVE50\]/);
    assert.match(all.message, /​{500}/);
    const replay = await service.execute({
      eventId: "badge-shadow-all", externalUserId: "home-badge-inventory-user",
      destinationId: "isolated-home-badge-room", message: "/홈뱃지전체"
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.message, all.message);
  });
});
