import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requireMiniPetReservationQuantity } from "../src/market/market-mini-pet-bulk-escrow.js";

describe("market mini pet bulk escrow contract", () => {
  it("accepts only an exact reservation quantity", () => {
    assert.doesNotThrow(() => requireMiniPetReservationQuantity(3, 3n));
    assert.throws(() => requireMiniPetReservationQuantity(1, 2n), /거래할 미니펫 수량이 일치하지 않습니다/);
    assert.throws(() => requireMiniPetReservationQuantity(0, 1n), /거래할 미니펫 수량이 일치하지 않습니다/);
  });
});
