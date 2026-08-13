import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { formatDecimal3, nonNegativeInteger, parseDecimal3, positiveInteger } from "../shared/numeric-policy.js";
import { TransactionalOperationRunner, type OperationActor } from "../shared/transactional-operation.js";

interface MarketCommandBase { reason: string; reasonCode: string; idempotencyKey: string; actor: OperationActor; sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system"; }
type ListingAsset = { type: "stack"; itemCode: string; quantity: string; expectedVersion: string } | { type: "instance"; instanceId: string; expectedVersion: string };

// 거래소 자산 예약·결제·정산·원장을 하나의 트랜잭션 경계로 처리합니다.
export class MarketService {
  private readonly operations: TransactionalOperationRunner;
  constructor(database: DatabaseClient) { this.operations = new TransactionalOperationRunner(database); }

  async createListing(command: MarketCommandBase & { sellerPlayerId: string; asset: ListingAsset; currencyCode: string; priceAmount: string; expiresAt: Date }): Promise<{ listingId: string; version: string; auditId: string }> {
    const price = parseDecimal3(command.priceAmount, "priceAmount"); if (price <= 0n) throw new ApplicationError("INVALID_MARKET_PRICE", "판매 가격은 0보다 커야 합니다.", 422);
    if (command.expiresAt.getTime() <= Date.now()) throw new ApplicationError("INVALID_MARKET_EXPIRY", "매물 만료 시각은 미래여야 합니다.", 422);
    return this.operations.run({ scope: `market.listing.create:${command.sellerPlayerId}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "market.listing.create", targetType: "player", targetId: command.sellerPlayerId,
      reason: command.reason, outboxType: "market.listing.created" }, async (transaction, operationId) => {
      const currencies = await transaction.query<Array<{ code: string }>>("SELECT code FROM currency_definitions WHERE code = ? AND active = TRUE", [command.currencyCode]);
      if (currencies[0] === undefined) throw new ApplicationError("CURRENCY_NOT_FOUND", "판매 재화를 찾을 수 없습니다.", 404);
      let itemId: bigint; let instanceId: bigint | null = null; let quantity = 1n;
      if (command.asset.type === "stack") {
        quantity = positiveInteger(command.asset.quantity, "quantity");
        const items = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE", [command.asset.itemCode]);
        if (items[0] === undefined) throw new ApplicationError("STACKABLE_ITEM_NOT_FOUND", "판매 가능한 stack 아이템을 찾을 수 없습니다.", 404);
        itemId = items[0].id;
        const stacks = await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE", [command.sellerPlayerId, itemId]);
        const stack = stacks[0]; if (stack === undefined || stack.quantity < quantity) throw new ApplicationError("INSUFFICIENT_ITEM", "판매할 아이템 수량이 부족합니다.", 409);
        if (stack.version.toString() !== command.asset.expectedVersion) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
        await transaction.execute("UPDATE inventory_stacks SET quantity = quantity - ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [quantity, command.sellerPlayerId, itemId, stack.version]);
        await transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, ?)", [operationId, command.sellerPlayerId, itemId, -quantity, command.reasonCode]);
      } else {
        positiveInteger(command.asset.instanceId, "instanceId");
        const instances = await transaction.query<Array<{ id: bigint; item_id: bigint; version: bigint; status: string; player_id: bigint }>>("SELECT id, item_id, version, status, player_id FROM inventory_instances WHERE id = ? FOR UPDATE", [command.asset.instanceId]);
        const instance = instances[0];
        if (instance === undefined || instance.player_id.toString() !== command.sellerPlayerId || instance.status !== "owned") throw new ApplicationError("INSTANCE_NOT_OWNED", "판매할 instance를 소유하고 있지 않습니다.", 409);
        if (instance.version.toString() !== command.asset.expectedVersion) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "아이템 소유권이 먼저 변경되었습니다.", 409);
        itemId = instance.item_id; instanceId = instance.id;
        await transaction.execute("UPDATE inventory_instances SET status = 'reserved', version = version + 1 WHERE id = ? AND version = ?", [instance.id, instance.version]);
      }
      const listing = await transaction.execute(`INSERT INTO market_listings
        (seller_player_id, asset_type_code, item_id, inventory_instance_id, quantity, price_currency_code, price_amount, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [command.sellerPlayerId, command.asset.type, itemId, instanceId, quantity, command.currencyCode, formatDecimal3(price), command.expiresAt]);
      await transaction.execute("INSERT INTO market_asset_reservations (listing_id, reservation_key, reserved_at, expires_at) VALUES (?, UUID(), UTC_TIMESTAMP(3), ?)", [listing.insertId, command.expiresAt]);
      await transaction.execute("INSERT INTO market_events (listing_id, operation_id, event_code, detail_json) VALUES (?, ?, 'created', ?)", [listing.insertId, operationId, JSON.stringify({ assetType: command.asset.type, quantity: quantity.toString() })]);
      return { result: { listingId: listing.insertId.toString(), version: "1" }, changeSummary: { listingId: listing.insertId.toString(), priceAmount: formatDecimal3(price), currencyCode: command.currencyCode } };
    });
  }

  async buyListing(command: MarketCommandBase & { listingId: string; buyerPlayerId: string; expectedVersion: string; feeBasisPoints: string }): Promise<{ settlementId: string; listingVersion: string; grossAmount: string; feeAmount: string; netAmount: string; auditId: string }> {
    const feeBasisPoints = nonNegativeInteger(command.feeBasisPoints, "feeBasisPoints");
    if (feeBasisPoints > 10_000n) throw new ApplicationError("INVALID_MARKET_FEE", "수수료는 0~10000bp여야 합니다.", 422);
    return this.operations.run({ scope: `market.listing.buy:${command.listingId}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "market.listing.buy", targetType: "market_listing", targetId: command.listingId,
      reason: command.reason, outboxType: "market.listing.sold" }, async (transaction, operationId) => {
      const rows = await transaction.query<Array<{ seller_player_id: bigint; asset_type_code: string; item_id: bigint; inventory_instance_id: bigint | null; quantity: bigint; price_currency_code: string; price_amount: string; status: string; version: bigint; expires_at: Date | null }>>(
        "SELECT seller_player_id, asset_type_code, item_id, inventory_instance_id, quantity, price_currency_code, price_amount, status, version, expires_at FROM market_listings WHERE id = ? FOR UPDATE", [command.listingId]);
      const listing = rows[0]; if (listing === undefined) throw new ApplicationError("MARKET_LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.", 404);
      if (listing.status !== "open" || (listing.expires_at !== null && listing.expires_at.getTime() <= Date.now())) throw new ApplicationError("MARKET_LISTING_CLOSED", "구매할 수 없는 매물입니다.", 409);
      if (listing.version.toString() !== command.expectedVersion) throw new ApplicationError("MARKET_VERSION_CONFLICT", "매물이 먼저 변경되었습니다.", 409);
      if (listing.seller_player_id.toString() === command.buyerPlayerId) throw new ApplicationError("SELF_MARKET_PURCHASE", "자신의 매물은 구매할 수 없습니다.", 422);
      const gross = parseDecimal3(listing.price_amount, "priceAmount"); const fee = gross * feeBasisPoints / 10_000n; const net = gross - fee;
      const balances = await this.lockCurrencyAccounts(transaction, [command.buyerPlayerId, listing.seller_player_id.toString()], listing.price_currency_code);
      const buyer = balances.get(command.buyerPlayerId)!; const seller = balances.get(listing.seller_player_id.toString())!;
      if (buyer.balance < gross) throw new ApplicationError("INSUFFICIENT_CURRENCY", "구매 재화가 부족합니다.", 409);
      const buyerAfter = buyer.balance - gross; const sellerAfter = seller.balance + net;
      await transaction.execute("UPDATE currency_accounts SET balance = ?, version = version + 1 WHERE player_id = ? AND currency_code = ? AND version = ?", [formatDecimal3(buyerAfter), command.buyerPlayerId, listing.price_currency_code, buyer.version]);
      await transaction.execute("UPDATE currency_accounts SET balance = ?, version = version + 1 WHERE player_id = ? AND currency_code = ? AND version = ?", [formatDecimal3(sellerAfter), listing.seller_player_id, listing.price_currency_code, seller.version]);
      await transaction.execute(`INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES
        (?, 1, ?, ?, ?, ?, ?), (?, 2, ?, ?, ?, ?, ?)`, [operationId, command.buyerPlayerId, listing.price_currency_code, formatDecimal3(-gross), formatDecimal3(buyerAfter), command.reasonCode,
        operationId, listing.seller_player_id, listing.price_currency_code, formatDecimal3(net), formatDecimal3(sellerAfter), command.reasonCode]);
      if (listing.asset_type_code === "stack") {
        await transaction.execute("INSERT IGNORE INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, 0, 0)", [command.buyerPlayerId, listing.item_id]);
        const stackRows = await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE", [command.buyerPlayerId, listing.item_id]);
        const stack = stackRows[0]!;
        await transaction.execute("UPDATE inventory_stacks SET quantity = quantity + ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [listing.quantity, command.buyerPlayerId, listing.item_id, stack.version]);
        await transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, ?)", [operationId, command.buyerPlayerId, listing.item_id, listing.quantity, command.reasonCode]);
      } else {
        await transaction.execute("UPDATE inventory_instances SET player_id = ?, status = 'owned', version = version + 1 WHERE id = ? AND status = 'reserved'", [command.buyerPlayerId, listing.inventory_instance_id]);
      }
      const settlement = await transaction.execute("INSERT INTO market_settlements (operation_id, listing_id, buyer_player_id, gross_amount, fee_amount, net_amount, settled_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))", [operationId, command.listingId, command.buyerPlayerId, formatDecimal3(gross), formatDecimal3(fee), formatDecimal3(net)]);
      await transaction.execute("INSERT INTO market_fee_ledger (operation_id, listing_id, currency_code, amount, reason_code) VALUES (?, ?, ?, ?, ?)", [operationId, command.listingId, listing.price_currency_code, formatDecimal3(fee), command.reasonCode]);
      const version = listing.version + 1n;
      await transaction.execute("UPDATE market_listings SET status = 'sold', version = ?, closed_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?", [version, command.listingId, listing.version]);
      await transaction.execute("DELETE FROM market_asset_reservations WHERE listing_id = ?", [command.listingId]);
      await transaction.execute("INSERT INTO market_events (listing_id, operation_id, event_code, detail_json) VALUES (?, ?, 'sold', ?)", [command.listingId, operationId, JSON.stringify({ buyerPlayerId: command.buyerPlayerId, feeBasisPoints: feeBasisPoints.toString() })]);
      return { result: { settlementId: settlement.insertId.toString(), listingVersion: version.toString(), grossAmount: formatDecimal3(gross), feeAmount: formatDecimal3(fee), netAmount: formatDecimal3(net) }, changeSummary: { listingId: command.listingId, buyerPlayerId: command.buyerPlayerId, grossAmount: formatDecimal3(gross), feeAmount: formatDecimal3(fee) } };
    });
  }

  async cancelListing(command: MarketCommandBase & { listingId: string; sellerPlayerId: string; expectedVersion: string }): Promise<{ listingVersion: string; auditId: string }> {
    return this.operations.run({ scope: `market.listing.cancel:${command.listingId}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "market.listing.cancel", targetType: "market_listing", targetId: command.listingId,
      reason: command.reason, outboxType: "market.listing.cancelled" }, async (transaction, operationId) => {
      const rows = await transaction.query<Array<{ seller_player_id: bigint; asset_type_code: string; item_id: bigint; inventory_instance_id: bigint | null; quantity: bigint; status: string; version: bigint }>>("SELECT seller_player_id, asset_type_code, item_id, inventory_instance_id, quantity, status, version FROM market_listings WHERE id = ? FOR UPDATE", [command.listingId]);
      const listing = rows[0]; if (listing === undefined || listing.seller_player_id.toString() !== command.sellerPlayerId) throw new ApplicationError("MARKET_LISTING_NOT_FOUND", "판매자의 매물을 찾을 수 없습니다.", 404);
      if (listing.status !== "open") throw new ApplicationError("MARKET_LISTING_CLOSED", "취소할 수 없는 매물입니다.", 409);
      if (listing.version.toString() !== command.expectedVersion) throw new ApplicationError("MARKET_VERSION_CONFLICT", "매물이 먼저 변경되었습니다.", 409);
      if (listing.asset_type_code === "stack") {
        const stacks = await transaction.query<Array<{ version: bigint }>>("SELECT version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE", [command.sellerPlayerId, listing.item_id]);
        await transaction.execute("UPDATE inventory_stacks SET quantity = quantity + ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [listing.quantity, command.sellerPlayerId, listing.item_id, stacks[0]!.version]);
        await transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, ?)", [operationId, command.sellerPlayerId, listing.item_id, listing.quantity, command.reasonCode]);
      } else {
        await transaction.execute("UPDATE inventory_instances SET status = 'owned', version = version + 1 WHERE id = ? AND player_id = ? AND status = 'reserved'", [listing.inventory_instance_id, command.sellerPlayerId]);
      }
      const version = listing.version + 1n;
      await transaction.execute("UPDATE market_listings SET status = 'cancelled', version = ?, closed_at = UTC_TIMESTAMP(3) WHERE id = ? AND version = ?", [version, command.listingId, listing.version]);
      await transaction.execute("DELETE FROM market_asset_reservations WHERE listing_id = ?", [command.listingId]);
      await transaction.execute("INSERT INTO market_events (listing_id, operation_id, event_code) VALUES (?, ?, 'cancelled')", [command.listingId, operationId]);
      return { result: { listingVersion: version.toString() }, changeSummary: { listingId: command.listingId, sellerPlayerId: command.sellerPlayerId } };
    });
  }

  private async lockCurrencyAccounts(transaction: DatabaseTransaction, playerIds: string[], currencyCode: string): Promise<Map<string, { balance: bigint; version: bigint }>> {
    const sorted = [...new Set(playerIds)].sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
    for (const playerId of sorted) await transaction.execute("INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, ?, 0, 0)", [playerId, currencyCode]);
    const result = new Map<string, { balance: bigint; version: bigint }>();
    for (const playerId of sorted) {
      const rows = await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = ? FOR UPDATE", [playerId, currencyCode]);
      result.set(playerId, { balance: parseDecimal3(rows[0]!.balance, "balance"), version: rows[0]!.version });
    }
    return result;
  }
}
