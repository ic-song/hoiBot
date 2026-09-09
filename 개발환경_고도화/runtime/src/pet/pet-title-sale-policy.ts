import { parseCanonicalCurrencyMinorAmount } from "../currency/canonical-currency-amount.js";

const LEGACY_MINIMUM_PRICE_THRESHOLD = 10_000n;
const LEGACY_MINIMUM_SALE_POINT = 1_000_000n;

export function calculatePetTitleSalePoint(priceAmount: bigint): bigint {
  if (priceAmount < 0n) throw new Error("PET_TITLE_SALE_PRICE_INVALID");
  return priceAmount < LEGACY_MINIMUM_PRICE_THRESHOLD
    ? LEGACY_MINIMUM_SALE_POINT
    : priceAmount * 3n / 10n;
}

export function calculatePetTitleSaleMinorAmount(priceAmount: bigint, decimalPlaces: number): {
  salePoint: bigint;
  deltaMinorAmount: bigint;
} {
  const salePoint = calculatePetTitleSalePoint(priceAmount);
  return {
    salePoint,
    deltaMinorAmount: parseCanonicalCurrencyMinorAmount(salePoint.toString(), decimalPlaces),
  };
}
