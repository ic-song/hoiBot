import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { CurrencyService } from "../src/currency/currency-service.js";
import { InventoryService } from "../src/inventory/inventory-service.js";
import { PetService } from "../src/pet/pet-service.js";
import { GuildService } from "../src/guild/guild-service.js";
import { HomeSocialService } from "../src/home/home-social-service.js";
import { EventRankingService } from "../src/event/event-ranking-service.js";
import { MarketService } from "../src/market/market-service.js";
import { ApplicationError } from "../src/shared/application-error.js";

const config = loadConfig();
if (!config.database.enabled || !config.database.name.startsWith("hoibot_import_verify_")) {
  throw new Error("Domain mutation probe may run only against a disposable hoibot_import_verify_* database.");
}
const database = createDatabaseClient(config.database);
const key = (name: string) => `${name}-${randomUUID()}`;
try {
  const players = await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id LIMIT 2");
  if (players.length < 2) throw new Error("Two imported players are required.");
  const sellerId = players[0]!.id.toString(); const buyerId = players[1]!.id.toString();
  const actor = { type: "player" as const, id: sellerId };
  const currency = new CurrencyService(database); const inventory = new InventoryService(database); const pet = new PetService(database);
  const guild = new GuildService(database); const home = new HomeSocialService(database); const event = new EventRankingService(database); const market = new MarketService(database);

  const sellerCurrency = await database.query<Array<{ version: bigint }>>("SELECT version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point'", [sellerId]);
  const currencyResult = await currency.adjust({ playerId: sellerId, currencyCode: "point", delta: "10.125", expectedVersion: sellerCurrency[0]?.version.toString() ?? "0", reasonCode: "probe", reason: "domain probe", idempotencyKey: key("currency"), actor, sourceCode: "system" });
  const duplicateKey = key("currency-duplicate");
  const beforeDuplicate = await database.query<Array<{ version: bigint }>>("SELECT version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point'", [sellerId]);
  const firstDuplicate = await currency.adjust({ playerId: sellerId, currencyCode: "point", delta: "1", expectedVersion: beforeDuplicate[0]!.version.toString(), reasonCode: "probe", reason: "idempotency probe", idempotencyKey: duplicateKey, actor, sourceCode: "system" });
  const secondDuplicate = await currency.adjust({ playerId: sellerId, currencyCode: "point", delta: "1", expectedVersion: beforeDuplicate[0]!.version.toString(), reasonCode: "probe", reason: "idempotency probe", idempotencyKey: duplicateKey, actor, sourceCode: "system" });

  await database.execute("INSERT INTO item_definitions (code, display_name, asset_type_code, stackable) VALUES ('probe_stack', '검증 스택', 'item', TRUE), ('probe_instance', '검증 인스턴스', 'equipment', FALSE)");
  const stack = await inventory.changeStack({ playerId: sellerId, itemCode: "probe_stack", quantityDelta: "5", expectedVersion: "0", reasonCode: "probe", reason: "domain probe", idempotencyKey: key("stack"), actor, sourceCode: "system" });
  const instance = await inventory.grantInstance({ playerId: sellerId, itemCode: "probe_instance", reasonCode: "probe", reason: "domain probe", idempotencyKey: key("instance"), actor, sourceCode: "system" });
  const transferredInstance = await inventory.transferInstance({ playerId: sellerId, toPlayerId: buyerId, instanceId: instance.instanceId, expectedVersion: "1", reasonCode: "probe", reason: "domain probe", idempotencyKey: key("instance-transfer"), actor, sourceCode: "system" });

  const petRows = await database.query<Array<{ player_id: bigint; version: bigint }>>("SELECT player_id, version FROM player_pets ORDER BY id LIMIT 1");
  const petPlayerId = petRows[0]!.player_id.toString();
  const petExperience = await pet.gainExperience({ playerId: petPlayerId, amount: "7", expectedVersion: petRows[0]!.version.toString(), reason: "domain probe", idempotencyKey: key("pet-exp"), actor, sourceCode: "system" });
  await database.execute("INSERT INTO skill_definitions (code, display_name, active) VALUES ('probe_skill', '검증 스킬', TRUE)");
  const petSkill = await pet.equipSkill({ playerId: petPlayerId, slotNo: "1", skillCode: "probe_skill", level: "2", expectedVersion: petExperience.version, reason: "domain probe", idempotencyKey: key("pet-skill"), actor, sourceCode: "system" });
  const petEquipmentInstance = await inventory.grantInstance({ playerId: petPlayerId, itemCode: "probe_instance", reasonCode: "probe", reason: "pet equipment probe", idempotencyKey: key("pet-equipment-item"), actor, sourceCode: "system" });
  const petEquipment = await pet.equipInventory({ playerId: petPlayerId, slotCode: "weapon", instanceId: petEquipmentInstance.instanceId, expectedPetVersion: petSkill.version, expectedInstanceVersion: "1", reason: "pet equipment probe", idempotencyKey: key("pet-equipment"), actor: { type: "system" }, sourceCode: "system" });
  const ownedTitle = await database.query<Array<{ code: string }>>(`SELECT definition.code FROM player_titles owned
    JOIN title_definitions definition ON definition.id = owned.title_id WHERE owned.player_id = ? LIMIT 1`, [petPlayerId]);
  const equippedTitle = ownedTitle[0] === undefined ? null : await pet.equipTitle({ playerId: petPlayerId, titleCode: ownedTitle[0].code, target: "player", reason: "domain probe", idempotencyKey: key("title"), actor, sourceCode: "system" });

  const guildRows = await database.query<Array<{ guild_id: bigint; player_id: bigint }>>("SELECT guild_id, player_id FROM guild_members ORDER BY guild_id LIMIT 1");
  const guildId = guildRows[0]!.guild_id.toString(); const guildPlayerId = guildRows[0]!.player_id.toString();
  const guildResource = await guild.adjustResource({ guildId, actorPlayerId: guildPlayerId, currencyCode: "point", delta: "5", expectedVersion: "0", reasonCode: "probe", reason: "domain probe", idempotencyKey: key("guild-resource"), actor, sourceCode: "system" });
  const guildWarehouse = await guild.changeWarehouseStack({ guildId, actorPlayerId: guildPlayerId, itemCode: "probe_stack", quantityDelta: "2", expectedVersion: "0", reasonCode: "probe", reason: "domain probe", idempotencyKey: key("guild-stack"), actor, sourceCode: "system" });
  const guildPost = await guild.publishPost({ guildId, actorPlayerId: guildPlayerId, body: "통합 검증 게시글", reasonCode: "probe", reason: "domain probe", idempotencyKey: key("guild-post"), actor, sourceCode: "system" });
  const guildVersion = await database.query<Array<{ version: bigint }>>("SELECT version FROM guilds WHERE id = ?", [guildId]);
  await database.execute("INSERT INTO guild_roles (guild_id, code, display_name) VALUES (?, 'probe_manager', '검증 관리자')", [guildId]);
  const guildRole = await guild.assignMemberRole({ guildId, actorPlayerId: guildPlayerId, memberPlayerId: guildPlayerId, roleCode: "probe_manager", expectedGuildVersion: guildVersion[0]!.version.toString(), reasonCode: "probe", reason: "role probe", idempotencyKey: key("guild-role"), actor: { type: "system" }, sourceCode: "system" });

  const visit = await home.visit({ homePlayerId: buyerId, actorPlayerId: sellerId, reason: "domain probe", idempotencyKey: key("home-visit"), actor, sourceCode: "system" });
  const comment = await home.comment({ homePlayerId: buyerId, actorPlayerId: sellerId, body: "통합 검증 댓글", reason: "domain probe", idempotencyKey: key("home-comment"), actor, sourceCode: "system" });
  const reaction = await home.react({ homePlayerId: buyerId, actorPlayerId: sellerId, reactionCode: "like", reason: "domain probe", idempotencyKey: key("home-like"), actor, sourceCode: "system" });

  await database.execute("INSERT INTO event_seasons (code, display_name, starts_at, ends_at, status) VALUES ('probe_season', '검증 시즌', UTC_TIMESTAMP(3) - INTERVAL 1 DAY, UTC_TIMESTAMP(3) + INTERVAL 1 DAY, 'active')");
  await database.execute("INSERT INTO game_mode_definitions (code, display_name, active) VALUES ('probe_mode', '검증 모드', TRUE)");
  const progress = await event.recordProgress({ playerId: sellerId, seasonCode: "probe_season", modeCode: "probe_mode", progress: { stage: 1 }, expectedVersion: "0", reason: "domain probe", idempotencyKey: key("event-progress"), actor, sourceCode: "system" });
  await event.submitResult({ playerId: sellerId, seasonCode: "probe_season", modeCode: "probe_mode", score: "100.125", result: { cleared: true }, reason: "domain probe", idempotencyKey: key("event-result-1"), actor, sourceCode: "system" });
  await event.submitResult({ playerId: buyerId, seasonCode: "probe_season", modeCode: "probe_mode", score: "90", result: { cleared: true }, reason: "domain probe", idempotencyKey: key("event-result-2"), actor, sourceCode: "system" });
  const leaderboard = await event.rebuildLeaderboard({ seasonCode: "probe_season", modeCode: "probe_mode", leaderboardCode: "probe_board", reason: "domain probe", idempotencyKey: key("leaderboard"), actor: { type: "system" }, sourceCode: "system" });

  const buyerCurrency = await database.query<Array<{ version: bigint }>>("SELECT version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point'", [buyerId]);
  await currency.adjust({ playerId: buyerId, currencyCode: "point", delta: "1000", expectedVersion: buyerCurrency[0]?.version.toString() ?? "0", reasonCode: "probe", reason: "market funding", idempotencyKey: key("fund-buyer"), actor, sourceCode: "system" });
  const listing = await market.createListing({ sellerPlayerId: sellerId, asset: { type: "stack", itemCode: "probe_stack", quantity: "2", expectedVersion: stack.version }, currencyCode: "point", priceAmount: "100.125", expiresAt: new Date(Date.now() + 3_600_000), reasonCode: "probe", reason: "market probe", idempotencyKey: key("listing"), actor, sourceCode: "system" });
  const purchase = await market.buyListing({ listingId: listing.listingId, buyerPlayerId: buyerId, expectedVersion: listing.version, feeBasisPoints: "250", reasonCode: "probe", reason: "market probe", idempotencyKey: key("purchase"), actor: { type: "player", id: buyerId }, sourceCode: "system" });
  const sellerStack = await database.query<Array<{ version: bigint }>>("SELECT stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id = stack.item_id WHERE stack.player_id = ? AND item.code = 'probe_stack'", [sellerId]);
  const cancelListing = await market.createListing({ sellerPlayerId: sellerId, asset: { type: "stack", itemCode: "probe_stack", quantity: "1", expectedVersion: sellerStack[0]!.version.toString() }, currencyCode: "point", priceAmount: "10", expiresAt: new Date(Date.now() + 3_600_000), reasonCode: "probe", reason: "cancel probe", idempotencyKey: key("listing-cancel"), actor, sourceCode: "system" });
  const cancelled = await market.cancelListing({ listingId: cancelListing.listingId, sellerPlayerId: sellerId, expectedVersion: cancelListing.version, reasonCode: "probe", reason: "cancel probe", idempotencyKey: key("cancel"), actor, sourceCode: "system" });

  let staleConflict = false;
  try { await currency.adjust({ playerId: sellerId, currencyCode: "point", delta: "1", expectedVersion: "0", reasonCode: "probe", reason: "stale probe", idempotencyKey: key("stale"), actor, sourceCode: "system" }); }
  catch (error) { staleConflict = error instanceof ApplicationError && error.code === "CURRENCY_VERSION_CONFLICT"; }
  const counts = await database.query<Array<{ operations: bigint; audits: bigint; outbox: bigint; market_fees: bigint }>>("SELECT (SELECT COUNT(*) FROM operations) operations, (SELECT COUNT(*) FROM command_audit) audits, (SELECT COUNT(*) FROM outbox_messages) outbox, (SELECT COUNT(*) FROM market_fee_ledger) market_fees");
  process.stdout.write(JSON.stringify({ currency: currencyResult.balance, idempotency: firstDuplicate.auditId === secondDuplicate.auditId, staleConflict,
    stack: stack.quantity, instance: instance.instanceId, transferredInstanceVersion: transferredInstance.version, equippedTitle: equippedTitle?.titleCode ?? null, petVersion: petSkill.version, petEquipmentVersion: petEquipment.petVersion, guildResource: guildResource.balance, guildWarehouse: guildWarehouse.quantity,
    guildPost: guildPost.postId, guildRole: guildRole.roleCode, homeVisit: visit.visitId, homeComment: comment.commentId, homeReaction: reaction.created,
    eventVersion: progress.version, leaderboardEntries: leaderboard.entryCount, settlement: purchase.settlementId, marketFee: purchase.feeAmount,
    cancelledVersion: cancelled.listingVersion, operations: counts[0]!.operations.toString(), audits: counts[0]!.audits.toString(), outbox: counts[0]!.outbox.toString(), marketFees: counts[0]!.market_fees.toString() }) + "\n");
  if (!staleConflict || firstDuplicate.auditId !== secondDuplicate.auditId || leaderboard.entryCount !== "2" || purchase.grossAmount !== "100.125" || reaction.created !== true || counts[0]!.market_fees !== 1n) throw new Error("Domain service invariants failed.");
} finally { await database.close(); }
