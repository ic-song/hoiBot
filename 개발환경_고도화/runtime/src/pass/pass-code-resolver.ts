export const PASS_CODE_POLICY_VERSION = "PASS-SIX-v1-cdfd62d5a8f38662" as const;
export const PASS_CODE_POLICY_SHA256 = "cdfd62d5a8f38662132a63dfa9dc90d6c43f9928500e604079e255e92cd4f8c9" as const;

export const PASS_CODE_MAPPINGS = [
  { semanticCode: "hoi", compatibilityCode: "support" },
  { semanticCode: "newbie", compatibilityCode: "beginner" },
  { semanticCode: "premium", compatibilityCode: "premium" }
] as const;

export const PASS_CODE_PASSTHROUGH = ["contribution", "diamond", "oneday"] as const;
export const PASS_SEMANTIC_CODES = ["hoi", "newbie", "premium", ...PASS_CODE_PASSTHROUGH] as const;
export const PASS_COMPATIBILITY_CODES = ["support", "beginner", "premium", ...PASS_CODE_PASSTHROUGH] as const;

export type PassSemanticCode = typeof PASS_SEMANTIC_CODES[number];
export type PassCompatibilityCode = typeof PASS_COMPATIBILITY_CODES[number];
export type PassCodeScope = "SEMANTIC" | "COMPATIBILITY";
export type PassCodeResolutionErrorCode =
  | "PASS_CODE_POLICY_VERSION_MISMATCH"
  | "PASS_CODE_SCOPE_INVALID"
  | "PASS_CODE_NOT_ALLOWED_FOR_SCOPE";

export class PassCodeResolutionError extends Error {
  public constructor(public readonly code: PassCodeResolutionErrorCode) {
    super(code);
    this.name = "PassCodeResolutionError";
  }
}

export interface PassCodeResolutionRequest {
  code: string;
  sourceScope: PassCodeScope;
  targetScope: PassCodeScope;
  policyVersion: string;
}

const semanticToCompatibility: Readonly<Record<PassSemanticCode, PassCompatibilityCode>> = Object.freeze({
  hoi: "support",
  newbie: "beginner",
  premium: "premium",
  contribution: "contribution",
  diamond: "diamond",
  oneday: "oneday"
});

const compatibilityToSemantic: Readonly<Record<PassCompatibilityCode, PassSemanticCode>> = Object.freeze({
  support: "hoi",
  beginner: "newbie",
  premium: "premium",
  contribution: "contribution",
  diamond: "diamond",
  oneday: "oneday"
});

const isSemanticCode = (code: string): code is PassSemanticCode =>
  (PASS_SEMANTIC_CODES as readonly string[]).includes(code);

const isCompatibilityCode = (code: string): code is PassCompatibilityCode =>
  (PASS_COMPATIBILITY_CODES as readonly string[]).includes(code);

// 동결된 정책 버전과 명시된 pass code scope 사이에서만 코드를 변환합니다.
export function resolvePassCode(request: PassCodeResolutionRequest): PassSemanticCode | PassCompatibilityCode {
  if (request.policyVersion !== PASS_CODE_POLICY_VERSION) {
    throw new PassCodeResolutionError("PASS_CODE_POLICY_VERSION_MISMATCH");
  }
  if (request.sourceScope === request.targetScope) {
    throw new PassCodeResolutionError("PASS_CODE_SCOPE_INVALID");
  }
  if (request.sourceScope === "SEMANTIC" && request.targetScope === "COMPATIBILITY") {
    if (!isSemanticCode(request.code)) {
      throw new PassCodeResolutionError("PASS_CODE_NOT_ALLOWED_FOR_SCOPE");
    }
    return semanticToCompatibility[request.code];
  }
  if (request.sourceScope === "COMPATIBILITY" && request.targetScope === "SEMANTIC") {
    if (!isCompatibilityCode(request.code)) {
      throw new PassCodeResolutionError("PASS_CODE_NOT_ALLOWED_FOR_SCOPE");
    }
    return compatibilityToSemantic[request.code];
  }
  throw new PassCodeResolutionError("PASS_CODE_SCOPE_INVALID");
}
