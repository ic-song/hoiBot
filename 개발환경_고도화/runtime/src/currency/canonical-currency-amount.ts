const SIGNED_BIGINT_MIN = -9_223_372_036_854_775_808n;
const SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
export const UNSIGNED_BIGINT_MAX = 18_446_744_073_709_551_615n;

function assertScale(decimalPlaces: number): void {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 9) throw new Error("CANONICAL_CURRENCY_DECIMAL_PLACES_INVALID");
}

// 원본 문자열을 Number로 통과시키지 않고 정의된 최소단위 BIGINT로 정확히 변환합니다.
export function parseCanonicalCurrencyMinorAmount(source: string, decimalPlaces: number): bigint {
  assertScale(decimalPlaces);
  const match = /^([+-]?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(source);
  if (match === null) throw new Error("CANONICAL_CURRENCY_SOURCE_AMOUNT_INVALID");
  const fraction = match[3] ?? "";
  if (fraction.length > decimalPlaces) throw new Error("CANONICAL_CURRENCY_SOURCE_PRECISION_EXCEEDED");
  const paddedFraction = fraction.padEnd(decimalPlaces, "0");
  const magnitude = BigInt(`${match[2]}${paddedFraction}`);
  const value = match[1] === "-" ? -magnitude : magnitude;
  if (value < SIGNED_BIGINT_MIN || value > SIGNED_BIGINT_MAX) throw new Error("CANONICAL_CURRENCY_SOURCE_AMOUNT_OUT_OF_RANGE");
  return value;
}

export function parseCanonicalCurrencyBalanceMinorAmount(source: string, decimalPlaces: number): bigint {
  const value = parseCanonicalCurrencyMinorAmount(source, decimalPlaces);
  if (value < 0n) throw new Error("CANONICAL_CURRENCY_NEGATIVE_BALANCE_QUARANTINED");
  return value;
}

export function assertCanonicalCurrencyDelta(value: bigint): void {
  if (value === 0n || value < SIGNED_BIGINT_MIN || value > SIGNED_BIGINT_MAX) throw new Error("CANONICAL_CURRENCY_DELTA_INVALID");
}
