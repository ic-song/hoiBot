import {
  formatPackageCatalogWizardGuide,
  formatPackageCatalogWizardStatus,
  formatWizardRewards,
  parseWizardQuantity,
  parseWizardRewardChoice,
  type PackageCatalogWizardDraft,
  type PackageCatalogWizardInput,
  type PackageCatalogWizardReward,
} from "./package-catalog-add-wizard.js";

export interface PackageCatalogWizardSession {
  sessionId: string;
  operatorId: string;
  version: bigint;
  baseCatalogVersion: bigint;
  expiresAt: Date;
  draft: PackageCatalogWizardDraft;
}

export interface PackageCatalogWizardResult {
  message: string;
  replayed: boolean;
  session?: PackageCatalogWizardSession;
  packageId?: string;
  outboxId?: string;
}

export interface PackageCatalogWizardRepository {
  findReplay(requestKey: string): Promise<PackageCatalogWizardResult | undefined>;
  readActive(operatorId: string, now: Date): Promise<PackageCatalogWizardSession | undefined>;
  start(input: { operatorId: string; requestKey: string; now: Date; expiresAt: Date }): Promise<PackageCatalogWizardResult>;
  cancel(input: { operatorId: string; requestKey: string; expectedVersion?: bigint; message: string }): Promise<PackageCatalogWizardResult>;
  transition(input: { operatorId: string; requestKey: string; expectedVersion: bigint; draft: PackageCatalogWizardDraft; message: string }): Promise<PackageCatalogWizardResult>;
  finalize(input: { operatorId: string; requestKey: string; expectedVersion: bigint; baseCatalogVersion: bigint; draft: PackageCatalogWizardDraft; message: string }): Promise<PackageCatalogWizardResult>;
}

const START_MESSAGE = ["📦 패키지 추가를 시작합니다.", "", "1단계: 패키지 이름을 입력해주세요.", "", "예:",
  "이벤트패키지🎁", "", "※ 별도 가방 아이템명은 사용하지 않고 패키지 이름으로 저장됩니다.",
  "취소하려면 \"취소\" 또는 /패키지추가취소"].join("\n");

// 보상 선택 안내를 현재 reward 순서와 함께 생성합니다.
function rewardChoiceMessage(rewards: readonly PackageCatalogWizardReward[]): string {
  const lines = ["3단계: 무엇을 추가할까요?", "", "1. 포인트", "2. 아이템", "3. 완료", "4. 취소", "", "숫자 또는 이름으로 입력할 수 있습니다.", "예: 1 또는 포인트"];
  if (rewards.length > 0) lines.push("", "현재 보상:", formatWizardRewards(rewards));
  return lines.join("\n");
}

// 최종 등록 전 미리보기 메시지를 생성합니다.
function previewMessage(draft: PackageCatalogWizardDraft): string {
  return ["📦 패키지 추가 미리보기", "", `패키지: ${draft.name}`, `설명: ${draft.description}`, "", "보상:",
    formatWizardRewards(draft.rewards), "", "등록하려면 \"등록\"", "보상을 더 추가하려면 \"수정\"", "취소하려면 \"취소\""].join("\n");
}

export class PackageCatalogAddWizardService {
  public constructor(private readonly repository: PackageCatalogWizardRepository, private readonly ttlMs = 30 * 60 * 1000) {}

  // 관리자 제어명령 또는 active-session 일반 입력을 처리합니다.
  public async execute(input: { operatorId: string; requestKey: string; command: PackageCatalogWizardInput; now?: Date }): Promise<PackageCatalogWizardResult> {
    const replay = await this.repository.findReplay(input.requestKey);
    if (replay) return { ...replay, replayed: true };
    const now = input.now ?? new Date();
    if (input.command.kind === "GUIDE") return { message: formatPackageCatalogWizardGuide(), replayed: false };
    const session = await this.repository.readActive(input.operatorId, now);
    if (input.command.kind === "STATUS") return { message: formatPackageCatalogWizardStatus(session?.draft), replayed: false, session };
    if (input.command.kind === "START") {
      return this.repository.start({ operatorId: input.operatorId, requestKey: input.requestKey, now, expiresAt: new Date(now.getTime() + this.ttlMs) });
    }
    if (input.command.kind === "CANCEL") {
      return this.repository.cancel({ operatorId: input.operatorId, requestKey: input.requestKey, expectedVersion: session?.version,
        message: session ? "✅ 패키지 추가가 취소되었습니다." : "ℹ️ 진행 중인 패키지 추가가 없습니다." });
    }
    if (!session) return { message: "ℹ️ 진행 중인 패키지 추가가 없습니다.", replayed: false };
    return this.handleFlow(input.operatorId, input.requestKey, session, input.command.text.trim());
  }

  // active draft의 한 단계만 optimistic version으로 전이합니다.
  private async handleFlow(operatorId: string, requestKey: string, session: PackageCatalogWizardSession, text: string): Promise<PackageCatalogWizardResult> {
    if (!text) return { message: "❌ 값을 입력해주세요.", replayed: false, session };
    if (text === "취소") return this.repository.cancel({ operatorId, requestKey, expectedVersion: session.version, message: "✅ 패키지 추가가 취소되었습니다." });
    const draft = session.draft;
    let next: PackageCatalogWizardDraft;
    let message: string;
    if (draft.step === "NAME") {
      next = { ...draft, name: text, step: "DESC" };
      message = `✅ 1단계 입력 완료\n\n패키지 이름:\n${text}\n\n2단계: 패키지 설명을 입력해주세요.`;
    } else if (draft.step === "DESC") {
      next = { ...draft, description: text, step: "REWARD_CHOICE" };
      message = `✅ 2단계 입력 완료\n\n${rewardChoiceMessage(next.rewards)}`;
    } else if (draft.step === "REWARD_CHOICE") {
      const choice = parseWizardRewardChoice(text);
      if (choice === "CANCEL") return this.repository.cancel({ operatorId, requestKey, expectedVersion: session.version, message: "✅ 패키지 추가가 취소되었습니다." });
      if (choice === "POINT") { next = { ...draft, step: "POINT_COUNT" }; message = "포인트 수량을 입력해주세요.\n예: 10000000"; }
      else if (choice === "ITEM") { next = { ...draft, step: "ITEM_NAME" }; message = "아이템명을 입력해주세요.\n예: 펫 강화석⭐"; }
      else if (choice === "DONE" && draft.rewards.length > 0) { next = { ...draft, step: "CONFIRM" }; message = previewMessage(next); }
      else return { message: choice === "DONE" ? "❌ 보상을 1개 이상 추가해야 합니다." : "❌ 1/포인트, 2/아이템, 3/완료, 4/취소 중 하나를 입력해주세요.", replayed: false, session };
    } else if (draft.step === "POINT_COUNT") {
      const quantity = parseWizardQuantity(text);
      if (!quantity) return { message: "❌ 포인트 수량은 1 이상 숫자로 입력해주세요.", replayed: false, session };
      const reward: PackageCatalogWizardReward = { rewardType: "POINT", assetCode: "POINT", quantity };
      next = { ...draft, rewards: [...draft.rewards, reward], step: "REWARD_CHOICE" };
      message = `✅ 보상 추가 완료\n- 포인트 🅟${quantity.toLocaleString("en-US")}\n\n${rewardChoiceMessage(next.rewards)}`;
    } else if (draft.step === "ITEM_NAME") {
      next = { ...draft, pendingItemName: text, step: "ITEM_COUNT" };
      message = "수량을 입력해주세요.\n예: 10";
    } else if (draft.step === "ITEM_COUNT") {
      const quantity = parseWizardQuantity(text);
      if (!quantity) return { message: "❌ 아이템 수량은 1 이상 숫자로 입력해주세요.", replayed: false, session };
      if (!draft.pendingItemName) return { message: "❌ 아이템명이 없습니다. 아이템명을 다시 입력해주세요.", replayed: false, session };
      const reward: PackageCatalogWizardReward = { rewardType: "ITEM", assetCode: draft.pendingItemName, quantity };
      next = { ...draft, pendingItemName: undefined, rewards: [...draft.rewards, reward], step: "REWARD_CHOICE" };
      message = `✅ 보상 추가 완료\n- ${reward.assetCode} x${quantity.toLocaleString("en-US")}\n\n${rewardChoiceMessage(next.rewards)}`;
    } else {
      if (text === "등록") return this.repository.finalize({ operatorId, requestKey, expectedVersion: session.version, baseCatalogVersion: session.baseCatalogVersion, draft,
        message: `✅ 패키지 추가 완료\n\n패키지: ${draft.name}\n구성: ${formatWizardRewards(draft.rewards).replace(/^- /gm, "")}` });
      if (text === "수정") { next = { ...draft, step: "REWARD_CHOICE" }; message = rewardChoiceMessage(next.rewards); }
      else return { message: "❌ 등록, 수정, 취소 중 하나를 입력해주세요.", replayed: false, session };
    }
    return this.repository.transition({ operatorId, requestKey, expectedVersion: session.version, draft: next, message });
  }

  public static startMessage(): string { return START_MESSAGE; }
}
