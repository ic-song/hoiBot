import type { BagSellInput, BagSellRepository, BagSellResult } from "./bag-sell.js";
import { parseBagSellCommand } from "./bag-sell.js";

const USAGE = "사용법: /판매 [가방번호] [수량]\n수량을 생략하면 해당 아이템을 모두 판매합니다.";

export class BagSellService {
  constructor(private readonly repository: BagSellRepository) {}

  async execute(input: BagSellInput): Promise<BagSellResult> {
    const parsed = parseBagSellCommand(input.message);
    if (parsed === null) return { status: "invalid_command", data: USAGE };
    return this.repository.sell({ ...input, ...parsed });
  }
}
