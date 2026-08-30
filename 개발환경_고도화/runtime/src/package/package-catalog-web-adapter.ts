import { createHash } from "node:crypto";
import { PackageCatalogCommandError, type PackageCatalogRewardInput } from "./package-catalog-admin-command.js";
import type { PackageCatalogMutationResult } from "./package-catalog-admin-service.js";

export type PackageCatalogWebMutation =
  | { action: "ADD"; displayName: string; description: string; rewards: readonly PackageCatalogRewardInput[] }
  | { action: "EDIT"; packageId: string; rewards: readonly PackageCatalogRewardInput[] }
  | { action: "REMOVE"; packageId: string }
  | { action: "ENABLE"; packageId: string };

export interface PackageCatalogWebMutationInput {
  actorOperatorId: string;
  sourceCode: string;
  idempotencyKey: string;
  expectedCatalogVersion: bigint;
  reason: string;
  mutation: PackageCatalogWebMutation;
}

export interface PackageCatalogWebMutationRequest extends PackageCatalogWebMutationInput {
  requestKey: string;
  payloadFingerprint: string;
}

export interface PackageCatalogWebAdapterRepository {
  mutateForOperator(request: PackageCatalogWebMutationRequest): Promise<PackageCatalogMutationResult>;
}

const MAX_DECIMAL_30 = 999999999999999999999999999999n;
const SOURCE_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

// bigint가 포함된 웹 변경 요청을 순서가 고정된 fingerprint payload로 변환합니다.
function fingerprintPayload(input: PackageCatalogWebMutationInput): string {
  const mutation = input.mutation.action === "ADD"
    ? {
        action: input.mutation.action,
        displayName: input.mutation.displayName,
        description: input.mutation.description,
        rewards: input.mutation.rewards.map((reward) => ({
          rewardType: reward.rewardType,
          assetCode: reward.assetCode,
          quantity: reward.quantity.toString(),
        })),
      }
    : input.mutation.action === "EDIT"
      ? {
          action: input.mutation.action,
          packageId: input.mutation.packageId,
          rewards: input.mutation.rewards.map((reward) => ({
            rewardType: reward.rewardType,
            assetCode: reward.assetCode,
            quantity: reward.quantity.toString(),
          })),
        }
      : { action: input.mutation.action, packageId: input.mutation.packageId };
  return JSON.stringify({
    expectedCatalogVersion: input.expectedCatalogVersion.toString(),
    reason: input.reason,
    mutation,
  });
}

// source와 operator를 분리한 고정 길이 request key를 만듭니다.
function namespacedRequestKey(sourceCode: string, operatorId: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return `web:${sourceCode}:${operatorId}:sha256:${digest}`;
}

// 웹 입력의 보상 수량과 stable asset code를 기존 패키지 계약에 맞게 검증합니다.
function validateRewards(rewards: readonly PackageCatalogRewardInput[]): void {
  if (rewards.length === 0) {
    throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "보상을 한 개 이상 입력해 주세요.");
  }
  for (const reward of rewards) {
    if ((reward.rewardType !== "POINT" && reward.rewardType !== "ITEM") || reward.assetCode.trim() === "" || reward.assetCode.length > 191) {
      throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "보상 정보를 확인해 주세요.");
    }
    if (reward.quantity < 1n || reward.quantity > MAX_DECIMAL_30) {
      throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "보상 수량을 확인해 주세요.");
    }
  }
}

// 웹 변경 요청을 정규화하고 provider가 검증할 replay 계약을 생성합니다.
function normalizeInput(input: PackageCatalogWebMutationInput): PackageCatalogWebMutationRequest {
  const actorOperatorId = input.actorOperatorId.trim();
  const sourceCode = input.sourceCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const reason = input.reason.trim();
  if (!/^[1-9][0-9]{0,19}$/.test(actorOperatorId) || BigInt(actorOperatorId) > 18446744073709551615n) {
    throw new PackageCatalogCommandError("PACKAGE_CATALOG_OPERATOR_INVALID", "운영자 식별자를 확인해 주세요.");
  }
  if (!SOURCE_CODE_PATTERN.test(sourceCode) || sourceCode === "iris") {
    throw new PackageCatalogCommandError("PACKAGE_CATALOG_SOURCE_INVALID", "웹 요청 출처를 확인해 주세요.");
  }
  if (idempotencyKey === "" || idempotencyKey.length > 1_000) {
    throw new PackageCatalogCommandError("PACKAGE_CATALOG_IDEMPOTENCY_INVALID", "멱등성 키를 확인해 주세요.");
  }
  if (input.expectedCatalogVersion < 1n) {
    throw new PackageCatalogCommandError("PACKAGE_CATALOG_VERSION_INVALID", "패키지 목록 버전을 확인해 주세요.");
  }
  if (reason === "" || reason.length > 500) {
    throw new PackageCatalogCommandError("PACKAGE_CATALOG_REASON_INVALID", "변경 사유를 입력해 주세요.");
  }
  const mutation = input.mutation.action === "ADD"
    ? {
        ...input.mutation,
        displayName: input.mutation.displayName.trim(),
        description: input.mutation.description.trim(),
      }
    : { ...input.mutation, packageId: input.mutation.packageId.trim() };
  if (mutation.action === "ADD") {
    if (mutation.displayName === "" || mutation.displayName.length > 191 || mutation.description === "") {
      throw new PackageCatalogCommandError("PACKAGE_FIELDS_REQUIRED", "패키지 이름과 설명을 입력해 주세요.");
    }
    validateRewards(mutation.rewards);
  } else {
    if (!PACKAGE_ID_PATTERN.test(mutation.packageId)) {
      throw new PackageCatalogCommandError("PACKAGE_ID_INVALID", "패키지 식별자를 확인해 주세요.");
    }
    if (mutation.action === "EDIT") validateRewards(mutation.rewards);
  }
  const normalized: PackageCatalogWebMutationInput = {
    actorOperatorId,
    sourceCode,
    idempotencyKey,
    expectedCatalogVersion: input.expectedCatalogVersion,
    reason,
    mutation,
  };
  return {
    ...normalized,
    requestKey: namespacedRequestKey(sourceCode, actorOperatorId, idempotencyKey),
    payloadFingerprint: createHash("sha256").update(fingerprintPayload(normalized)).digest("hex"),
  };
}

export class PackageCatalogWebAdapter {
  public constructor(private readonly repository: PackageCatalogWebAdapterRepository) {}

  // operator 기반 웹 변경을 stable package ID와 optimistic version 경계로 실행합니다.
  public async mutate(input: PackageCatalogWebMutationInput): Promise<PackageCatalogMutationResult> {
    return this.repository.mutateForOperator(normalizeInput(input));
  }
}
