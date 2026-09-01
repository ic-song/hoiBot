import type { DatabaseTransaction } from "../database.js";

export const FREE_MARKET_MEMBERSHIP_ITEM_CODE = "free_market_membership" as const;

// 자유시장 회원권 보유 여부를 stable item code와 양수 stack 수량으로 판정합니다.
export const FREE_MARKET_MEMBERSHIP_EXISTS_SQL = `EXISTS(
  SELECT 1
  FROM inventory_stacks stack
  JOIN item_definitions item ON item.id=stack.item_id
  WHERE stack.player_id=?
    AND stack.quantity>0
    AND item.code='${FREE_MARKET_MEMBERSHIP_ITEM_CODE}'
)`;

export async function hasFreeMarketMembership(
  transaction: Pick<DatabaseTransaction, "query">,
  playerId: bigint,
): Promise<boolean> {
  const rows = await transaction.query<Array<{ allowed: bigint | number }>>(
    `SELECT ${FREE_MARKET_MEMBERSHIP_EXISTS_SQL} allowed`,
    [playerId],
  );
  return String(rows[0]?.allowed ?? 0) === "1";
}
