import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PET_EXPLORE_SETTLEMENT_POLICY_HASH,
  PET_EXPLORE_SETTLEMENT_POLICY_JSON,
  PET_EXPLORE_SETTLEMENT_POLICY_VERSION,
} from "../src/pet/pet-explore-settlement-input-snapshot-provider.js";

describe("pet explore lucky box reward correction", () => {
  it("publishes a hash-bound r1 policy", () => {
    assert.equal(PET_EXPLORE_SETTLEMENT_POLICY_VERSION, "PET-EXPLORE-SETTLEMENT-v2.400-20260831-r1");
    assert.equal(createHash("sha256").update(PET_EXPLORE_SETTLEMENT_POLICY_JSON).digest("hex"), PET_EXPLORE_SETTLEMENT_POLICY_HASH);
    assert.equal(JSON.parse(PET_EXPLORE_SETTLEMENT_POLICY_JSON).rewardCorrections.luck_mine.to, "reward_lucky_box");
  });

  it("keeps the package identity disabled and routes only the reward identity", () => {
    const seed = readFileSync(new URL("../migrations/078_package_lucky_box_seed.sql", import.meta.url), "utf8");
    const correction = readFileSync(new URL("../migrations/406_pet_explore_lucky_box_reward_correction.sql", import.meta.url), "utf8");
    assert.match(seed, /\('lucky_box','STACK','행운의박스[\s\S]*?'CATALOG_SEED_ONLY'\),0,1\)/);
    assert.match(seed, /\('reward_lucky_box','STACK','럭키박스[\s\S]*?'CATALOG_REWARD_ITEM'\),1,1\)/);
    assert.match(correction, /JSON_OBJECT\('itemCode','reward_lucky_box','quantity','1'\)/);
    assert.doesNotMatch(correction, /UPDATE\s+item_definitions[\s\S]+active\s*=\s*1[\s\S]+lucky_box/i);
  });

  it("retires the old policy only after the corrected policy is published", () => {
    const correction = readFileSync(new URL("../migrations/406_pet_explore_lucky_box_reward_correction.sql", import.meta.url), "utf8");
    assert.match(correction, /PET-EXPLORE-SETTLEMENT-v2\.400-20260831-r1/);
    assert.match(correction, /SET status_code='RETIRED'/);
    assert.match(correction, new RegExp(PET_EXPLORE_SETTLEMENT_POLICY_HASH));
  });
});
