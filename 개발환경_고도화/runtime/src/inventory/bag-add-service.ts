import type { BagAddInput, BagAddRepository, BagAddResult, ParsedBagAddCommand } from "./bag-add.js";

const USAGE = "올바른 명령어 형식을 사용해주세요. 예: /가방추가 [유저명], [아이템명] [갯수]";

// Iris 메시지가 레거시 `/가방추가` 명령 후보인지 판별합니다.
export function isBagAddCommandCandidate(message: string | undefined): boolean {
  return message?.startsWith("/가방추가") === true;
}

// 쉼표로 구분한 대상명, 아이템명과 음수가 아닌 수량을 해석합니다.
export function parseBagAddCommand(message: string): ParsedBagAddCommand | null {
  const match = /^\/가방추가\s+([^,]+),\s+([^,]+)\s+(\d+)\s*$/.exec(message);
  if (match === null) return null;
  return {
    targetName: match[1]!.trim(),
    itemName: match[2]!.trim(),
    itemCount: BigInt(match[3]!)
  };
}

// 인벤토리 변경 권한 확인 후 가방 아이템 누적을 repository에 위임합니다.
export class BagAddService {
  constructor(private readonly repository: BagAddRepository) {}

  async handle(input: BagAddInput): Promise<BagAddResult> {
    const operatorId = await this.repository.findAuthorizedOperator(input.externalUserId);
    if (operatorId === null) return { status: "ignored_forbidden" };
    const parsed = parseBagAddCommand(input.message);
    if (parsed === null || parsed.targetName === "" || parsed.itemName === "") {
      return { status: "invalid_command", data: USAGE };
    }
    return this.repository.add({ ...input, ...parsed, operatorId });
  }
}
