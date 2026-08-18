import type {
  BagAttributeInput,
  BagAttributeRepository,
  BagAttributeResult,
  ParsedBagAttributeCommand
} from "./bag-attribute.js";

const USAGE = "올바른 명령어 형식을 사용해주세요. 예: /가방속성 [유저명] [아이템번호] [갯수]";

// Iris 메시지가 레거시 `/가방속성` 명령 후보인지 판별합니다.
export function isBagAttributeCommandCandidate(message: string | undefined): boolean {
  return message?.startsWith("/가방속성") === true;
}

// 레거시의 공백 허용 대상명과 숫자 인자 형식을 그대로 해석합니다.
export function parseBagAttributeCommand(message: string): ParsedBagAttributeCommand | null {
  const match = /^\/가방속성\s+([^]+)\s+(\d+)\s+(\d+)\s*$/.exec(message);
  if (match === null) return null;
  return {
    targetName: match[1]!,
    itemNumber: Number.parseInt(match[2]!, 10),
    itemCount: BigInt(match[3]!)
  };
}

// Master 권한 확인 후 레거시 명령 형식과 DB 변경을 repository에 위임합니다.
export class BagAttributeService {
  constructor(private readonly repository: BagAttributeRepository) {}

  async handle(input: BagAttributeInput): Promise<BagAttributeResult> {
    const operatorId = await this.repository.findAuthorizedOperator(input.externalUserId);
    if (operatorId === null) return { status: "ignored_forbidden" };

    const parsed = parseBagAttributeCommand(input.message);
    if (parsed === null) return { status: "invalid_command", data: USAGE };
    return this.repository.adjust({ ...input, ...parsed, operatorId });
  }
}
