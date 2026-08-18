import { ApplicationError } from "./application-error.js";

const DECIMAL_PATTERN = /^(-?)(\d{1,27})(?:\.(\d{1,3}))?$/;

// DECIMAL(30,3) 값을 부동소수점 손실 없이 최소 단위 bigint로 변환합니다.
export function parseDecimal3(value: string, fieldName: string): bigint {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) throw new ApplicationError("INVALID_DECIMAL", `${fieldName} 값이 DECIMAL(30,3) 범위를 벗어났습니다.`, 422);
  const units = BigInt(match[2]!) * 1000n + BigInt((match[3] ?? "").padEnd(3, "0"));
  return match[1] === "-" ? -units : units;
}

// 최소 단위 bigint를 MariaDB와 API에서 사용하는 소수 문자열로 변환합니다.
export function formatDecimal3(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const fraction = (absolute % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / 1000n}${fraction === "" ? "" : `.${fraction}`}`;
}

// 양수 BIGINT 입력만 허용합니다.
export function positiveInteger(value: string, fieldName: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new ApplicationError("INVALID_INTEGER", `${fieldName} 값은 양의 정수여야 합니다.`, 422);
  return BigInt(value);
}

// 0을 포함하는 BIGINT 입력만 허용합니다.
export function nonNegativeInteger(value: string, fieldName: string): bigint {
  if (!/^\d+$/.test(value)) throw new ApplicationError("INVALID_INTEGER", `${fieldName} 값은 0 이상의 정수여야 합니다.`, 422);
  return BigInt(value);
}
