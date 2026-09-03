import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { extractHttpRouteSurface, type HttpRouteMethod } from "./http-route-surface-audit.js";

// OBJECT_DATA_MODEL_STANDARD_CANONICAL_PROVIDER: this canonical transition
// audit names legacy currency tables as evidence; it is not a legacy provider.

export type ConsumerKind = "LEGACY_COMMAND" | "AUTOMATIC_CALLBACK" | "RUNTIME_DISPATCH" | "ADMIN_COMMAND" | "HTTP_WEB_ROUTE" | "APP_WIRING" | "SQL_REPOSITORY";

export interface DerivedConsumer {
  consumerId: string;
  kind: ConsumerKind;
  file: string;
  symbol: string;
  triggerOrPredicate: string;
  access: "READ" | "WRITE" | "READ_WRITE";
  legacyPaths: string[];
  sqlTables: string[];
  observedSqlReadTables: string[];
  observedSqlWriteTables: string[];
  saveLoad: string[];
  environmentResolver: string;
  currentProviderImports: string[];
  reachableHelpers: string[];
  unresolvedDynamicCallCount: number;
  primarySlice: string;
  dependentSlices: string[];
  p1Bridges: string[];
  sourceSpan: { start: number; end: number; sha256: string };
  status: "IN_SCOPE";
  targetSelectorId: string;
  usedTargetTables: string[];
  usedTargetColumns: string[];
  readTargetTables: string[];
  writeTargetTables: string[];
  readTargetColumns: string[];
  writeTargetColumns: string[];
  transactionalPortDependencies: string[];
  interfaceId: string;
  interfaceMethod: "READ" | "EXECUTE";
  transactionOwnerInterfaceId: string | null;
  transactionParticipantInterfaceIds: string[];
  operationReceiptTables: string[];
  targetUsageMode: "CURRENT_SQL" | "ADDITIVE_PLAN" | "PORT_ONLY";
}

export interface ConsumerManifest {
  format: "hoibot-object-db-consumer-manifest-v1";
  baseCommit: string;
  consumers: DerivedConsumer[];
  counts: Record<ConsumerKind, number>;
  consumerSetSha256: string;
  targetSelectors: Record<string, { domains: string[]; tables: string[]; columns: string[]; infrastructureTables: string[] }>;
  audit: { orphanCount: number; extraCount: number; duplicatePrimaryCount: number; undeclaredSelectorCount: number; excludedNegativeGuardCount: number; activeRegistryObjectRows: number; registrySourceMismatchCount: number; registrySourceMismatches: string[]; appSourceCandidateCount: number; appRawGuardCount: number; adminSourceCandidateCount: number; adminOrphanKeys: string[]; adminExtraKeys: string[]; operationReceiptTableCount: number; missingOperationReceiptTableCount: number; missingOperationReceiptTables: string[]; legacyOrphanKeys: string[]; legacyExtraKeys: string[]; appOrphanKeys: string[]; appExtraKeys: string[] };
}

const SLICE_P1: Record<string, string[]> = {
  "CONTEXT-BRIDGE": ["P1-IDENTITY-CROSSWALK", "P1-ENVIRONMENT-PARTITION"],
  ITEM: ["P1-MISSING-PORTS"],
  "CURRENCY-SHOP": [],
  "BUILDING-RECIPE": ["P1-CROSS-DOMAIN-ATOMICITY"],
  "FURNITURE-HOME": ["P1-FURNITURE-DRAW-POLICY"],
  "HOME-AGGREGATE-RANK": ["P1-OWNER-GRAPH"],
  "PET-EQUIPMENT": ["P1-MISSING-PORTS"],
  "MINI-PET": ["P1-MISSING-PORTS"],
  "MEMBER-TITLE": ["P1-MISSING-PORTS"],
  "PET-TITLE": ["P1-MISSING-PORTS"],
  "MINI-PET-TITLE-COLLECTION": ["P1-MISSING-PORTS"],
  "PET-SKILL": [],
  "MARKET-ORCHESTRATOR": ["P1-CROSS-DOMAIN-ATOMICITY"],
  "PACKAGE-CATALOG": [],
  "PACKAGE-USE": ["P1-CROSS-DOMAIN-ATOMICITY"],
  "ADMIN-LIFECYCLE": ["P1-OWNER-GRAPH", "P1-ENVIRONMENT-PARTITION"],
  "ADMIN-WEB-APP-WIRING": ["P1-SINGLE-WRITER", "P1-ENVIRONMENT-PARTITION"]
};

const SLICE_DOMAINS: Record<string, string[]> = {
  "CONTEXT-BRIDGE": ["player"], ITEM: ["player", "item"], "CURRENCY-SHOP": ["player", "currency", "item"],
  "BUILDING-RECIPE": ["player", "building-recipe", "item", "currency"], "FURNITURE-HOME": ["player", "furniture"],
  "HOME-AGGREGATE-RANK": ["player", "furniture", "pet-equipment", "mini-pet", "pet-skill"],
  "PET-EQUIPMENT": ["player", "pet-equipment"], "MINI-PET": ["player", "mini-pet"],
  "MEMBER-TITLE": ["player", "member-title"], "PET-TITLE": ["player", "pet-title", "pet-equipment"],
  "MINI-PET-TITLE-COLLECTION": ["player", "mini-pet-title", "mini-pet"], "PET-SKILL": ["player", "pet-skill", "pet-equipment"],
  "MARKET-ORCHESTRATOR": ["player", "item", "currency", "furniture", "pet-equipment", "mini-pet", "pet-skill"],
  "PACKAGE-CATALOG": ["package", "item"], "PACKAGE-USE": ["player", "package", "item", "currency", "furniture", "pet-equipment", "mini-pet", "member-title", "pet-title", "mini-pet-title", "pet-skill"],
  "ADMIN-LIFECYCLE": ["player", "item", "currency", "furniture", "pet-equipment", "mini-pet", "member-title", "pet-title", "mini-pet-title", "pet-skill", "package", "building-recipe"],
  "ADMIN-WEB-APP-WIRING": ["player"]
};

const TABLE_SLICE: Array<[RegExp, string]> = [
  [/package/i, "PACKAGE-CATALOG"], [/furniture/i, "FURNITURE-HOME"], [/mini_pet_title/i, "MINI-PET-TITLE-COLLECTION"],
  [/pet_title/i, "PET-TITLE"], [/member_title/i, "MEMBER-TITLE"], [/pet_skill/i, "PET-SKILL"], [/mini_pet/i, "MINI-PET"],
  [/craft|building/i, "BUILDING-RECIPE"], [/currency/i, "CURRENCY-SHOP"], [/equipment|owned_pet|pet_definition/i, "PET-EQUIPMENT"],
  [/item/i, "ITEM"], [/canonical_players/i, "CONTEXT-BRIDGE"]
];

const OBJECT_MARKER = /가방|아이템|포인트|다이아|상점|조합|건설|건물|가구|펫|타이틀|칭호|스킬|자유시장|거래|패키지|오픈|판매|동기화|전체정리|데이터정리|계정|휴면|가입인증|계급|순위|통계|백업|서버이동|미출석|글자수통계|bag|inventory|currency|balance|configuration|shop|craft|building|furniture|object|pet|miniPet|mini_pet|petTitle|pet_title|playerTitle|player_title|memberTitle|member_title|petSkill|pet_skill|pet_feed|package|market/i;

const APP_BINDING_SLICE: Array<[RegExp, string]> = [
  [/DailyPrayer|daily.?prayer|\b기도\b/i, "PET-SKILL"],
  [/spirit_name_combine/i, "BUILDING-RECIPE"], [/admin_title_gift_ticket_grant/i, "MEMBER-TITLE"],
  [/dispatchSupportPassRegistryCommand|one_day_pass_registry|pass_subscription_retired|auto_daily_quest_orchestration|support_premium_notice_send/i, "ADMIN-LIFECYCLE"],
  [/one_day_pass_subscription|inventory_fortune_pouch_open/i, "ITEM"], [/happy_foundation/i, "CURRENCY-SHOP"],
  [/home_(?:activity_file_bootstrap|activity_restore|comment_file_bootstrap|feed_migration|social_badge_migration)|HOME_COMMENT_PIN|home_badge_permanent_delete/i, "ADMIN-LIFECYCLE"],
  [/home_(?:activity_alert_read|comment_action|feed_mutate|like_action|profile_view|baseball_pitch|badge_inventory_read|badge_equip|badge_gacha_open|badge_cube|heart_expression)|social_own_heart/i, "HOME-AGGREGATE-RANK"],
  [/legacy_social_like/i, "CURRENCY-SHOP"],
  [/tier_reward_payout/i, "ITEM"],
  [/package.*(?:bag|use|open)|(?:bag|use|open).*package/i, "PACKAGE-USE"], [/package/i, "PACKAGE-CATALOG"],
  [/market|carrot|trade|listing/i, "MARKET-ORCHESTRATOR"], [/building|construction|craft|combine|recipe/i, "BUILDING-RECIPE"],
  [/mini.?pet.?title/i, "MINI-PET-TITLE-COLLECTION"], [/pet.?title/i, "PET-TITLE"], [/player.?title|member.?title/i, "MEMBER-TITLE"],
  [/pet.?skill/i, "PET-SKILL"], [/mini.?pet/i, "MINI-PET"], [/currency|balance|point|diamond|shop|wallet|heart/i, "CURRENCY-SHOP"],
  [/(?:home.?furniture|pet|pendant|spirit).*(?:rank|stats)|(?:rank|stats).*(?:home.?furniture|pet|pendant|spirit)/i, "HOME-AGGREGATE-RANK"],
  [/furniture|home.?furniture/i, "FURNITURE-HOME"], [/(?:home_(?:comment|like|activity|feed|profile)|legacy_social_like)/i, "HOME-AGGREGATE-RANK"],
  [/pendant|spirit|pet/i, "PET-EQUIPMENT"], [/inventory|item|bag/i, "ITEM"], [/rank|stats|aggregate|record/i, "HOME-AGGREGATE-RANK"],
  [/cleanup|sync|delete|grant|reset|override|admin/i, "ADMIN-LIFECYCLE"], [/(?:external.?identity|identity|context|changePlayerServer|handlerKey=USER_(?:PROFILE|SIGNUP)|\/user-(?:profile|signup))/i, "CONTEXT-BRIDGE"]
];

const SLICE_OPERATION_TABLES: Record<string, string[]> = {
  "CONTEXT-BRIDGE": ["canonical_player_identity_crosswalks"],
  ITEM: ["canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries"],
  "CURRENCY-SHOP": ["canonical_currency_operations", "canonical_currency_ledger_entries"],
  "BUILDING-RECIPE": ["canonical_craft_operations", "canonical_craft_item_ledger_entries", "canonical_craft_currency_ledger_entries"],
  "FURNITURE-HOME": ["object_furniture_operation_replays", "object_furniture_ownership_history"],
  "HOME-AGGREGATE-RANK": [],
  "PET-EQUIPMENT": ["canonical_pet_equipment_operation_replays"],
  "MINI-PET": ["canonical_mini_pet_operation_replays"],
  "MEMBER-TITLE": [],
  "PET-TITLE": [],
  "MINI-PET-TITLE-COLLECTION": [],
  "PET-SKILL": ["canonical_pet_skill_operation_replays"],
  "MARKET-ORCHESTRATOR": ["object_furniture_market_listings", "object_furniture_active_market_listings", "object_furniture_ownership_history", "canonical_currency_operations", "canonical_currency_ledger_entries"],
  "PACKAGE-CATALOG": ["canonical_package_definition_replays"],
  "PACKAGE-USE": ["canonical_package_definition_replays", "canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries", "canonical_currency_operations", "canonical_currency_ledger_entries"],
  "ADMIN-LIFECYCLE": [],
  "ADMIN-WEB-APP-WIRING": []
};

const MUTATION_INFRASTRUCTURE_TABLES = ["operations", "command_executions", "command_audit", "outbox_messages"];

function appBindingSlice(value: string): string | undefined {
  return APP_BINDING_SLICE.find(([pattern]) => pattern.test(value))?.[1];
}

function isExcludedNonObjectAppBinding(trigger: string): boolean {
  return /handlerKey=(?:guild_board|social_board_read|social_punch_reaction|record_board|operation_notice_mutate)$/.test(trigger);
}

function isExcludedNonObjectAppPredicate(predicate: string): boolean {
  return /isGuildForceExpelCommandCandidate|isGuildJoinConditionCommandCandidate|isRecordBoardCommandCandidate|(?:normalizedEvent|event)\.message\s*===?\s*["']\/ping["']/.test(predicate);
}

function constructedTypeFor(text: string, variable: string): string | undefined {
  const match = new RegExp(`\\bconst\\s+${variable}\\s*=`).exec(text);
  if (match === null) return undefined;
  return text.slice(match.index, match.index + 800).match(/\bnew\s+([A-Z][A-Za-z0-9_$]+)\s*\(/)?.[1];
}

function appRouteDependentSlices(trigger: string): string[] {
  if (/PetSkillCatalog/.test(trigger)) return ["PET-SKILL"];
  if (/Balance|DiamondShopCatalog/.test(trigger)) return ["CURRENCY-SHOP"];
  if (/ObjectCatalog/.test(trigger)) return ["ITEM", "FURNITURE-HOME", "PET-EQUIPMENT", "MINI-PET", "MEMBER-TITLE", "PET-TITLE", "MINI-PET-TITLE-COLLECTION", "PET-SKILL"].sort();
  if (/ConfigurationCatalog/.test(trigger)) return ["ADMIN-LIFECYCLE", "BUILDING-RECIPE"].sort();
  return [];
}

function httpEndpointAccess(method: HttpRouteMethod, path: string): DerivedConsumer["access"] {
  if (method === "GET") {
    if (path === "/api/v1/admin/moderation-incidents/:incidentId/content"
      || path === "/api/v1/sessions/current"
      || path === "/api/v1/player-profiles/current") return "READ_WRITE";
    return "READ";
  }
  if (method === "POST" && (path === "/api/v1/admin/balance/:domain/preview"
    || path === "/api/v1/admin/restores/preview")) return "READ";
  return "READ_WRITE";
}

const APP_HANDLER_SERVICE: Record<string, string> = {
  home_comment_action: "DailyCommentIrisHandler", home_like_action: "HomeLikeIrisHandler", legacy_social_like: "LegacyLikeIrisHandler",
  home_profile_view: "HomeProfileViewIrisHandler", home_activity_alert_read: "HomeActivityAlertReadIrisHandler", home_feed_mutate: "HomeFeedMutationIrisHandler",
  home_badge_inventory_read: "HomeBadgeInventoryIrisHandler", home_badge_gacha_open: "HomeBadgeGachaIrisHandler", home_badge_cube: "HomeBadgeCubeIrisHandler",
  inventory_wallet_rng_open: "InventoryWalletRngOpenIrisHandler", inventory_fortune_pouch_open: "InventoryFortunePouchIrisHandler",
  home_heart_expression: "HomeHeartExpressionIrisHandler", support_premium_notice_send: "SupportPremiumNoticeIrisHandler", guild_board: "GuildBoardIrisHandler",
  home_badge_equip: "HomeBadgeEquipIrisHandler", home_badge_permanent_delete: "HomeBadgePermanentDeleteIrisHandler"
};

const APP_HANDLER_PRIMARY: Record<string, string> = {
  contribution_pass_registry: "ADMIN-LIFECYCLE", diamond_pass_registry: "ADMIN-LIFECYCLE", hoi_pass_registry: "ADMIN-LIFECYCLE",
  member_ticket_tier_recalculate: "ITEM", tier_roster_read: "ITEM", tier_rank_read: "ITEM",
  free_market_cancel: "MARKET-ORCHESTRATOR", free_market_force_cancel: "MARKET-ORCHESTRATOR", market_carrot_trade: "MARKET-ORCHESTRATOR",
  free_market_buy: "MARKET-ORCHESTRATOR", free_market_bag_register: "MARKET-ORCHESTRATOR", store_hoi_shop: "MARKET-ORCHESTRATOR", store_auction_bid: "MARKET-ORCHESTRATOR",
  home_furniture_draw: "FURNITURE-HOME", home_furniture_clean: "FURNITURE-HOME", home_furniture_sell: "FURNITURE-HOME",
  legendary_stone_draw: "ITEM", letter_board: "ITEM", castle_battle_execute: "PET-EQUIPMENT",
  castle_kingdom_status_read: "HOME-AGGREGATE-RANK", admin_account_suspension: "ADMIN-LIFECYCLE", mini_pet_bulk_cleanup: "MINI-PET"
};

const APP_NAMED_PRIMARY: Record<string, string> = {
  isGuildJoinCommandCandidate: "ITEM",
  isAutoExploreFixedConfigCommand: "PET-EQUIPMENT"
};

const APP_HANDLER_DEPENDENCIES: Record<string, string[]> = {
  legendary_stone_draw: [], happy_foundation: ["ITEM"],
  mini_pet_carrot_trade: ["ITEM", "MINI-PET"], mini_pet_elite_combine: ["ITEM", "MINI-PET"],
  mini_pet_battle_reset_ticket_craft: ["ITEM", "MINI-PET"],
  auto_daily_quest_orchestration: ["CURRENCY-SHOP", "FURNITURE-HOME", "ITEM", "MINI-PET", "PET-EQUIPMENT", "PET-SKILL"],
  castle_battle_execute: ["CURRENCY-SHOP", "FURNITURE-HOME", "ITEM", "MINI-PET", "PET-SKILL"],
  castle_kingdom_status_read: ["ITEM", "PET-EQUIPMENT"], letter_board: [],
  home_furniture_draw: ["ITEM"], home_furniture_clean: ["CURRENCY-SHOP"], home_furniture_sell: ["CURRENCY-SHOP"],
  free_market_cancel: ["FURNITURE-HOME", "ITEM", "MINI-PET", "PET-EQUIPMENT", "PET-SKILL"],
  free_market_force_cancel: ["ITEM"], market_carrot_trade: ["ITEM"],
  free_market_buy: ["CURRENCY-SHOP", "FURNITURE-HOME", "ITEM", "MINI-PET", "PET-EQUIPMENT", "PET-SKILL"],
  free_market_bag_register: ["ITEM", "PET-SKILL"],
  store_hoi_shop: ["CURRENCY-SHOP", "ITEM", "MEMBER-TITLE", "MINI-PET", "PET-EQUIPMENT", "PET-TITLE"],
  store_auction_bid: ["CURRENCY-SHOP", "ITEM"], contribution_pass_registry: [], diamond_pass_registry: [], hoi_pass_registry: ["ITEM"],
  mini_pet_bulk_cleanup: [], admin_account_suspension: []
};

const APP_HANDLER_MUTATION_SLICES: Record<string, string[]> = {
  free_market_cancel: ["FURNITURE-HOME", "ITEM", "MINI-PET", "PET-EQUIPMENT", "PET-SKILL"],
  free_market_force_cancel: ["ITEM"],
  market_carrot_trade: ["ITEM"],
  free_market_buy: ["CURRENCY-SHOP", "FURNITURE-HOME", "ITEM", "MINI-PET", "PET-EQUIPMENT", "PET-SKILL"],
  free_market_bag_register: ["ITEM", "PET-SKILL"],
  store_hoi_shop: ["CURRENCY-SHOP", "ITEM", "MEMBER-TITLE", "MINI-PET", "PET-EQUIPMENT", "PET-TITLE"],
  store_auction_bid: ["CURRENCY-SHOP", "ITEM"]
};

const MUTATION_CONTRACT_BY_SLICE: Record<string, { port: string; receipts: string[] }> = {
  ITEM: { port: "item.inventory.mutate", receipts: ["canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries"] },
  "CURRENCY-SHOP": { port: "currency.balance.mutate", receipts: ["canonical_currency_operations", "canonical_currency_ledger_entries"] },
  "FURNITURE-HOME": { port: "furniture.ownership.mutate", receipts: ["object_furniture_operation_replays", "object_furniture_ownership_history"] },
  "MINI-PET": { port: "mini-pet.ownership.mutate", receipts: ["canonical_mini_pet_operation_replays"] },
  "PET-EQUIPMENT": { port: "pet-equipment.ownership.mutate", receipts: ["canonical_pet_equipment_operation_replays"] },
  "PET-SKILL": { port: "pet-skill.ownership.mutate", receipts: ["canonical_pet_skill_operation_replays"] },
  "MEMBER-TITLE": { port: "member-title.ownership.mutate", receipts: ["canonical_member_title_operations"] },
  "PET-TITLE": { port: "pet-title.ownership.mutate", receipts: ["canonical_pet_title_operations"] },
  "MINI-PET-TITLE-COLLECTION": { port: "mini-pet-title.ownership.mutate", receipts: ["canonical_mini_pet_title_operations"] }
};

const APP_HANDLER_PROVIDER: Record<string, string> = {
  contribution_pass_registry: "ContributionPassIrisHandler", diamond_pass_registry: "DiamondPassIrisHandler", hoi_pass_registry: "HoiPassIrisHandler",
  member_ticket_tier_recalculate: "MemberTicketTierRecalculateService", tier_roster_read: "TierRosterReadService", tier_rank_read: "TierRosterReadService",
  free_market_cancel: "FreeMarketCancelService", free_market_force_cancel: "FreeMarketForceCancelService", market_carrot_trade: "CarrotTradeService",
  free_market_buy: "FreeMarketBuyService", free_market_bag_register: "FreeMarketBagRegisterService", store_hoi_shop: "HoiShopService", store_auction_bid: "AuctionBidService",
  home_furniture_draw: "HomeFurnitureDrawService", home_furniture_clean: "HomeFurnitureCleanService", home_furniture_sell: "HomeFurnitureSellService",
  mini_pet_bulk_cleanup: "MiniPetBulkCleanupService", admin_account_suspension: "AdminAccountSuspensionService"
};

const DYNAMIC_DISPATCH_KEYS: Record<string, string[]> = {
  isTierCommandDispatch: ["member_ticket_tier_recalculate", "tier_roster_read", "tier_rank_read"],
  isFreeMarketMutationDispatch: ["free_market_cancel", "free_market_force_cancel", "market_carrot_trade", "free_market_buy", "free_market_bag_register", "store_hoi_shop", "store_auction_bid"]
};

const NAMED_PREDICATE_HANDLER: Record<string, string> = {
  isHomeFurnitureDrawCandidate: "home_furniture_draw",
  isHomeFurnitureCleanCandidate: "home_furniture_clean",
  isHomeFurnitureSellCandidate: "home_furniture_sell"
};

const READ_ONLY_APP_TRIGGER = /handlerKey=(?:PACKAGE_BAG|POINT_SHOP_CATALOG_READ|DIAMOND_SHOP_CATALOG_READ|tier_roster_read|tier_rank_read|castle_kingdom_status_read|pendant_market_info|carrot_temperature_rank_read|carrot_ban_list_read|free_market_read|carrot_board_read|castle_battle_self_record_read|castle_battle_ranking_read|player_cumulative_level_rank_read|spirit_rank_read|player_cumulative_like_rank_read|player_chat_rank_read|castle_charm_ranking_read|pet_intimacy_rank_read|home_furniture_stats_read|home_furniture_info_read|player_verification_rank_read|home_ranking_read|raid_charm_ranking_read|home_furniture_rank_read|player_overall_rank_read|player_diamond_rank_read|pendant_rank_read|player_level_rank_read|player_title_list_read|player_title_info_read)|predicate=isCarrotRankReadCommand|PACKAGE_CATALOG_WIZARD_(?:GUIDE|STATUS)/i;
const ADMIN_NON_OBJECT_COMMAND = /^(?:isGuildProfileNoticeMutateCandidate|isGuildLeadershipTransferCandidate|isGuildNameRenameCandidate|isGuildMarkMutateCandidate|isGuildCreateCandidate|isGuildSubMasterAssignCandidate|isGuildSwordMasterAssignCandidate|isOperationIntervalResetCommand|isRequestMonitorExceptionCommandCandidate|isRequestMonitorConfigCommandCandidate|isAuthCheckCountResetCommand)$/;

function adminPrimarySlice(guard: string): string {
  if (/^(?:isPetSkillBookGrantCommandCandidate|isPetDungeonEntryGrantCommandCandidate)$/.test(guard)) return "ITEM";
  if (/MiniPet.*Title/.test(guard)) return "MINI-PET-TITLE-COLLECTION";
  if (/PetSkill/.test(guard)) return "PET-SKILL";
  if (/MiniPet/.test(guard)) return "MINI-PET";
  if (/PetTitle/.test(guard)) return "PET-TITLE";
  if (/Pet|Spirit|Matzang/.test(guard)) return "PET-EQUIPMENT";
  if (/Title/.test(guard)) return "MEMBER-TITLE";
  if (/Auction/.test(guard)) return "MARKET-ORCHESTRATOR";
  if (/CharacterCount|Rank|Stats/.test(guard)) return "HOME-AGGREGATE-RANK";
  if (/Point|Diamond|Currency|Shop|HoiLand|LordIncome/.test(guard)) return "CURRENCY-SHOP";
  if (/Item|Inventory|Ring|Badge|Reward|Ticket|LegendaryStone/.test(guard)) return "ITEM";
  return "ADMIN-LIFECYCLE";
}

function appHandlerEvidenceSymbol(handlerKey: string): string | undefined {
  if (handlerKey in APP_HANDLER_SERVICE) return APP_HANDLER_SERVICE[handlerKey];
  if (handlerKey in APP_HANDLER_PROVIDER) {
    if (handlerKey.startsWith("free_market_") || handlerKey === "market_carrot_trade" || handlerKey.startsWith("store_")) return "handleFreeMarketMutation";
    if (/^(?:member_ticket_tier_recalculate|tier_roster_read|tier_rank_read)$/.test(handlerKey)) return "createTierCommandService";
    return APP_HANDLER_PROVIDER[handlerKey];
  }
  return undefined;
}

function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function unique(values: string[]): string[] { return [...new Set(values)].sort(); }
function repoPath(root: string, file: string): string { return relative(root, file).replaceAll("\\", "/"); }

function sliceFor(value: string, kind: ConsumerKind): string {
  if (kind === "HTTP_WEB_ROUTE" || kind === "APP_WIRING") return "ADMIN-WEB-APP-WIRING";
  if (/package.*(?:use|open|bag)|패키지(?:사용|가방)|오픈/i.test(value) && !/catalog|리스트|추가|수정|제거|활성/i.test(value)) return "PACKAGE-USE";
  if (/package|패키지/i.test(value)) return "PACKAGE-CATALOG";
  if (/market|trade|listing|carrot|자유시장|거래등록|당근/i.test(value)) return "MARKET-ORCHESTRATOR";
  if (/mini.?pet.?title|miniPetTitle|미니펫(?:타이틀|컬렉션)/i.test(value)) return "MINI-PET-TITLE-COLLECTION";
  if (/pet.?title|petTitle|펫타이틀/i.test(value)) return "PET-TITLE";
  if (/member.?title|memberTitle|player.?title|타이틀/i.test(value) && !/펫/i.test(value)) return "MEMBER-TITLE";
  if (/pet.?skill|petSkill|펫스킬/i.test(value)) return "PET-SKILL";
  if (/combine|craft|recipe|building|조합|건설|건물/i.test(value)) return "BUILDING-RECIPE";
  if (/furniture|가구/i.test(value)) return "FURNITURE-HOME";
  if (/mini.?pet|miniPet|미니펫/i.test(value)) return "MINI-PET";
  if (/currency|balance|point|diamond|shop|포인트|다이아|상점/i.test(value)) return "CURRENCY-SHOP";
  if (/rank|stats|aggregate|종합순위|매력순위|가구통계|글자수통계/i.test(value)) return "HOME-AGGREGATE-RANK";
  if (/equipment|pendant|spirit|(?:^|[^A-Za-z])pet(?:[^A-Za-z]|$)|펜던트|정령|펫/i.test(value)) return "PET-EQUIPMENT";
  if (/item|inventory|bag|가방|아이템|전체판매/i.test(value)) return "ITEM";
  if (/admin|cleanup|sync|delete|grant|override|삭제|동기화|정리|지급/i.test(value)) return "ADMIN-LIFECYCLE";
  return "CONTEXT-BRIDGE";
}

function dependentSlices(primary: string, value: string, tables: string[]): string[] {
  const candidates = new Set<string>();
  for (const [pattern, slice] of TABLE_SLICE) if (pattern.test(`${value} ${tables.join(" ")}`)) candidates.add(slice);
  if (/market|거래|자유시장|당근/i.test(value)) candidates.add("MARKET-ORCHESTRATOR");
  if (/package|패키지/i.test(value)) candidates.add(/use|open|사용|오픈/i.test(value) ? "PACKAGE-USE" : "PACKAGE-CATALOG");
  candidates.delete(primary);
  return [...candidates].sort();
}

function accessFor(text: string): DerivedConsumer["access"] {
  const code = maskNonStructuralCode(text);
  const read = /\bSELECT\b|\bloadJsonFile\b|FileStream\.read|\.(?:find|findIndex|read|query|has|get)\s*\(/i.test(code);
  const write = /\b(?:INSERT|UPDATE|DELETE)\b|\b(?:saveJsonFile|savebackupJsonFile)\b|FileStream\.write|\.(?:execute|push|splice|shift|unshift|pop|set|delete)\s*\(|(?:\+\+|--|\+=|-=|\*=|\/=|\[[^\]]+\]|\.[A-Za-z_$][A-Za-z0-9_$]*)\s*=/.test(code);
  return read && write ? "READ_WRITE" : write ? "WRITE" : "READ";
}

function observedSqlDirection(text: string, knownTables?: ReadonlySet<string>): { read: string[]; write: string[] } {
  const accepted = (table: string): boolean => knownTables === undefined || knownTables.has(table);
  return {
    read: unique([...text.matchAll(/\b(?:FROM|JOIN)\s+`?([a-z][a-z0-9_]*)`?/gi)].map((match) => match[1]!).filter(accepted)),
    write: unique([...text.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?([a-z][a-z0-9_]*)`?/gi)].map((match) => match[1]!).filter(accepted))
  };
}

function legacyAccessFor(text: string): DerivedConsumer["access"] {
  const code = maskNonStructuralCode(text);
  const persistedWrite = /\b(?:saveJsonFile|savebackupJsonFile)\b|FileStream\.write/.test(code);
  return persistedWrite ? "READ_WRITE" : "READ";
}

function p1For(primary: string, access: DerivedConsumer["access"], unresolvedDynamicCallCount = 0): string[] {
  const attached = (SLICE_P1[primary] ?? []).filter((condition) => {
    if (["P1-IDENTITY-CROSSWALK", "P1-MISSING-PORTS", "P1-ENVIRONMENT-PARTITION", "P1-SINGLE-WRITER"].includes(condition)) return false;
    if (condition === "P1-CROSS-DOMAIN-ATOMICITY" || condition === "P1-SINGLE-WRITER") return access !== "READ";
    return true;
  });
  if (unresolvedDynamicCallCount > 0) attached.push("P1-MISSING-PORTS");
  return unique(attached);
}

function isPrayerConsumer(consumer: Pick<DerivedConsumer, "triggerOrPredicate">): boolean {
  return /daily.?prayer|\/기도/i.test(consumer.triggerOrPredicate);
}

function isExploreSettlementConsumer(consumer: Pick<DerivedConsumer, "triggerOrPredicate">): boolean {
  return consumer.triggerOrPredicate === "TIMER:exploreInterval == true"
    || /\/펫탐험정산|PetExploreSettlement|pet.?explore.?settlement/i.test(consumer.triggerOrPredicate);
}

function isPackageUseConsumer(consumer: Pick<DerivedConsumer, "triggerOrPredicate">): boolean {
  return consumer.triggerOrPredicate === "handlerKey=PACKAGE_USE" || /\/패키지사용/.test(consumer.triggerOrPredicate);
}

function isMarketSettlementConsumer(consumer: Pick<DerivedConsumer, "kind" | "triggerOrPredicate">): boolean {
  const value = consumer.triggerOrPredicate;
  if (consumer.kind === "RUNTIME_DISPATCH") return /handlerKey=(?:free_market_cancel|free_market_force_cancel|market_carrot_trade|free_market_buy|free_market_bag_register|store_hoi_shop|store_auction_bid|pet_skill_market_listing|home_furniture_carrot_transfer|pet_skill_carrot_trade|pendant_market_register|mini_pet_carrot_trade|pendant_carrot_trade|home_furniture_market_listing)$/.test(value);
  if (consumer.kind === "SQL_REPOSITORY") return value === "SQL_METHOD:transitionOwnedFurniture";
  if (consumer.kind === "ADMIN_COMMAND") return /ADMIN:(?:isAdminAuctionResetCommand|isAuctionRegisterCandidate)$/.test(value);
  return /(?:가구당근|스킬거래등록|펜던트당근|미니펫거래등록|당근\s|당근완료|가방거래등록|가구거래등록|펫스킬당근|당근등록|자유시장취소|거래소강제취소|자유시장구매|미니펫당근|펜던트거래등록)/.test(value);
}

function isHomeAggregateMutationConsumer(consumer: Pick<DerivedConsumer, "triggerOrPredicate">): boolean {
  return /handlerKey=(?:home_like_action|home_baseball_pitch|home_comment_action|HOME_COMMENT_DELETE|home_feed_mutate|social_own_heart|home_badge_gacha_open|home_badge_cube|home_profile_view)$/.test(consumer.triggerOrPredicate)
    || /ADMIN:(?:isGuildRankSnapshotRefreshCommand|isPunchRankResetCommand|isOverallRankRewardPayoutCommand|isGuildTerritoryRankRewardPayoutCommand|isGuildRankRewardPayoutCommand)$/.test(consumer.triggerOrPredicate);
}

function isIdentityMutationConsumer(consumer: Pick<DerivedConsumer, "kind" | "symbol" | "triggerOrPredicate">): boolean {
  return consumer.triggerOrPredicate === "handlerKey=USER_SIGNUP"
    || (consumer.kind === "SQL_REPOSITORY" && consumer.symbol === "registerPlayer");
}

function legacyEvidencePaths(consumer: DerivedConsumer): string[] {
  if (consumer.kind !== "LEGACY_COMMAND" && consumer.kind !== "AUTOMATIC_CALLBACK") return consumer.legacyPaths;
  const paths = (names: string[]): string[] => ["/sdcard/호이랜드/", "/sdcard/호이랜드_dev/"]
    .flatMap((root) => names.map((name) => `${root}${name}`));
  if (isPrayerConsumer(consumer)) return paths(["guildData.json", "member.json", "member_pet.json", "petSkillData.json"]);
  if (isExploreSettlementConsumer(consumer)) return paths(["guildData.json", "member.json", "member_pet.json", "petExploreData.json", "petSkillData.json", "petSweetHomeData.json"]);
  return consumer.legacyPaths;
}

function normalizeConsumerSemantics(consumer: DerivedConsumer): DerivedConsumer {
  const value = consumer.triggerOrPredicate;
  const handlerKey = value.match(/handlerKey=([A-Za-z0-9_]+)/)?.[1];
  if (handlerKey?.endsWith("_read") && handlerKey !== "home_activity_alert_read") return { ...consumer, access: "READ" };
  if (READ_ONLY_APP_TRIGGER.test(value)) return { ...consumer, access: "READ" };
  if (consumer.kind === "LEGACY_COMMAND" && /\/(?:좋아요순위|길드순위|펫친밀도순위|온도순위|채팅순위|레벨순위)/.test(value)) return { ...consumer, access: "READ" };
  if (consumer.primarySlice === "PACKAGE-CATALOG" && !/packageCatalogWizardActiveInput/.test(value)) return {
    ...consumer,
    dependentSlices: consumer.dependentSlices.filter((slice) => slice !== "PACKAGE-USE")
  };
  if (/isAutoExploreFixedConfigCommand/.test(value)) return { ...consumer, dependentSlices: [] };
  if (/packageCatalogWizardActiveInput/.test(value)) return {
    ...consumer,
    access: "READ_WRITE",
    dependentSlices: consumer.dependentSlices.filter((slice) => slice !== "PACKAGE-USE"),
    currentProviderImports: ["./package/package-catalog-add-wizard-iris-handler.js"]
  };
  if (consumer.kind === "APP_WIRING" && value === "dispatchAdminAccountSuspensionCommand") return {
    ...consumer,
    dependentSlices: []
  };
  if (consumer.kind === "APP_WIRING" && value === "dispatchMiniPetEquipOrBulkCleanup") return {
    ...consumer,
    dependentSlices: consumer.dependentSlices.filter((slice) => slice !== "PET-TITLE")
  };
  if (consumer.kind === "APP_WIRING" && value === "dispatchPetExploreCommandConsumers") return {
    ...consumer,
    access: "READ_WRITE",
    currentProviderImports: [
      "./pet/pet-explore-settlement-command-consumer.js",
      "./pet/pet-explore-event-control-command-service.js"
    ]
  };
  if (isPrayerConsumer(consumer)) return {
    ...consumer,
    legacyPaths: legacyEvidencePaths(consumer),
    dependentSlices: unique(["ITEM", ...(consumer.file.endsWith("app.ts") ? ["CONTEXT-BRIDGE"] : [])])
  };
  if (isExploreSettlementConsumer(consumer)) return {
    ...consumer,
    access: "READ_WRITE",
    legacyPaths: legacyEvidencePaths(consumer),
    dependentSlices: ["FURNITURE-HOME", "HOME-AGGREGATE-RANK", "ITEM", "MINI-PET", "PET-SKILL"],
    observedSqlReadTables: consumer.kind === "APP_WIRING" ? [] : consumer.observedSqlReadTables,
    observedSqlWriteTables: consumer.kind === "APP_WIRING" ? [] : consumer.observedSqlWriteTables,
    unresolvedDynamicCallCount: consumer.kind === "APP_WIRING" ? Math.max(1, consumer.unresolvedDynamicCallCount) : consumer.unresolvedDynamicCallCount
  };
  return consumer;
}

function explicitMutationSlices(consumer: DerivedConsumer): string[] {
  if (consumer.access === "READ") return [];
  const handlerKey = consumer.triggerOrPredicate.match(/handlerKey=([a-zA-Z0-9_]+)/)?.[1];
  if (handlerKey !== undefined && APP_HANDLER_MUTATION_SLICES[handlerKey] !== undefined) return APP_HANDLER_MUTATION_SLICES[handlerKey]!;
  if (handlerKey === "PACKAGE_USE") return ["CURRENCY-SHOP", "FURNITURE-HOME", "ITEM", "MEMBER-TITLE", "MINI-PET", "PET-EQUIPMENT", "PET-TITLE"];
  if (consumer.primarySlice === "PACKAGE-USE" && /\/패키지사용/.test(consumer.triggerOrPredicate)) return ["CURRENCY-SHOP", "ITEM"];
  if (isPrayerConsumer(consumer) || isExploreSettlementConsumer(consumer)) return ["ITEM"];
  return [];
}

function consumerInterfaceContract(consumer: DerivedConsumer, writeTargetTables: string[]): Pick<DerivedConsumer,
  "interfaceId" | "interfaceMethod" | "transactionOwnerInterfaceId" | "transactionParticipantInterfaceIds" | "operationReceiptTables"> {
  const value = consumer.triggerOrPredicate;
  let interfaceId: string;
  if (isPrayerConsumer(consumer)) interfaceId = "pet-skill.daily-prayer.execute";
  else if (/^\/로켓\d+,/.test(value)) interfaceId = "item.admin-grant.execute";
  else if (isExploreSettlementConsumer(consumer)) interfaceId = "pet-explore.settlement.execute";
  else if (value === "MESSAGE:msg.length > 3 progression") interfaceId = "admin-lifecycle.message-progression.apply";
  else if (/^STATE:/.test(value)) interfaceId = `${consumer.primarySlice.toLowerCase()}.state-transition.${sha(value).slice(0, 12)}`;
  else if (/handlerKey=([a-zA-Z0-9_]+)/.test(value)) interfaceId = `${consumer.primarySlice.toLowerCase()}.${value.match(/handlerKey=([a-zA-Z0-9_]+)/)![1]!.replaceAll("_", "-")}.${consumer.access === "READ" ? "read" : "execute"}`;
  else if (consumer.kind === "SQL_REPOSITORY") interfaceId = `${consumer.primarySlice.toLowerCase()}.repository.${basename(consumer.file, ".ts").replaceAll("_", "-")}.${consumer.symbol.replaceAll("_", "-")}`;
  else interfaceId = `${consumer.primarySlice.toLowerCase()}.${consumer.kind.toLowerCase().replaceAll("_", "-")}.${sha(value).slice(0, 12)}`;
  const interfaceMethod = consumer.access === "READ" ? "READ" as const : "EXECUTE" as const;
  const mutationPorts: Array<[RegExp, string]> = [
    [/canonical_owned_item_|canonical_item_inventory_/, "item.inventory.mutate"],
    [/canonical_player_currency_balances|canonical_currency_(?:operations|ledger_entries)/, "currency.balance.mutate"],
    [/object_(?:owned_furniture|home_furniture|furniture_market)|object_furniture_(?:operation|ownership)/, "furniture.ownership.mutate"],
    [/canonical_owned_mini_pet_(?!title_)|canonical_mini_pet_operation_/, "mini-pet.ownership.mutate"],
    [/canonical_owned_(?:pet_instances|pet_equipment|equipment_instances)|canonical_pet_equipment_operation_/, "pet-equipment.ownership.mutate"],
    [/canonical_owned_pet_skill_|canonical_pet_skill_(?:equipments|operation_)/, "pet-skill.ownership.mutate"],
    [/canonical_member_title_definitions/, "member-title.catalog.mutate"],
    [/canonical_owned_member_title_|canonical_member_title_selections/, "member-title.ownership.mutate"],
    [/canonical_pet_title_definitions/, "pet-title.catalog.mutate"],
    [/canonical_owned_pet_title_|canonical_pet_title_selections/, "pet-title.ownership.mutate"],
    [/canonical_mini_pet_title_definitions/, "mini-pet-title.catalog.mutate"],
    [/canonical_owned_mini_pet_title_|canonical_mini_pet_title_selections/, "mini-pet-title.ownership.mutate"],
    [/canonical_package_/, consumer.primarySlice === "PACKAGE-USE" ? "package.inventory.consume" : "package.catalog.mutate"],
    [/canonical_(?:craft|building)_/, "building-recipe.mutate"]
  ];
  const explicitSlices = explicitMutationSlices(consumer);
  const participants = consumer.access === "READ" ? [] : unique(explicitSlices.length > 0
    ? explicitSlices.map((slice) => MUTATION_CONTRACT_BY_SLICE[slice]?.port).filter((port): port is string => port !== undefined)
    : writeTargetTables.flatMap((table) => mutationPorts.filter(([pattern]) => pattern.test(table)).map(([, port]) => port)));
  if (consumer.access !== "READ" && isPackageUseConsumer(consumer) && !participants.includes("package.inventory.consume")) participants.push("package.inventory.consume");
  if (consumer.access !== "READ" && isMarketSettlementConsumer(consumer) && !participants.includes("market.settlement.mutate")) participants.push("market.settlement.mutate");
  if (consumer.access !== "READ" && isHomeAggregateMutationConsumer(consumer) && !participants.includes("home.aggregate.mutate")) participants.push("home.aggregate.mutate");
  const receipts = new Set<string>();
  if (consumer.access !== "READ") {
    for (const table of explicitSlices.length > 0 ? [] : writeTargetTables) {
      if (/canonical_owned_item_|canonical_item_inventory_/.test(table)) ["canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries"].forEach((name) => receipts.add(name));
      if (/canonical_player_currency_balances|canonical_currency_(?:operations|ledger_entries)/.test(table)) ["canonical_currency_operations", "canonical_currency_ledger_entries"].forEach((name) => receipts.add(name));
      if (/object_(?:owned_furniture|home_furniture|furniture_market)|object_furniture_/.test(table)) ["object_furniture_operation_replays", "object_furniture_ownership_history"].forEach((name) => receipts.add(name));
      if (/canonical_owned_mini_pet_(?!title_)|canonical_mini_pet_operation_/.test(table)) receipts.add("canonical_mini_pet_operation_replays");
      if (/canonical_owned_(?:pet_instances|pet_equipment|equipment_instances)|canonical_pet_equipment_operation_/.test(table)) receipts.add("canonical_pet_equipment_operation_replays");
      if (/canonical_owned_pet_skill_|canonical_pet_skill_(?:equipments|operation_)/.test(table)) receipts.add("canonical_pet_skill_operation_replays");
      if (/canonical_member_title_definitions|canonical_owned_member_title_|canonical_member_title_selections/.test(table)) receipts.add("canonical_member_title_operations");
      if (/canonical_pet_title_definitions|canonical_owned_pet_title_|canonical_pet_title_selections/.test(table)) receipts.add("canonical_pet_title_operations");
      if (/canonical_mini_pet_title_definitions|canonical_owned_mini_pet_title_|canonical_mini_pet_title_selections/.test(table)) receipts.add("canonical_mini_pet_title_operations");
      if (/canonical_package_/.test(table) && consumer.primarySlice !== "PACKAGE-USE") receipts.add("canonical_package_definition_replays");
      if (/definition_imports$/.test(table)) receipts.add(table);
    }
    if (isIdentityMutationConsumer(consumer)) receipts.add("canonical_player_identity_operations");
    for (const slice of explicitSlices) for (const receipt of MUTATION_CONTRACT_BY_SLICE[slice]?.receipts ?? []) receipts.add(receipt);
    if (isPrayerConsumer(consumer)) receipts.add("canonical_daily_prayer_operations");
    if (isExploreSettlementConsumer(consumer)) receipts.add("canonical_pet_explore_operations");
    if (isPackageUseConsumer(consumer)) ["canonical_package_use_operations", "canonical_package_use_reward_ledger_entries"].forEach((name) => receipts.add(name));
    if (isMarketSettlementConsumer(consumer)) ["canonical_market_operations", "canonical_market_transfer_ledger_entries"].forEach((name) => receipts.add(name));
    if (isHomeAggregateMutationConsumer(consumer)) receipts.add("canonical_home_aggregate_operations");
    if (consumer.kind === "SQL_REPOSITORY" && consumer.primarySlice === "BUILDING-RECIPE" && consumer.symbol === "execute") {
      receipts.delete("canonical_item_inventory_operations");
      receipts.delete("canonical_item_inventory_ledger_entries");
      receipts.delete("canonical_currency_operations");
      receipts.delete("canonical_currency_ledger_entries");
      ["canonical_craft_operations", "canonical_craft_item_ledger_entries", "canonical_craft_currency_ledger_entries"].forEach((name) => receipts.add(name));
    }
    if (consumer.targetUsageMode !== "CURRENT_SQL" && consumer.targetUsageMode !== "PORT_ONLY" && receipts.size === 0) {
      const primaryReceipt: Record<string, string[]> = {
        ITEM: ["canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries"],
        "CURRENCY-SHOP": ["canonical_currency_operations", "canonical_currency_ledger_entries"],
        "BUILDING-RECIPE": ["canonical_craft_operations"],
        "FURNITURE-HOME": ["object_furniture_operation_replays", "object_furniture_ownership_history"],
        "PET-EQUIPMENT": ["canonical_pet_equipment_operation_replays"],
        "MINI-PET": ["canonical_mini_pet_operation_replays"],
        "MEMBER-TITLE": ["canonical_member_title_operations"],
        "PET-TITLE": ["canonical_pet_title_operations"],
        "MINI-PET-TITLE-COLLECTION": ["canonical_mini_pet_title_operations"],
        "PET-SKILL": ["canonical_pet_skill_operation_replays"],
        "PACKAGE-CATALOG": ["canonical_package_definition_replays"]
      };
      for (const table of primaryReceipt[consumer.primarySlice] ?? []) receipts.add(table);
    }
  }
  return {
    interfaceId,
    interfaceMethod,
    transactionOwnerInterfaceId: interfaceMethod === "READ" ? null : interfaceId,
    transactionParticipantInterfaceIds: participants.sort(),
    operationReceiptTables: [...receipts].sort()
  };
}

function maskNonStructuralCode(text: string): string {
  const chars = text.split("");
  let state: "CODE" | "SINGLE" | "DOUBLE" | "TEMPLATE" | "LINE_COMMENT" | "BLOCK_COMMENT" | "REGEX" = "CODE";
  let escaped = false;
  for (let index = 0; index < chars.length; index += 1) {
    const current = text[index]!;
    const next = text[index + 1] ?? "";
    if (state === "CODE") {
      if (current === "'") state = "SINGLE";
      else if (current === '"') state = "DOUBLE";
      else if (current === "`") state = "TEMPLATE";
      else if (current === "/" && next === "/") { state = "LINE_COMMENT"; chars[index] = chars[index + 1] = " "; index += 1; }
      else if (current === "/" && next === "*") { state = "BLOCK_COMMENT"; chars[index] = chars[index + 1] = " "; index += 1; }
      else if (current === "/" && /[=(,:!?&|;{}\[]/.test((text.slice(0, index).match(/\S(?=\s*$)/)?.[0] ?? "("))) state = "REGEX";
      continue;
    }
    if (current !== "\n" && current !== "\r") chars[index] = " ";
    if (state === "LINE_COMMENT") { if (current === "\n") state = "CODE"; continue; }
    if (state === "BLOCK_COMMENT") { if (current === "*" && next === "/") { chars[index + 1] = " "; index += 1; state = "CODE"; } continue; }
    if (escaped) { escaped = false; continue; }
    if (current === "\\") { escaped = true; continue; }
    if ((state === "SINGLE" && current === "'") || (state === "DOUBLE" && current === '"') || (state === "TEMPLATE" && current === "`") || (state === "REGEX" && current === "/")) state = "CODE";
  }
  return chars.join("");
}

function balancedEnd(masked: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    if (masked[index] === open) depth += 1;
    if (masked[index] === close) { depth -= 1; if (depth === 0) return index; }
  }
  return -1;
}

const namedFunctionBodyCache = new Map<string, Map<string, string>>();
function namedFunctionBodies(text: string): Map<string, string> {
  const cached = namedFunctionBodyCache.get(text);
  if (cached !== undefined) return cached;
  const masked = maskNonStructuralCode(text);
  const bodies = new Map<string, string>();
  for (const match of masked.matchAll(/\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/g)) {
    const brace = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = balancedEnd(masked, brace, "{", "}");
    if (end !== -1) bodies.set(match[1]!, text.slice(brace + 1, end));
  }
  namedFunctionBodyCache.set(text, bodies);
  return bodies;
}

function namedFunctionSpan(text: string, name: string): { start: number; bodyStart: number; end: number; body: string } | undefined {
  const masked = maskNonStructuralCode(text);
  const match = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(masked);
  if (match === null) return undefined;
  const open = match.index + match[0].lastIndexOf("(");
  const close = balancedEnd(masked, open, "(", ")");
  if (close === -1) return undefined;
  let angleDepth = 0;
  let brace = -1;
  for (let index = close + 1; index < masked.length; index += 1) {
    if (masked[index] === "<") angleDepth += 1;
    else if (masked[index] === ">" && angleDepth > 0) angleDepth -= 1;
    else if (masked[index] === "{" && angleDepth === 0) { brace = index; break; }
    else if (masked[index] === ";" && angleDepth === 0) break;
  }
  if (brace === -1) return undefined;
  const end = balancedEnd(masked, brace, "{", "}");
  return end === -1 ? undefined : { start: match.index, bodyStart: brace + 1, end: end + 1, body: text.slice(brace + 1, end) };
}

interface ClassMethodSpan { name: string; start: number; bodyStart: number; end: number; body: string; publicEntry: boolean }

function classMethodSpans(text: string): ClassMethodSpan[] {
  const masked = maskNonStructuralCode(text);
  const output: ClassMethodSpan[] = [];
  for (const match of masked.matchAll(/^  (?:(?:public|private|protected|static|readonly)\s+)*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)) {
    const name = match[1]!;
    if (/^(?:constructor|if|for|while|switch|catch)$/.test(name)) continue;
    const open = (match.index ?? 0) + match[0].lastIndexOf("(");
    const close = balancedEnd(masked, open, "(", ")");
    if (close === -1) continue;
    let angleDepth = 0;
    let brace = -1;
    for (let index = close + 1; index < masked.length; index += 1) {
      if (masked[index] === "<") angleDepth += 1;
      else if (masked[index] === ">" && angleDepth > 0) angleDepth -= 1;
      else if (masked[index] === "{" && angleDepth === 0) { brace = index; break; }
      else if (masked[index] === ";" && angleDepth === 0) break;
    }
    if (brace === -1) continue;
    const end = balancedEnd(masked, brace, "{", "}");
    if (end !== -1) output.push({ name, start: match.index ?? 0, bodyStart: brace + 1, end: end + 1, body: text.slice(brace + 1, end), publicEntry: !/\b(?:private|protected)\b/.test(match[0]) });
  }
  return output;
}

function expandClassMethodClosure(text: string, seed: ClassMethodSpan): { text: string; methods: string[] } {
  const methods = new Map(classMethodSpans(text).map((method) => [method.name, method]));
  const visited = new Set<string>([seed.name]);
  const queue = [seed];
  const chunks = [seed.body];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const match of current.body.matchAll(/\bthis\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      const target = methods.get(match[1]!);
      if (target === undefined || visited.has(target.name)) continue;
      visited.add(target.name);
      queue.push(target);
      chunks.push(target.body);
    }
  }
  return { text: chunks.join("\n"), methods: [...visited].sort() };
}

function sqlAccessFor(text: string): DerivedConsumer["access"] {
  const read = /\bSELECT\b/i.test(text);
  const write = /\b(?:INSERT|UPDATE|DELETE)\b/i.test(text);
  return read && write ? "READ_WRITE" : write ? "WRITE" : "READ";
}

function expandHelperClosure(text: string, initialBody: string): { text: string; helpers: string[]; unresolvedDynamicCallCount: number } {
  const functions = namedFunctionBodies(text);
  const helpers = new Set<string>();
  const queue = [initialBody];
  const chunks = [initialBody];
  let unresolvedDynamicCallCount = 0;
  while (queue.length > 0) {
    const body = queue.shift()!;
    unresolvedDynamicCallCount += [...body.matchAll(/\[[^\]"']+\]\s*\(/g)].length;
    for (const match of body.matchAll(/(?<!\.)\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      const name = match[1]!;
      // response(...) is the legacy command router.  Following it from an
      // orchestration helper (notably /자동일퀘) would make one consumer own
      // every command in the file instead of its intentionally bounded child
      // command set.
      if (name === "response") continue;
      const helperBody = functions.get(name);
      if (helperBody === undefined || helpers.has(name)) continue;
      helpers.add(name);
      chunks.push(helperBody);
      queue.push(helperBody);
    }
  }
  return { text: chunks.join("\n"), helpers: [...helpers].sort(), unresolvedDynamicCallCount };
}

function legacyPrimarySlice(predicate: string, branch: string): string {
  const value = predicate.replace(/\\\//g, "/");
  if (/자동일퀘/.test(value)) return "ADMIN-LIFECYCLE";
  if (/HoiPassPremiumAdminCommand/.test(value)) return "ADMIN-LIFECYCLE";
  if (/(?:["']\/기도["']|DailyPrayer)/.test(value)) return "PET-SKILL";
  if (/(?:["']\/매력["']|["']\/펫주인["']|["']\/펫탐험정산["'])/.test(value)) return "PET-EQUIPMENT";
  if (/(?:["']\/(?:캐슬전적|미니펫대전승률|레벨|내정보)["'])/.test(value)) return "HOME-AGGREGATE-RANK";
  if (/\/(?:정보|미출석)|계정정지|휴면계정|휴면해제|가입인증|인증필요/.test(value)) return "ADMIN-LIFECYCLE";
  if (/\/길드계급표/.test(value)) return "HOME-AGGREGATE-RANK";
  if (/\/초보\d+,|\/로켓(?:\d+|명령)/.test(value)) return "ITEM";
  if (/@플러팅/.test(value)) return "PET-SKILL";
  if (/패키지(?:사용|가방)/.test(value)) return "PACKAGE-USE";
  if (/패키지/.test(value)) return "PACKAGE-CATALOG";
  // 거래 행위는 물품 종류보다 시장 오케스트레이터가 트랜잭션을 소유한다.
  if (/자유시장|거래|당근|경매/.test(value)) return "MARKET-ORCHESTRATOR";
  if (/가구|샵오픈|로열오픈/.test(value)) return /순위|통계/.test(value) ? "HOME-AGGREGATE-RANK" : "FURNITURE-HOME";
  if (/미니펫(?:타이틀|컬렉션|도감)/.test(value)) return "MINI-PET-TITLE-COLLECTION";
  if (/미니펫/.test(value)) return /순위|통계/.test(value) ? "HOME-AGGREGATE-RANK" : "MINI-PET";
  if (/펫스킬/.test(value)) return "PET-SKILL";
  if (/펫타이틀/.test(value)) return "PET-TITLE";
  if (/타이틀|칭호/.test(value) && !/펫/.test(value)) return "MEMBER-TITLE";
  if (/펜던트|정령|펫(?:정보|상태|생성|환생|이름|먹이|강화)/.test(value)) return /순위|통계/.test(value) ? "HOME-AGGREGATE-RANK" : "PET-EQUIPMENT";
  if (/조합|조합법|건설|건물/.test(value)) return "BUILDING-RECIPE";
  if (/포인트|다이아|하트|상점|지갑/.test(value)) return "CURRENCY-SHOP";
  if (/ㅊㅊ/.test(value)) return "CURRENCY-SHOP";
  if (/순위|통계|전체매력/.test(value)) return "HOME-AGGREGATE-RANK";
  if (/동기화|데이터정리|계정(?:잠수)?삭제|전체정리|글자수통계/.test(value)) return "ADMIN-LIFECYCLE";
  if (/가방|아이템|판매|오픈|상자|티켓/.test(value)) return "ITEM";
  // Predicate evidence is authoritative. Branch evidence is only a fallback
  // for aliases whose command text has no domain noun.
  return sliceFor(branch.slice(0, 4000), "LEGACY_COMMAND");
}

function legacyDependentSlices(primary: string, predicate: string, closureText: string): string[] {
  const value = `${predicate}\n${closureText}`;
  if (/자동일퀘/.test(predicate)) return ["CURRENCY-SHOP", "ITEM", "MINI-PET", "PET-EQUIPMENT", "PET-SKILL"].sort();
  if (/\/기도/.test(predicate)) return ["CONTEXT-BRIDGE", "ITEM"].sort();
  if (/패키지사용/.test(predicate)) return ["CURRENCY-SHOP", "ITEM"].sort();
  if (/자유시장|거래등록|당근|경매/.test(predicate)) {
    const dependencies = new Set<string>(["CURRENCY-SHOP"]);
    if (/가구/.test(predicate)) dependencies.add("FURNITURE-HOME");
    else if (/미니펫/.test(predicate)) dependencies.add("MINI-PET");
    else if (/펫스킬|스킬거래/.test(predicate)) dependencies.add("PET-SKILL");
    else if (/펜던트/.test(predicate)) dependencies.add("PET-EQUIPMENT");
    else dependencies.add("ITEM");
    dependencies.delete(primary);
    return [...dependencies].sort();
  }
  const result = new Set<string>();
  if (/\baddItem\b|\.bag\s*\[|inventory/i.test(value)) result.add("ITEM");
  if (/\baddPoint\b|\baddDiamond\b|point|diamond|currency|포인트|다이아/i.test(value)) result.add("CURRENCY-SHOP");
  if (/\bhasPetSkill\b|petSkill|pet_skill|펫스킬/i.test(value)) result.add("PET-SKILL");
  if (/miniPet|mini_pet|미니펫/i.test(value)) result.add("MINI-PET");
  if (/homeData|furniture|가구/i.test(value)) result.add("FURNITURE-HOME");
  if (/petData|ownedPet|player_pets|펫/i.test(value)) result.add("PET-EQUIPMENT");
  result.delete(primary);
  return [...result].sort();
}

function legacySemanticContinuation(predicate: string, branch: string): { trigger: string; primary: string } | undefined {
  if (/msg\s*===?\s*["']자유시장거래(?:취소)?["']/.test(predicate)) return { trigger: `STATE:${predicate}`, primary: "MARKET-ORCHESTRATOR" };
  if (/userState\[sender\]\.packageAdd/.test(predicate)) return { trigger: `STATE:packageAdd:${predicate}`, primary: "PACKAGE-CATALOG" };
  if (/msg\s*===?\s*["'](?:쫄았음|진행시켜|장착할래|생각해볼게)["']/.test(predicate)
    && /pendant(?:Upgrade|Equip)|pendantEquipState|getPendant|clearPendant/.test(`${predicate}\n${branch}`)) return { trigger: `STATE:pendant:${predicate}`, primary: "PET-EQUIPMENT" };
  if (/msg\s*===?\s*["'](?:입양할래|생각해볼게)["']/.test(predicate) && /miniPet|미니펫/.test(`${predicate}\n${branch}`)) return { trigger: `STATE:mini-pet-equip:${predicate}`, primary: "MINI-PET" };
  if (/msg\s*===?\s*["'](?:등록|ㄴㄴ)["']/.test(predicate) && /petSkillCollection/.test(`${predicate}\n${branch}`)) return { trigger: `STATE:pet-skill-collection:${predicate}`, primary: "PET-SKILL" };
  if (/msg\s*===?\s*["'](?:등록|ㄴㄴ)["']/.test(predicate) && /miniPetCollection/.test(`${predicate}\n${branch}`)) return { trigger: `STATE:mini-pet-collection:${predicate}`, primary: "MINI-PET-TITLE-COLLECTION" };
  return undefined;
}

function ifStatements(text: string): Array<{ index: number; end: number; predicate: string; branch: string }> {
  const masked = maskNonStructuralCode(text);
  const output: Array<{ index: number; end: number; predicate: string; branch: string }> = [];
  for (const match of masked.matchAll(/\bif\s*\(/g)) {
    const start = (match.index ?? 0) + match[0].lastIndexOf("(");
    const predicateEnd = balancedEnd(masked, start, "(", ")");
    if (predicateEnd === -1) continue;
    let branchStart = predicateEnd + 1;
    while (/\s/.test(masked[branchStart] ?? "")) branchStart += 1;
    if (masked[branchStart] !== "{") {
      const statementEnd = masked.indexOf(";", branchStart);
      if (statementEnd !== -1) output.push({ index: match.index ?? 0, end: statementEnd + 1, predicate: text.slice(start + 1, predicateEnd), branch: text.slice(branchStart, statementEnd + 1) });
      continue;
    }
    const branchEnd = balancedEnd(masked, branchStart, "{", "}");
    if (branchEnd === -1) continue;
    output.push({ index: match.index ?? 0, end: branchEnd + 1, predicate: text.slice(start + 1, predicateEnd), branch: text.slice(branchStart + 1, branchEnd) });
  }
  return output;
}

function legacyEntryStatements(text: string): Array<{ index: number; end: number; predicate: string; branch: string }> {
  const statements = ifStatements(text);
  return statements.filter((candidate) => {
    // These are sibling route entries in the legacy guild-territory block. A
    // surrounding operational gate also references `msg`, but does not own the
    // individual commands.
    if (/msg\s*===?\s*["']\/길드영지(?:확인|초기화)?["']/.test(candidate.predicate)) return true;
    return !statements.some((ancestor) => {
    if (ancestor === candidate || ancestor.index >= candidate.index || ancestor.end < candidate.end) return false;
    // A command/state branch owns its internal validation conditions. Broad
    // room, sender and progression gates do not, so commands below them remain
    // independently visible.
    return isCommandPredicate(ancestor.predicate)
      || legacySemanticContinuation(ancestor.predicate, ancestor.branch) !== undefined;
    });
  });
}

function surroundingSymbol(text: string, index: number): string {
  const prefix = text.slice(0, index);
  const matches = [...prefix.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)];
  return matches.at(-1)?.[1] ?? "response";
}

function isCommandPredicate(predicate: string): boolean {
  return /\bmsg\b/.test(predicate) && (/["']\//.test(predicate) || /\/\^?\\?\//.test(predicate)
    || /\bmsg(?:\.trim\(\))?\s*===?\s*["'][^"']+["']/.test(predicate)
    || /\bmsg(?:\.trim\(\))?\.(?:startsWith|indexOf|includes)\s*\(\s*["'][^"']+["']/.test(predicate)
    || /\bis[A-Za-z0-9_$]*(?:Command|Candidate|Dispatch|Handler)[A-Za-z0-9_$]*\s*\(\s*msg\b/.test(predicate));
}

function isNegativeCommandGuard(predicate: string): boolean {
  const value = predicate.trim();
  const hasPositiveAtom = /\bmsg(?:\.trim\(\))?\s*===?\s*["'][^"']+["']/.test(value)
    || /\bmsg(?:\.trim\(\))?\.(?:startsWith|indexOf|includes)\s*\(\s*["'][^"']+["']/.test(value)
    || /\/(?:\\\/|[^/])+\/[gimsuy]*\.test\s*\(\s*(?:msg|msg\.trim\(\))/.test(value);
  if (hasPositiveAtom) return false;
  return /\bmsg\s*!==?/.test(value)
    || /^!\s*(?:\/[^\n]+\/|[A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*(?:test|exec)\s*\(\s*msg\b/.test(value)
    || /^!\s*\(.*\bmsg\b/s.test(value);
}

function isExcludedLegacyObjectSurface(predicate: string): boolean {
  return /msg\s*===?\s*["']\/(?:길드계급표|길드영지준비확인|길드영지확인|길드영지초기화|길드영지)["']/.test(predicate);
}

function legacyCandidateKeys(root: string): Set<string> {
  const keys = new Set<string>();
  const independentObjectMarker = /가방|아이템|포인트|다이아|상점|조합|건설|건물|가구|펫|타이틀|칭호|스킬|시장|거래|패키지|오픈|판매|동기화|정리|계정|휴면|가입인증|계급|순위|통계|티어|길드영지|백업|서버이동|미출석|bag|inventory|currency|shop|craft|building|furniture|pet|title|skill|package|market/i;
  for (const relativeFile of ["main.js", "Info.js"]) {
    const text = readFileSync(resolve(root, relativeFile), "utf8");
    const responseSpan = namedFunctionSpan(text, "response");
    if (responseSpan === undefined) continue;
    const scanText = responseSpan.body;
    const masked = maskNonStructuralCode(scanText);
    // This is deliberately separate from legacyConsumers(), ifStatements(),
    // and legacyEntryStatements(). It builds its own raw span inventory first,
    // then applies an independent ancestor-ownership rule.
    const rawStatements: Array<{ index: number; end: number; predicate: string; branch: string; positiveAtom: boolean }> = [];
    const token = /\bif\s*\(/g;
    for (const match of masked.matchAll(token)) {
      const statementIndex = match.index ?? 0;
      const open = statementIndex + match[0].lastIndexOf("(");
      const close = balancedEnd(masked, open, "(", ")");
      if (close === -1) continue;
      let bodyStart = close + 1;
      while (/\s/.test(masked[bodyStart] ?? "")) bodyStart += 1;
      const bodyEnd = masked[bodyStart] === "{" ? balancedEnd(masked, bodyStart, "{", "}") : masked.indexOf(";", bodyStart);
      if (bodyEnd === -1) continue;
      const predicate = scanText.slice(open + 1, close);
      const branch = scanText.slice(bodyStart, Math.min(bodyEnd + 1, bodyStart + 12000));
      const positiveAtom = /\bmsg(?:\.trim\(\))?\s*===?\s*["'][^"']+["']/.test(predicate)
        || /\bmsg(?:\.trim\(\))?\.(?:startsWith|indexOf|includes)\s*\(\s*["'][^"']+["']/.test(predicate)
        || /\/(?:\\\/|[^/])+\/[gimsuy]*\.test\s*\(\s*(?:msg|msg\.trim\(\))/.test(predicate)
        || /\bis[A-Za-z0-9_$]*(?:Command|Candidate|Dispatch|Handler)[A-Za-z0-9_$]*\s*\(\s*msg\b/.test(predicate);
      rawStatements.push({ index: statementIndex, end: bodyEnd + 1, predicate, branch, positiveAtom });
    }
    for (const statement of rawStatements) {
      const { index: statementIndex, predicate, branch, positiveAtom } = statement;
      if (isExcludedLegacyObjectSurface(predicate)) continue;
      const independentState = /userState\[[^\]]+\]\.packageAdd|msg\s*===?\s*["'](?:자유시장거래(?:취소)?|입양할래|생각해볼게|등록|ㄴㄴ)["']|pendant(?:Upgrade|Equip)|pendantEquipState/i.test(`${predicate}\n${branch}`);
      const ownedByAncestor = rawStatements.some((ancestor) => ancestor.index < statement.index && ancestor.end >= statement.end
        && (ancestor.positiveAtom || /userState\[[^\]]+\]\.packageAdd|msg\s*===?\s*["'](?:자유시장거래(?:취소)?|입양할래|생각해볼게|등록|ㄴㄴ)["']|pendant(?:Upgrade|Equip)|pendantEquipState/i.test(`${ancestor.predicate}\n${ancestor.branch}`)));
      if (ownedByAncestor) continue;
      const hasMessage = /\bmsg\b/.test(predicate);
      const negativeOnly = !positiveAtom && (/\bmsg\s*!==?/.test(predicate) || /^\s*!\s*(?:\([^)]*\)|[^\s]+)\s*(?:\.test\s*\(\s*msg|$)/s.test(predicate));
      if ((hasMessage && positiveAtom && !negativeOnly && independentObjectMarker.test(`${predicate}\n${branch}`)) || independentState) {
        keys.add(`${relativeFile}|${responseSpan.bodyStart + statementIndex}`);
      }
    }
    if (relativeFile === "main.js") {
      const rocketArray = /var\s+로켓명령\s*=\s*\[([^\]]+)\]/.exec(scanText);
      const rocketGuard = /if\s*\(\s*msg\.startsWith\(로켓명령\[i\]\)\s*\)/.exec(scanText);
      if (rocketArray !== null && rocketGuard !== null) {
        for (const command of rocketArray[1]!.match(/["'](\/로켓\d+,\s*)["']/g) ?? []) {
          const trigger = command.slice(1, -1).trimEnd();
          keys.add(`${relativeFile}|${responseSpan.bodyStart + rocketGuard.index}|${trigger}`);
        }
      }
    }
  }
  return keys;
}

function legacyConsumers(root: string, tableNames: string[]): DerivedConsumer[] {
  const output: DerivedConsumer[] = [];
  for (const relativeFile of ["main.js", "Info.js"]) {
    const file = resolve(root, relativeFile);
    const text = readFileSync(file, "utf8");
    const responseSpan = namedFunctionSpan(text, "response");
    if (responseSpan === undefined) continue;
    for (const statement of legacyEntryStatements(responseSpan.body)) {
        const { predicate, branch } = statement;
        if (isExcludedLegacyObjectSurface(predicate)) continue;
        if (isNegativeCommandGuard(predicate)) continue;
        const semantic = legacySemanticContinuation(predicate, branch);
        if ((isCommandPredicate(predicate) && OBJECT_MARKER.test(`${predicate}\n${branch.slice(0, 12000)}`)) || semantic !== undefined) {
          const closure = expandHelperClosure(text, branch);
          const primary = semantic?.primary ?? legacyPrimarySlice(predicate, closure.text);
          const paths = unique([...closure.text.matchAll(/["'](\/sdcard\/호이랜드(?:_dev)?\/[^"']+)["']/g)].map((match) => match[1]!));
          const saveLoad = unique([...(closure.text.match(/\b(?:saveJsonFile|savebackupJsonFile|loadJsonFile|resolveActiveDataPath)\b/g) ?? [])]);
          const sourceStart = responseSpan.bodyStart + statement.index;
          const sourceEnd = responseSpan.bodyStart + statement.end;
          const value = `${relativeFile}|${sourceStart}|${predicate}`;
          const access = legacyAccessFor(branch);
          output.push({
            consumerId: `legacy-${sha(value).slice(0, 16)}`,
            kind: "LEGACY_COMMAND",
            file: relativeFile,
            symbol: "response",
            triggerOrPredicate: semantic?.trigger ?? (/exploreInterval\s*==\s*true/.test(predicate) ? predicate.replace(/exploreInterval\s*==\s*true\s*\|\|\s*/, "") : predicate),
            access,
            legacyPaths: paths,
            sqlTables: [],
            observedSqlReadTables: [],
            observedSqlWriteTables: [],
            saveLoad,
            environmentResolver: saveLoad.includes("resolveActiveDataPath") ? "resolveActiveDataPath" : "legacy fixed-path context",
            currentProviderImports: [],
            reachableHelpers: closure.helpers,
            unresolvedDynamicCallCount: closure.unresolvedDynamicCallCount,
            primarySlice: primary,
            dependentSlices: legacyDependentSlices(primary, predicate, `${branch}\n${closure.helpers.join("\n")}`),
            p1Bridges: p1For(primary, access, closure.unresolvedDynamicCallCount)
            ,sourceSpan: { start: sourceStart, end: sourceEnd, sha256: sha(text.slice(sourceStart, sourceEnd)) }
            ,status: "IN_SCOPE"
            ,targetSelectorId: `selector:${primary}`
            ,usedTargetTables: []
            ,usedTargetColumns: []
            ,readTargetTables: []
            ,writeTargetTables: []
            ,readTargetColumns: []
            ,writeTargetColumns: []
            ,transactionalPortDependencies: []
            ,interfaceId: ""
            ,interfaceMethod: "READ"
            ,transactionOwnerInterfaceId: null
            ,transactionParticipantInterfaceIds: []
            ,operationReceiptTables: []
            ,targetUsageMode: "ADDITIVE_PLAN"
          });
        }
    }
  }
  return output;
}

function legacyDynamicConsumers(root: string): DerivedConsumer[] {
  const file = resolve(root, "main.js");
  const text = readFileSync(file, "utf8");
  const responseSpan = namedFunctionSpan(text, "response");
  if (responseSpan === undefined) return [];
  const arrayMatch = /var\s+로켓명령\s*=\s*\[([^\]]+)\]/.exec(responseSpan.body);
  const guardMatch = /if\s*\(\s*msg\.startsWith\(로켓명령\[i\]\)\s*\)/.exec(responseSpan.body);
  if (arrayMatch === null || guardMatch === null) return [];
  const statement = ifStatements(responseSpan.body).find(({ index }) => index === guardMatch.index);
  if (statement === undefined) return [];
  const sourceStart = responseSpan.bodyStart + statement.index;
  const sourceEnd = responseSpan.bodyStart + statement.end;
  const closure = expandHelperClosure(text, statement.branch);
  return [...arrayMatch[1]!.matchAll(/["'](\/로켓\d+,\s*)["']/g)].map((match) => {
    const trigger = match[1]!.trimEnd();
    return {
      consumerId: `legacy-${sha(`main.js|${sourceStart}|${trigger}`).slice(0, 16)}`,
      kind: "LEGACY_COMMAND" as const,
      file: "main.js",
      symbol: "response",
      triggerOrPredicate: trigger,
      access: "READ_WRITE" as const,
      legacyPaths: [],
      sqlTables: [],
      observedSqlReadTables: [],
      observedSqlWriteTables: [],
      saveLoad: unique(closure.text.match(/\b(?:saveJsonFile|savebackupJsonFile|loadJsonFile|resolveActiveDataPath)\b/g) ?? []),
      environmentResolver: "legacy fixed-path context",
      currentProviderImports: [],
      reachableHelpers: closure.helpers,
      unresolvedDynamicCallCount: closure.unresolvedDynamicCallCount,
      primarySlice: "ITEM",
      dependentSlices: [],
      p1Bridges: p1For("ITEM", "READ_WRITE", closure.unresolvedDynamicCallCount),
      sourceSpan: { start: sourceStart, end: sourceEnd, sha256: sha(text.slice(sourceStart, sourceEnd)) },
      status: "IN_SCOPE" as const,
      targetSelectorId: "selector:ITEM",
      usedTargetTables: [], usedTargetColumns: [], readTargetTables: [], writeTargetTables: [], readTargetColumns: [], writeTargetColumns: [], transactionalPortDependencies: [],
      interfaceId: "", interfaceMethod: "READ", transactionOwnerInterfaceId: null, transactionParticipantInterfaceIds: [], operationReceiptTables: [],
      targetUsageMode: "ADDITIVE_PLAN" as const
    };
  });
}

function excludedNegativeGuardCount(root: string): number {
  return ["main.js", "Info.js"].flatMap((file) => {
    const text = readFileSync(resolve(root, file), "utf8");
    return ifStatements(namedFunctionSpan(text, "response")?.body ?? "");
  })
    .filter(({ predicate, branch }) => isNegativeCommandGuard(predicate) && OBJECT_MARKER.test(`${predicate}\n${branch.slice(0, 12000)}`)).length;
}

function legacyAutomaticConsumers(root: string): DerivedConsumer[] {
  const file = resolve(root, "main.js");
  const text = readFileSync(file, "utf8");
  const make = (statement: { index: number; end: number; predicate: string; branch: string }, trigger: string, primary: string, dependencies: string[], extraP1: string[] = []): DerivedConsumer => {
    const closure = expandHelperClosure(text, statement.branch);
    const access = legacyAccessFor(closure.text);
    return {
    consumerId: `automatic-callback-${sha(`main.js|${statement.index}|${trigger}`).slice(0, 16)}`,
    kind: "AUTOMATIC_CALLBACK",
    file: "main.js",
    symbol: "response",
    triggerOrPredicate: trigger,
    access,
    legacyPaths: unique([...closure.text.matchAll(/["'](\/sdcard\/호이랜드(?:_dev)?\/[^"']+)["']/g)].map((match) => match[1]!)),
    sqlTables: [],
    observedSqlReadTables: [],
    observedSqlWriteTables: [],
    saveLoad: unique(closure.text.match(/\b(?:saveJsonFile|loadJsonFile|resolveActiveDataPath)\b/g) ?? []),
    environmentResolver: "resolveActiveDataPath",
    currentProviderImports: [],
    reachableHelpers: closure.helpers,
    unresolvedDynamicCallCount: closure.unresolvedDynamicCallCount,
    primarySlice: primary,
    dependentSlices: dependencies,
    p1Bridges: unique([...p1For(primary, access, closure.unresolvedDynamicCallCount), ...extraP1]),
    sourceSpan: { start: statement.index, end: statement.end, sha256: sha(text.slice(statement.index, statement.end)) },
    status: "IN_SCOPE",
    targetSelectorId: `selector:${primary}`,
    usedTargetTables: [], usedTargetColumns: [], readTargetTables: [], writeTargetTables: [], readTargetColumns: [], writeTargetColumns: [], transactionalPortDependencies: [],
    interfaceId: "", interfaceMethod: "READ", transactionOwnerInterfaceId: null, transactionParticipantInterfaceIds: [], operationReceiptTables: [],
    targetUsageMode: "ADDITIVE_PLAN"
    };
  };
  const statements = ifStatements(text);
  const output: DerivedConsumer[] = [];
  const explore = statements.find(({ predicate }) => /exploreInterval\s*==\s*true/.test(predicate));
  if (explore !== undefined) output.push(make(explore, "TIMER:exploreInterval == true", "PET-EQUIPMENT", ["CURRENCY-SHOP", "FURNITURE-HOME", "ITEM", "MINI-PET", "PET-SKILL"]));
  const progression = statements.find(({ predicate }) => /\bmsg\.length\s*>\s*3\b/.test(predicate));
  if (progression !== undefined) output.push(make(progression, "MESSAGE:msg.length > 3 progression", "ADMIN-LIFECYCLE", ["CURRENCY-SHOP", "ITEM", "MINI-PET", "PET-EQUIPMENT", "PET-SKILL"], ["P1-CROSS-DOMAIN-ATOMICITY"]));
  return output;
}

function walkTs(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkTs(path));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) output.push(path);
  }
  return output.sort();
}

interface RuntimeDependencyClosure {
  files: string[];
  text: string;
}

function localImportBindings(file: string, text: string): Array<{ bindings: string[]; target: string; specifier: string }> {
  const output: Array<{ bindings: string[]; target: string; specifier: string }> = [];
  for (const match of text.matchAll(/import\s+([\s\S]*?)\s+from\s+["'](\.[^"']+)["']/g)) {
    const clause = match[1]!.trim();
    const specifier = match[2]!;
    const bindings: string[] = [];
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1];
    if (named !== undefined) {
      for (const entry of named.split(",")) {
        const cleaned = entry.trim().replace(/^type\s+/, "");
        if (cleaned.length === 0) continue;
        bindings.push(cleaned.split(/\s+as\s+/).at(-1)!.trim());
      }
    }
    const defaultBinding = clause.replace(/\{[\s\S]*?\}/, "").replace(/,$/, "").trim();
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(defaultBinding)) bindings.push(defaultBinding);
    let target = resolve(dirname(file), specifier);
    if (/\.js$/.test(target)) target = target.replace(/\.js$/, ".ts");
    output.push({ bindings: unique(bindings), target, specifier });
  }
  return output;
}

function expandRuntimeDependencyClosure(file: string, seedText: string): RuntimeDependencyClosure {
  const visited = new Set<string>();
  const chunks: string[] = [seedText];
  const visit = (currentFile: string, referencedText: string): void => {
    const currentText = readFileSync(currentFile, "utf8");
    for (const entry of localImportBindings(currentFile, currentText)) {
      if (!entry.bindings.some((binding) => new RegExp(`\\b${binding}\\b`).test(referencedText))) continue;
      if (visited.has(entry.target)) continue;
      visited.add(entry.target);
      const dependencyText = readFileSync(entry.target, "utf8");
      chunks.push(dependencyText);
      visit(entry.target, dependencyText);
    }
  };
  visit(file, seedText);
  return { files: [...visited].sort(), text: chunks.join("\n") };
}

function hasPersistentConsumerEvidence(text: string, tableNames: string[]): boolean {
  return tableNames.some((table) => new RegExp(`\\b${table}\\b`, "i").test(text))
    || /\bDatabase(?:Client|Transaction)\b|\.(?:query|execute)\s*(?:<[^>]+>)?\s*\(|\b[A-Za-z0-9]*(?:Repository|Store)\b|\/sdcard\/호이랜드(?:_dev)?\//i.test(text);
}

export function rawAppMessageGuardKinds(predicate: string): string[] {
  const kinds: string[] = [];
  if (/(?:normalizedEvent|event)\.message\s*===?\s*["']/.test(predicate)) kinds.push("EXACT");
  if (/(?:normalizedEvent|event)\.message(?:\?\.)?(?:startsWith|endsWith|includes)\s*\(/.test(predicate)) kinds.push("STRING_METHOD");
  if (/(?:\.test|\.exec)\s*\(\s*(?:normalizedEvent|event)\.message/.test(predicate)) kinds.push("REGEX");
  return kinds;
}

function appServiceCalls(text: string, body: string): string[] {
  return unique([
    ...[...body.matchAll(/new\s+([A-Z][A-Za-z0-9_$]+)\s*\([^;]*?\)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gs)].map((match) => `${match[1]}.${match[2]}`),
    ...[...body.matchAll(/new\s+([A-Z][A-Za-z0-9_$]*(?:Service|Repository|Store))\s*\(/g)].map((match) => match[1]!),
    ...[...body.matchAll(/\b([a-z][A-Za-z0-9_$]*(?:Handler|Service|Repository|Store))\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((match) => `${constructedTypeFor(text, match[1]!) ?? match[1]}.${match[2]}`)
  ]);
}

function handlerSpecificEvidence(direct: string, trigger: string, handlerCount: number): string {
  if (handlerCount <= 1 || !trigger.includes("handlerKey=")) return direct;
  const value = trigger.slice(trigger.indexOf("=") + 1);
  const fragments: string[] = [];
  let offset = 0;
  while (offset < direct.length) {
    const index = direct.indexOf(`"${value}"`, offset);
    const singleIndex = direct.indexOf(`'${value}'`, offset);
    const next = index === -1 ? singleIndex : singleIndex === -1 ? index : Math.min(index, singleIndex);
    if (next === -1) break;
    fragments.push(direct.slice(Math.max(0, next - 100), Math.min(direct.length, next + value.length + 500)));
    offset = next + value.length + 2;
  }
  return fragments.length > 0 ? fragments.join("\n") : direct;
}

function appCommandStatements(file: string, text: string, tableNames: string[]): Array<{ trigger: string; body: string; direct: string; index: number; end: number; primarySlice: string; providerImports: string[]; helpers: string[] }> {
  const output: Array<{ trigger: string; body: string; direct: string; index: number; end: number; primarySlice: string; providerImports: string[]; helpers: string[] }> = [];
  const commandSpans = ["buildApp", "dispatchMiniPetEquipOrBulkCleanup"].map((name) => namedFunctionSpan(text, name)).filter((span): span is NonNullable<typeof span> => span !== undefined);
  for (const commandSpan of commandSpans) for (const localStatement of ifStatements(commandSpan.body)) {
    const statement = { ...localStatement, index: commandSpan.bodyStart + localStatement.index, end: commandSpan.bodyStart + localStatement.end };
    const direct = `${statement.predicate}\n${statement.branch}`;
    if (isExcludedNonObjectAppPredicate(statement.predicate)) continue;
    const namedPredicates = unique([...statement.predicate.matchAll(/\b(is[A-Za-z0-9_$]+(?:Command|Candidate|Dispatch|Handler))\s*\(/g)].map((match) => match[1]!));
    // Only keys admitted by the predicate are reachable. Handler literals in
    // a ternary body are not consumers unless the outer guard admits them.
    const predicateHandlers = unique([...statement.predicate.matchAll(/\b([A-Za-z0-9_$]*handlerKey)(?:\s+as\s+string\s*\))?\s*===\s*["']([^"']+)["']/g)].map((match) => `${match[1]}=${match[2]}`));
    const semantic = /\bpackageCatalogWizardActiveInput\b/.test(statement.predicate) ? ["packageCatalogWizardActiveInput"] : [];
    const raw = rawAppMessageGuardKinds(statement.predicate).length > 0 ? [`message-guard@${statement.index}`] : [];
    if (namedPredicates.length === 0 && predicateHandlers.length === 0 && semantic.length === 0 && raw.length === 0) continue;
    if (predicateHandlers.length === 0 && !/(?:normalizedEvent|event)\.message/.test(statement.predicate)) continue;
    const localClosure = expandHelperClosure(text, direct);
    const closure = expandRuntimeDependencyClosure(file, localClosure.text);
    if (!hasPersistentConsumerEvidence(closure.text, tableNames)) continue;
    const serviceCalls = appServiceCalls(text, statement.branch);
    const dynamicHandlers = namedPredicates.flatMap((name) => DYNAMIC_DISPATCH_KEYS[name] ?? []).map((key) => `handlerKey=${key}`);
    const namedHandlers = namedPredicates.map((name) => NAMED_PREDICATE_HANDLER[name]).filter((value): value is string => value !== undefined).map((key) => `handlerKey=${key}`);
    const ordinaryNamed = predicateHandlers.length === 0 && dynamicHandlers.length === 0 && namedHandlers.length === 0
      ? namedPredicates.filter((name) => !(name in DYNAMIC_DISPATCH_KEYS) && !(name in NAMED_PREDICATE_HANDLER))
      : [];
    const triggers = unique([
      ...predicateHandlers,
      ...dynamicHandlers,
      ...namedHandlers,
      ...semantic.map((value) => `predicate=${value}${serviceCalls.length > 0 ? `;service=${serviceCalls.join("|")}` : ""}`),
      ...ordinaryNamed.map((name) => `predicate=${name}${serviceCalls.length > 0 ? `;service=${serviceCalls.join("|")}` : ""}`),
      ...(predicateHandlers.length === 0 && namedPredicates.length === 0 && semantic.length === 0 ? raw.map((value) => `predicate=${value}${serviceCalls.length > 0 ? `;service=${serviceCalls.join("|")}` : ""}`) : [])
    ]);
    for (const trigger of triggers) {
      if (isExcludedNonObjectAppBinding(trigger)) continue;
      const handlerValue = trigger.includes("handlerKey=") ? trigger.slice(trigger.indexOf("=") + 1) : "";
      const explicitService = appHandlerEvidenceSymbol(handlerValue);
      const namedValue = trigger.startsWith("predicate=") ? trigger.slice("predicate=".length).split(";")[0]! : "";
      const namedHandler = NAMED_PREDICATE_HANDLER[namedValue];
      const namedProvider = namedHandler === undefined ? undefined : appHandlerEvidenceSymbol(namedHandler);
      const consumerDirect = explicitService !== undefined ? `${trigger}\n${explicitService}`
        : namedProvider !== undefined ? `${trigger}\n${namedProvider}`
        : handlerSpecificEvidence(direct, trigger, predicateHandlers.length);
      const consumerServiceCalls = appServiceCalls(text, consumerDirect);
      const consumerImportBindings = localImportBindings(file, text).filter(({ bindings }) => bindings.some((binding) => new RegExp(`\\b${binding}\\b`).test(consumerDirect)));
      const primarySlice = APP_HANDLER_PRIMARY[handlerValue] ?? (namedHandler === undefined ? undefined : APP_HANDLER_PRIMARY[namedHandler])
        ?? APP_NAMED_PRIMARY[namedValue]
        ?? appBindingSlice(trigger) ?? appBindingSlice(`${consumerServiceCalls.join(" ")} ${consumerImportBindings.map(({ target }) => target).join(" ")}`);
      if (primarySlice === undefined) continue;
      const consumerLocalClosure = expandHelperClosure(text, consumerDirect);
      const consumerClosure = expandRuntimeDependencyClosure(file, consumerLocalClosure.text);
      if (hasPersistentConsumerEvidence(consumerClosure.text, tableNames)) output.push({ trigger, body: consumerClosure.text, direct: consumerDirect, index: statement.index, end: statement.end, primarySlice, providerImports: unique(consumerImportBindings.map(({ specifier }) => specifier)), helpers: consumerLocalClosure.helpers });
    }
  }
  return output;
}

function supportPassFunctionConsumers(file: string, text: string): Array<{ trigger: string; body: string; direct: string; index: number; end: number; primarySlice: string; providerImports: string[]; helpers: string[] }> {
  const span = namedFunctionSpan(text, "dispatchSupportPassRegistryCommand");
  if (span === undefined) return [];
  return ["contribution_pass_registry", "diamond_pass_registry", "hoi_pass_registry"].map((handlerKey) => {
    const provider = appHandlerEvidenceSymbol(handlerKey)!;
    const direct = `handlerKey=${handlerKey}\n${provider}`;
    const closure = expandRuntimeDependencyClosure(file, direct);
    return {
      trigger: `handlerKey=${handlerKey}`,
      body: closure.text,
      direct,
      index: span.start,
      end: span.end,
      primarySlice: APP_HANDLER_PRIMARY[handlerKey]!,
      providerImports: localImportBindings(file, text).filter(({ bindings }) => bindings.includes(provider)).map(({ specifier }) => specifier),
      helpers: []
    };
  });
}

function fallthroughHandlerConsumers(file: string, text: string): Array<{ trigger: string; body: string; direct: string; index: number; end: number; primarySlice: string; providerImports: string[]; helpers: string[] }> {
  const specifications = [
    { handlerKey: "mini_pet_bulk_cleanup", functionName: "dispatchMiniPetEquipOrBulkCleanup" },
    { handlerKey: "admin_account_suspension", functionName: "dispatchAdminAccountSuspensionCommand" }
  ];
  return specifications.flatMap(({ handlerKey, functionName }) => {
    const declaredSpan = namedFunctionSpan(text, functionName);
    const guard = ifStatements(text).find(({ predicate }) => predicate.includes(`handlerKey !== "${handlerKey}"`));
    const span = declaredSpan ?? (guard === undefined ? undefined : { start: guard.index, bodyStart: guard.index, end: guard.end, body: guard.branch });
    const provider = appHandlerEvidenceSymbol(handlerKey);
    if (span === undefined || provider === undefined || !text.slice(span.start, span.end).includes(`handlerKey !== "${handlerKey}"`)) return [];
    const direct = `handlerKey=${handlerKey}\n${provider}`;
    const closure = expandRuntimeDependencyClosure(file, direct);
    return [{
      trigger: `handlerKey=${handlerKey}`,
      body: closure.text,
      direct,
      index: span.start,
      end: span.end,
      primarySlice: APP_HANDLER_PRIMARY[handlerKey]!,
      providerImports: localImportBindings(file, text).filter(({ bindings }) => bindings.includes(provider)).map(({ specifier }) => specifier),
      helpers: []
    }];
  });
}

function appSourceCandidateKeys(root: string, tableNames: string[]): { keys: Set<string>; rawGuardCount: number } {
  const file = resolve(root, "개발환경_고도화/runtime/src/app.ts");
  const text = readFileSync(file, "utf8");
  const keys = new Set<string>();
  let rawGuardCount = 0;
  const imports = localImportBindings(file, text);
  // Independent raw-token scan: do not call appCommandStatements(), and only
  // inspect the predicate for reachability.  Handler names that appear solely
  // in a ternary/body are intentionally not promoted to active consumers.
  const commandSpans = ["buildApp", "dispatchMiniPetEquipOrBulkCleanup"].map((name) => namedFunctionSpan(text, name)).filter((span): span is NonNullable<typeof span> => span !== undefined);
  for (const commandSpan of commandSpans) {
    const scanText = commandSpan.body;
    const masked = maskNonStructuralCode(scanText);
    for (const match of masked.matchAll(/\bif\s*\(/g)) {
      const localIndex = match.index ?? 0;
      const index = commandSpan.bodyStart + localIndex;
      const open = localIndex + match[0].lastIndexOf("(");
      const close = balancedEnd(masked, open, "(", ")");
      if (close === -1) continue;
      let bodyStart = close + 1;
      while (/\s/.test(masked[bodyStart] ?? "")) bodyStart += 1;
      const bodyEnd = masked[bodyStart] === "{" ? balancedEnd(masked, bodyStart, "{", "}") : masked.indexOf(";", bodyStart);
      if (bodyEnd === -1) continue;
      const predicate = scanText.slice(open + 1, close);
      const body = scanText.slice(bodyStart, bodyEnd + 1);
      if (isExcludedNonObjectAppPredicate(predicate)) continue;
      const direct = `${predicate}\n${body}`;
      const named = unique([...predicate.matchAll(/\b(is[A-Za-z0-9_$]+(?:Command|Candidate|Dispatch|Handler))\s*\(/g)].map((entry) => entry[1]!));
      const raw = /(?:normalizedEvent|event)\.message/.test(predicate) && rawAppMessageGuardKinds(predicate).length > 0;
      const semantic = /\bpackageCatalogWizardActiveInput\b/.test(predicate);
      const predicateKeys = new Set([...predicate.matchAll(/\b[A-Za-z0-9_$]*handlerKey(?:\s+as\s+string\s*\))?\s*===\s*["']([A-Za-z0-9_]+)["']/g)].map((entry) => entry[1]!));
      for (const name of named) {
        for (const key of DYNAMIC_DISPATCH_KEYS[name] ?? []) predicateKeys.add(key);
        const namedHandler = NAMED_PREDICATE_HANDLER[name];
        if (namedHandler !== undefined) predicateKeys.add(namedHandler);
        if (name in APP_NAMED_PRIMARY) continue;
        const imported = imports.find(({ bindings }) => bindings.includes(name));
        if (imported !== undefined) {
          const importedText = readFileSync(imported.target, "utf8");
          const importedSpan = namedFunctionSpan(importedText, name);
          for (const entry of (importedSpan?.body ?? importedText).matchAll(/handlerKey\s*===?\s*["']([A-Za-z0-9_]+)["']/g)) predicateKeys.add(entry[1]!);
        }
      }
      const mappedPredicateKeys = [...predicateKeys].filter((key) => !isExcludedNonObjectAppBinding(`handlerKey=${key}`)
        && (APP_HANDLER_PRIMARY[key] ?? appBindingSlice(`handlerKey=${key}`)) !== undefined);
      const sourceObjectEvidence = mappedPredicateKeys.length > 0
        || named.some((name) => name in APP_NAMED_PRIMARY)
        || appBindingSlice(`${predicate}\n${body}`) !== undefined
        || hasPersistentConsumerEvidence(direct, tableNames);
      if ((named.length > 0 || raw || semantic || predicateKeys.size > 0) && sourceObjectEvidence) {
        let handlerAdded = false;
        for (const key of predicateKeys) {
          const trigger = `handlerKey=${key}`;
          if (!isExcludedNonObjectAppBinding(trigger) && (APP_HANDLER_PRIMARY[key] ?? appBindingSlice(trigger)) !== undefined) {
            keys.add(`RUNTIME_DISPATCH|${trigger}`);
            handlerAdded = true;
          }
        }
        if (semantic || (!handlerAdded && (named.length > 0 || raw))) keys.add(`RUNTIME_DISPATCH|${index}`);
        if (raw && named.length === 0) rawGuardCount += 1;
      }
    }
  }
  for (const key of ["mini_pet_bulk_cleanup", "admin_account_suspension"]) keys.add(`RUNTIME_DISPATCH|handlerKey=${key}`);
  const buildSpan = namedFunctionSpan(text, "buildApp");
  const wiringMasked = maskNonStructuralCode(buildSpan?.body ?? "");
  for (const match of wiringMasked.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    const name = match[1]!;
    if (/^dispatch[A-Za-z0-9]+$/.test(name)) {
      if (name === "dispatchPetExploreCommandConsumers") {
        keys.add("APP_WIRING|dispatchPetExploreSettlementCommand");
        keys.add("APP_WIRING|dispatchPetExploreEventControlCommand");
      } else keys.add(`APP_WIRING|${name}`);
    }
  }
  const routeSurface = extractHttpRouteSurface({ runtimeRoot: resolve(root, "개발환경_고도화/runtime") });
  for (const endpoint of routeSurface.endpoints) keys.add(`HTTP_WEB_ROUTE|${endpoint.key}`);
  for (const key of ["contribution_pass_registry", "diamond_pass_registry", "hoi_pass_registry"]) keys.add(`RUNTIME_DISPATCH|handlerKey=${key}`);
  for (const match of text.matchAll(/\bsetInterval\s*\(/g)) if (/accountCleanupTimer\s*=\s*setInterval/.test(text.slice(Math.max(0, (match.index ?? 0) - 120), (match.index ?? 0) + 180))) keys.add(`AUTOMATIC_CALLBACK|TIMER:setInterval@${match.index}`);
  return { keys, rawGuardCount };
}

function adminSourceCandidateKeys(root: string): Set<string> {
  const text = readFileSync(resolve(root, "개발환경_고도화/runtime/src/admin/iris-admin-command-service.ts"), "utf8");
  const start = text.indexOf("async changePlayerPoint(");
  const end = text.indexOf("async handleMiniPetDuelResetGrant(", start);
  if (start < 0 || end < 0) return new Set();
  const dispatch = text.slice(start, end);
  const keys = new Set<string>();
  for (const match of dispatch.matchAll(/\bif\s*\(\s*(is[A-Za-z0-9_$]*(?:Command|Candidate)[A-Za-z0-9_$]*)\s*\(\s*input\.message\s*\)/g)) {
    const guard = match[1]!;
    if (!ADMIN_NON_OBJECT_COMMAND.test(guard)) keys.add(`ADMIN:${guard}`);
  }
  if (dispatch.includes("const match = /^\\/포인트수정")) keys.add("ADMIN:/포인트수정");
  return keys;
}

function runtimePrimarySlice(relativeFile: string, trigger: string, kind: ConsumerKind, tables: string[], classificationBody: string): string {
  if (relativeFile.includes("/inventory/")) return "ITEM";
  if (relativeFile.includes("/home/canonical-furniture-home-repository")) return "FURNITURE-HOME";
  if (relativeFile.includes("/currency/")) return "CURRENCY-SHOP";
  if (relativeFile.includes("/mini-pet/")) return "MINI-PET";
  if (relativeFile.includes("/title/")) return "MEMBER-TITLE";
  if (relativeFile.includes("/pet/maria-canonical-pet-skill")) return "PET-SKILL";
  if (relativeFile.includes("/pet/")) return "PET-EQUIPMENT";
  if (relativeFile.includes("/crafting/")) return "BUILDING-RECIPE";
  if (relativeFile.includes("/package/")) return "PACKAGE-CATALOG";
  if (relativeFile.includes("/data-migration/")) return "ADMIN-LIFECYCLE";
  if (relativeFile.includes("/identity/") || relativeFile.includes("/catalog/object-catalog-compatibility")) return "CONTEXT-BRIDGE";
  return sliceFor(`${relativeFile} ${trigger} ${tables.join(" ")} ${classificationBody.slice(0, 4000)}`, kind);
}

function knownMigrationSqlTables(root: string): Set<string> {
  const migrationRoot = resolve(root, "개발환경_고도화/runtime/migrations");
  return new Set(unique(readdirSync(migrationRoot).filter((name) => name.endsWith(".sql")).flatMap((name) =>
    [...readFileSync(resolve(migrationRoot, name), "utf8").matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([a-z][a-z0-9_]*)`?/gi)].map((match) => match[1]!))));
}

function httpRouteConsumers(root: string, tableNames: string[]): DerivedConsumer[] {
  const runtimeRoot = resolve(root, "개발환경_고도화/runtime");
  const knownSqlTables = knownMigrationSqlTables(root);
  return extractHttpRouteSurface({ runtimeRoot }).endpoints.map((endpoint, index) => {
    const file = resolve(runtimeRoot, endpoint.module);
    const text = readFileSync(file, "utf8");
    const direct = text.slice(endpoint.sourceSpan.start, endpoint.sourceSpan.end);
    // A route span proves only its direct body. Interface-property calls such as
    // dependencies.auth.refreshSession cannot be resolved to one implementation
    // without composition-root type analysis, so do not overclaim transitive SQL.
    const observedSql = observedSqlDirection(direct, knownSqlTables);
    const sqlTables = tableNames.filter((table) => new RegExp(`\\b${table}\\b`, "i").test(direct));
    const registrarSlices = appRouteDependentSlices(endpoint.registrar);
    const inferredSlices = dependentSlices("ADMIN-WEB-APP-WIRING", `${endpoint.key}\n${direct}`, sqlTables);
    const dependent = unique([...registrarSlices, ...inferredSlices].filter((slice) => slice !== "ADMIN-WEB-APP-WIRING"));
    const access = httpEndpointAccess(endpoint.method, endpoint.path);
    return {
      consumerId: `http-web-route-${sha(`${endpoint.module}|${endpoint.key}|${index}`).slice(0, 16)}`,
      kind: "HTTP_WEB_ROUTE",
      file: repoPath(root, file),
      symbol: endpoint.registrar,
      triggerOrPredicate: endpoint.key,
      access,
      legacyPaths: [],
      sqlTables,
      observedSqlReadTables: observedSql.read,
      observedSqlWriteTables: observedSql.write,
      saveLoad: [],
      environmentResolver: "composition-root database",
      currentProviderImports: [],
      reachableHelpers: unique([...direct.matchAll(/\bdependencies\.([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)/g)].map((match) => match[1]!)),
      unresolvedDynamicCallCount: 1,
      primarySlice: "ADMIN-WEB-APP-WIRING",
      dependentSlices: dependent,
      p1Bridges: p1For("ADMIN-WEB-APP-WIRING", access),
      sourceSpan: { start: endpoint.sourceSpan.start, end: endpoint.sourceSpan.end, sha256: endpoint.sourceSpan.sha256 },
      status: "IN_SCOPE",
      targetSelectorId: "selector:ADMIN-WEB-APP-WIRING",
      usedTargetTables: [], usedTargetColumns: [], readTargetTables: [], writeTargetTables: [], readTargetColumns: [], writeTargetColumns: [],
      transactionalPortDependencies: [], interfaceId: "", interfaceMethod: "READ", transactionOwnerInterfaceId: null,
      transactionParticipantInterfaceIds: [], operationReceiptTables: [], targetUsageMode: "PORT_ONLY"
    };
  });
}

function runtimeConsumers(root: string, tableNames: string[]): DerivedConsumer[] {
  const runtimeSrc = resolve(root, "개발환경_고도화/runtime/src");
  const knownSqlTables = knownMigrationSqlTables(root);
  const output: DerivedConsumer[] = [];
  for (const file of walkTs(runtimeSrc)) {
    const relativeFile = repoPath(root, file);
    if (relativeFile.endsWith("object-db-consumer-transition-audit.ts")) continue;
    const text = readFileSync(file, "utf8");
    const imports = unique([...text.matchAll(/from\s+["']([^"']*(?:repository|provider|service)[^"']*)["']/gi)].map((match) => match[1]!));
    const tables = tableNames.filter((table) => new RegExp(`\\b${table}\\b`, "i").test(text));
    const base = basename(file);
    const classOrFunction = text.match(/(?:class|function)\s+([A-Za-z0-9_]+)/)?.[1] ?? base.replace(/\.ts$/, "");
    let addSequence = 0;
    const logicalKeys = new Set<string>();
    const add = (kind: ConsumerKind, trigger: string, body = text, spanStart = 0, spanEnd = spanStart + body.length, classificationBody = body, primaryOverride?: string, dependentOverride?: string[], providerImportsOverride?: string[], helpersOverride?: string[], symbolOverride?: string, accessOverride?: DerivedConsumer["access"]): void => {
      const logicalKey = `${kind}|${trigger}`;
      if (logicalKeys.has(logicalKey)) return;
      logicalKeys.add(logicalKey);
      const consumerTables = tableNames.filter((table) => new RegExp(`\\b${table}\\b`, "i").test(body));
      const observedSql = observedSqlDirection(body, knownSqlTables);
      const primary = primaryOverride ?? runtimePrimarySlice(relativeFile, trigger, kind, consumerTables, classificationBody);
      const access = accessOverride ?? (READ_ONLY_APP_TRIGGER.test(trigger) ? "READ" : accessFor(body));
      output.push({
        consumerId: `${kind.toLowerCase().replaceAll("_", "-")}-${sha(`${relativeFile}|${kind}|${trigger}|${addSequence++}`).slice(0, 16)}`,
        kind,
        file: relativeFile,
        symbol: symbolOverride ?? classOrFunction,
        triggerOrPredicate: trigger,
        access,
        legacyPaths: unique([...body.matchAll(/["'](\/sdcard\/호이랜드(?:_dev)?\/[^"']+)["']/g)].map((match) => match[1]!)),
        sqlTables: consumerTables,
        observedSqlReadTables: observedSql.read,
        observedSqlWriteTables: observedSql.write,
        saveLoad: unique(body.match(/\b(?:saveJsonFile|loadJsonFile|resolveActiveDataPath)\b/g) ?? []),
        environmentResolver: /DATABASE_NAME|databaseIdentity|environment_code|environmentCode/.test(body) ? "database/environment context" : "composition-root database",
        currentProviderImports: providerImportsOverride ?? imports,
        reachableHelpers: helpersOverride ?? [],
        unresolvedDynamicCallCount: 0,
        primarySlice: primary,
        dependentSlices: dependentOverride ?? dependentSlices(primary, `${relativeFile} ${trigger}\n${body}`, consumerTables),
        p1Bridges: p1For(primary, access)
        ,sourceSpan: { start: spanStart, end: spanEnd, sha256: sha(text.slice(spanStart, spanEnd)) }
        ,status: "IN_SCOPE"
        ,targetSelectorId: `selector:${primary}`
        ,usedTargetTables: []
        ,usedTargetColumns: []
        ,readTargetTables: []
        ,writeTargetTables: []
        ,readTargetColumns: []
        ,writeTargetColumns: []
        ,transactionalPortDependencies: []
        ,interfaceId: ""
        ,interfaceMethod: "READ"
        ,transactionOwnerInterfaceId: null
        ,transactionParticipantInterfaceIds: []
        ,operationReceiptTables: []
        ,targetUsageMode: kind === "SQL_REPOSITORY" ? "CURRENT_SQL" : "PORT_ONLY"
      });
    };
    if (!relativeFile.includes("/data-migration/")) {
      const methods = classMethodSpans(text);
      const titleDomains: Array<{ name: string; primary: string; tables: string[] }> = [
        { name: "member", primary: "MEMBER-TITLE", tables: ["canonical_member_title_definitions", "canonical_owned_member_title_instances", "canonical_member_title_selections"] },
        { name: "pet", primary: "PET-TITLE", tables: ["canonical_pet_title_definitions", "canonical_owned_pet_title_instances", "canonical_pet_title_selections"] },
        { name: "mini-pet", primary: "MINI-PET-TITLE-COLLECTION", tables: ["canonical_mini_pet_title_definitions", "canonical_owned_mini_pet_title_instances", "canonical_mini_pet_title_selections"] }
      ];
      for (const method of methods) {
        if (!method.publicEntry) continue;
        const closure = expandClassMethodClosure(text, method);
        if (!/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(closure.text)) continue;
        if (relativeFile.endsWith("/title/maria-canonical-title-repository.ts")) {
          for (const domain of titleDomains) {
            const methodTables = method.name === "listOwned" ? domain.tables
              : method.name === "select" || method.name === "release" ? domain.tables.slice(1)
              : method.name === "grant" ? [domain.tables[1]!]
              : [domain.tables[0]!];
            const domainBody = `${closure.text}\n${methodTables.join("\n")}`;
            add("SQL_REPOSITORY", `SQL_METHOD:${domain.name}:${method.name}`, domainBody, method.start, method.end, domainBody,
              domain.primary, [], undefined, closure.methods, `${domain.name}.${method.name}`, sqlAccessFor(closure.text));
          }
        } else {
          const methodTables = tableNames.filter((table) => new RegExp(`\\b${table}\\b`, "i").test(closure.text));
          if (methodTables.length === 0) continue;
          const primary = method.name === "registerPlayer" ? "CONTEXT-BRIDGE"
            : relativeFile.includes("/home/canonical-furniture-home-repository") && methodTables.some((table) => /market_listings/.test(table))
            ? "MARKET-ORCHESTRATOR" : undefined;
          add("SQL_REPOSITORY", `SQL_METHOD:${method.name}`, closure.text, method.start, method.end, closure.text,
            primary, undefined, undefined, closure.methods, method.name, sqlAccessFor(closure.text));
        }
      }
    }
    if (relativeFile.endsWith("/admin/iris-admin-command-service.ts")) {
      const methods = classMethodSpans(text);
      const dispatch = methods.find(({ name }) => name === "changePlayerPoint");
      if (dispatch !== undefined) {
        for (const statement of ifStatements(dispatch.body)) {
          const guard = statement.predicate.match(/\b(is[A-Za-z0-9_$]*(?:Command|Candidate)[A-Za-z0-9_$]*)\s*\(\s*input\.message\s*\)/)?.[1];
          if (guard === undefined || ADMIN_NON_OBJECT_COMMAND.test(guard)) continue;
          let commandEvidence = `${statement.predicate}\n${statement.branch}`;
          const localMethods = unique([...statement.branch.matchAll(/\bthis\.([A-Za-z0-9_$]+)\s*\(/g)].map((match) => match[1]!));
          for (const localMethod of localMethods) {
            const method = methods.find(({ name }) => name === localMethod);
            if (method !== undefined) commandEvidence += `\n${expandClassMethodClosure(text, method).text}`;
          }
          const closure = expandRuntimeDependencyClosure(file, commandEvidence);
          if (!hasPersistentConsumerEvidence(closure.text, tableNames)) continue;
          const primary = adminPrimarySlice(guard);
          const importsForCommand = localImportBindings(file, text)
            .filter(({ bindings }) => bindings.some((binding) => new RegExp(`\\b${binding}\\b`).test(commandEvidence)))
            .map(({ specifier }) => specifier);
          const commandDependencies = dependentSlices(primary, `${guard}\n${localMethods.join("\n")}\n${importsForCommand.join("\n")}`, []);
          const commandAccess: DerivedConsumer["access"] = /(?:Read|Status|Stats|Compare|TimeCheck)/.test(guard) ? "READ" : "READ_WRITE";
          add("ADMIN_COMMAND", `ADMIN:${guard}`, closure.text, dispatch.bodyStart + statement.index,
            dispatch.bodyStart + statement.end, commandEvidence, primary, commandDependencies, importsForCommand,
            localMethods, guard, commandAccess);
        }
        const pointEditStart = dispatch.body.indexOf("const match = /^\\/포인트수정");
        if (pointEditStart >= 0) {
          const pointBody = dispatch.body.slice(pointEditStart);
          add("ADMIN_COMMAND", "ADMIN:/포인트수정", pointBody, dispatch.bodyStart + pointEditStart,
            dispatch.end, pointBody, "CURRENCY-SHOP", ["CONTEXT-BRIDGE"],
            ["../currency/currency-service.js"], [], "admin-point-edit", "READ_WRITE");
        }
      }
    }
    if (file.endsWith("app.ts")) {
      for (const candidate of [...appCommandStatements(file, text, tableNames), ...supportPassFunctionConsumers(file, text), ...fallthroughHandlerConsumers(file, text)]) {
        const handlerKey = candidate.trigger.match(/handlerKey=([A-Za-z0-9_]+)/)?.[1];
        const runtimeClosure = expandRuntimeDependencyClosure(file, candidate.body);
        add("RUNTIME_DISPATCH", candidate.trigger, runtimeClosure.text, candidate.index, candidate.end, "", candidate.primarySlice,
          handlerKey === undefined ? undefined : APP_HANDLER_DEPENDENCIES[handlerKey], candidate.providerImports, candidate.helpers, candidate.trigger);
      }
      const buildSpan = namedFunctionSpan(text, "buildApp");
      const wiringText = buildSpan?.body ?? "";
      const wiringOffset = buildSpan?.bodyStart ?? 0;
      for (const match of wiringText.matchAll(/\b(dispatch[A-Za-z0-9]+)\s*\(/g)) {
        const sourceStart = wiringOffset + (match.index ?? 0);
        if (match[1] === "dispatchPetExploreCommandConsumers") {
          for (const logicalName of ["dispatchPetExploreSettlementCommand", "dispatchPetExploreEventControlCommand"]) {
            const logicalSpan = namedFunctionSpan(text, logicalName);
            if (logicalSpan === undefined) continue;
            const logicalClosure = expandRuntimeDependencyClosure(file, logicalSpan.body);
            const logicalImports = localImportBindings(file, text)
              .filter(({ bindings }) => bindings.some((binding) => new RegExp(`\\b${binding}\\b`).test(logicalSpan.body)))
              .map(({ specifier }) => specifier);
            add("APP_WIRING", logicalName, logicalClosure.text, logicalSpan.start, logicalSpan.end, logicalSpan.body,
              "PET-EQUIPMENT", undefined, logicalImports, [], logicalName);
          }
          continue;
        }
        const functionSpan = namedFunctionSpan(text, match[1]!);
        const localClosure = expandHelperClosure(text, functionSpan?.body ?? match[0]);
        const closure = expandRuntimeDependencyClosure(file, localClosure.text);
        const exactImports = localImportBindings(file, text).filter(({ bindings }) => bindings.some((binding) => new RegExp(`\\b${binding}\\b`).test(functionSpan?.body ?? match[0]))).map(({ specifier }) => specifier);
        add("APP_WIRING", match[1]!, closure.text, sourceStart, sourceStart + match[0].length, match[0], appBindingSlice(match[1]!) ?? "ADMIN-WEB-APP-WIRING", undefined, exactImports, localClosure.helpers, match[1]!);
      }
    }
    if (file.endsWith("app.ts")) {
      for (const match of text.matchAll(/\bsetInterval\s*\(/g)) {
        const start = Math.max(0, (match.index ?? 0) - 120);
        const snippet = text.slice(start, Math.min(text.length, (match.index ?? 0) + 1600));
        if (/accountCleanupTimer\s*=\s*setInterval/.test(snippet.slice(0, 300))) add("AUTOMATIC_CALLBACK", `TIMER:setInterval@${match.index}`, snippet, start, start + snippet.length, snippet, "ADMIN-LIFECYCLE", undefined, [], [], "accountCleanupTimer");
      }
    }
  }
  return output;
}

export function deriveConsumerManifest(repoRoot: string, baseCommit: string): ConsumerManifest {
  const standard = JSON.parse(readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-data-model-standard.v1.json"), "utf8")) as { tables: Array<{ table: string; columns: Array<{ name: string }>; primaryKey: string[]; foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }> }> };
  const tableNames = standard.tables.map(({ table }) => table);
  const tableMap = new Map(standard.tables.map((table) => [table.table, table]));
  const targetSelectors = deriveTargetSelectors(repoRoot);
  const closeUsage = (seedTables: string[], seedColumns: string[]): { tables: string[]; columns: string[] } => {
    const tables = new Set(seedTables);
    const columns = new Set(seedColumns);
    for (const tableName of [...tables]) {
      const table = tableMap.get(tableName);
      if (!table) continue;
      for (const column of table.primaryKey) columns.add(`${tableName}.${column}`);
      for (const foreignKey of table.foreignKeys) {
        if (!columns.has(`${tableName}.${foreignKey.column}`)) continue;
        tables.add(foreignKey.referencesTable);
        columns.add(`${foreignKey.referencesTable}.${foreignKey.referencesColumn}`);
      }
    }
    return { tables: [...tables].sort(), columns: [...columns].sort() };
  };
  const closeDirectionalUsage = (seedReadTables: string[], seedWriteTables: string[], seedReadColumns: string[], seedWriteColumns: string[]): {
    readTables: string[]; writeTables: string[]; readColumns: string[]; writeColumns: string[];
  } => {
    const writeTables = new Set(seedWriteTables);
    const writeColumns = new Set(seedWriteColumns);
    const readTables = new Set(seedReadTables);
    const readColumns = new Set(seedReadColumns);
    for (const tableName of writeTables) {
      const table = tableMap.get(tableName);
      if (!table) continue;
      for (const column of table.primaryKey) writeColumns.add(`${tableName}.${column}`);
      for (const foreignKey of table.foreignKeys) {
        writeColumns.add(`${tableName}.${foreignKey.column}`);
        if (!writeTables.has(foreignKey.referencesTable)) readTables.add(foreignKey.referencesTable);
        readColumns.add(`${foreignKey.referencesTable}.${foreignKey.referencesColumn}`);
      }
    }
    const closedRead = closeUsage([...readTables], [...readColumns]);
    return {
      readTables: closedRead.tables,
      writeTables: [...writeTables].sort(),
      readColumns: closedRead.columns,
      writeColumns: [...writeColumns].sort()
    };
  };
  const plannedUsage = (consumer: DerivedConsumer): { tables: string[]; columns: string[]; readTables: string[]; writeTables: string[]; readColumns: string[]; writeColumns: string[] } => {
    const selectorList = unique([consumer.primarySlice, ...consumer.dependentSlices]).map((slice) => targetSelectors[`selector:${slice}`]).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    if (selectorList.length === 0) return { tables: [], columns: [], readTables: [], writeTables: [], readColumns: [], writeColumns: [] };
    const availableTables = unique(selectorList.flatMap(({ tables }) => tables));
    const availableColumns = unique(selectorList.flatMap(({ columns }) => columns));
    const sourceText = readFileSync(resolve(repoRoot, consumer.file), "utf8");
    const directValue = sourceText.slice(consumer.sourceSpan.start, consumer.sourceSpan.end);
    const value = consumer.kind === "LEGACY_COMMAND"
      ? `${directValue}\n${consumer.reachableHelpers.join("\n")}`
      : `${consumer.triggerOrPredicate}\n${consumer.currentProviderImports.join("\n")}\n${consumer.reachableHelpers.join("\n")}\n${consumer.sqlTables.join("\n")}`;
    const corePatterns: Record<string, RegExp> = {
      "CONTEXT-BRIDGE": /canonical_players/,
      ITEM: /canonical_item_definitions|canonical_owned_item_stacks/,
      "CURRENCY-SHOP": /canonical_currency_definitions|canonical_player_currency_balances/,
      "BUILDING-RECIPE": /canonical_building_definitions|canonical_craft_recipe_definitions|canonical_building_craft_recipes/,
      "FURNITURE-HOME": /object_furniture_definitions|object_owned_furniture_instances/,
      "HOME-AGGREGATE-RANK": /definitions|owned_.*instances/,
      "PET-EQUIPMENT": /canonical_pet_definitions|canonical_owned_pet_instances|canonical_equipment_definitions|canonical_owned_equipment_instances/,
      "MINI-PET": /canonical_mini_pet_definitions|canonical_owned_mini_pet_instances/,
      "MEMBER-TITLE": /canonical_member_title_definitions|canonical_owned_member_title_instances/,
      "PET-TITLE": /canonical_pet_title_definitions|canonical_owned_pet_title_instances/,
      "MINI-PET-TITLE-COLLECTION": /canonical_mini_pet_title_definitions|canonical_owned_mini_pet_title_instances/,
      "PET-SKILL": /canonical_pet_skill_definitions|canonical_owned_pet_skill_stacks/,
      "MARKET-ORCHESTRATOR": /canonical_players|canonical_player_currency_balances/,
      "PACKAGE-CATALOG": /canonical_package_definitions|canonical_package_reward_groups|canonical_package_reward_entries/,
      "PACKAGE-USE": /canonical_package_definitions|canonical_package_reward_groups|canonical_package_reward_entries/,
      "ADMIN-LIFECYCLE": /canonical_players/
    };
    const selected = new Set(availableTables.filter((table) => corePatterns[consumer.primarySlice]?.test(table)));
    const packageBagRead = consumer.reachableHelpers.includes("buildUserPackageBagMessage") && !consumer.reachableHelpers.includes("usePackageFromBag");
    const packageUse = consumer.reachableHelpers.includes("usePackageFromBag") || /패키지사용/i.test(consumer.triggerOrPredicate);
    if (/(?:\.bag\s*\[|\.bag\.|가방|bag|inventory)/i.test(value)) {
      for (const table of availableTables) if (/canonical_item_definitions|canonical_owned_item_stacks|canonical_owned_item_instances/.test(table)) selected.add(table);
    }
    const domainSignals: Array<[RegExp, RegExp]> = [
      [/miniPet|mini_pet|미니펫/i, /canonical_mini_pet_definitions|canonical_owned_mini_pet_instances|canonical_mini_pet_(?:equipment|enhancement_rules)/],
      [/miniPetTitle|mini_pet_title|미니펫타이틀/i, /canonical_(?:owned_)?mini_pet_title/],
      [/petTitle|pet_title|펫타이틀/i, /canonical_(?:owned_)?pet_title/],
      [/memberTitle|playerTitle|member_title|player_title|타이틀/i, /canonical_(?:owned_)?member_title/],
      [/petSkill|pet_skill|펫스킬/i, /canonical_pet_skill_definitions|canonical_owned_pet_skill_stacks|canonical_pet_skill_equipments/],
      [/furniture|homeData|가구/i, /object_furniture_definitions|object_owned_furniture_instances|object_home_furniture_placements/],
      [/petData|ownedPet|펫/i, /canonical_pet_definitions|canonical_owned_pet_instances|canonical_(?:owned_)?equipment/],
      [/point|diamond|currency|포인트|다이아/i, /canonical_currency_definitions|canonical_player_currency_balances/]
    ];
    if (!packageBagRead) for (const [signal, tablePattern] of domainSignals) if (signal.test(value)) for (const table of availableTables) if (tablePattern.test(table)) selected.add(table);
    if (packageUse) {
      selected.clear();
      for (const table of availableTables) if (/^canonical_(?:package_(?:definitions|reward_groups|reward_entries|item_rewards|nested_rewards)|owned_item_(?:stacks|instances)|item_definitions|currency_definitions|player_currency_balances|players)$/.test(table)) selected.add(table);
    }
    if (isPrayerConsumer(consumer) || isExploreSettlementConsumer(consumer)) {
      for (const table of availableTables) if (/^canonical_(?:item_definitions|owned_item_stacks)$/.test(table)) selected.add(table);
      selected.delete("canonical_owned_item_instances");
    }
    if (!packageBagRead && !packageUse) {
      if (/선택|장착|해제|equip|select/i.test(value)) for (const table of availableTables) if (/selections|equipments|placements/.test(table)) selected.add(table);
      if (/강화|enhance/i.test(value)) for (const table of availableTables) if (/enhancement_rules/.test(table)) selected.add(table);
      if (/거래|시장|판매|market|listing/i.test(value)) for (const table of availableTables) if (/market_listings/.test(table)) selected.add(table);
      // Operation/receipt tables are selected only when the concrete consumer
      // evidence names them. Slice membership alone is not execution evidence.
    }
    const operationTable = (table: string): boolean => /operations|ledger_entries|operation_replays|ownership_history/.test(table);
    const definitionTable = (table: string): boolean => /definitions$|enhancement_rules$|reward_groups$|reward_entries$|_rewards$|_inputs$|_outputs$|craft_recipes$/.test(table);
    const explicitSlices = explicitMutationSlices(consumer);
    const mutationSlices = new Set<string>(consumer.access === "READ" ? [] : explicitSlices.length > 0 ? explicitSlices : [consumer.primarySlice]);
    if (explicitSlices.length === 0 && /자동일퀘|패키지사용|자유시장|거래등록|당근|경매|market|listing|trade/i.test(consumer.triggerOrPredicate)) {
      for (const slice of consumer.dependentSlices) mutationSlices.add(slice);
    }
    const tableSlice = (table: string): string | undefined => TABLE_SLICE.find(([pattern]) => pattern.test(table))?.[1];
    const writeTables = new Set<string>();
    const readTables = new Set<string>();
    for (const table of selected) {
      if (consumer.access === "READ") readTables.add(table);
      else if (operationTable(table) || (!definitionTable(table) && !/^canonical_players$/.test(table) && mutationSlices.has(tableSlice(table) ?? consumer.primarySlice))) writeTables.add(table);
      else readTables.add(table);
    }
    if (consumer.primarySlice === "PACKAGE-CATALOG" && consumer.access !== "READ") for (const table of selected) if (/canonical_package_/.test(table)) writeTables.add(table);
    const relevantColumn = (qualified: string, forWrite: boolean): boolean => {
      const [tableName, columnName] = qualified.split(".") as [string, string];
      const table = tableMap.get(tableName);
      if (table?.primaryKey.includes(columnName) || table?.foreignKeys.some(({ column }) => column === columnName)) return true;
      if (forWrite && (/^(?:INSERT|UPDATE)_(?:USER|TIME)$/.test(columnName) || operationTable(tableName))) return true;
      if (/name|description|grade|active|quantity|balance|amount|price|charm|enhancement|experience|status|selected|equipped|bound|slot|handler_key|options_json|target_kind|probability|max_open|selection_mode|reward_order/.test(columnName)) return true;
      return false;
    };
    const readColumns = availableColumns.filter((qualified) => readTables.has(qualified.split(".")[0]!) && relevantColumn(qualified, false));
    const writeColumns = availableColumns.filter((qualified) => writeTables.has(qualified.split(".")[0]!) && relevantColumn(qualified, true));
    const directional = closeDirectionalUsage([...readTables], [...writeTables], readColumns, writeColumns);
    return {
      tables: unique([...directional.readTables, ...directional.writeTables]),
      columns: unique([...directional.readColumns, ...directional.writeColumns]),
      readTables: directional.readTables, writeTables: directional.writeTables,
      readColumns: directional.readColumns, writeColumns: directional.writeColumns
    };
  };
  const consumers = [...legacyConsumers(repoRoot, tableNames), ...legacyDynamicConsumers(repoRoot), ...legacyAutomaticConsumers(repoRoot), ...runtimeConsumers(repoRoot, tableNames), ...httpRouteConsumers(repoRoot, tableNames)]
    .map(normalizeConsumerSemantics)
    .map((consumer) => ({
      ...consumer,
      p1Bridges: unique([...consumer.p1Bridges, ...consumer.dependentSlices.flatMap((slice) => p1For(slice, consumer.access))])
    }))
    .map((consumer) => {
      if (consumer.targetUsageMode === "ADDITIVE_PLAN" || consumer.targetUsageMode === "PORT_ONLY") {
        const usage = plannedUsage(consumer);
        const infrastructure = consumer.access === "READ" ? [] : targetSelectors[consumer.targetSelectorId]?.infrastructureTables ?? [];
        const contract = consumerInterfaceContract(consumer, usage.writeTables);
        return {
          ...consumer,
          ...contract,
          p1Bridges: unique([
            ...consumer.p1Bridges,
            "P1-MISSING-PORTS",
            ...(usage.tables.includes("canonical_players") ? ["P1-IDENTITY-CROSSWALK"] : []),
            ...(consumer.kind !== "SQL_REPOSITORY" ? ["P1-ENVIRONMENT-PARTITION"] : []),
            ...(consumer.kind !== "SQL_REPOSITORY" && consumer.access !== "READ" ? ["P1-SINGLE-WRITER"] : [])
          ]),
          usedTargetTables: usage.tables,
          usedTargetColumns: usage.columns,
          readTargetTables: usage.readTables,
          writeTargetTables: usage.writeTables,
          readTargetColumns: usage.readColumns,
          writeTargetColumns: usage.writeColumns,
          transactionalPortDependencies: unique(infrastructure)
        };
      }
      const text = readFileSync(resolve(repoRoot, consumer.file), "utf8");
      const methodName = consumer.symbol.split(".").at(-1)!;
      const method = classMethodSpans(text).find(({ name }) => name === methodName);
      const sqlEvidence = method === undefined ? text.slice(consumer.sourceSpan.start, consumer.sourceSpan.end) : expandClassMethodClosure(text, method).text;
      const readTables = new Set<string>();
      const writeTables = new Set<string>();
      const canonicalTitleRepository = consumer.file.endsWith("/title/maria-canonical-title-repository.ts");
      if (canonicalTitleRepository) {
        const definitionTable = consumer.sqlTables.find((tableName) => /_title_definitions$/.test(tableName));
        const ownershipTable = consumer.sqlTables.find((tableName) => /owned_.*_title_instances$/.test(tableName));
        const selectionTable = consumer.sqlTables.find((tableName) => /_title_selections$/.test(tableName));
        if (methodName === "registerDefinition" || methodName === "updateDefinition") {
          if (definitionTable) { readTables.add(definitionTable); writeTables.add(definitionTable); }
        } else if (methodName === "grant") {
          if (ownershipTable) { readTables.add(ownershipTable); writeTables.add(ownershipTable); }
        } else if (methodName === "select") {
          if (ownershipTable) readTables.add(ownershipTable);
          if (selectionTable) writeTables.add(selectionTable);
        } else if (methodName === "release") {
          if (ownershipTable) { readTables.add(ownershipTable); writeTables.add(ownershipTable); }
          if (selectionTable) writeTables.add(selectionTable);
        } else if (methodName === "listOwned") {
          for (const tableName of consumer.sqlTables) readTables.add(tableName);
        }
      }
      for (const tableName of consumer.sqlTables) {
        if (new RegExp(`\\b(?:FROM|JOIN)\\s+\`?${tableName}\`?\\b`, "i").test(sqlEvidence)) readTables.add(tableName);
        if (new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+\`?${tableName}\`?\\b`, "i").test(sqlEvidence)) writeTables.add(tableName);
      }
      const dynamicRead = !canonicalTitleRepository && /\b(?:FROM|JOIN)\s+\$\{[A-Za-z0-9_.]+\}/i.test(sqlEvidence);
      const dynamicWrite = !canonicalTitleRepository && /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+\$\{[A-Za-z0-9_.]+\}/i.test(sqlEvidence);
      for (const tableName of consumer.sqlTables) {
        if (readTables.has(tableName) || writeTables.has(tableName)) continue;
        const dynamicTarget = sqlEvidence.includes(tableName);
        if (dynamicTarget && dynamicRead) readTables.add(tableName);
        if (dynamicTarget && dynamicWrite) writeTables.add(tableName);
      }
      for (const tableName of consumer.sqlTables) {
        if (readTables.has(tableName) || writeTables.has(tableName)) continue;
        if (consumer.access !== "WRITE") readTables.add(tableName);
        if (consumer.access !== "READ") writeTables.add(tableName);
      }
      if (consumer.access !== "WRITE" && readTables.size === 0) for (const table of consumer.sqlTables) readTables.add(table);
      if (consumer.access !== "READ" && writeTables.size === 0) for (const table of consumer.sqlTables) writeTables.add(table);
      const readColumns = new Set<string>();
      const writeColumns = new Set<string>();
      for (const tableName of new Set([...readTables, ...writeTables])) {
        const table = tableMap.get(tableName);
        if (!table) continue;
        const selected = readTables.has(tableName) ? readColumns : writeColumns;
        for (const column of table.columns) if (new RegExp(`\\b${column.name}\\b`).test(sqlEvidence)) selected.add(`${tableName}.${column.name}`);
        for (const column of table.primaryKey) selected.add(`${tableName}.${column}`);
        for (const foreignKey of table.foreignKeys) {
          selected.add(`${tableName}.${foreignKey.column}`);
          selected.add(`${foreignKey.referencesTable}.${foreignKey.referencesColumn}`);
        }
      }
      const directional = closeDirectionalUsage([...readTables], [...writeTables], [...readColumns], [...writeColumns]);
      const contract = consumerInterfaceContract(consumer, directional.writeTables);
      return {
        ...consumer,
        ...contract,
        p1Bridges: unique([
          ...consumer.p1Bridges,
          ...(consumer.access !== "READ" && contract.operationReceiptTables.length === 0 ? ["P1-MISSING-PORTS"] : []),
          ...(isIdentityMutationConsumer(consumer) ? ["P1-IDENTITY-CROSSWALK"] : [])
        ]),
        usedTargetTables: unique([...directional.readTables, ...directional.writeTables]),
        usedTargetColumns: unique([...directional.readColumns, ...directional.writeColumns]),
        readTargetTables: directional.readTables,
        writeTargetTables: directional.writeTables,
        readTargetColumns: directional.readColumns,
        writeTargetColumns: directional.writeColumns,
        transactionalPortDependencies: consumer.access === "READ" ? [] : unique(targetSelectors[consumer.targetSelectorId]?.infrastructureTables ?? [])
      };
    })
    .sort((left, right) => left.consumerId.localeCompare(right.consumerId));
  const ids = consumers.map(({ consumerId }) => consumerId);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate consumerId");
  const registryText = readFileSync(resolve(repoRoot, "COMMAND_REGISTRY.md"), "utf8");
  const registryObjectCommands = [...registryText.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`(main\.js|Info\.js)`\s*\|\s*\[ \]\s*\|\s*\[ \]\s*\|/gm)]
    .map((match) => ({ command: match[1]!.split(/\s|\[/)[0]!.replace(/[,，]+$/, ""), file: match[2]! }))
    .filter(({ command }) => OBJECT_MARKER.test(command));
  const registrySourceMismatches = registryObjectCommands.filter(({ command, file }) => {
    if (!readFileSync(resolve(repoRoot, file), "utf8").includes(command)) return true;
    const commandName = command.replace(/^\//, "");
    return !consumers.some((consumer) => consumer.kind === "LEGACY_COMMAND" && consumer.file === file
      && (consumer.triggerOrPredicate.includes(command)
        || consumer.triggerOrPredicate.includes(`(${commandName}|`)
        || consumer.triggerOrPredicate.includes(`|${commandName})`)
        || consumer.triggerOrPredicate.includes(`|${commandName}|`)));
  }).map(({ command, file }) => `${file}:${command}`).sort();
  const logicalKeys = consumers.map((entry) => `${entry.file}|${entry.symbol}|${entry.triggerOrPredicate}`);
  const logicalDuplicateCount = logicalKeys.length - new Set(logicalKeys).size;
  const sliceIds = new Set(Object.keys(SLICE_P1));
  const positiveLegacyCandidateKeys = legacyCandidateKeys(repoRoot);
  const classifiedLegacyKeys = new Set(consumers.filter(({ kind }) => kind === "LEGACY_COMMAND").map(({ file, sourceSpan, triggerOrPredicate }) =>
    /^\/로켓\d+,/.test(triggerOrPredicate) ? `${file}|${sourceSpan.start}|${triggerOrPredicate}` : `${file}|${sourceSpan.start}`));
  const legacyOrphanKeys = [...positiveLegacyCandidateKeys].filter((key) => !classifiedLegacyKeys.has(key)).sort();
  const legacyExtraKeys = [...classifiedLegacyKeys].filter((key) => !positiveLegacyCandidateKeys.has(key)).sort();
  const appCandidateAudit = appSourceCandidateKeys(repoRoot, tableNames);
  const appCandidates = appCandidateAudit.keys;
  const classifiedAppCandidates = new Set(consumers.filter(({ file, kind }) => kind === "HTTP_WEB_ROUTE"
    || (file.endsWith("app.ts") && kind !== "SQL_REPOSITORY" && kind !== "ADMIN_COMMAND" && kind !== "LEGACY_COMMAND"))
    .map(({ kind, triggerOrPredicate, sourceSpan }) => kind === "RUNTIME_DISPATCH" && !triggerOrPredicate.includes("handlerKey=") ? `${kind}|${sourceSpan.start}` : `${kind}|${triggerOrPredicate}`));
  const appOrphanKeys = [...appCandidates].filter((key) => !classifiedAppCandidates.has(key)).sort();
  const appExtraKeys = [...classifiedAppCandidates].filter((key) => !appCandidates.has(key)).sort();
  const adminCandidates = adminSourceCandidateKeys(repoRoot);
  const classifiedAdminCandidates = new Set(consumers.filter(({ kind }) => kind === "ADMIN_COMMAND").map(({ triggerOrPredicate }) => triggerOrPredicate));
  const adminOrphanKeys = [...adminCandidates].filter((key) => !classifiedAdminCandidates.has(key)).sort();
  const adminExtraKeys = [...classifiedAdminCandidates].filter((key) => !adminCandidates.has(key)).sort();
  const operationReceiptTables = unique(consumers.flatMap(({ operationReceiptTables }) => operationReceiptTables));
  const missingOperationReceiptTables = operationReceiptTables.filter((table) => !tableNames.includes(table));
  const kinds: ConsumerKind[] = ["LEGACY_COMMAND", "AUTOMATIC_CALLBACK", "RUNTIME_DISPATCH", "ADMIN_COMMAND", "HTTP_WEB_ROUTE", "APP_WIRING", "SQL_REPOSITORY"];
  const counts = Object.fromEntries(kinds.map((kind) => [kind, consumers.filter((entry) => entry.kind === kind).length])) as Record<ConsumerKind, number>;
  return {
    format: "hoibot-object-db-consumer-manifest-v1",
    baseCommit,
    consumers,
    counts,
    consumerSetSha256: sha(JSON.stringify(consumers)),
    targetSelectors,
    audit: {
      orphanCount: legacyOrphanKeys.length + appOrphanKeys.length + adminOrphanKeys.length + consumers.filter((entry) => !sliceIds.has(entry.primarySlice)).length,
      extraCount: legacyExtraKeys.length + appExtraKeys.length + adminExtraKeys.length,
      duplicatePrimaryCount: logicalDuplicateCount,
      undeclaredSelectorCount: consumers.filter((entry) => targetSelectors[entry.targetSelectorId] === undefined).length,
      excludedNegativeGuardCount: excludedNegativeGuardCount(repoRoot),
      activeRegistryObjectRows: registryObjectCommands.length,
      registrySourceMismatchCount: registrySourceMismatches.length,
      registrySourceMismatches,
      appSourceCandidateCount: appCandidates.size,
      appRawGuardCount: appCandidateAudit.rawGuardCount,
      adminSourceCandidateCount: adminCandidates.size,
      adminOrphanKeys,
      adminExtraKeys,
      operationReceiptTableCount: operationReceiptTables.length,
      missingOperationReceiptTableCount: missingOperationReceiptTables.length,
      missingOperationReceiptTables,
      legacyOrphanKeys,
      legacyExtraKeys,
      appOrphanKeys,
      appExtraKeys
    }
  };
}

export function deriveTargetSelectors(repoRoot: string): Record<string, { domains: string[]; tables: string[]; columns: string[]; infrastructureTables: string[] }> {
  const fieldMap = JSON.parse(readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-domain-import-field-map.v1.json"), "utf8")) as {
    mappings: Array<{ domain: string; targetTables: string[]; fields: Array<{ targetColumns: string[] }> }>;
  };
  const standard = JSON.parse(readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-data-model-standard.v1.json"), "utf8")) as {
    tables: Array<{ table: string; columns: Array<{ name: string }>; foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }> }>;
  };
  const standardTables = new Map(standard.tables.map((table) => [table.table, table]));
  const mappings = new Map(fieldMap.mappings.map((entry) => [entry.domain, entry]));
  return Object.fromEntries(Object.entries(SLICE_DOMAINS).map(([slice, domains]) => {
    const entries = domains.map((domain) => mappings.get(domain)).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    const tables = new Set(entries.flatMap((entry) => entry.targetTables));
    const columns = new Set(entries.flatMap((entry) => entry.fields.flatMap((field) => field.targetColumns)));
    for (const tableName of SLICE_OPERATION_TABLES[slice] ?? []) {
      tables.add(tableName);
      for (const column of standardTables.get(tableName)?.columns ?? []) columns.add(`${tableName}.${column.name}`);
    }
    for (const tableName of [...tables]) for (const foreignKey of standardTables.get(tableName)?.foreignKeys ?? []) {
      if (!columns.has(`${tableName}.${foreignKey.column}`)) continue;
      tables.add(foreignKey.referencesTable);
      columns.add(`${foreignKey.referencesTable}.${foreignKey.referencesColumn}`);
    }
    return [`selector:${slice}`, {
      domains,
      tables: [...tables].sort(),
      columns: [...columns].sort(),
      infrastructureTables: MUTATION_INFRASTRUCTURE_TABLES.slice()
    }];
  }));
}
