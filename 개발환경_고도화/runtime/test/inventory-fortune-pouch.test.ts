import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInventoryFortunePouchCommandCandidate, normalizeInventoryFortunePouchDispatchMessage, parseInventoryFortunePouchCommand } from "../src/inventory/inventory-fortune-pouch-command.js";
import { aggregateInventoryFortunePouchRolls, createInventoryFortunePouchSeed, formatInventoryFortunePouchReply, inventoryFortunePouchSample, resolveInventoryFortunePouchRoll, type InventoryFortunePouchTier } from "../src/inventory/inventory-fortune-pouch-service.js";

const tiers: InventoryFortunePouchTier[] = [
  { tier_ordinal:1,weight_value:2300n,item_id:1n,item_code:"sword",display_name:"집행검👑",reward_quantity:1n },
  { tier_ordinal:2,weight_value:10000n,item_id:2n,item_code:"immortal",display_name:"불멸🪬",reward_quantity:1n },
  { tier_ordinal:3,weight_value:3000000n,item_id:3n,item_code:"food",display_name:"펫먹이상자📦(/상자오픈)",reward_quantity:1n },
  { tier_ordinal:4,weight_value:5000000n,item_id:4n,item_code:"pet",display_name:"펫 강화석⭐",reward_quantity:1n },
  { tier_ordinal:5,weight_value:8000000n,item_id:5n,item_code:"spirit",display_name:"정령 강화석🥀",reward_quantity:1n },
  { tier_ordinal:6,weight_value:11500000n,item_id:6n,item_code:"trash",display_name:"잡템상자☠",reward_quantity:1n },
  { tier_ordinal:7,weight_value:72487700n,item_id:7n,item_code:"allowance",display_name:"용돈💸",reward_quantity:5n }
];

describe("inventory fortune pouch v2.400", () => {
  it("preserves the broad startsWith candidate", () => {
    for (const value of ["/복주머니", "/복주머니 2", "/복주머니안내", "/복주머니 2 extra"]) assert.equal(isInventoryFortunePouchCommandCandidate(value), true);
    for (const value of [undefined, "복주머니", " /복주머니"]) assert.equal(isInventoryFortunePouchCommandCandidate(value), false);
    assert.equal(normalizeInventoryFortunePouchDispatchMessage("/복주머니안내"), "/복주머니");
  });

  it("keeps split parseInt cap, zero, negative, NaN and extra-token quirks", () => {
    assert.equal(parseInventoryFortunePouchCommand("/복주머니")?.count, 1n);
    assert.equal(parseInventoryFortunePouchCommand("/복주머니 20000")?.count, 10000n);
    assert.equal(parseInventoryFortunePouchCommand("/복주머니 2개 extra")?.count, 2n);
    assert.equal(parseInventoryFortunePouchCommand("/복주머니 0")?.count, 0n);
    assert.equal(parseInventoryFortunePouchCommand("/복주머니 -3")?.count, -3n);
    assert.equal(parseInventoryFortunePouchCommand("/복주머니  2")?.count, null);
  });

  it("uses the exact seven cumulative probability boundaries", () => {
    const samples = [0,0.00002299,0.000023,0.00012299,0.000123,0.03012299,0.030123,0.08012299,0.080123,0.16012299,0.160123,0.27512299,0.275123,0.99999999];
    assert.deepEqual(samples.map(sample => resolveInventoryFortunePouchRoll(sample,100000000n,tiers).tier.tier_ordinal), [1,1,2,2,3,3,4,4,5,5,6,6,7,7]);
  });

  it("keeps deterministic samples and first-hit aggregate order", () => {
    const seed = createInventoryFortunePouchSeed("v2400","event-1","42",3n);
    assert.equal(inventoryFortunePouchSample(seed,1n), inventoryFortunePouchSample(seed,1n));
    const rolls = [resolveInventoryFortunePouchRoll(0.3,100000000n,tiers,1n),resolveInventoryFortunePouchRoll(0,100000000n,tiers,2n),resolveInventoryFortunePouchRoll(0.4,100000000n,tiers,3n)];
    assert.deepEqual(aggregateInventoryFortunePouchRolls(rolls).map(row => [row.displayName,row.quantity]), [["용돈💸",10n],["집행검👑",1n]]);
  });

  it("formats the exact legacy response including an empty zero-roll result", () => {
    assert.equal(formatInventoryFortunePouchReply("왕검증자","0",[]), "[왕검증자]의 복주머니🧧(0회)\n\n오픈결과:\n\n\n축하해요 복받으세용 데헷! 🎉");
    assert.match(formatInventoryFortunePouchReply("왕검증자","2",[{ itemId:7n,itemCode:"allowance",displayName:"용돈💸",quantity:10n }]), /^\[왕검증자\]의 복주머니🧧\(2회\)[\s\S]*용돈💸 10개/);
  });
});
