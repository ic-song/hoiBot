import { ApplicationError } from "../shared/application-error.js";

export type MiniPetCollectionRegisterAction =
  | { kind: "usage" }
  | { kind: "preview"; bagNumbers: number[] }
  | { kind: "confirm"; confirmationToken: string }
  | { kind: "cancel"; confirmationToken: string };

export interface MiniPetCollectionRegisterInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface MiniPetCollectionRegisterResult {
  status: "usage" | "previewed" | "registered" | "cancelled" | "ignored";
  data?: string;
  confirmationToken?: string;
  expiresAt?: string;
  selectedStableOwnedIds?: string[];
  stageBefore?: number;
  stageAfter?: number;
  completedStage?: number;
  pointCost?: string;
  rewards?: Array<{ itemCode: string; quantity: string }>;
  titleCode?: string;
  outboxId?: string;
  auditId?: string;
}

export interface MiniPetCollectionRegisterRepository {
  preview(input: MiniPetCollectionRegisterInput, bagNumbers: number[]): Promise<MiniPetCollectionRegisterResult>;
  confirm(input: MiniPetCollectionRegisterInput, confirmationToken: string): Promise<MiniPetCollectionRegisterResult>;
  cancel(input: MiniPetCollectionRegisterInput, confirmationToken: string): Promise<MiniPetCollectionRegisterResult>;
}

const TOKEN_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PREVIEW_PATTERN = /^\/컬렉션등록(?:\s+\d+){1,8}$/;
const CONFIRM_PATTERN = new RegExp(`^/컬렉션등록\\s+(확인|취소)\\s+(${TOKEN_PATTERN})$`);
const USAGE = "사용법: /컬렉션등록 [가방번호 1~8개]\n확인: /컬렉션등록 확인 [확인번호]\n취소: /컬렉션등록 취소 [확인번호]";

// exact 명령 형식만 컬렉션 등록 dispatch 대상으로 분류합니다.
export function isMiniPetCollectionRegisterCommand(message: string | null | undefined): boolean {
  return message === "/컬렉션등록" || (typeof message === "string"
    && (PREVIEW_PATTERN.test(message) || CONFIRM_PATTERN.test(message)));
}

// 컬렉션 등록 안내, preview, 확인, 취소 입력을 구조화합니다.
export function parseMiniPetCollectionRegisterCommand(message: string): MiniPetCollectionRegisterAction | null {
  if (message === "/컬렉션등록") return { kind: "usage" };
  const confirmation = CONFIRM_PATTERN.exec(message);
  if (confirmation !== null) {
    return confirmation[1] === "확인"
      ? { kind: "confirm", confirmationToken: confirmation[2]! }
      : { kind: "cancel", confirmationToken: confirmation[2]! };
  }
  if (!PREVIEW_PATTERN.test(message)) return null;
  const bagNumbers = message.slice("/컬렉션등록".length).trim().split(/\s+/).map(Number);
  if (bagNumbers.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 100)) {
    throw new ApplicationError("MINIPET_COLLECTION_BAG_NUMBER_INVALID", "가방번호는 1부터 100까지만 사용할 수 있습니다.", 422);
  }
  if (new Set(bagNumbers).size !== bagNumbers.length) {
    throw new ApplicationError("MINIPET_COLLECTION_BAG_NUMBER_DUPLICATE", "같은 가방번호를 두 번 선택할 수 없습니다.", 422);
  }
  return { kind: "preview", bagNumbers };
}

// 컬렉션 등록 명령을 무변경 안내 또는 영속 repository 작업으로 전달합니다.
export class MiniPetCollectionRegisterService {
  constructor(private readonly repository: MiniPetCollectionRegisterRepository) {}

  async handle(input: MiniPetCollectionRegisterInput): Promise<MiniPetCollectionRegisterResult> {
    const action = parseMiniPetCollectionRegisterCommand(input.message);
    if (action === null) return { status: "ignored" };
    if (action.kind === "usage") return { status: "usage", data: USAGE };
    if (action.kind === "preview") return this.repository.preview(input, action.bagNumbers);
    if (action.kind === "confirm") return this.repository.confirm(input, action.confirmationToken);
    return this.repository.cancel(input, action.confirmationToken);
  }
}
