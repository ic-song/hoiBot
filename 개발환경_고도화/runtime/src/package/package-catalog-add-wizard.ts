export type PackageCatalogWizardStep = "NAME" | "DESC" | "REWARD_CHOICE" | "POINT_COUNT" | "ITEM_NAME" | "ITEM_COUNT" | "CONFIRM";

export type PackageCatalogWizardReward =
  | { rewardType: "POINT"; assetCode: "POINT"; quantity: bigint }
  | { rewardType: "ITEM"; assetCode: string; quantity: bigint };

export interface PackageCatalogWizardDraft {
  step: PackageCatalogWizardStep;
  name: string;
  description: string;
  rewards: readonly PackageCatalogWizardReward[];
  pendingItemName?: string;
}

export type PackageCatalogWizardInput =
  | { kind: "GUIDE" }
  | { kind: "START" }
  | { kind: "CANCEL" }
  | { kind: "STATUS" }
  | { kind: "FLOW"; text: string };

// exact 제어명령을 단계형 패키지 입력으로 변환합니다.
export function parsePackageCatalogWizardControl(message: string): PackageCatalogWizardInput | undefined {
  if (message === "/패키지추가방법") return { kind: "GUIDE" };
  if (message === "/패키지추가시작") return { kind: "START" };
  if (message === "/패키지추가취소") return { kind: "CANCEL" };
  if (message === "/패키지추가상태") return { kind: "STATUS" };
  return undefined;
}

// 단계형 패키지 제어명령 후보만 exact guard로 확인합니다.
export function isPackageCatalogWizardControl(message: string): boolean {
  return parsePackageCatalogWizardControl(message) !== undefined;
}

// 쉼표 없는 양의 정수 수량만 bigint로 검증합니다.
export function parseWizardQuantity(text: string): bigint | undefined {
  if (!/^\d+$/.test(text)) return undefined;
  const quantity = BigInt(text);
  return quantity > 0n ? quantity : undefined;
}

// legacy 단계별 보상 선택값을 정규화합니다.
export function parseWizardRewardChoice(text: string): "POINT" | "ITEM" | "DONE" | "CANCEL" | undefined {
  if (text === "1" || text === "포인트") return "POINT";
  if (text === "2" || text === "아이템") return "ITEM";
  if (text === "3" || text === "완료") return "DONE";
  if (text === "4" || text === "취소") return "CANCEL";
  return undefined;
}

// 단계형 추가 방법 안내를 legacy 문구 순서로 생성합니다.
export function formatPackageCatalogWizardGuide(): string {
  return [
    "📦 패키지 추가/제거 방법", "", "단계별 추가:", "/패키지추가시작", "",
    "추가:", "/패키지추가 패키지명 | 설명 | 보상목록", "", "수정:",
    "/패키지수정 리스트번호 보상목록", "", "보상목록 형식:",
    "item:아이템명:수량, point:포인트수량", "아이템명 x수량, 아이템명 x수량",
    "※ 패키지명 하나만 사용하며, 가방에도 같은 이름으로 표시됩니다.", "", "제거:",
    "/패키지제거 리스트번호", "/패키지리스트제거 리스트번호", "", "재활성:",
    "/패키지활성 리스트번호",
  ].join("\n");
}

// 현재 보상 목록을 legacy 표시 형식으로 생성합니다.
export function formatWizardRewards(rewards: readonly PackageCatalogWizardReward[]): string {
  if (rewards.length === 0) return "- 없음";
  return rewards.map((reward) => reward.rewardType === "POINT"
    ? `- 포인트 🅟${reward.quantity.toLocaleString("en-US")}`
    : `- ${reward.assetCode} x${reward.quantity.toLocaleString("en-US")}`).join("\n");
}

// 현재 persistent draft 상태를 관리자용 메시지로 생성합니다.
export function formatPackageCatalogWizardStatus(draft?: PackageCatalogWizardDraft): string {
  if (!draft) return "ℹ️ 진행 중인 패키지 추가가 없습니다.";
  return ["📦 패키지 추가 진행 상태", "", `단계: ${draft.step}`, `패키지: ${draft.name || "-"}`,
    `설명: ${draft.description || "-"}`, "보상:", formatWizardRewards(draft.rewards)].join("\n");
}
