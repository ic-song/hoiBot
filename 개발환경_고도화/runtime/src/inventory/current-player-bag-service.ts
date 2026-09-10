import { ApplicationError } from "../shared/application-error.js";
import type { BagView } from "./bag.js";
import { compareLegacyBagItems } from "./legacy-bag-formatter.js";

const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const DEFAULT_PAGE_LIMIT = 20;

export interface CurrentPlayerBagRepository {
  findCurrentPlayerBag(playerId: string): Promise<BagView | null>;
}

export interface CurrentPlayerBagRequest {
  currentPlayerId: string;
  limit?: number;
  offset?: number;
}

export interface CurrentPlayerBagResponse {
  ownerLabel: string;
  advertisement: string;
  items: Array<{
    displayName: string;
    quantity: string;
  }>;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

// 세션에서 확정된 현재 player_id가 unsigned 64-bit 범위인지 검증합니다.
function requireCurrentPlayerId(value: string): string {
  if (!/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > MAX_UNSIGNED_BIGINT) {
    throw new ApplicationError("CURRENT_PLAYER_CONTEXT_INVALID", "현재 게임계정 정보를 확인할 수 없습니다.", 401);
  }
  return value;
}

// 현재 사용자 자신의 가방을 레거시 순서로 정렬하고 페이지 단위 read model로 반환합니다.
export class CurrentPlayerBagService {
  constructor(private readonly repository: CurrentPlayerBagRepository) {}

  async execute(input: CurrentPlayerBagRequest): Promise<CurrentPlayerBagResponse> {
    const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new ApplicationError("BAG_PAGINATION_INVALID", "가방 페이지 범위를 확인해 주세요.", 422);
    }

    const bag = await this.repository.findCurrentPlayerBag(requireCurrentPlayerId(input.currentPlayerId));
    if (bag === null) {
      throw new ApplicationError("CURRENT_PLAYER_NOT_AVAILABLE", "현재 게임계정을 찾을 수 없습니다.", 404);
    }
    const orderedItems = bag.items
      .filter((item) => BigInt(item.quantity) > 0n)
      .slice()
      .sort(compareLegacyBagItems);
    const items = orderedItems.slice(offset, offset + limit).map((item) => ({
      displayName: item.displayName,
      quantity: item.quantity
    }));
    return {
      ownerLabel: bag.ownerLabel,
      advertisement: bag.advertisement,
      items,
      pagination: {
        limit,
        offset,
        total: orderedItems.length,
        hasMore: offset + items.length < orderedItems.length
      }
    };
  }
}
