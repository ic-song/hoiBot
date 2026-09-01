import type { DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface MiniPetEscrowAsset {
  ownedMiniPetId: bigint;
  version: bigint;
}

interface ReservedMiniPetRow {
  owned_mini_pet_id: bigint;
  version: bigint;
}

// 매물 수량과 예약된 stable 미니펫 수가 정확히 일치하는지 확인합니다.
export function requireMiniPetReservationQuantity(actual: number, expected: bigint): void {
  if (BigInt(actual) !== expected) {
    throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "거래할 미니펫 수량이 일치하지 않습니다.", 409);
  }
}

// 선택한 여러 미니펫을 한 매물의 논리 escrow로 원자 예약합니다.
export async function reserveMiniPetEscrow(transaction: DatabaseTransaction, input: {
  listingId: bigint;
  playerId: bigint;
  assets: readonly MiniPetEscrowAsset[];
}): Promise<void> {
  if (input.assets.length === 0) throw new ApplicationError("FREE_MARKET_ASSET_MISSING", "예약할 미니펫이 없습니다.", 409);
  const ids = input.assets.map((asset) => asset.ownedMiniPetId);
  if (new Set(ids.map(String)).size !== ids.length) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "같은 미니펫을 중복 예약할 수 없습니다.", 409);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await transaction.query<Array<{ id: bigint; version: bigint; equipped: number; reserved: number }>>(
    `SELECT pet.id,pet.version,pet.equipped,EXISTS(SELECT 1 FROM market_mini_pet_reservations reservation WHERE reservation.owned_mini_pet_id=pet.id) reserved
       FROM owned_mini_pets pet
      WHERE pet.player_id=? AND pet.id IN (${placeholders})
      ORDER BY pet.id FOR UPDATE`,
    [input.playerId, ...ids],
  );
  requireMiniPetReservationQuantity(rows.length, BigInt(input.assets.length));
  const expected = new Map(input.assets.map((asset) => [asset.ownedMiniPetId.toString(), asset.version]));
  for (const row of rows) {
    if (Number(row.equipped) !== 0 || Number(row.reserved) !== 0 || expected.get(row.id.toString()) !== row.version) {
      throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "미니펫 소유권이 먼저 변경되었습니다.", 409);
    }
    await transaction.execute(
      "INSERT INTO market_mini_pet_reservations(listing_id,owned_mini_pet_id,player_id,reserved_at) VALUES (?,?,?,UTC_TIMESTAMP(3))",
      [input.listingId, row.id, input.playerId],
    );
  }
}

// 취소 시 수량을 검증한 뒤 매물의 모든 미니펫 예약을 해제합니다.
export async function releaseMiniPetEscrow(transaction: DatabaseTransaction, input: {
  listingId: bigint;
  playerId: bigint;
  quantity: bigint;
}): Promise<void> {
  const rows = await transaction.query<Array<{ owned_mini_pet_id: bigint }>>(
    "SELECT owned_mini_pet_id FROM market_mini_pet_reservations WHERE listing_id=? AND player_id=? ORDER BY owned_mini_pet_id FOR UPDATE",
    [input.listingId, input.playerId],
  );
  requireMiniPetReservationQuantity(rows.length, input.quantity);
  await transaction.execute("DELETE FROM market_mini_pet_reservations WHERE listing_id=?", [input.listingId]);
}

// 구매 시 예약된 미니펫 전부를 구매자 가방으로 옮기고 이전 원장을 남깁니다.
export async function transferMiniPetEscrow(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  listingId: bigint;
  sellerPlayerId: bigint;
  buyerPlayerId: bigint;
  quantity: bigint;
}): Promise<void> {
  const rows = await transaction.query<ReservedMiniPetRow[]>(
    `SELECT reservation.owned_mini_pet_id,pet.version
       FROM market_mini_pet_reservations reservation
       JOIN owned_mini_pets pet ON pet.id=reservation.owned_mini_pet_id
      WHERE reservation.listing_id=? AND reservation.player_id=? AND pet.player_id=? AND pet.equipped=FALSE
      ORDER BY reservation.owned_mini_pet_id FOR UPDATE`,
    [input.listingId, input.sellerPlayerId, input.sellerPlayerId],
  );
  requireMiniPetReservationQuantity(rows.length, input.quantity);
  const next = (await transaction.query<Array<{ next_value: bigint }>>(
    "SELECT COALESCE(MAX(bag_sequence),0)+1 next_value FROM owned_mini_pets WHERE player_id=? FOR UPDATE",
    [input.buyerPlayerId],
  ))[0]?.next_value ?? 1n;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const changed = await transaction.execute(
      "UPDATE owned_mini_pets SET player_id=?,bag_sequence=?,version=version+1 WHERE id=? AND player_id=? AND equipped=FALSE AND version=?",
      [input.buyerPlayerId, next + BigInt(index), row.owned_mini_pet_id, input.sellerPlayerId, row.version],
    );
    if (changed.affectedRows !== 1n) throw new ApplicationError("FREE_MARKET_ASSET_CONFLICT", "미니펫 소유권이 먼저 변경되었습니다.", 409);
    await transaction.execute(
      "INSERT INTO market_mini_pet_transfer_ledger(operation_id,sequence_no,listing_id,owned_mini_pet_id,seller_player_id,buyer_player_id,version_before,version_after) VALUES (?,?,?,?,?,?,?,?)",
      [input.operationId, index + 1, input.listingId, row.owned_mini_pet_id, input.sellerPlayerId, input.buyerPlayerId, row.version, row.version + 1n],
    );
  }
  const remaining = await transaction.query<Array<{ id: bigint }>>(
    "SELECT id FROM owned_mini_pets WHERE player_id=? AND equipped=FALSE ORDER BY COALESCE(bag_sequence,id),id FOR UPDATE",
    [input.sellerPlayerId],
  );
  for (let index = 0; index < remaining.length; index += 1) {
    await transaction.execute("UPDATE owned_mini_pets SET bag_sequence=?,version=version+1 WHERE id=?", [index + 1, remaining[index]!.id]);
  }
  await transaction.execute("DELETE FROM market_mini_pet_reservations WHERE listing_id=?", [input.listingId]);
}
