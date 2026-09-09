import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculatePetTitleSaleMinorAmount, calculatePetTitleSalePoint } from "../src/pet/pet-title-sale-policy.js";

describe("pet title sale policy", () => {
  it("preserves the legacy minimum and integer 30 percent boundaries", () => {
    assert.equal(calculatePetTitleSalePoint(9_999n), 1_000_000n);
    assert.equal(calculatePetTitleSalePoint(10_000n), 3_000n);
    assert.equal(calculatePetTitleSalePoint(100_000_003n), 30_000_000n);
  });

  it("converts the displayed point amount to the canonical minor unit", () => {
    assert.deepEqual(calculatePetTitleSaleMinorAmount(100_000_000n, 3), {
      salePoint: 30_000_000n,
      deltaMinorAmount: 30_000_000_000n,
    });
    assert.deepEqual(calculatePetTitleSaleMinorAmount(9_999n, 0), {
      salePoint: 1_000_000n,
      deltaMinorAmount: 1_000_000n,
    });
  });

  it("rejects an invalid negative catalog price", () => {
    assert.throws(() => calculatePetTitleSalePoint(-1n), /PET_TITLE_SALE_PRICE_INVALID/);
  });
});
