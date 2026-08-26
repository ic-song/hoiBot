import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPendantInfo, normalizePendantInfoDispatchMessage, parsePendantInfoCommand, selectPendantInfoRow, type PendantInfoRow } from "../src/pet/pendant-info-service.js";

const row = (id: number, name: string, grade: string, upgrade = "2"): PendantInfoRow => ({ instance_id: BigInt(id), item_name: name, name_value: name, icon_value: "💎", grade_value: grade, durability_value: "4", max_durability_value: "5", upgrade_value: upgrade });

describe("pendant info", () => {
  it("preserves the broad outer guard and numeric inner guard", () => {
    assert.deepEqual(parsePendantInfoCommand("/펜던트정보"), { kind: "usage" });
    assert.deepEqual(parsePendantInfoCommand("/펜던트정보 안내"), { kind: "usage" });
    assert.deepEqual(parsePendantInfoCommand("/펜던트정보 0"), { kind: "lookup", index: 0n });
    assert.equal(parsePendantInfoCommand("/펜던트정보 "), undefined);
    assert.equal(normalizePendantInfoDispatchMessage("/펜던트정보 2"), "/펜던트정보");
  });
  it("selects the stable grade and name sorted bag number", () => {
    assert.equal(selectPendantInfoRow([row(2, "나", "하급"), row(1, "가", "창조")], 1n)?.instance_id, 1n);
    assert.equal(selectPendantInfoRow([row(2, "나", "하급")], 2n), undefined);
  });
  it("reuses the verified pendant detail projection", () => {
    const data = formatPendantInfo(row(1, "창조펜던트", "창조", "2"));
    assert.match(data, /^펜던트 정보:/); assert.match(data, /기본 종합매력👑: 20,000,000/); assert.match(data, /총 펫탐험성공확률⛰️: \+2\.7%/); assert.match(data, /다음 강화성공 확률🎲: 100%/);
  });
});
