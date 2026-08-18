import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { GRADE_COMBINE_REWARDS } from "../src/mini-pet/grade-combine-rewards.js";

const source = await readFile(resolve(import.meta.dirname, "../../../main.js"), "utf8");
const marker = "const MINI_PET_COMBINATION_REWARDS = ";
const start = source.indexOf(marker);
const end = source.indexOf("\n};", start) + 3;
assert.ok(start >= 0 && end > start, "Rhino reward pool must remain discoverable.");
const legacy = vm.runInNewContext(`(${source.slice(start + marker.length, end).trim().replace(/;$/, "")})`) as Record<string, Array<[string, string, number]>>;
const relational = Object.fromEntries(Object.entries(GRADE_COMBINE_REWARDS).map(([grade, pool]) => [
  grade, pool.map(({ name, emoji, experience }) => [name, emoji, Number(experience)])
]));
assert.equal(JSON.stringify(relational), JSON.stringify(legacy));

const guard = source.indexOf('msg.startsWith("/미니펫조합태초+") || msg.startsWith("/미니펫조합창세") || msg.startsWith("/미니펫조합창조")');
const parse = source.indexOf("firstIndex = parseInt(combinationArgs[1], 10);", guard);
const remove = source.indexOf("removeMiniPetsFromBag(bag, [firstIndex, secondIndex]);", parse);
const random = source.indexOf("Math.random() < config.successRate", remove);
const save = source.indexOf("saveJsonFile(petData, memberPetPath);", random);
assert.ok(guard >= 0 && guard < parse && parse < remove && remove < random && random < save);

process.stdout.write(`${JSON.stringify({
  commandGuards: "broad startsWith preserved", numericParsing: "parseInt suffix preserved",
  rewardCounts: { primordialPlus: legacy["태초+"]?.length, genesis: legacy["창세"]?.length, creation: legacy["창조"]?.length },
  sourceOrder: "remove -> random -> save", rewardPoolExact: true, operationalSourceReadOnly: true
})}\n`);
