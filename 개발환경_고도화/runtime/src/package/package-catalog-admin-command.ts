export type PackageCatalogRewardInput = {
  rewardType: "POINT" | "ITEM";
  assetCode: string;
  quantity: bigint;
};

export type PackageCatalogAdminCommand =
  | { kind: "ADD"; displayName: string; description: string; rewards: readonly PackageCatalogRewardInput[] }
  | { kind: "EDIT"; listNumber: number; rewards: readonly PackageCatalogRewardInput[] }
  | { kind: "REMOVE"; listNumber: number; alias: "/패키지제거" | "/패키지리스트제거" }
  | { kind: "ENABLE"; listNumber: number };

export class PackageCatalogCommandError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// 쉼표가 포함된 양의 정수 수량을 bigint로 변환합니다.
function parseQuantity(value: string): bigint {
  const normalized = value.replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "보상 수량을 확인해 주세요.");
  const quantity = BigInt(normalized);
  if (quantity < 1n) throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "보상 수량은 1개 이상이어야 합니다.");
  return quantity;
}

// 표준 point/item 문법의 보상 한 건을 변환합니다.
function parseStandardReward(token: string): PackageCatalogRewardInput {
  const point = /^point:([^:]+)$/i.exec(token);
  if (point) return { rewardType: "POINT", assetCode: "POINT", quantity: parseQuantity(point[1]!.trim()) };
  const item = /^item:(.+):([^:]+)$/i.exec(token);
  if (!item || item[1]!.trim().length === 0) throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "보상 형식을 확인해 주세요.");
  return { rewardType: "ITEM", assetCode: item[1]!.trim(), quantity: parseQuantity(item[2]!.trim()) };
}

// 레거시 자연어 '아이템 x수량' 또는 표준 point/item 보상 목록을 순서대로 변환합니다.
export function parsePackageCatalogRewards(value: string): readonly PackageCatalogRewardInput[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "보상을 입력해 주세요.");
  if (/\s+x\s*[\d,]+/i.test(trimmed)) {
    const rewards: PackageCatalogRewardInput[] = [];
    const pattern = /(?:^|,\s*)(.+?)\s+x\s*([\d,]+)(?=\s*,|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(trimmed)) !== null) {
      const assetCode = match[1]!.trim();
      if (assetCode.length === 0) throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "아이템 이름을 확인해 주세요.");
      rewards.push({ rewardType: "ITEM", assetCode, quantity: parseQuantity(match[2]!) });
    }
    if (rewards.length === 0) throw new PackageCatalogCommandError("PACKAGE_REWARD_INVALID", "보상 형식을 확인해 주세요.");
    return rewards;
  }
  return trimmed.split(",").map((token) => token.trim()).filter(Boolean).map(parseStandardReward);
}

// 패키지 카탈로그 관리자 명령을 full-pattern guard로 해석합니다.
export function parsePackageCatalogAdminCommand(message: string): PackageCatalogAdminCommand | undefined {
  const add = /^\/패키지추가\s+([^|]+)\|([^|]+)\|([^|]+)$/.exec(message);
  if (add) {
    const displayName = add[1]!.trim();
    const description = add[2]!.trim();
    if (displayName.length === 0 || description.length === 0) throw new PackageCatalogCommandError("PACKAGE_FIELDS_REQUIRED", "패키지 이름과 설명을 입력해 주세요.");
    return { kind: "ADD", displayName, description, rewards: parsePackageCatalogRewards(add[3]!) };
  }
  const edit = /^\/패키지수정\s+(\d+)\s+(?:[|:：]\s*)?(.+)$/.exec(message);
  if (edit) return { kind: "EDIT", listNumber: Number(edit[1]), rewards: parsePackageCatalogRewards(edit[2]!) };
  const remove = /^\/(패키지제거|패키지리스트제거)\s+(\d+)$/.exec(message);
  if (remove) return { kind: "REMOVE", listNumber: Number(remove[2]), alias: `/${remove[1]}` as "/패키지제거" | "/패키지리스트제거" };
  const enable = /^\/패키지활성\s+(\d+)$/.exec(message);
  if (enable) return { kind: "ENABLE", listNumber: Number(enable[1]) };
  return undefined;
}

// 동적 관리자 명령을 dispatcher 후보로만 좁혀 확인합니다.
export function isPackageCatalogAdminCommandCandidate(message: string): boolean {
  return /^\/(?:패키지추가|패키지수정|패키지제거|패키지리스트제거|패키지활성)(?:\s|$)/.test(message);
}

// argument가 있는 명령을 command_registry의 exact alias로 정규화합니다.
export function normalizePackageCatalogAdminDispatchMessage(message: string): string {
  const match = /^(\/(?:패키지추가|패키지수정|패키지제거|패키지리스트제거|패키지활성))(?:\s|$)/.exec(message);
  return match?.[1] ?? message;
}
