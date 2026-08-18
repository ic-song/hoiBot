import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { GetMyProfileService } from "../src/player/get-my-profile-service.js";
import { formatLegacyMyProfile } from "../src/player/legacy-profile-formatter.js";
import { MariaProfileRepository } from "../src/player/maria-profile-repository.js";

const config = loadConfig();
const restartVerification = process.env.PROFILE_PROBE_RESTART_VERIFICATION === "true";
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic profile probe is blocked for database: ${config.database.name}`);
}

const database = createDatabaseClient(config.database);
try {
  const contract = JSON.parse(await readFile(
    path.resolve("../migration-control/evidence/player-profile-read/contract.json"),
    "utf8"
  )) as {
    syntheticIdentity: { providerCode: string; externalUserId: string };
    expected: { playerId: string; zeroWidthCount: number; linesWithoutZeroWidth: string[] };
  };
  const profile = await new GetMyProfileService(new MariaProfileRepository(database))
    .execute(contract.syntheticIdentity.providerCode, contract.syntheticIdentity.externalUserId);
  const output = formatLegacyMyProfile(profile);
  const zeroWidthCount = [...output].filter((character) => character === "\u200b").length;
  const linesWithoutZeroWidth = output.replaceAll("\u200b", "").split("\n");
  assert.equal(profile.playerId, contract.expected.playerId);
  assert.equal(zeroWidthCount, contract.expected.zeroWidthCount);
  assert.deepEqual(linesWithoutZeroWidth, contract.expected.linesWithoutZeroWidth);
  process.stdout.write(`${JSON.stringify({
    sliceId: "player-profile-read",
    command: "/내정보",
    playerId: profile.playerId,
    zeroWidthCount,
    lineCount: linesWithoutZeroWidth.length,
    exactContractMatched: true,
    restartVerification
  })}\n`);
} finally {
  await database.close();
}
