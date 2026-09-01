import { ApplicationError } from "../shared/application-error.js";
import { validateSystemAccountName, type ValidSignupName } from "../signup/signup-policy.js";

export const USER_TERMS_VERSION = "2026-08-05";
export const USER_PENDING_HOURS = 24;
export const USER_CODE_MINUTES = 30;
export const USER_CODE_MAX_FAILURES = 5;
export const USER_LOGIN_MAX_FAILURES = 5;
export const USER_LOGIN_LOCK_MINUTES = 15;
export const USER_AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;

// 변경 불가능한 사이트 로그인 ID 형식을 검증합니다.
export function validateLoginId(value: string): string {
  if (!/^[a-z0-9]{6,20}$/.test(value)) {
    throw new ApplicationError(
      "INVALID_LOGIN_ID",
      "로그인 ID는 영문 소문자와 숫자 6~20자로 입력해 주세요.",
      422
    );
  }
  return value;
}

// 사이트 사용자 비밀번호의 길이와 영문·숫자 포함 여부를 검증합니다.
export function validateUserPassword(value: string): string {
  if (value.length < 8 || value.length > 64 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new ApplicationError(
      "INVALID_PASSWORD",
      "비밀번호는 8~64자이며 영문과 숫자를 각각 하나 이상 포함해야 합니다.",
      422
    );
  }
  return value;
}

// 시스템 계정 이름 오류를 사이트 API용 오류로 변환합니다.
export function validateUserAccountName(value: string): ValidSignupName {
  try {
    return validateSystemAccountName(value);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_SIGNUP_NAME_FORMAT";
    if (code === "BLOCKED_SIGNUP_NAME") {
      throw new ApplicationError("BLOCKED_ACCOUNT_NAME", "사용할 수 없는 시스템 계정 이름입니다.", 422);
    }
    throw new ApplicationError(
      "INVALID_ACCOUNT_NAME",
      "시스템 계정 이름은 한글 두 글자, 공백 한 칸, 남 또는 여 형식이어야 합니다.",
      422
    );
  }
}

// KakaoTalk 봇이 처리할 정확한 인증 코드 명령만 판별합니다.
export function readKakaoVerificationCode(message: string | undefined): string | null {
  const match = message?.match(/^\/인증 ([A-Z2-9]{8})$/i);
  return match?.[1]?.toUpperCase() ?? null;
}
