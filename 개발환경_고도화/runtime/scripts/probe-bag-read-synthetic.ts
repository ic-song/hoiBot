import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GetBagService } from "../src/inventory/get-bag-service.js";
import { formatLegacyBag } from "../src/inventory/legacy-bag-formatter.js";
import { MariaBagRepository } from "../src/inventory/maria-bag-repository.js";

const config = loadConfig();
if (!config.database.enabled || /(^|[_-])(prod|production)($|[_-])/i.test(config.database.name) || config.database.name === "hoibot") {
  throw new Error("합성 `/가방` 검증은 운영 DB에서 실행할 수 없습니다.");
}

const database = createDatabaseClient(config.database);
try {
  const bag = await new GetBagService(new MariaBagRepository(database))
    .execute("synthetic", "synthetic-user-alpha");
  const output = formatLegacyBag(bag);
  assert.equal(bag.items.length, 5);
  assert.match(output, /^\[테스트알파\]의 가방🧳\n/);
  assert.ok(output.indexOf("잡템☠️ x 20") < output.indexOf("양념치킨🐔 x 12"));
  assert.ok(output.indexOf("양념치킨🐔 x 12") < output.indexOf("합성 당근 x 20"));
  console.log(JSON.stringify({ ok: true, playerId: bag.playerId, itemCount: bag.items.length, outputLines: output.split("\n").length }));
} finally {
  await database.close();
}
