import { ApplicationError } from "../shared/application-error.js";
import type { BagRepository, BagView } from "./bag.js";

export function isBagCommand(message: string | undefined): boolean {
  return message === "/가방" || message === "ㄴㄴㄴ";
}

// 외부 identity에 연결된 가방 읽기 모델을 반환합니다.
export class GetBagService {
  constructor(private readonly repository: BagRepository) {}

  async execute(providerCode: string, externalUserId: string): Promise<BagView> {
    const bag = await this.repository.findByExternalIdentity(providerCode, externalUserId);
    if (bag === null) {
      throw new ApplicationError("IDENTITY_MAPPING_REQUIRED", "연결된 캐릭터를 찾을 수 없습니다.", 404);
    }
    return bag;
  }
}
