import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaPetInfoRepository } from "../src/pet/maria-pet-info-repository.js";
import { GetPetInfoService } from "../src/pet/pet-info-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet-info probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
const restartVerification = process.env.PET_INFO_PROBE_RESTART_VERIFICATION === "true";
try {
  const repository = new MariaPetInfoRepository(database);
  const view = await repository.findByExternalIdentity("synthetic", "synthetic-user-alpha");
  assert.ok(view);
  assert.equal(view.displayName, "테스트알파");
  assert.equal(view.pet.name, "합성펫알파");
  assert.equal(view.pet.image, "🐺");
  assert.equal(view.pet.personality, "합성 다정함");
  assert.deepEqual(view.elemental, { name: "합성 불새", grade: "합성 정령왕", enhancement: "3" });
  assert.deepEqual(view.home, { name: "알파의 합성 홈", charm: "108", floorArea: "16" });
  assert.equal(view.miniPet?.name, "합성별이");
  assert.equal(view.charm.castle, "353");
  assert.equal(view.charm.raid, "350");
  assert.equal(view.charm.total, "2703");
  assert.equal(view.charm.criticalChance, "1.00");
  assert.equal(view.pass.premium, true);

  const replies = await new GetPetInfoService(repository, () => 0).execute("synthetic", "synthetic-user-alpha");
  assert.equal(replies.length, 2);
  assert.equal(replies[0]?.data, "🐺");
  const text = replies[1]?.data ?? "";
  assert.match(text, /\[테스트알파\]의 펫정보🐶/);
  assert.match(text, /종합매력👑: 2,703💞/);
  assert.match(text, /펫홈🏡: 알파의 합성 홈\(\+108💕\)\[\+16평\]/);
  assert.equal((text.match(/​/g) ?? []).length, 500);
  process.stdout.write(`${JSON.stringify({ database: config.database.name, playerId: view.playerId,
    replies: replies.length, image: replies[0]?.data, totalCharm: view.charm.total,
    allSeeCount: (text.match(/​/g) ?? []).length, restartVerification,
    operationalSnapshotTouched: false })}\n`);
} finally {
  await database.close();
}
