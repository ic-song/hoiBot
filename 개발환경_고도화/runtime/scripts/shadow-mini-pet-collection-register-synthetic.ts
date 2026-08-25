import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MiniPetCollectionRegisterService } from "../src/mini-pet/collection-register-service.js";
import { MariaMiniPetCollectionRegisterRepository } from "../src/mini-pet/maria-collection-register-repository.js";

const token = process.env.MINIPET_COLLECTION_CONFIRM_TOKEN;
if (token === undefined || token === "") throw new Error("MINIPET_COLLECTION_CONFIRM_TOKEN is required.");
const database = createDatabaseClient(loadConfig().database);
const service = new MiniPetCollectionRegisterService(new MariaMiniPetCollectionRegisterRepository(database));

try {
  const replay = await service.handle({
    externalUserId: "synthetic-collection-register", channelId: "synthetic-room-384",
    eventId: "collection-confirm-384", message: `/컬렉션등록 확인 ${token}`
  });
  assert.equal(replay.status, "registered");
  assert.equal(replay.pointCost, "2000");
  const rows = await database.query<Array<{ registrations: bigint; pets: bigint; food: bigint; point: string }>>(
    `SELECT
      (SELECT COUNT(*) FROM mini_pet_collection_registration_ledger WHERE player_id = 960000384) registrations,
      (SELECT COUNT(*) FROM owned_mini_pets WHERE player_id = 960000384) pets,
      (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = 960000384 AND item.code = 'pet_food') food,
      (SELECT balance FROM currency_accounts WHERE player_id = 960000384 AND currency_code = 'point') point`
  );
  assert.deepEqual([rows[0]!.registrations.toString(), rows[0]!.pets.toString(), rows[0]!.food.toString(), rows[0]!.point], ["2", "2", "119100", "98000.000"]);
  console.log(JSON.stringify({ shadow: "PASS", restartReplay: true, registrations: "2", rewardNotDuplicated: true }));
} finally {
  await database.close();
}
