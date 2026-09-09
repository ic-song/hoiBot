import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPendantBagMessage, parsePendantBagCommand, type PendantBagEntry } from "../src/pet/pendant-bag-service.js";

const entry = (id: number, name: string, grade: string): PendantBagEntry => ({ instanceId: String(id), name, icon: "💎", grade, durability: 4n, maxDurability: 5n, upgrade: 2n });

describe("pendant bag command", () => {
  it("accepts the exact self form and one free-form target only", () => {
    assert.deepEqual(parsePendantBagCommand("/펜던트가방"), { targetName: null });
    assert.deepEqual(parsePendantBagCommand("/펜던트가방 대상 여"), { targetName: "대상 여" });
    for (const value of ["펜던트가방", "/펜던트가방대상", "/펜던트가방 "]) assert.equal(parsePendantBagCommand(value), null);
  });

  it("keeps the empty legacy bag projection", () => {
    const data = formatPendantBagMessage("⭐본인 남", []);
    assert.match(data, /^\[⭐본인 남\] 보유 펜던트가방💎\[0\/50\]/);
    assert.match(data, /보유한 펜던트가 없습니다\.$/);
  });

  it("sorts grade then Korean name without mutating source order", () => {
    const source = [entry(2, "나", "하급"), entry(1, "가", "창조"), entry(3, "가", "하급")];
    const data = formatPendantBagMessage("대상 여", source);
    assert.ok(data.indexOf("가💎[창조]") < data.indexOf("가💎[하급]") && data.indexOf("가💎[하급]") < data.indexOf("나💎[하급]"));
    assert.deepEqual(source.map((row) => row.instanceId), ["2", "1", "3"]);
  });

  it("inserts exactly 500 allsee characters before the sixth row", () => {
    const data = formatPendantBagMessage("대상 여", Array.from({ length: 6 }, (_, index) => entry(index + 1, `펜던트${index + 1}`, "하급")));
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(data.indexOf("5. ") < data.indexOf("\u200b") && data.indexOf("\u200b") < data.indexOf("6. "));
  });
});
