import { randomUUID, timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import Fastify, { LogController, type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import { createScopedDatabaseClient, hasDatabaseTransactionCapabilities, type DatabaseClient } from "./database.js";
import type { VerifiedEnvironmentContext } from "./runtime/environment-context.js";
import { RecentEventStore } from "./recent-events.js";
import { ApplicationError } from "./shared/application-error.js";
import { normalizeIrisEvent, type IrisPayload, type NormalizedIrisEvent } from "./integration/iris-normalizer.js";
import { ProcessIrisEventService, recordOutboxDelivery, type ChannelNameObservation, type EventProcessingResult, type PendingReply } from "./integration/event-processing-service.js";
import { withMariaTransactionRetry } from "./shared/maria-database-error-policy.js";
import {
  formatIrisKakaoDiagnostic,
  IrisKakaoDatabaseInspector,
  splitIrisKakaoDiagnostic,
  type IrisKakaoDatabaseSnapshot
} from "./integration/iris-kakao-database-inspector.js";
import {
  formatIrisEventMonitorMessage,
  formatModerationIncidentReadMessage,
  shouldMonitorIrisEvent,
  type IrisOriginalMessageResult
} from "./integration/iris-event-monitor.js";
import {
  IrisChannelPolicyInspector,
  type IrisChannelAccessDecision
} from "./integration/iris-channel-policy.js";
import { AdminAuthService } from "./admin/auth-service.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { CurrencyService } from "./currency/currency-service.js";
import { registerAdminWebShellRoutes } from "./admin/web-shell.js";
import { registerSiteSignupWebRoutes } from "./signup/site-signup-web.js";
import { registerAdminDiamondShopCatalogWebRoutes } from "./admin/diamond-shop-catalog-web-routes.js";
import { registerAdminPackageCatalogWebRoutes } from "./admin/package-catalog-web-routes.js";
import { registerAdminObjectCatalogWebRoutes } from "./admin/object-catalog-web-routes.js";
import { registerAdminBalanceWebRoutes } from "./admin/admin-balance-web-routes.js";
import { registerAdminConfigurationCatalogWebRoutes } from "./admin/configuration-catalog-web-routes.js";
import { registerAdminPetSkillCatalogWebRoutes } from "./admin/pet-skill-catalog-web-routes.js";
import { AdminBalanceReadModelProvider } from "./admin/admin-balance-read-model.js";
import { AdminBalanceMutationProvider } from "./admin/admin-balance-mutation-provider.js";
import { MariaAdminBalanceMutationRepository } from "./admin/maria-admin-balance-mutation-repository.js";
import { DiamondShopCatalogWebAdapterProvider } from "./shop/diamond-shop-catalog-web-adapter-provider.js";
import { MariaPackageCatalogAdminRepository, MariaPackageCatalogWebAdapterRepository } from "./package/mariadb-package-catalog-admin.js";
import { PackageCatalogWebAdapter } from "./package/package-catalog-web-adapter.js";
import { ObjectCatalogService } from "./catalog/object-catalog.js";
import { MariaObjectCatalogRepository } from "./catalog/maria-object-catalog-repository.js";
import { ObjectCatalogWebAdapterProvider } from "./catalog/object-catalog-web-adapter-provider.js";
import { ConfigurationCatalogProvider, ConfigurationCatalogRegistry } from "./configuration/configuration-catalog.js";
import { MariaConfigurationCatalogRepository } from "./configuration/maria-configuration-catalog-repository.js";
import { PET_SKILL_CATALOG_CONFIGURATION, PetSkillCatalogCrudProvider } from "./pet/pet-skill-catalog.js";
import { MariaProfileRepository } from "./player/maria-profile-repository.js";
import { ChangePlayerServerService } from "./player/change-player-server-service.js";
import { DailyPrayerIrisCommandService, isDailyPrayerCommand } from "./player/daily-prayer-service.js";
import { AutoExploreFixedConfigService, isAutoExploreFixedConfigCommand } from "./pet/auto-explore-fixed-config-service.js";
import { isPetExploreSettlementCommand } from "./pet/pet-explore-settlement-command-consumer.js";
import { isPetExploreEventControlCommand } from "./pet/pet-explore-event-control-command-service.js";
import { PetExploreAppWiringIngress } from "./pet/pet-explore-app-wiring-ingress.js";
import { PetTitleAppWiringIngress, PetTitleShadowEvaluator, PetTitleShadowReadAuthorityProvider } from "./pet/pet-title-app-wiring-ingress.js";
import { PetTitleCanonicalMutationProvider } from "./pet/pet-title-canonical-mutation-provider.js";
import { PetTitleCanonicalReadProvider } from "./pet/pet-title-canonical-read-provider.js";
import { MariaPlayerContextProvider } from "./account-platform/player-context-provider.js";
import { InventoryBulkSellService, isInventoryBulkSellCommand } from "./inventory/bulk-sell-service.js";
import { InventoryCleanupIrisHandler } from "./inventory/inventory-cleanup-iris-handler.js";
import { DiamondBoxCraftService, isDiamondBoxCraftCommand, normalizeDiamondBoxCraftDispatchMessage } from "./crafting/diamond-box-craft-service.js";
import { FirstSponsorRegistryService, isFirstSponsorCommandCandidate, normalizeFirstSponsorDispatchMessage } from "./admin/first-sponsor-registry-service.js";
import { HappyFoundationCommandService, isHappyFoundationCommand, normalizeHappyFoundationDispatchMessage } from "./foundation/happy-foundation-command-service.js";
import { GetMyProfileService } from "./player/get-my-profile-service.js";
import { isPlayerCumulativeLevelRankReadCommand, PlayerCumulativeLevelRankReadService } from "./player/player-cumulative-level-rank-read-service.js";
import { isPlayerCumulativeLikeRankReadCommand, PlayerCumulativeLikeRankReadService } from "./player/player-cumulative-like-rank-read-service.js";
import { isPlayerDiamondRankReadCommand, PlayerDiamondRankReadService } from "./player/player-diamond-rank-read-service.js";
import { isPlayerLevelResetCommand, PlayerLevelResetService } from "./player/player-level-reset-service.js";
import { isPlayerLevelRankReadCommand, PlayerLevelRankReadService } from "./player/player-level-rank-read-service.js";
import { isPlayerVerificationRankReadCommand, PlayerVerificationRankReadService } from "./player/player-verification-rank-read-service.js";
import { isPlayerRankReadCommandCandidate } from "./player/privileged-rank-read-command-dispatch.js";
import { AdminPlayerInfoReadService, isAdminPlayerInfoReadCandidate, normalizeAdminPlayerInfoReadDispatchMessage } from "./player/admin-player-info-read-service.js";
import { DeveloperNoteReadService, isDeveloperNoteReadCommand } from "./admin/developer-note-read-service.js";
import { isSocialBoardReadCommand, SocialBoardReadService } from "./social/social-board-read-service.js";
import { FreeMarketReadService, isFreeMarketReadCommand } from "./market/free-market-read-service.js";
import { FreeMarketInitService, isFreeMarketInitCommand } from "./market/free-market-init-service.js";
import { handleFreeMarketMutation, isFreeMarketLifecycleCandidate, isFreeMarketMutationDispatch, normalizeFreeMarketLifecycleDispatchMessage } from "./market/free-market-buy-service.js";
import { CarrotBoardReadService, isCarrotBoardReadCommand } from "./market/carrot-board-read-service.js";
import { CarrotBoardDeleteService, isCarrotBoardDeleteCommand } from "./market/carrot-board-delete-service.js";
import { CarrotBoardCompleteService, isCarrotBoardCompleteCommand } from "./market/carrot-board-complete-service.js";
import { CarrotBoardAddService, isCarrotBoardAddCandidate } from "./market/carrot-board-add-service.js";
import { CarrotRankReadService, isCarrotRankReadCommand } from "./market/carrot-rank-read-service.js";
import { CarrotTemperatureRankReadService, isCarrotTemperatureRankReadCommand } from "./market/carrot-temperature-rank-read-service.js";
import { CarrotBanListReadService, isCarrotBanListReadCommand } from "./market/carrot-ban-list-read-service.js";
import { CarrotBanListAddService, isCarrotBanListAddCommand, normalizeCarrotBanListAddDispatchMessage } from "./market/carrot-ban-list-add-service.js";
import { CarrotBanListRemoveService, isCarrotBanListRemoveCommand, normalizeCarrotBanListRemoveDispatchMessage } from "./market/carrot-ban-list-remove-service.js";
import { isPlayerOverallRankReadCommand, PlayerOverallRankReadService } from "./player/player-overall-rank-read-service.js";
import { isPlayerChatRankReadCommand, PlayerChatRankReadService } from "./player/player-chat-rank-read-service.js";
import { isPlayerTitleSelectCandidate, normalizePlayerTitleSelectDispatchMessage, PlayerTitleSelectService } from "./player/player-title-select-service.js";
import { isPlayerTitleInfoReadCandidate, isPlayerTitleListReadCandidate, normalizePlayerTitleInfoReadDispatchMessage, normalizePlayerTitleListReadDispatchMessage, PlayerTitleReadService } from "./player/player-title-read-service.js";
import { isPlayerTitleGiftCandidate, normalizePlayerTitleGiftDispatchMessage, PlayerTitleGiftService } from "./player/player-title-gift-service.js";
import { isTitleGiftTicketGrantCandidate, normalizeTitleGiftTicketGrantDispatchMessage, TitleGiftTicketGrantService } from "./admin/title-gift-ticket-grant-service.js";
import { formatLegacyMyProfile } from "./player/legacy-profile-formatter.js";
import { AdminDirectoryService } from "./admin/directory-service.js";
import { AdminManagementService } from "./admin/management-service.js";
import { ManagedBackupCommandService } from "./admin/managed-backup-command-service.js";
import { DataBackupService } from "./admin/data-backup-service.js";
import { DataRestoreService } from "./admin/data-restore-service.js";
import { IrisAdminCommandService, isPointEditCommandCandidate } from "./admin/iris-admin-command-service.js";
import { PetTitleAdminAppWiringIngress } from "./admin/pet-title-admin-app-wiring-ingress.js";
import { PetDataCompareAppWiringIngress } from "./admin/pet-data-compare-app-wiring-ingress.js";
import { isPetDataCompareCommand } from "./admin/pet-data-compare-service.js";
import { AdminDiamondEditService, isAdminDiamondEditCommand, normalizeAdminDiamondEditDispatchMessage } from "./admin/admin-diamond-edit-service.js";

import { AdminAccountSuspensionService, isAdminAccountSuspensionCommand, normalizeAdminAccountSuspensionDispatchMessage } from "./admin/admin-account-suspension-service.js";
import { AdminDiamondResetAllService, isAdminDiamondResetAllCommand, normalizeAdminDiamondResetAllDispatchMessage } from "./admin/admin-diamond-reset-all-service.js";
import { createTierCommandService, isTierCommandCandidate, isTierCommandDispatch, isTierCommandHandler } from "./player/tier-command-dispatch.js";
import { AdminPackageDeleteService, isAdminPackageDeleteCommand, normalizeAdminPackageDeleteDispatchMessage } from "./admin/admin-package-delete-service.js";
import { dispatchAdminGlobalGiftCommand, isAdminGlobalGiftCommand, normalizeAdminGlobalGiftDispatchMessage } from "./admin/admin-global-gift-service.js";
import { MiniPetRankRewardPayoutService, isMiniPetRankRewardPayoutCommand, normalizeMiniPetRankRewardPayoutDispatchMessage } from "./mini-pet/mini-pet-rank-reward-payout-service.js";
import { TierRewardPayoutService, isTierRewardPayoutCommand, normalizeTierRewardPayoutDispatchMessage } from "./player/tier-reward-payout-service.js";
import { MiniPetBindingReleaseService, isMiniPetBindingReleaseCommand, normalizeMiniPetBindingReleaseDispatchMessage } from "./mini-pet/mini-pet-binding-release-service.js";
import { isOperationNoticeCommandCandidate, normalizeOperationNoticeDispatchMessage, OperationNoticeService } from "./admin/operation-notice-service.js";
import { SignupService } from "./signup/signup-service.js";
import { isSignupCommand } from "./signup/signup-policy.js";
import { buildSiteSignupEntryMessage, isSiteSignupEntryCommand } from "./signup/site-signup-entry.js";
import {
  AccountPlatformIrisContextProvider,
  type AccountPlatformKakaoEventContext
} from "./account-platform/account-platform-iris-context-provider.js";
import { isAccountSwitchCommandCandidate } from "./account-platform/account-switch-command-service.js";
import {
  CommandDispatcher,
  MariaCommandDispatchRepository,
  MariaCommandRouteReader,
  parseCanaryUserIds
} from "./dispatch/command-dispatcher.js";
import { MariaAppWiringOperationProvider } from "./dispatch/app-wiring-operation-provider.js";
import { isPetCreationCommandCandidate, PetCreationService } from "./pet/pet-creation-service.js";
import { isPetRenameCommandCandidate, PetRenameService } from "./pet/pet-rename-service.js";
import { isPetRenameTicketCraftCommand, PetRenameTicketCraftService } from "./pet/pet-rename-ticket-craft-service.js";
import { CastleBattleResetCraftService, isCastleBattleResetCraftCommand } from "./castle/castle-battle-reset-craft-service.js";
import { isCastleBattleExecuteCommand } from "./castle/castle-battle-execute-service.js";
import { CastleBattleExecuteIrisHandler } from "./castle/castle-battle-execute-iris-handler.js";
import { CastleBattleRankingService, isCastleBattleRankingCommand } from "./castle/castle-battle-ranking-service.js";
import { MariaCastleBattleRankingRepository } from "./castle/maria-castle-battle-ranking-repository.js";
import { CastleBattleSelfRecordReadService, isCastleBattleSelfRecordCommand } from "./castle/castle-battle-self-record-read-service.js";
import { CastleKingdomStatusReadService, isCastleKingdomStatusReadCommand } from "./castle/castle-kingdom-status-read-service.js";
import { CastleCharmRankingReadService, isCastleCharmRankingReadCommand } from "./castle/castle-charm-ranking-read-service.js";
import { CastleStateResetService, isCastleStateResetCommand } from "./castle/castle-state-reset-service.js";
import { MiniPetBagThresholdCleanService, isMiniPetBagThresholdCleanCommand } from "./mini-pet/mini-pet-bag-threshold-clean-service.js";
import { MiniPetGradeCleanupService, isMiniPetGradeCleanupCommand } from "./mini-pet/mini-pet-grade-cleanup-service.js";
import { MiniPetAdminOwnedDeleteService, isMiniPetAdminOwnedDeleteCommand } from "./mini-pet/mini-pet-admin-owned-delete-service.js";
import { MiniPetEquippedCustomizeService, isMiniPetEquippedCustomizeCommand } from "./mini-pet/mini-pet-equipped-customize-service.js";
import { MiniPetEquipService, isMiniPetEquipCommandCandidate, normalizeMiniPetEquipDispatchMessage } from "./mini-pet/mini-pet-equip-service.js";
import { MiniPetBulkCleanupService, isMiniPetBulkCleanupCommand, normalizeMiniPetBulkCleanupDispatchMessage } from "./mini-pet/mini-pet-bulk-cleanup-service.js";
import { MiniPetBattleResetTicketCraftService, isMiniPetBattleResetTicketCraftCommand } from "./mini-pet/mini-pet-battle-reset-ticket-craft-service.js";
import { MiniPetBattleRecordResetService, isMiniPetBattleRecordResetCommand } from "./mini-pet/mini-pet-battle-record-reset-service.js";
import { MiniPetUpgradeService, isMiniPetUpgradeCommand } from "./mini-pet/mini-pet-upgrade-service.js";
import { isRaidCharmRankingReadCommand, RaidCharmRankingReadService } from "./raid/raid-charm-ranking-read-service.js";
import { isMiniPetBattleCommand } from "./mini-pet/mini-pet-battle-execute-service.js";
import { MiniPetBattleExecuteIrisHandler } from "./mini-pet/mini-pet-battle-execute-iris-handler.js";
import { isMiniPetBattleLeaderboardCommand, MiniPetBattleLeaderboardReadService } from "./mini-pet/mini-pet-battle-leaderboard-read-service.js";
import { isAutoDailyQuestCommand } from "./quest/auto-daily-quest-orchestration-service.js";
import { AutoDailyQuestOrchestrationIrisHandler } from "./quest/auto-daily-quest-orchestration-iris-handler.js";
import { isSpiritRankCommand, SpiritRankService } from "./pet/spirit-rank-service.js";
import { isSpiritInfoCommand, SpiritInfoService } from "./pet/spirit-info-service.js";
import { isPendantBagCommandCandidate, PendantBagService } from "./pet/pendant-bag-service.js";
import { isPendantBagCleanupCommandCandidate, normalizePendantBagCleanupDispatchMessage, PendantBagCleanupService } from "./pet/pendant-bag-cleanup-service.js";
import { isPendantEnhanceCommandCandidate, normalizePendantEnhanceDispatchMessage, PendantEnhanceService } from "./pet/pendant-enhance-service.js";
import { MariaPendantPolicyCatalogRepository } from "./pet/maria-pendant-policy-catalog-repository.js";
import { PendantPolicyCatalogReadProvider } from "./pet/pendant-policy-catalog.js";
import { isPendantEnhanceCorrectionCommandCandidate, normalizePendantEnhanceCorrectionDispatchMessage, PendantEnhanceCorrectionService } from "./pet/pendant-enhance-correction-service.js";
import { isPendantDurabilityCorrectionCommandCandidate, normalizePendantDurabilityCorrectionDispatchMessage, PendantDurabilityCorrectionService } from "./pet/pendant-durability-correction-service.js";
import { isPendantMarketRegisterCommandCandidate, normalizePendantMarketRegisterDispatchMessage, PendantMarketRegisterService } from "./market/pendant-market-register-service.js";
import { isPetSkillMarketListingCandidate, normalizePetSkillMarketListingDispatchMessage, PetSkillMarketListingService } from "./market/pet-skill-market-listing-service.js";
import { HomeFurnitureMarketListingService, isHomeFurnitureMarketListingCandidate, normalizeHomeFurnitureMarketListingDispatchMessage } from "./market/home-furniture-market-listing-service.js";
import { isPendantMarketInfoCommandCandidate, normalizePendantMarketInfoDispatchMessage, PendantMarketInfoService } from "./market/pendant-market-info-service.js";
import { isPendantCarrotTradeCommandCandidate, normalizePendantCarrotTradeDispatchMessage, PendantCarrotTradeService } from "./market/pendant-carrot-trade-service.js";
import { isMiniPetCarrotTradeCandidate, MiniPetCarrotTradeService, normalizeMiniPetCarrotTradeDispatchMessage } from "./mini-pet/mini-pet-carrot-trade-service.js";
import { isMiniPetEliteCombineCandidate, MiniPetEliteCombineService, normalizeMiniPetEliteCombineDispatchMessage } from "./mini-pet/mini-pet-elite-combine-service.js";
import { isPendantRestoreCommandCandidate, normalizePendantRestoreDispatchMessage, PendantRestoreService } from "./pet/pendant-restore-service.js";
import { isPendantDeleteCommandCandidate,normalizePendantDeleteDispatchMessage,PendantDeleteService } from "./pet/pendant-delete-service.js";
import { isPendantRankCommand,PendantRankService } from "./pet/pendant-rank-service.js";
import { isPendantDrawOpenCommandCandidate,normalizePendantDrawOpenDispatchMessage,PendantDrawOpenService } from "./pet/pendant-draw-open-service.js";
import { isPendantEquipCommandCandidate,normalizePendantEquipDispatchMessage,PendantEquipService } from "./pet/pendant-equip-service.js";
import { isPendantEquipResetCommandCandidate,normalizePendantEquipResetDispatchMessage,PendantEquipResetService } from "./pet/pendant-equip-reset-service.js";
import { isPendantInfoCommandCandidate,normalizePendantInfoDispatchMessage,PendantInfoService } from "./pet/pendant-info-service.js";
import { isPendantGrantCommandCandidate,normalizePendantGrantDispatchMessage,PendantGrantService } from "./pet/pendant-grant-service.js";
import { isPendantSellCommandCandidate,normalizePendantSellDispatchMessage,PendantSellService } from "./pet/pendant-sell-service.js";
import { isPendantProbabilityCommand,PendantProbabilityService } from "./pet/pendant-probability-service.js";
import { isSpiritNameCommandCandidate, SpiritNameService } from "./pet/spirit-name-service.js";
import { isSpiritNameCombineCommand, SpiritNameCombineService } from "./pet/spirit-name-combine-service.js";
import { isRaidStrikeSealCraftCommand, RaidStrikeSealCraftService } from "./raid/raid-strike-seal-craft-service.js";
import { isPetFoodBoxCraftCommand, PetFoodBoxCraftService } from "./crafting/pet-food-box-craft-service.js";
import { MariaPetInfoRepository } from "./pet/maria-pet-info-repository.js";
import { GetPetInfoService, isPetInfoCommand } from "./pet/pet-info-service.js";
import { isPetStatusCommand, PetStatusService } from "./pet/pet-status-service.js";
import { isPetIntimacyRankCommand, PetIntimacyRankReadService } from "./pet/pet-intimacy-rank-read-service.js";
import { isPetTitleCommandCandidate, normalizePetTitleDispatchMessage, PetTitleLifecycleService } from "./pet/pet-title-lifecycle-service.js";
import { PetTitleDefinitionLinkProvider } from "./pet/pet-title-definition-link.js";
import { MariaPetTitleDefinitionLinkRepository } from "./pet/maria-pet-title-definition-link-repository.js";
import { isPetRebirthCommandCandidate, normalizePetRebirthDispatchMessage, PetRebirthService } from "./pet/pet-rebirth-service.js";
import { isPetDuelEmoteCommandCandidate, normalizePetDuelEmoteDispatchMessage, PetDuelEmoteService } from "./pet/pet-duel-emote-service.js";
import { isPetSkillReadCommand, PetSkillReadService } from "./pet/pet-skill-read-service.js";
import { isPetSkillProbabilityCommand } from "./pet/pet-skill-probability-service.js";
import { PetSkillProbabilityAtomicService } from "./pet/pet-skill-probability-atomic-service.js";
import { isPetSkillInfoShadowCandidate, normalizePetSkillInfoDispatchMessage, PetSkillInfoShadowService } from "./pet/pet-skill-info-shadow-service.js";
import { isPetSkillBagReadCommand, PetSkillBagReadService } from "./pet/pet-skill-bag-read-service.js";
import { isPetSkillDuplicateReadCommand, PetSkillDuplicateReadService } from "./pet/pet-skill-duplicate-read-service.js";
import { isPetSkillExtinctionCandidate, normalizePetSkillExtinctionDispatchMessage, PetSkillExtinctionService } from "./pet/pet-skill-extinction-service.js";
import { isPetSkillBookCombineCandidate, normalizePetSkillBookCombineDispatchMessage, PetSkillBookCombineService } from "./pet/pet-skill-book-combine-service.js";
import { isPetSkillOpenCandidate, normalizePetSkillOpenDispatchMessage, PetSkillOpenService } from "./pet/pet-skill-open-service.js";
import { isPetSkillBulkGrantCandidate, normalizePetSkillBulkGrantDispatchMessage, PetSkillBulkGrantService } from "./pet/pet-skill-bulk-grant-service.js";
import { isPetSkillEquipCandidate, normalizePetSkillEquipDispatchMessage, PetSkillEquipService } from "./pet/pet-skill-equip-service.js";
import { isPetSkillSaleCandidate, normalizePetSkillSaleDispatchMessage, PetSkillSaleLifecycleService } from "./pet/pet-skill-sale-lifecycle-service.js";
import { HopePremiumDeleteService, isHopePremiumDeleteCandidate, normalizeHopePremiumDeleteDispatchMessage } from "./pet/hope-premium-delete-service.js";
import { HomeFurnitureBagLifecycleService, isHomeFurnitureBagCandidate, normalizeHomeFurnitureBagDispatchMessage } from "./home/home-furniture-bag-lifecycle-service.js";
import { HomeFurnitureCarrotTransferService, isHomeFurnitureCarrotTransferCandidate, normalizeHomeFurnitureCarrotTransferDispatchMessage } from "./home/home-furniture-carrot-transfer-service.js";
import { HomeFurnitureRankReadService, isHomeFurnitureRankCommand } from "./home/home-furniture-rank-read-service.js";
import { HomeRankingReadService, isHomeRankingReadCommand } from "./home/home-ranking-read-service.js";
import { HomeFurnitureEquipService, isHomeFurnitureEquipCandidate, normalizeHomeFurnitureEquipDispatchMessage } from "./home/home-furniture-equip-service.js";
import { HomeFurnitureFullCleanupService, isHomeFurnitureFullCleanupCommand } from "./home/home-furniture-full-cleanup-service.js";
import { HomeFurnitureInfoReadService, isHomeFurnitureInfoReadCandidate, normalizeHomeFurnitureInfoReadDispatchMessage } from "./home/home-furniture-info-read-service.js";
import { HomeFurnitureRemoveService, isHomeFurnitureRemoveCandidate, normalizeHomeFurnitureRemoveDispatchMessage } from "./home/home-furniture-remove-service.js";
import { HomeFurnitureAddService, isHomeFurnitureAddCandidate, normalizeHomeFurnitureAddDispatchMessage } from "./home/home-furniture-add-service.js";
import { HomeFurnitureStatsReadService, isHomeFurnitureStatsReadCommand } from "./home/home-furniture-stats-read-service.js";
import { HomeFurnitureSellService, isHomeFurnitureSellCandidate, normalizeHomeFurnitureSellDispatchMessage } from "./home/home-furniture-sell-service.js";
import { HomeFurnitureDrawService, isHomeFurnitureDrawCandidate, normalizeHomeFurnitureDrawDispatchMessage } from "./home/home-furniture-draw-service.js";
import { HomeFurnitureCleanService, isHomeFurnitureCleanCandidate, normalizeHomeFurnitureCleanDispatchMessage } from "./home/home-furniture-clean-service.js";
import { HomeFurnitureUnequipService, isHomeFurnitureUnequipCandidate, normalizeHomeFurnitureUnequipDispatchMessage } from "./home/home-furniture-unequip-service.js";
import { SocialOwnHeartService, isSocialOwnHeartCandidate, normalizeSocialOwnHeartDispatchMessage } from "./social/social-own-heart-service.js";
import { isPetSkillCarrotTradeCandidate, normalizePetSkillCarrotTradeDispatchMessage, PetSkillCarrotTradeService } from "./pet/pet-skill-carrot-trade-service.js";
import { GuildJoinService } from "./guild/guild-join-service.js";
import { MariaGuildJoinRepository } from "./guild/maria-guild-join-repository.js";
import { isGuildJoinCommandCandidate } from "./guild/guild-join-policy.js";
import { GuildJoinableListReadService, isGuildJoinableListReadCommand } from "./guild/guild-joinable-list-read-service.js";
import { GuildJoinConditionService } from "./guild/guild-join-condition-service.js";
import { isGuildJoinConditionCommandCandidate } from "./guild/guild-join-condition-policy.js";
import { MariaGuildJoinConditionRepository } from "./guild/maria-guild-join-condition-repository.js";
import { GuildForceExpelService } from "./guild/guild-force-expel-service.js";
import { isGuildForceExpelCommandCandidate } from "./guild/guild-force-expel-policy.js";
import { MariaGuildForceExpelRepository } from "./guild/maria-guild-force-expel-repository.js";
import { GuildRecruitmentToggleService, isGuildRecruitmentToggleCommand } from "./guild/guild-recruitment-toggle-service.js";
import { isRiftForceAdminCommand, RiftForceAdminService } from "./guild/rift-force-admin-service.js";
import { GuildPetSkillStockGrantService, isGuildPetSkillStockGrantCandidate, normalizeGuildPetSkillStockGrantDispatchMessage } from "./guild/guild-pet-skill-stock-grant-service.js";
import { ConstructionEditService } from "./home/construction-edit-service.js";
import { isConstructionEditCommandCandidate } from "./home/construction-edit-policy.js";
import { MariaConstructionEditRepository } from "./home/maria-construction-edit-repository.js";
import { UserAuthService } from "./user-auth/user-auth-service.js";
import { registerUserAuthRoutes } from "./user-auth/routes.js";
import { AccountCleanupService } from "./user-auth/account-cleanup-service.js";
import { ProviderVerificationService } from "./user-auth/provider-verification-service.js";
import { readKakaoVerificationCode } from "./user-auth/policy.js";
import { RequestRateLimiter } from "./user-auth/request-rate-limiter.js";
import {
  ModerationIncidentService,
  readModerationIncidentNumber
} from "./integration/moderation-incident-service.js";
import { MembershipLogService, type MembershipLogSummary } from "./integration/membership-log-service.js";
import { RetainedEventContentService } from "./integration/retained-event-content-service.js";
import { BagAttributeService, isBagAttributeCommandCandidate } from "./inventory/bag-attribute-service.js";
import { MariaBagAttributeRepository } from "./inventory/maria-bag-attribute-repository.js";
import { BagAddService, isBagAddCommandCandidate } from "./inventory/bag-add-service.js";
import { MariaBagAddRepository } from "./inventory/maria-bag-add-repository.js";
import { GetBagService, isBagCommand } from "./inventory/get-bag-service.js";
import { MariaBagRepository } from "./inventory/maria-bag-repository.js";
import { InventorySnapshotService, isInventorySnapshotCommand } from "./inventory/inventory-snapshot-service.js";
import { MariaInventorySnapshotRepository } from "./inventory/maria-inventory-snapshot-repository.js";
import { formatLegacyBag } from "./inventory/legacy-bag-formatter.js";
import {
  isPackageCommandCandidate,
  normalizePackageDispatchMessage,
} from "./package/package-command.js";
import { PackageIrisCommandHandler } from "./package/package-iris-command-handler.js";
import {
  isPackageCatalogAdminCommandCandidate,
  normalizePackageCatalogAdminDispatchMessage,
} from "./package/package-catalog-admin-command.js";
import { PackageCatalogAdminIrisHandler } from "./package/package-catalog-admin-iris-handler.js";
import { isPackageCatalogWizardControl } from "./package/package-catalog-add-wizard.js";
import { PackageCatalogAddWizardIrisHandler } from "./package/package-catalog-add-wizard-iris-handler.js";
import {
  isPointShopCatalogCommandCandidate,
  normalizePointShopCatalogDispatchMessage,
} from "./shop/point-shop-catalog-command.js";
import { PointShopCatalogIrisHandler } from "./shop/point-shop-catalog-iris-handler.js";
import {
  isCommentPinDeleteCommandCandidate,
  normalizeCommentPinDeleteDispatchMessage,
} from "./home/comment-pin-delete-command.js";
import { CommentPinDeleteIrisHandler } from "./home/comment-pin-delete-iris-handler.js";
import { isCommentDeleteCommandCandidate, normalizeCommentDeleteDispatchMessage } from "./home/comment-delete-command.js";
import { CommentDeleteIrisHandler } from "./home/comment-delete-iris-handler.js";
import { isCommentPinCommandCandidate, normalizeCommentPinDispatchMessage } from "./home/comment-pin-command.js";
import { CommentPinIrisHandler } from "./home/comment-pin-iris-handler.js";
import { isLegacyDataCleanupCommand, normalizeLegacyDataCleanupDispatchMessage } from "./admin/legacy-data-cleanup-command.js";
import { LegacyDataCleanupIrisHandler } from "./admin/legacy-data-cleanup-iris-handler.js";
import { isDebugModeCommand, normalizeDebugModeDispatchMessage } from "./admin/debug-mode-command.js";
import { DebugModeIrisHandler } from "./admin/debug-mode-iris-handler.js";
import { isHomeFurnitureEquipSyncCommand, normalizeHomeFurnitureEquipSyncDispatchMessage } from "./home/home-furniture-equip-sync-command.js";
import { HomeFurnitureEquipSyncIrisHandler } from "./home/home-furniture-equip-sync-iris-handler.js";
import { isHomeBaseballPitchCommandCandidate, normalizeHomeBaseballPitchDispatchMessage } from "./home/home-baseball-pitch-command.js";
import { HomeBaseballPitchIrisHandler } from "./home/home-baseball-pitch-iris-handler.js";
import { isLegendaryStoneDrawCommandCandidate, normalizeLegendaryStoneDrawDispatchMessage } from "./shop/legendary-stone-draw-command.js";
import { LegendaryStoneDrawIrisHandler } from "./shop/legendary-stone-draw-iris-handler.js";
import { isPetExploreRecordsResetCommand, normalizePetExploreRecordsResetDispatchMessage } from "./pet/pet-explore-records-reset-command.js";
import { PetExploreRecordsResetIrisHandler } from "./pet/pet-explore-records-reset-iris-handler.js";
import { isContributionPassCommandCandidate, normalizeContributionPassDispatchMessage } from "./pass/contribution-pass-command.js";
import { ContributionPassIrisHandler } from "./pass/contribution-pass-iris-handler.js";
import { isDiamondPassCommandCandidate, normalizeDiamondPassDispatchMessage } from "./pass/diamond-pass-command.js";
import { DiamondPassIrisHandler } from "./pass/diamond-pass-iris-handler.js";
import { isHoiPassCommandCandidate, normalizeHoiPassDispatchMessage } from "./pass/hoi-pass-command.js";
import { HoiPassIrisHandler } from "./pass/hoi-pass-iris-handler.js";
import { isPassSubscriptionRetiredCommandCandidate, normalizePassSubscriptionRetiredDispatchMessage } from "./pass/pass-subscription-retired-command-service.js";
import { PassSubscriptionRetiredIrisHandler } from "./pass/pass-subscription-retired-iris-handler.js";
import { isOneDayPassSubscriptionCommand, normalizeOneDayPassSubscriptionDispatchMessage } from "./pass/one-day-pass-subscription-command.js";
import { OneDayPassSubscriptionIrisHandler } from "./pass/one-day-pass-subscription-iris-handler.js";
import { isOneDayPassCommandCandidate, normalizeOneDayPassDispatchMessage } from "./pass/one-day-pass-command.js";
import { OneDayPassIrisHandler } from "./pass/one-day-pass-iris-handler.js";
import { isDailyCommentCommandCandidate, normalizeDailyCommentDispatchMessage } from "./home/daily-comment-command.js";
import { DailyCommentIrisHandler } from "./home/daily-comment-iris-handler.js";
import { isHomeLikeCommandCandidate, normalizeHomeLikeDispatchMessage } from "./home/home-like-command.js";
import { HomeLikeIrisHandler } from "./home/home-like-iris-handler.js";
import { isLegacyLikeCommandCandidate, normalizeLegacyLikeDispatchMessage } from "./social/legacy-like-command.js";
import { LegacyLikeIrisHandler } from "./social/legacy-like-iris-handler.js";
import { isHomeProfileViewCandidate, normalizeHomeProfileViewDispatchMessage } from "./home/home-profile-view-command.js";
import { HomeProfileViewIrisHandler } from "./home/home-profile-view-iris-handler.js";
import { isHomeActivityAlertReadCommand, normalizeHomeActivityAlertReadDispatchMessage } from "./home/home-activity-alert-read-command.js";
import { HomeActivityAlertReadIrisHandler } from "./home/home-activity-alert-read-iris-handler.js";
import { isHomeFeedMutationCommandCandidate, normalizeHomeFeedMutationDispatchMessage } from "./home/home-feed-mutate-command.js";
import { HomeFeedMutationIrisHandler } from "./home/home-feed-mutate-iris-handler.js";
import { isHomeBadgeInventoryCommand, normalizeHomeBadgeInventoryDispatchMessage } from "./home/home-badge-inventory-command.js";
import { HomeBadgeInventoryIrisHandler } from "./home/home-badge-inventory-iris-handler.js";
import { isHomeBadgeGachaCommandCandidate, normalizeHomeBadgeGachaDispatchMessage } from "./home/home-badge-gacha-command.js";
import { HomeBadgeGachaIrisHandler } from "./home/home-badge-gacha-iris-handler.js";
import { isHomeBadgeCubeCommandCandidate, normalizeHomeBadgeCubeDispatchMessage } from "./home/home-badge-cube-command.js";
import { HomeBadgeCubeIrisHandler } from "./home/home-badge-cube-iris-handler.js";
import { isInventoryWalletRngOpenCommandCandidate, normalizeInventoryWalletRngOpenDispatchMessage } from "./inventory/inventory-wallet-rng-open-command.js";
import { InventoryWalletRngOpenIrisHandler } from "./inventory/inventory-wallet-rng-open-iris-handler.js";
import { isInventoryFortunePouchCommandCandidate, normalizeInventoryFortunePouchDispatchMessage } from "./inventory/inventory-fortune-pouch-command.js";
import { InventoryFortunePouchIrisHandler } from "./inventory/inventory-fortune-pouch-iris-handler.js";
import { isHomeHeartExpressionCommandCandidate, normalizeHomeHeartExpressionDispatchMessage } from "./home/home-heart-expression-command.js";
import { HomeHeartExpressionIrisHandler } from "./home/home-heart-expression-iris-handler.js";
import { isSupportPremiumNoticeCommandCandidate, normalizeSupportPremiumNoticeDispatchMessage } from "./support/support-premium-notice-command.js";
import { SupportPremiumNoticeIrisHandler } from "./support/support-premium-notice-iris-handler.js";
import { isGuildBoardCommandCandidate, normalizeGuildBoardDispatchMessage } from "./guild/guild-board-service.js";
import { GuildBoardIrisHandler } from "./guild/guild-board-iris-handler.js";
import { HomeBadgeEquipIrisHandler } from "./home/home-badge-equip-iris-handler.js";
import { HomeBadgePermanentDeleteIrisHandler } from "./home/home-badge-permanent-delete-iris-handler.js";
import { isHomeBadgePermanentDeleteCommand, normalizeHomeBadgePermanentDeleteDispatchMessage } from "./home/home-badge-permanent-delete-command.js";
import { isHomeBadgeEquipCommand, normalizeHomeBadgeEquipDispatchMessage } from "./home/home-badge-equip-command.js";
import { isHomeCommentFileBootstrapCommand, normalizeHomeCommentFileBootstrapDispatchMessage } from "./home/home-comment-file-bootstrap-command.js";
import { HomeCommentFileBootstrapIrisHandler } from "./home/home-comment-file-bootstrap-iris-handler.js";
import { isHomeVisitResetCommand, normalizeHomeVisitResetDispatchMessage } from "./home/home-visit-reset-command.js";
import { HomeVisitResetIrisHandler } from "./home/home-visit-reset-iris-handler.js";
import { isHomeSocialBadgeMigrationCommand, normalizeHomeSocialBadgeMigrationDispatchMessage } from "./home/home-social-badge-migration-command.js";
import { HomeSocialBadgeMigrationIrisHandler } from "./home/home-social-badge-migration-iris-handler.js";
import { isHomePassReformCleanupCommand, normalizeHomePassReformCleanupDispatchMessage } from "./home/home-pass-reform-cleanup-command.js";
import { HomePassReformCleanupIrisHandler } from "./home/home-pass-reform-cleanup-iris-handler.js";
import { isHomeFeedMigrationCommand, normalizeHomeFeedMigrationDispatchMessage } from "./home/home-feed-migration-command.js";
import { HomeFeedMigrationIrisHandler } from "./home/home-feed-migration-iris-handler.js";
import { isHomeActivityRestoreCommand, normalizeHomeActivityRestoreDispatchMessage } from "./home/home-activity-restore-command.js";
import { HomeActivityRestoreIrisHandler } from "./home/home-activity-restore-iris-handler.js";
import { isHomeActivityFileBootstrapCommand, normalizeHomeActivityFileBootstrapDispatchMessage } from "./home/home-activity-file-bootstrap-command.js";
import { HomeActivityFileBootstrapIrisHandler } from "./home/home-activity-file-bootstrap-iris-handler.js";

interface TokenQuery {
  token?: string;
}

interface IrisTextReply {
  room: string;
  data: string;
}

interface IrisImageReply {
  room: string;
  imageUrl: string;
}

export interface AppDependencies {
  sendIrisTextReply?: (reply: IrisTextReply) => Promise<void>;
  sendIrisImageReply?: (reply: IrisImageReply) => Promise<void>;
  inspectIrisKakaoDatabase?: (event: NormalizedIrisEvent) => Promise<IrisKakaoDatabaseSnapshot>;
  inspectIrisChannel?: (event: NormalizedIrisEvent) => Promise<IrisChannelAccessDecision>;
  retainIrisEventContent?: (payload: IrisPayload, event: NormalizedIrisEvent) => Promise<number>;
  database?: DatabaseClient;
  environmentContext?: VerifiedEnvironmentContext;
  appWiringOperationProvider?: MariaAppWiringOperationProvider;
  petExploreAppWiringIngress?: Pick<PetExploreAppWiringIngress, "handle">;
  petDataCompareAppWiringIngress?: Pick<PetDataCompareAppWiringIngress, "handle">;
  petTitleAppWiringIngress?: Pick<PetTitleAppWiringIngress, "handle">;
  irisAdminCommandService?: Pick<IrisAdminCommandService, "changePlayerPoint">;
  accountPlatformIrisContextProvider?: Pick<AccountPlatformIrisContextProvider, "prepareKakao" | "dispatchAccountSwitch">;
  dailyPrayerRandom?: () => number;
  adminDiagnosticNow?: () => number;
  runAccountCleanupMaintenance?: () => Promise<{
    pending: { processed: number; failed: number };
    deleted: { processed: number; failed: number };
  }>;
  purgeRetainedEventContent?: () => Promise<number>;
}

// KakaoTalk DB 대상 행 조회 결과를 원문 표시 상태로 변환합니다.
function readOriginalMessage(snapshot: IrisKakaoDatabaseSnapshot): IrisOriginalMessageResult {
  const target = snapshot.targetChatLog;
  if (target.error !== undefined) return { status: "failed" };
  if (target.rows.length !== 1 || typeof target.rows[0]?.message !== "string") {
    return { status: "not_found" };
  }
  return { status: "recovered", message: target.rows[0].message };
}

// 로그에 인증 쿼리 문자열이 남지 않도록 경로만 반환합니다.
function getSafePath(url: string): string {
  return new URL(url, "http://localhost").pathname;
}

// 두 공유 토큰을 일정 시간 비교 방식으로 확인합니다.
function tokensMatch(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

// 헤더를 우선하고 Iris 호환용 쿼리 토큰을 보조로 읽습니다.
function readSharedToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  const headerToken = request.headers["x-iris-token"];
  if (typeof headerToken === "string") {
    return headerToken;
  }

  return (request.query as TokenQuery).token ?? "";
}

// 보호된 Iris 및 디버그 API에서 공유 토큰을 검증합니다.
// 가구 변경 명령의 공용 dispatch 후보 판정과 DB 별칭 정규화를 한곳에서 처리합니다.
function isHomeFurnitureMutationCandidate(message: string | undefined): boolean {
  return isHomeFurnitureDrawCandidate(message)
    || isHomeFurnitureUnequipCandidate(message)
    || isHomeFurnitureSellCandidate(message)
    || isHomeFurnitureCleanCandidate(message)
    || isHomeFurnitureAddCandidate(message)
    || isHomeFurnitureRemoveCandidate(message);
}

function normalizeHomeFurnitureMutationDispatchMessage(message: string): string {
  if (isHomeFurnitureDrawCandidate(message)) return normalizeHomeFurnitureDrawDispatchMessage(message);
  if (isHomeFurnitureUnequipCandidate(message)) return normalizeHomeFurnitureUnequipDispatchMessage(message);
  if (isHomeFurnitureSellCandidate(message)) return normalizeHomeFurnitureSellDispatchMessage(message);
  if (isHomeFurnitureCleanCandidate(message)) return normalizeHomeFurnitureCleanDispatchMessage(message);
  if (isHomeFurnitureAddCandidate(message)) return normalizeHomeFurnitureAddDispatchMessage(message);
  if (isHomeFurnitureRemoveCandidate(message)) return normalizeHomeFurnitureRemoveDispatchMessage(message);
  return message;
}

function createTokenGuard(config: AppConfig) {
  return async function tokenGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!tokensMatch(readSharedToken(request), config.irisSharedToken)) {
      await reply.code(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "유효한 Iris 공유 토큰이 필요합니다." },
        requestId: request.id
      });
    }
  };
}

// Iris `/reply` API로 텍스트 답장을 전송합니다.
async function sendIrisTextReply(config: AppConfig, reply: IrisTextReply): Promise<void> {
  const response = await fetch(`${config.irisBaseUrl}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "text", room: reply.room, data: reply.data }),
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    throw new Error(`Iris reply failed with HTTP ${response.status}.`);
  }

  const result = await response.json() as { success?: unknown };
  if (result.success !== true) {
    throw new Error("Iris reply response did not report success.");
  }
}

// JSON 문자열 또는 객체로 전달된 Iris 하위 필드를 안전하게 객체로 변환합니다.
function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

// 허용된 Kakao CDN HTTPS 이미지 주소만 반환합니다.
function readTrustedKakaoImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const trustedHost = hostname === "kakaocdn.net"
      || hostname.endsWith(".kakaocdn.net")
      || hostname === "kakao.com"
      || hostname.endsWith(".kakao.com");

    return url.protocol === "https:" && trustedHost ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

// 단일 이미지 수신 이벤트에서 전달 가능한 이미지 URL을 추출합니다.
function readIncomingSingleImageUrl(
  payload: IrisPayload,
  targetRoomId: string
): string | undefined {
  if (String(payload.json?.type) !== "2") {
    return undefined;
  }

  const sourceRoomId = payload.json?.chat_id;
  if ((typeof sourceRoomId !== "string" && typeof sourceRoomId !== "number")
    || String(sourceRoomId) === targetRoomId) {
    return undefined;
  }

  const attachment = readRecord(payload.json?.attachment);
  return readTrustedKakaoImageUrl(attachment?.url);
}

// 제한된 크기로 원격 이미지를 내려받아 Iris 전송용 base64 문자열로 변환합니다.
async function downloadImageAsBase64(config: AppConfig, imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(config.imageDownloadTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Image download returned a non-image content type.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > config.imageMaxBytes) {
    throw new Error("Image download exceeds the configured size limit.");
  }
  if (response.body === null) {
    throw new Error("Image download returned an empty body.");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;
      if (totalBytes > config.imageMaxBytes) {
        await reader.cancel();
        throw new Error("Image download exceeds the configured size limit.");
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new Error("Image download returned an empty body.");
  }
  return Buffer.concat(chunks, totalBytes).toString("base64");
}

// Kakao CDN 이미지를 내려받아 Iris `/reply` API로 대상 방에 전송합니다.
async function sendIrisImageReply(config: AppConfig, reply: IrisImageReply): Promise<void> {
  const imageData = await downloadImageAsBase64(config, reply.imageUrl);
  const response = await fetch(`${config.irisBaseUrl}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "image", room: reply.room, data: imageData }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`Iris image reply failed with HTTP ${response.status}.`);
  }

  const result = await response.json() as { success?: unknown };
  if (result.success !== true) {
    throw new Error("Iris image reply response did not report success.");
  }
}

// 미니펫 장착과 전체정리 명령의 공용 디스패치 후보 여부를 확인합니다.
function isMiniPetEquipOrBulkCleanupCommand(message: string | undefined): boolean {
  return isMiniPetEquipCommandCandidate(message) || isMiniPetBulkCleanupCommand(message)
    || isMiniPetBattleResetTicketCraftCommand(message) || isMiniPetBattleRecordResetCommand(message)
    || isMiniPetUpgradeCommand(message) || isMiniPetEliteCombineCandidate(message);
}

// 미니펫 장착과 전체정리 명령을 공용 레지스트리 조회 형식으로 정규화합니다.
function normalizeMiniPetEquipOrBulkCleanupDispatchMessage(message: string): string {
  if (isMiniPetEquipCommandCandidate(message)) return normalizeMiniPetEquipDispatchMessage(message);
  if (isMiniPetBulkCleanupCommand(message)) return normalizeMiniPetBulkCleanupDispatchMessage(message) ?? message;
  if (isMiniPetUpgradeCommand(message)) return "/미니펫강화";
  if (isMiniPetEliteCombineCandidate(message)) return normalizeMiniPetEliteCombineDispatchMessage(message);
  return message;
}

// 미니펫 공용 명령을 실행하고 생성된 답변을 기존 처리 큐에 추가합니다.
async function dispatchMiniPetEquipOrBulkCleanup(input: {
  database: DatabaseClient | undefined;
  isOperationalChannel: boolean;
  duplicate: boolean | undefined;
  route: string | undefined;
  handlerKey: string | undefined;
  normalizedEvent: NormalizedIrisEvent;
  replies: PendingReply[] | undefined;
}): Promise<void> {
  const event = input.normalizedEvent;
  if (!input.isOperationalChannel || input.duplicate !== false
    || input.route !== "MODERN"
    || event.userId === undefined || input.database === undefined) return;
  if (input.handlerKey === "mini_pet_equip" && isMiniPetEquipCommandCandidate(event.message)) {
    const result = await new MiniPetEquipService(input.database).handle({
      externalUserId: event.userId,
      message: event.message!,
      eventId: event.eventId,
      destinationId: event.channelId!
    });
    if (result.outboxId !== undefined && result.data !== undefined) {
      input.replies?.push({ outboxId: result.outboxId, room: event.channelId!, data: result.data });
    }
    return;
  }
  if (input.handlerKey === "mini_pet_battle_reset_ticket_craft" && isMiniPetBattleResetTicketCraftCommand(event.message)) {
    const result = await new MiniPetBattleResetTicketCraftService(input.database).handle({
      externalUserId: event.userId,
      channelId: event.channelId!,
      message: event.message!,
      eventId: event.eventId
    });
    input.replies?.push({ outboxId: result.outboxId, room: event.channelId!, data: result.data });
    return;
  }
  if (input.handlerKey === "mini_pet_battle_record_reset" && isMiniPetBattleRecordResetCommand(event.message)) {
    const result = await new MiniPetBattleRecordResetService(input.database).handle({
      externalUserId: event.userId,
      channelId: event.channelId!,
      message: event.message!,
      eventId: event.eventId
    });
    input.replies?.push({ outboxId: result.outboxId, room: event.channelId!, data: result.data });
    return;
  }
  if (input.handlerKey === "mini_pet_upgrade" && isMiniPetUpgradeCommand(event.message)) {
    const result = await new MiniPetUpgradeService(input.database).handle({
      externalUserId: event.userId,
      destinationId: event.channelId!,
      message: event.message!,
      eventId: event.eventId
    });
    if (result.outboxId !== undefined && result.data !== undefined) {
      input.replies?.push({ outboxId: result.outboxId, room: event.channelId!, data: result.data });
    }
    return;
  }
  if (input.handlerKey === "mini_pet_carrot_trade" && isMiniPetCarrotTradeCandidate(event.message)) {
    const result = await new MiniPetCarrotTradeService(input.database).handle({
      eventId: event.eventId,
      externalUserId: event.userId,
      destinationId: event.channelId!,
      message: event.message!
    });
    if (result.status !== "silent" && result.outboxId !== undefined && result.data !== undefined) {
      input.replies?.push({ outboxId: result.outboxId, room: event.channelId!, data: result.data });
    }
    return;
  }
  if (input.handlerKey === "mini_pet_elite_combine" && isMiniPetEliteCombineCandidate(event.message)) {
    const result = await new MiniPetEliteCombineService(input.database).handle({ eventId:event.eventId, externalUserId:event.userId, destinationId:event.channelId!, message:event.message! });
    if (result.status !== "silent" && result.outboxId !== undefined && result.data !== undefined) input.replies?.push({ outboxId:result.outboxId, room:event.channelId!, data:result.data });
    return;
  }
  if (input.handlerKey !== "mini_pet_bulk_cleanup" || !isMiniPetBulkCleanupCommand(event.message)) return;
  const result = await new MiniPetBulkCleanupService(input.database).handle({
    eventId: event.eventId,
    externalUserId: event.userId,
    message: event.message!
  });
  if (result.outboxId !== undefined && result.data !== undefined) {
    input.replies?.push({ outboxId: result.outboxId, room: event.channelId!, data: result.data });
  }
}

// 운영 Kakao 이벤트의 고정된 방별 player snapshot으로 /계정변경을 한 번만 실행합니다.
export async function dispatchAccountSwitchCommand(
  provider: Pick<AccountPlatformIrisContextProvider, "prepareKakao" | "dispatchAccountSwitch"> | undefined,
  eventProcessor: Pick<ProcessIrisEventService, "queueCommandReply"> | undefined,
  isOperationalChannel: boolean,
  duplicate: boolean | undefined,
  event: NormalizedIrisEvent,
  replies: PendingReply[] | undefined,
): Promise<AccountPlatformKakaoEventContext | null> {
  if (provider === undefined || eventProcessor === undefined || !isOperationalChannel || duplicate !== false
    || replies === undefined || !isAccountSwitchCommandCandidate(event.message)) return null;
  const context = await provider.prepareKakao(event);
  if (context === null) return null;
  try {
    const result = await provider.dispatchAccountSwitch(context);
    if (result !== null) {
      replies.push(await eventProcessor.queueCommandReply(event, "ACCOUNT_PLATFORM_SWITCH", result.data));
    }
  } catch (error) {
    if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
      replies.push(await eventProcessor.queueCommandReply(event, "account_platform_switch_error", error.message));
    } else {
      throw error;
    }
  }
  return context;
}

// 펫탐험 정산 exact 명령을 app 본문 제어흐름과 분리해 registry consumer로 전달합니다.
async function dispatchPetExploreSettlementCommand(ingress: Pick<PetExploreAppWiringIngress, "handle"> | undefined, isOperationalChannel: boolean, duplicate: boolean | undefined, event: NormalizedIrisEvent): Promise<void> {
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetExploreSettlementCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return;
  await ingress.handle(event);
}

// 펫탐험 이벤트 제어 exact 명령을 공용 provider 소비자로 전달합니다.
async function dispatchPetExploreEventControlCommand(ingress: Pick<PetExploreAppWiringIngress, "handle"> | undefined, isOperationalChannel: boolean, duplicate: boolean | undefined, event: NormalizedIrisEvent): Promise<void> {
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetExploreEventControlCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return;
  await ingress.handle(event);
}

// 펫탐험 명령 소비자들을 app 본문의 단일 호출 경계로 묶습니다.
async function dispatchPetExploreCommandConsumers(ingress: Pick<PetExploreAppWiringIngress, "handle"> | undefined, isOperationalChannel: boolean, duplicate: boolean | undefined, event: NormalizedIrisEvent): Promise<void> {
  await dispatchPetExploreSettlementCommand(ingress,isOperationalChannel,duplicate,event);
  await dispatchPetExploreEventControlCommand(ingress,isOperationalChannel,duplicate,event);
}

function isPetSkillBulkGrantOrProbabilityCandidate(message: string | undefined): boolean {
  return isPetSkillBulkGrantCandidate(message) || isPetSkillProbabilityCommand(message) || isPetSkillInfoShadowCandidate(message);
}

function resolvePetSkillDispatchMessage(message: string | undefined): string | undefined {
  const value = message ?? "";
  if (isPetSkillInfoShadowCandidate(message)) return normalizePetSkillInfoDispatchMessage(value);
  if (isPetSkillSaleCandidate(message)) return normalizePetSkillSaleDispatchMessage(value);
  if (isPetSkillEquipCandidate(message)) return normalizePetSkillEquipDispatchMessage(value);
  if (isPetSkillBulkGrantCandidate(message)) return normalizePetSkillBulkGrantDispatchMessage(value);
  if (isPetSkillOpenCandidate(message)) return normalizePetSkillOpenDispatchMessage(value);
  if (isPetSkillMarketListingCandidate(message)) return normalizePetSkillMarketListingDispatchMessage(value);
  if (isPetSkillCarrotTradeCandidate(message)) return normalizePetSkillCarrotTradeDispatchMessage(value);
  if (isPetSkillBookCombineCandidate(message)) return normalizePetSkillBookCombineDispatchMessage(value);
  if (isPetSkillExtinctionCandidate(message)) return normalizePetSkillExtinctionDispatchMessage(value);
  return undefined;
}

// 정확한 확률 명령은 inbox claim부터 outbox까지 하나의 root transaction으로 처리합니다.
async function processPetSkillProbabilityAtomicIngress(input: {
  database: DatabaseClient;
  event: NormalizedIrisEvent;
  replyIdentity: NormalizedIrisEvent;
  environmentContext: VerifiedEnvironmentContext;
  channelType: "open_group" | "open_direct";
  channelName?: ChannelNameObservation;
}): Promise<EventProcessingResult> {
  if (input.event.channelId === undefined) throw new Error("PET_SKILL_PROBABILITY_CHANNEL_REQUIRED");
  const destinationId = input.event.channelId;
  return withMariaTransactionRetry(input.database, {
    maxAttempts: 3,
    allowRetry: () => true,
    exhaustedErrorCode: "PET_SKILL_PROBABILITY_TRANSACTION_RETRY_EXHAUSTED"
  }, async (transaction) => {
    const scopedDatabase = createScopedDatabaseClient(transaction);
    const processing = await new ProcessIrisEventService(scopedDatabase).executeAtomicCommandInTransaction(
      transaction,input.event,input.replyIdentity,input.channelType,
      input.channelName === undefined ? {} : { channelName: input.channelName }
    );
    const result = await new PetSkillProbabilityAtomicService(scopedDatabase).executeInTransaction(transaction, {
      event: input.event,
      environment: input.environmentContext.environmentCode,
      databaseIdentity: input.environmentContext.databaseIdentity,
      destinationId,
      duplicateClaim: processing.duplicate
    });
    if (!result.replayed && result.data !== null && result.outboxId !== null) {
      processing.replies.push({ outboxId: result.outboxId, room: destinationId, data: result.data });
    }
    return processing;
  });
}

async function verifyPetSkillProbabilityCompletedReplay(
  database: DatabaseClient | undefined,
  event: NormalizedIrisEvent,
  environmentContext: VerifiedEnvironmentContext | undefined
): Promise<boolean> {
  if (!isPetSkillProbabilityCommand(event.message)) return false;
  if (database === undefined || event.channelId === undefined) return false;
  if (environmentContext === undefined) {
    throw new Error("PET_SKILL_PROBABILITY_VERIFIED_ENVIRONMENT_REQUIRED");
  }
  return withMariaTransactionRetry(database, {
    maxAttempts: 3,
    allowRetry: () => true,
    exhaustedErrorCode: "PET_SKILL_PROBABILITY_REPLAY_RETRY_EXHAUSTED"
  }, transaction => new PetSkillProbabilityAtomicService(database).verifyCompletedReplayInTransaction(transaction, {
    event,environment:environmentContext.environmentCode,databaseIdentity:environmentContext.databaseIdentity,destinationId:event.channelId!
  }));
}

async function dispatchPetSkillReadCommands(input: {
  database: DatabaseClient | undefined;
  eventProcessor: Pick<ProcessIrisEventService, "queueCommandReply"> | undefined;
  isOperationalChannel: boolean;
  duplicate: boolean | undefined;
  route: string | undefined;
  handlerKey: string | undefined;
  event: NormalizedIrisEvent;
  replies: PendingReply[] | undefined;
}): Promise<void> {
  if (input.handlerKey === "pet_skill_probability") {
    return;
  }
  if (input.database === undefined || input.eventProcessor === undefined || input.replies === undefined
    || !input.isOperationalChannel || input.duplicate !== false || input.route !== "MODERN"
    || input.handlerKey !== "pet_skill_read" || !isPetSkillReadCommand(input.event.message)
    || input.event.userId === undefined || input.event.channelId === undefined) return;
  try {
    const result = await new PetSkillReadService(input.database).read({
      eventId:input.event.eventId, externalUserId:input.event.userId,
      destinationId:input.event.channelId, message:input.event.message!
    });
    input.replies.push(await input.eventProcessor.queueCommandReply(input.event,"pet_skill_read",result.reply));
  } catch (error) {
    if (error instanceof ApplicationError && [404,409,422].includes(error.statusCode)) {
      input.replies.push(await input.eventProcessor.queueCommandReply(input.event,"pet_skill_read_error",error.message));
    } else throw error;
  }
}

async function evaluatePetSkillInfoShadow(input:{database:DatabaseClient|undefined;isOperationalChannel:boolean;duplicate:boolean|undefined;route:string|undefined;handlerKey:string|undefined;event:NormalizedIrisEvent}):Promise<void>{
  if(input.database===undefined||!input.isOperationalChannel||input.duplicate!==false||input.route!=="SHADOW"
    ||input.handlerKey!=="pet_skill_info"||!isPetSkillInfoShadowCandidate(input.event.message)||input.event.userId===undefined)return;
  await new PetSkillInfoShadowService(input.database).evaluate({externalUserId:input.event.userId,displayName:input.event.displayName,message:input.event.message!});
}

async function dispatchPetSkillMutationCommands(input:{database:DatabaseClient|undefined;eventProcessor:ProcessIrisEventService|undefined;isOperationalChannel:boolean;processing:EventProcessingResult|undefined;route:string|undefined;handlerKey:string|undefined;event:NormalizedIrisEvent}):Promise<void>{
  const {database,eventProcessor,isOperationalChannel,processing,route,handlerKey,event}=input;
  if(database===undefined||eventProcessor===undefined||!isOperationalChannel||processing===undefined||processing.duplicate||route!=="MODERN"||event.userId===undefined||event.channelId===undefined)return;
  if(isPetSkillExtinctionCandidate(event.message)&&handlerKey==="pet_skill_extinction"){
    const result=await new PetSkillExtinctionService(database).handle({eventId:event.eventId,externalUserId:event.userId,destinationId:event.channelId,message:event.message!});
    processing.replies.push(await eventProcessor.queueCommandReply(event,"pet_skill_extinction",result.reply));
  }else if(isPetSkillOpenCandidate(event.message)&&handlerKey==="pet_skill_open"){
    try{const result=await new PetSkillOpenService(database).handle({eventId:event.eventId,externalUserId:event.userId,destinationId:event.channelId,message:event.message!});if("reply" in result)processing.replies.push(await eventProcessor.queueCommandReply(event,"pet_skill_open",result.reply));}
    catch(error){if(error instanceof ApplicationError&&[409,422].includes(error.statusCode))processing.replies.push(await eventProcessor.queueCommandReply(event,"pet_skill_open_error",error.message));else throw error;}
  }else if(isPetSkillBulkGrantCandidate(event.message)&&handlerKey==="pet_skill_bulk_grant"){
    const result=await new PetSkillBulkGrantService(database).handle({eventId:event.eventId,externalUserId:event.userId,destinationId:event.channelId,message:event.message!});
    if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:event.channelId,data:result.reply!});
  }else if(isPetSkillEquipCandidate(event.message)&&handlerKey==="pet_skill_equip"){
    const result=await new PetSkillEquipService(database).handle({eventId:event.eventId,externalUserId:event.userId,destinationId:event.channelId,message:event.message!});
    processing.replies.push({outboxId:result.outboxId,room:event.channelId,data:result.reply});
  }else if(isPetSkillSaleCandidate(event.message)&&handlerKey==="pet_skill_sale_lifecycle"){
    const result=await new PetSkillSaleLifecycleService(database).handle({eventId:event.eventId,externalUserId:event.userId,destinationId:event.channelId,message:event.message!});
    processing.replies.push({outboxId:result.outboxId,room:event.channelId,data:result.reply});
  }
}

export type PetDataCompareAppWiringDisposition = "not_applicable" | "legacy_fallback" | "claimed";

// exact ADMIN 명령만 app-wiring에 전달하고 claim 여부를 레거시 실행 경계에 반환합니다.
export async function dispatchPetDataCompareCommand(
  ingress: Pick<PetDataCompareAppWiringIngress, "handle"> | undefined,
  isOperationalChannel: boolean,
  duplicate: boolean | undefined,
  event: NormalizedIrisEvent,
): Promise<PetDataCompareAppWiringDisposition> {
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetDataCompareCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return "not_applicable";
  const result = await ingress.handle(event);
  if (result.status === "ignored") return "not_applicable";
  if (result.status === "legacy_fallback") return "legacy_fallback";
  return "claimed";
}

export type PetTitleAppWiringDisposition = "not_applicable" | "legacy_fallback" | "shadow" | "claimed";

// SHADOW는 기존 명령을 계속 실행하고, MODERN/NO_REPLY/REJECT claim만 레거시 실행을 차단합니다.
export async function dispatchPetTitleCommand(
  ingress:Pick<PetTitleAppWiringIngress,"handle">|undefined,
  isOperationalChannel:boolean,
  duplicate:boolean|undefined,
  event:NormalizedIrisEvent,
  replies:PendingReply[]|undefined,
):Promise<PetTitleAppWiringDisposition>{
  if(ingress===undefined||!isOperationalChannel||duplicate!==false||replies===undefined
    ||event.direction!=="incoming"||!isPetTitleCommandCandidate(event.message)
    ||event.userId===undefined||event.channelId===undefined)return "not_applicable";
  const result=await ingress.handle(event);
  if(result.status==="ignored")return "not_applicable";
  if(result.status==="legacy_fallback")return "legacy_fallback";
  if(result.status==="shadow")return "shadow";
  if(result.status==="modern")replies.push(result.reply);
  return "claimed";
}

// 후원패스 registry 후보 판정과 alias 정규화를 app 본문 밖의 단일 경계로 묶습니다.
function resolveSupportPassRegistryDispatchMessage(message: string | undefined): string | undefined {
  const value = message ?? "";
  if (process.env.CONTRIBUTION_PASS_COMMAND_ENABLED === "true" && isContributionPassCommandCandidate(message)) return normalizeContributionPassDispatchMessage(value);
  if (process.env.DIAMOND_PASS_COMMAND_ENABLED === "true" && isDiamondPassCommandCandidate(message)) return normalizeDiamondPassDispatchMessage(value);
  if (process.env.HOI_PASS_COMMAND_ENABLED === "true" && isHoiPassCommandCandidate(message)) return normalizeHoiPassDispatchMessage(value);
  return undefined;
}

// 공헌·다이아·호이패스 handler 분기를 app 본문 밖의 단일 실행 경계로 묶습니다.
async function dispatchSupportPassRegistryCommand(database: DatabaseClient | undefined, eventProcessor: ProcessIrisEventService | undefined, duplicate: boolean | undefined, route: string | undefined, handlerKey: string | undefined, event: NormalizedIrisEvent, replies: PendingReply[] | undefined): Promise<void> {
  if (database === undefined || eventProcessor === undefined || replies === undefined || duplicate || route !== "MODERN") return;
  const response = handlerKey === "contribution_pass_registry"
    ? await new ContributionPassIrisHandler(database).execute(event)
    : handlerKey === "diamond_pass_registry"
      ? await new DiamondPassIrisHandler(database).execute(event)
      : handlerKey === "hoi_pass_registry"
        ? await new HoiPassIrisHandler(database).execute(event)
        : undefined;
  if (response === undefined) return;
  replies.push({ outboxId: response.outboxId, room: response.room, data: response.message });
}

// 테스트와 실제 실행에서 공통으로 사용할 Fastify 앱을 생성합니다.
export function buildApp(config: AppConfig, dependencies: AppDependencies = {}) {
  const app = Fastify({
    bodyLimit: config.bodyLimitBytes,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.x-iris-token"],
        censor: "[REDACTED]"
      }
    }
  });
  const recentEvents = new RecentEventStore(config.recentEventLimit);
  const tokenGuard = createTokenGuard(config);
  const replyToIris = dependencies.sendIrisTextReply
    ?? ((reply: IrisTextReply) => sendIrisTextReply(config, reply));
  const forwardImageToIris = dependencies.sendIrisImageReply
    ?? ((reply: IrisImageReply) => sendIrisImageReply(config, reply));
  const inspectIrisKakaoDatabase = dependencies.inspectIrisKakaoDatabase
    ?? ((event: NormalizedIrisEvent) => new IrisKakaoDatabaseInspector(config.irisBaseUrl).inspect(event));
  const designatedChannelIds = new Set(config.irisAllowedOpenChatIds);
  const diagnosticChannelIds = new Set(
    config.nodeEnv === "production" || config.irisEventMonitorRoomId === ""
      ? []
      : [config.irisEventMonitorRoomId]
  );
  const inspectIrisChannel = dependencies.inspectIrisChannel
    ?? ((event: NormalizedIrisEvent) => new IrisChannelPolicyInspector(config.irisBaseUrl)
      .inspect(event, designatedChannelIds, diagnosticChannelIds, config.irisOpenChatObservationMode));
  const database = dependencies.database;
  const appWiringOperationProvider = dependencies.appWiringOperationProvider
    ?? (database !== undefined && dependencies.environmentContext !== undefined && hasDatabaseTransactionCapabilities(database)
      ? new MariaAppWiringOperationProvider(database, dependencies.environmentContext)
      : undefined);
  const petExploreAppWiringIngress = dependencies.petExploreAppWiringIngress
    ?? (database !== undefined && appWiringOperationProvider !== undefined
      ? new PetExploreAppWiringIngress(
        appWiringOperationProvider,
        new CommandDispatcher(new MariaCommandRouteReader(database), {
          enabled: true,
          allowAllCanaries: config.nodeEnv !== "production",
          canaryUserIds: parseCanaryUserIds(process.env.PARTIAL_COMMAND_CANARY_USER_IDS),
        }),
      )
      : undefined);
  const petDataCompareAppWiringIngress = dependencies.petDataCompareAppWiringIngress
    ?? (database !== undefined && appWiringOperationProvider !== undefined
      ? new PetDataCompareAppWiringIngress(
        appWiringOperationProvider,
        new CommandDispatcher(new MariaCommandRouteReader(database), {
          enabled: true,
          allowAllCanaries: config.nodeEnv !== "production",
          canaryUserIds: parseCanaryUserIds(process.env.PARTIAL_COMMAND_CANARY_USER_IDS),
        }),
      )
      : undefined);
  const petTitleContextProvider=new MariaPlayerContextProvider();
  const petTitleAppWiringIngress=dependencies.petTitleAppWiringIngress
    ??(database!==undefined&&appWiringOperationProvider!==undefined
      ?(()=>{
        return new PetTitleAppWiringIngress(
          appWiringOperationProvider,
          new CommandDispatcher(new MariaCommandRouteReader(database),{
            enabled:true,
            allowAllCanaries:config.nodeEnv!=="production",
            canaryUserIds:parseCanaryUserIds(process.env.PARTIAL_COMMAND_CANARY_USER_IDS),
          }),
          new PetTitleShadowEvaluator(petTitleContextProvider,new PetTitleShadowReadAuthorityProvider(),new PetTitleCanonicalReadProvider()),
          petTitleContextProvider,
          new PetTitleCanonicalMutationProvider(),
        );
      })()
      :undefined);
  const petTitleAdminAppWiringIngress=database!==undefined&&appWiringOperationProvider!==undefined
    ?new PetTitleAdminAppWiringIngress(
      appWiringOperationProvider,
      new CommandDispatcher(new MariaCommandRouteReader(database),{
        enabled:true,
        allowAllCanaries:false,
        canaryUserIds:new Set(),
      }),
      petTitleContextProvider,
      new PetTitleCanonicalMutationProvider(),
    )
    :undefined;
  const diagnosticRuntime=config.environmentCode===undefined?undefined:{
    environmentCode:config.environmentCode,
    ...(dependencies.environmentContext===undefined?{}:{databaseIdentity:dependencies.environmentContext.databaseIdentity}),
    ...(dependencies.adminDiagnosticNow===undefined?{}:{now:dependencies.adminDiagnosticNow})
  };
  const irisAdminCommandService = dependencies.irisAdminCommandService
    ?? (database === undefined ? undefined : new IrisAdminCommandService(database,config.irisAllowedOpenChatIds,petTitleAdminAppWiringIngress,diagnosticRuntime));
  const accountPlatformIrisContextProvider = dependencies.accountPlatformIrisContextProvider
    ?? (database === undefined ? undefined : new AccountPlatformIrisContextProvider(database));
  const retainedEventContents = database === undefined ? undefined : new RetainedEventContentService(database, {
    enabled: config.retainedEventContentEnabled,
    retentionDays: config.retainedEventContentDays,
    storageDirectory: config.retainedEventContentStorageDirectory,
    maxBytes: config.imageMaxBytes,
    downloadTimeoutMs: config.imageDownloadTimeoutMs
  });
  const retainIrisEventContent = dependencies.retainIrisEventContent
    ?? (retainedEventContents === undefined ? undefined
      : (payload: IrisPayload, event: NormalizedIrisEvent) => retainedEventContents.retain(payload, event));
  const retainedContentChannelIds = new Set(config.retainedEventContentChannelIds);
  let accountCleanupTimer: NodeJS.Timeout | undefined;
  let retainedContentCleanupTimer: NodeJS.Timeout | undefined;

  void app.register(cookie);
  void registerAdminWebShellRoutes(app);
  void registerSiteSignupWebRoutes(app);
  if (database !== undefined) {
    const profiles = new MariaProfileRepository(database);
    const adminAuth = new AdminAuthService(database);
    void registerAdminRoutes(app, {
      auth: adminAuth,
      profiles,
      changePlayerServer: new ChangePlayerServerService(database),
      directory: new AdminDirectoryService(database),
      management: new AdminManagementService(database),
      moderationIncidents: new ModerationIncidentService(database),
      retainedEventContents: retainedEventContents!,
      currency: new CurrencyService(database),
      managedBackup: new ManagedBackupCommandService(database),
      dataBackup: new DataBackupService(database),
      dataRestore: new DataRestoreService(database),
      inspectIrisKakaoDatabase,
      secureCookies: config.nodeEnv === "production"
    });
    void registerAdminDiamondShopCatalogWebRoutes(app, {
      auth: adminAuth,
      catalog: new DiamondShopCatalogWebAdapterProvider(database)
    });
    void registerAdminPackageCatalogWebRoutes(app, {
      auth: adminAuth,
      snapshot: new MariaPackageCatalogAdminRepository(database),
      catalog: new PackageCatalogWebAdapter(new MariaPackageCatalogWebAdapterRepository(database))
    });
    void registerAdminObjectCatalogWebRoutes(app, {
      auth: adminAuth,
      reader: new ObjectCatalogService(new MariaObjectCatalogRepository(database)),
      catalog: new ObjectCatalogWebAdapterProvider(database)
    });
    void registerAdminConfigurationCatalogWebRoutes(app, {
      auth: adminAuth,
      catalog: new ConfigurationCatalogProvider(
        new ConfigurationCatalogRegistry([]),
        new MariaConfigurationCatalogRepository(database)
      )
    });
    void registerAdminPetSkillCatalogWebRoutes(app, {
      auth: adminAuth,
      catalog: new PetSkillCatalogCrudProvider(
        new ConfigurationCatalogProvider(
          new ConfigurationCatalogRegistry([PET_SKILL_CATALOG_CONFIGURATION]),
          new MariaConfigurationCatalogRepository(database)
        )
      )
    });
    const adminBalanceRepository = new MariaAdminBalanceMutationRepository(database);
    void registerAdminBalanceWebRoutes(app, {
      auth: adminAuth,
      reader: new AdminBalanceReadModelProvider(database),
      mutation: new AdminBalanceMutationProvider(database, adminBalanceRepository)
    });
    void registerUserAuthRoutes(app, {
      auth: new UserAuthService(database, config.userVerificationPepper, config.nodeEnv),
      profiles,
      rateLimiter: new RequestRateLimiter(config.userVerificationPepper),
      secureCookies: config.nodeEnv === "production"
    });
    if (config.nodeEnv !== "test") {
      const cleanup = dependencies.runAccountCleanupMaintenance
        ?? (() => new AccountCleanupService(database).runMaintenance());
      const purgeRetainedContent = dependencies.purgeRetainedEventContent
        ?? (retainedEventContents === undefined ? undefined : () => retainedEventContents.purgeExpired());
      app.addHook("onListen", async () => {
        void cleanup().then((result) => {
          if (result.pending.processed > 0 || result.pending.failed > 0
            || result.deleted.processed > 0 || result.deleted.failed > 0) {
            app.log.info(result, "account_cleanup.completed");
          }
        }).catch((error) => app.log.error({ err: error }, "account_cleanup.failed"));
        accountCleanupTimer = setInterval(() => {
          void cleanup().then((result) => {
            if (result.pending.processed > 0 || result.pending.failed > 0
              || result.deleted.processed > 0 || result.deleted.failed > 0) {
              app.log.info(result, "account_cleanup.completed");
            }
          }).catch((error) => app.log.error({ err: error }, "account_cleanup.failed"));
        }, 3_600_000);
        accountCleanupTimer.unref();
        if (config.retainedEventContentEnabled && purgeRetainedContent !== undefined) {
          void purgeRetainedContent()
            .then((purged) => { if (purged > 0) app.log.info({ purged }, "retained_content_cleanup.completed"); })
            .catch((error) => app.log.error({ err: error }, "retained_content_cleanup.failed"));
          retainedContentCleanupTimer = setInterval(() => {
            void purgeRetainedContent()
              .then((purged) => { if (purged > 0) app.log.info({ purged }, "retained_content_cleanup.completed"); })
              .catch((error) => app.log.error({ err: error }, "retained_content_cleanup.failed"));
          }, 3_600_000);
          retainedContentCleanupTimer.unref();
        }
      });
    }
  }

  app.addHook("onClose", async () => {
    if (accountCleanupTimer !== undefined) clearInterval(accountCleanupTimer);
    if (retainedContentCleanupTimer !== undefined) clearInterval(retainedContentCleanupTimer);
    await database?.close();
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    request.log.info(
      { requestId: request.id, method: request.method, path: getSafePath(request.url) },
      "request.received"
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      { requestId: request.id, statusCode: reply.statusCode, responseTimeMs: reply.elapsedTime },
      "request.completed"
    );
  });

  app.setErrorHandler(async (error: FastifyError | ApplicationError, request, reply) => {
    const isApplicationError = error instanceof ApplicationError;
    const statusCode = isApplicationError ? error.statusCode
      : error.statusCode === 413 ? 413 : (error.statusCode ?? 500);
    const code = isApplicationError ? error.code
      : statusCode === 413 ? "PAYLOAD_TOO_LARGE" : "INTERNAL_SERVER_ERROR";
    const message = isApplicationError ? error.message
      : statusCode === 413 ? `요청 본문은 ${config.bodyLimitBytes}바이트를 초과할 수 없습니다.`
        : "서버가 요청을 처리하지 못했습니다.";

    request.log.error({ requestId: request.id, err: error }, "request.failed");
    await reply.code(statusCode).send({ ok: false, error: { code, message }, requestId: request.id });
  });

  app.get("/health/live", async (request) => ({
    ok: true,
    status: "alive",
    requestId: request.id
  }));

  app.get("/health/ready", async (request, reply) => {
    if (!config.database.enabled) {
      return { ok: true, status: "ready", database: "disabled", requestId: request.id };
    }

    if (database === undefined) {
      return reply.code(503).send({
        ok: false,
        status: "not_ready",
        database: "unavailable",
        requestId: request.id
      });
    }

    try {
      await database.ping();
      return { ok: true, status: "ready", database: "ready", requestId: request.id };
    } catch (error) {
      request.log.error({ requestId: request.id, err: error }, "database.readiness.failed");
      return reply.code(503).send({
        ok: false,
        status: "not_ready",
        database: "unavailable",
        requestId: request.id
      });
    }
  });

  app.get("/api/v1/ping", async (request) => ({
    ok: true,
    message: "pong",
    requestId: request.id
  }));

  app.get("/api/v1/version", async (request) => ({
    ok: true,
    version: config.version,
    requestId: request.id
  }));

  app.get("/api/v1/public/overview", async (request) => {
    if (database === undefined || !config.database.enabled) {
      return {
        ok: true,
        service: { api: "ready", database: "disabled" },
        metrics: null,
        requestId: request.id
      };
    }
    try {
      const rows = await database.query<Array<{
        active_players: bigint;
        active_channels: bigint;
        events_last_24_hours: bigint;
        last_event_at: Date | null;
      }>>(
        `SELECT
          (SELECT COUNT(*) FROM players WHERE status = 'active') AS active_players,
          (SELECT COUNT(*) FROM channels WHERE provider_code = 'iris' AND status = 'active') AS active_channels,
          (SELECT COUNT(*) FROM event_inbox WHERE received_at >= UTC_TIMESTAMP(3) - INTERVAL 24 HOUR) AS events_last_24_hours,
          (SELECT MAX(received_at) FROM event_inbox) AS last_event_at`
      );
      const row = rows[0];
      return {
        ok: true,
        service: { api: "ready", database: "ready" },
        metrics: row === undefined ? null : {
          activePlayers: row.active_players.toString(),
          activeChannels: row.active_channels.toString(),
          eventsLast24Hours: row.events_last_24_hours.toString(),
          lastEventAt: row.last_event_at?.toISOString() ?? null
        },
        requestId: request.id
      };
    } catch (error) {
      request.log.error({ requestId: request.id, err: error }, "public.overview.failed");
      return {
        ok: true,
        service: { api: "ready", database: "unavailable" },
        metrics: null,
        requestId: request.id
      };
    }
  });

  app.post<{ Body: IrisPayload; Querystring: TokenQuery }>(
    "/api/v1/integrations/iris/events",
    { preHandler: tokenGuard },
    async (request, reply) => {
      const normalizedEvent = normalizeIrisEvent(request.body);
      const channelAccess = await inspectIrisChannel(normalizedEvent);
      if (channelAccess.mode === "denied") {
        request.log.info(
          { requestId: request.id, reason: channelAccess.reason, channelClass: channelAccess.channelClass },
          "iris.event_ignored_by_channel_policy"
        );
        return reply.code(202).send({
          ok: true,
          accepted: true,
          ignored: true,
          ignoreReason: channelAccess.reason,
          requestId: request.id
        });
      }

      if (config.rawPayloadLogging) {
        request.log.info(
          { requestId: request.id, irisPayload: request.body },
          "iris.raw_payload"
        );
      }

      if (config.recentEventsEnabled) {
        recentEvents.add({
          requestId: request.id,
          receivedAt: new Date().toISOString(),
          payload: request.body
        });
      }

      const isOperationalChannel = channelAccess.mode === "operational";
      const isObservationChannel = channelAccess.mode === "observation";
      const isInteractiveChannel = isOperationalChannel || channelAccess.mode === "diagnostic";
      if (isOperationalChannel
        && await verifyPetSkillProbabilityCompletedReplay(database, normalizedEvent, dependencies.environmentContext)) {
        return reply.code(202).send({ ok: true, accepted: true, ignored: false, duplicate: true, requestId: request.id });
      }
      const verificationCode = readKakaoVerificationCode(normalizedEvent.message);
      const moderationIncidentNumber = readModerationIncidentNumber(normalizedEvent.message);
      const shouldCreateEventMonitorMessage = config.nodeEnv !== "production"
        && config.irisEventMonitorRoomId !== ""
        && shouldMonitorIrisEvent(request.body, normalizedEvent);
      const requiresOriginalMessageLookup = shouldCreateEventMonitorMessage
        && (normalizedEvent.eventCode === "message.deleted"
          || normalizedEvent.eventCode === "message.hidden_by_host");
      const requiresKakaoDatabaseLookup = requiresOriginalMessageLookup
        || (normalizedEvent.direction === "incoming" && (normalizedEvent.message === "/ping"
          || verificationCode !== null
          || isSignupCommand(normalizedEvent.message)
          || (normalizedEvent.message === "/info" && config.nodeEnv !== "production")
          || shouldCreateEventMonitorMessage));
      const kakaoDatabaseSnapshot = requiresKakaoDatabaseLookup
        ? await inspectIrisKakaoDatabase(normalizedEvent)
        : undefined;
      const commandEvent = {
        ...normalizedEvent,
        ...(kakaoDatabaseSnapshot?.subjectUserId === undefined
          ? {}
          : { userId: kakaoDatabaseSnapshot.subjectUserId }),
        ...(kakaoDatabaseSnapshot?.nickname === undefined
          || kakaoDatabaseSnapshot.nicknameSource === "iris_sender"
          ? {}
          : { displayName: kakaoDatabaseSnapshot.nickname,
              displayNameSource: "kakao_db" as const, displayNameTrust: "trusted" as const })
      };
      const isDiagnosticModeration = channelAccess.mode === "diagnostic"
        && (normalizedEvent.eventCode === "message.deleted"
          || normalizedEvent.eventCode === "message.hidden_by_host");
      const isMembershipEvent = normalizedEvent.eventCode === "member.joined"
        || normalizedEvent.eventCode === "member.departed";
      const packageDispatchCandidate = process.env.PACKAGE_COMMAND_ENABLED === "true"
        && isPackageCommandCandidate(normalizedEvent.message ?? "");
      const packageCatalogAdminDispatchCandidate = process.env.PACKAGE_CATALOG_ADMIN_COMMAND_ENABLED === "true"
        && isPackageCatalogAdminCommandCandidate(normalizedEvent.message ?? "");
      const pointShopCatalogDispatchCandidate = (process.env.POINT_SHOP_CATALOG_COMMAND_ENABLED === "true"
          || process.env.DIAMOND_SHOP_BUY_COMMAND_ENABLED === "true"
          || process.env.DIAMOND_SHOP_CATALOG_READ_COMMAND_ENABLED === "true")
        && isPointShopCatalogCommandCandidate(normalizedEvent.message);
      const commentPinDeleteDispatchCandidate = process.env.COMMENT_PIN_DELETE_COMMAND_ENABLED === "true"
        && isCommentPinDeleteCommandCandidate(normalizedEvent.message);
      const commentDeleteDispatchCandidate = process.env.COMMENT_DELETE_COMMAND_ENABLED === "true"
        && isCommentDeleteCommandCandidate(normalizedEvent.message);
      const commentPinDispatchCandidate = process.env.COMMENT_PIN_COMMAND_ENABLED === "true"
        && isCommentPinCommandCandidate(normalizedEvent.message);
      const legacyDataCleanupDispatchCandidate = process.env.LEGACY_DATA_CLEANUP_COMMAND_ENABLED === "true"
        && isLegacyDataCleanupCommand(normalizedEvent.message);
      const debugModeDispatchCandidate = process.env.DEBUG_MODE_COMMAND_ENABLED === "true"
        && isDebugModeCommand(normalizedEvent.message);
      const homeFurnitureEquipSyncDispatchCandidate = process.env.HOME_FURNITURE_EQUIP_SYNC_COMMAND_ENABLED === "true"
        && isHomeFurnitureEquipSyncCommand(normalizedEvent.message);
      const homeBaseballPitchDispatchCandidate = process.env.HOME_BASEBALL_PITCH_COMMAND_ENABLED === "true"
        && isHomeBaseballPitchCommandCandidate(normalizedEvent.message);
      const legendaryStoneDrawDispatchCandidate = process.env.LEGENDARY_STONE_DRAW_COMMAND_ENABLED === "true"
        && isLegendaryStoneDrawCommandCandidate(normalizedEvent.message);
      const petExploreRecordsResetDispatchCandidate = process.env.PET_EXPLORE_RECORDS_RESET_COMMAND_ENABLED === "true"
        && isPetExploreRecordsResetCommand(normalizedEvent.message);
      const supportPassRegistryDispatchMessage = resolveSupportPassRegistryDispatchMessage(normalizedEvent.message);
      const passSubscriptionRetiredDispatchCandidate = process.env.PASS_SUBSCRIPTION_RETIRED_COMMAND_ENABLED === "true"
        && isPassSubscriptionRetiredCommandCandidate(normalizedEvent.message);
      const oneDayPassSubscriptionDispatchCandidate = process.env.ONE_DAY_PASS_SUBSCRIPTION_COMMAND_ENABLED === "true"
        && isOneDayPassSubscriptionCommand(normalizedEvent.message);
      const oneDayPassDispatchCandidate = process.env.ONE_DAY_PASS_COMMAND_ENABLED === "true"
        && isOneDayPassCommandCandidate(normalizedEvent.message);
      const dailyCommentDispatchCandidate = process.env.DAILY_COMMENT_COMMAND_ENABLED === "true"
        && isDailyCommentCommandCandidate(normalizedEvent.message);
      const homeLikeDispatchCandidate = process.env.HOME_LIKE_COMMAND_ENABLED === "true"
        && isHomeLikeCommandCandidate(normalizedEvent.message);
      const legacyLikeDispatchCandidate = process.env.LEGACY_LIKE_COMMAND_ENABLED === "true"
        && isLegacyLikeCommandCandidate(normalizedEvent.message);
      const homeProfileViewDispatchCandidate = process.env.HOME_PROFILE_VIEW_COMMAND_ENABLED === "true"
        && isHomeProfileViewCandidate(normalizedEvent.message);
      const homeActivityAlertReadDispatchCandidate = process.env.HOME_ACTIVITY_ALERT_READ_COMMAND_ENABLED === "true"
        && isHomeActivityAlertReadCommand(normalizedEvent.message);
      const homeFeedMutationDispatchCandidate = process.env.HOME_FEED_MUTATE_COMMAND_ENABLED === "true"
        && isHomeFeedMutationCommandCandidate(normalizedEvent.message);
      const homeBadgeInventoryDispatchCandidate = process.env.HOME_BADGE_INVENTORY_COMMAND_ENABLED === "true"
        && isHomeBadgeInventoryCommand(normalizedEvent.message);
      const homeBadgeGachaDispatchCandidate = process.env.HOME_BADGE_GACHA_COMMAND_ENABLED === "true"
        && isHomeBadgeGachaCommandCandidate(normalizedEvent.message);
      const homeBadgeCubeDispatchCandidate = process.env.HOME_BADGE_CUBE_COMMAND_ENABLED === "true"
        && isHomeBadgeCubeCommandCandidate(normalizedEvent.message);
      const inventoryWalletRngOpenDispatchCandidate = process.env.INVENTORY_WALLET_RNG_OPEN_COMMAND_ENABLED === "true"
        && isInventoryWalletRngOpenCommandCandidate(normalizedEvent.message);
      const inventoryFortunePouchDispatchCandidate = process.env.INVENTORY_FORTUNE_POUCH_COMMAND_ENABLED === "true"
        && isInventoryFortunePouchCommandCandidate(normalizedEvent.message);
      const homeHeartExpressionDispatchCandidate = process.env.HOME_HEART_EXPRESSION_COMMAND_ENABLED === "true"
        && isHomeHeartExpressionCommandCandidate(normalizedEvent.message);
      const supportPremiumNoticeDispatchCandidate = process.env.SUPPORT_PREMIUM_NOTICE_COMMAND_ENABLED === "true"
        && isSupportPremiumNoticeCommandCandidate(normalizedEvent.message);
      const guildBoardDispatchCandidate = process.env.GUILD_BOARD_COMMAND_ENABLED === "true"
        && isGuildBoardCommandCandidate(normalizedEvent.message);
      const homeBadgeEquipDispatchCandidate = process.env.HOME_BADGE_EQUIP_COMMAND_ENABLED === "true"
        && isHomeBadgeEquipCommand(normalizedEvent.message);
      const homeBadgePermanentDeleteDispatchCandidate = process.env.HOME_BADGE_PERMANENT_DELETE_COMMAND_ENABLED === "true"
        && isHomeBadgePermanentDeleteCommand(normalizedEvent.message);
      const homeCommentFileBootstrapDispatchCandidate = process.env.HOME_COMMENT_FILE_BOOTSTRAP_COMMAND_ENABLED === "true"
        && isHomeCommentFileBootstrapCommand(normalizedEvent.message);
      const homeVisitResetDispatchCandidate = process.env.HOME_VISIT_RESET_COMMAND_ENABLED === "true"
        && isHomeVisitResetCommand(normalizedEvent.message);
      const homeSocialBadgeMigrationDispatchCandidate = process.env.HOME_SOCIAL_BADGE_MIGRATION_COMMAND_ENABLED === "true"
        && isHomeSocialBadgeMigrationCommand(normalizedEvent.message);
      const homePassReformCleanupDispatchCandidate = process.env.HOME_PASS_REFORM_CLEANUP_COMMAND_ENABLED === "true"
        && isHomePassReformCleanupCommand(normalizedEvent.message);
      const homeFeedMigrationDispatchCandidate = process.env.HOME_FEED_MIGRATION_COMMAND_ENABLED === "true"
        && isHomeFeedMigrationCommand(normalizedEvent.message);
      const homeActivityRestoreDispatchCandidate = process.env.HOME_ACTIVITY_RESTORE_COMMAND_ENABLED === "true"
        && isHomeActivityRestoreCommand(normalizedEvent.message);
      const homeActivityFileBootstrapDispatchCandidate = process.env.HOME_ACTIVITY_FILE_BOOTSTRAP_COMMAND_ENABLED === "true"
        && isHomeActivityFileBootstrapCommand(normalizedEvent.message);
      const packageCatalogWizardHandler = database !== undefined
        && process.env.PACKAGE_CATALOG_WIZARD_COMMAND_ENABLED === "true"
        ? new PackageCatalogAddWizardIrisHandler(database)
        : undefined;
      const packageCatalogWizardControlCandidate = packageCatalogWizardHandler !== undefined
        && isPackageCatalogWizardControl(normalizedEvent.message ?? ""),
        packageCatalogWizardActiveInput = packageCatalogWizardHandler !== undefined
        && normalizedEvent.direction === "incoming"
        && normalizedEvent.message !== undefined
        && !normalizedEvent.message.startsWith("/")
        && await packageCatalogWizardHandler.hasActiveSession(normalizedEvent);
      const partialDispatchCandidate = normalizedEvent.message === "/내정보"
        || isSignupCommand(normalizedEvent.message ?? "")
        || isInventoryBulkSellCommand(normalizedEvent.message)
        || isDiamondBoxCraftCommand(normalizedEvent.message)
        || isAdminDiamondEditCommand(normalizedEvent.message)
        || isAdminAccountSuspensionCommand(normalizedEvent.message)
        || isAdminDiamondResetAllCommand(normalizedEvent.message)
        || isTierCommandCandidate(normalizedEvent.message)
        || isAdminPackageDeleteCommand(normalizedEvent.message)
        || isAdminGlobalGiftCommand(normalizedEvent.message)
        || isMiniPetRankRewardPayoutCommand(normalizedEvent.message)
        || isTierRewardPayoutCommand(normalizedEvent.message)
        || isMiniPetBindingReleaseCommand(normalizedEvent.message)
        || isSpiritInfoCommand(normalizedEvent.message)
        || isOperationNoticeCommandCandidate(normalizedEvent.message)
        || isFirstSponsorCommandCandidate(normalizedEvent.message)
        || isHappyFoundationCommand(normalizedEvent.message)
        || isGuildRecruitmentToggleCommand(normalizedEvent.message)
        || isRiftForceAdminCommand(normalizedEvent.message)
        || isCastleBattleExecuteCommand(normalizedEvent.message)
        || isCastleBattleRankingCommand(normalizedEvent.message)
        || isCastleBattleSelfRecordCommand(normalizedEvent.message)
        || isCastleKingdomStatusReadCommand(normalizedEvent.message)
        || isCastleCharmRankingReadCommand(normalizedEvent.message)
        || isCastleStateResetCommand(normalizedEvent.message)
        || isMiniPetBagThresholdCleanCommand(normalizedEvent.message)
        || isMiniPetGradeCleanupCommand(normalizedEvent.message)
        || isMiniPetAdminOwnedDeleteCommand(normalizedEvent.message)
        || isMiniPetEquippedCustomizeCommand(normalizedEvent.message)
        || isMiniPetEquipOrBulkCleanupCommand(normalizedEvent.message)
        || isRaidCharmRankingReadCommand(normalizedEvent.message)
        || isMiniPetBattleLeaderboardCommand(normalizedEvent.message)
        || isMiniPetBattleCommand(normalizedEvent.message)
        || isMiniPetCarrotTradeCandidate(normalizedEvent.message)
        || isAutoDailyQuestCommand(normalizedEvent.message)
        || isSpiritRankCommand(normalizedEvent.message)
        || isPendantBagCleanupCommandCandidate(normalizedEvent.message)
        || isPendantEnhanceCommandCandidate(normalizedEvent.message)
        || isPendantEnhanceCorrectionCommandCandidate(normalizedEvent.message)
        || isPendantDurabilityCorrectionCommandCandidate(normalizedEvent.message)
        || isPendantMarketRegisterCommandCandidate(normalizedEvent.message)
        || isPendantMarketInfoCommandCandidate(normalizedEvent.message)
        || isPendantCarrotTradeCommandCandidate(normalizedEvent.message)
        || isPendantRestoreCommandCandidate(normalizedEvent.message)
        || isPendantDeleteCommandCandidate(normalizedEvent.message)
         || isPendantRankCommand(normalizedEvent.message)
         || isPendantDrawOpenCommandCandidate(normalizedEvent.message)
         || isPendantEquipCommandCandidate(normalizedEvent.message)
         || isPendantEquipResetCommandCandidate(normalizedEvent.message)
         || isPendantInfoCommandCandidate(normalizedEvent.message)
         || isPendantGrantCommandCandidate(normalizedEvent.message)
         || isPendantSellCommandCandidate(normalizedEvent.message)
         || isPendantProbabilityCommand(normalizedEvent.message)
        || isSpiritNameCommandCandidate(normalizedEvent.message)
        || isSpiritNameCombineCommand(normalizedEvent.message)
        || isPetSkillBulkGrantOrProbabilityCandidate(normalizedEvent.message)
        || isPetSkillEquipCandidate(normalizedEvent.message)
        || isPetSkillSaleCandidate(normalizedEvent.message)
        || isHopePremiumDeleteCandidate(normalizedEvent.message)
        || isHomeFurnitureBagCandidate(normalizedEvent.message)
        || isHomeFurnitureMarketListingCandidate(normalizedEvent.message)
         || isHomeFurnitureCarrotTransferCandidate(normalizedEvent.message)
         || isHomeFurnitureRankCommand(normalizedEvent.message)
         || isHomeRankingReadCommand(normalizedEvent.message)
         || isPlayerRankReadCommandCandidate(normalizedEvent.message)
         || isPlayerLevelResetCommand(normalizedEvent.message)
         || isAdminPlayerInfoReadCandidate(normalizedEvent.message)
         || isDeveloperNoteReadCommand(normalizedEvent.message)
         || isSocialBoardReadCommand(normalizedEvent.message)
         || isLetterBoardCandidate(normalizedEvent.message)
         || isRecordBoardCommandCandidate(normalizedEvent.message)
         || parseGuildAdminDetailCommand(normalizedEvent.message) !== null
         || isGuildProfileReadCommand(normalizedEvent.message)
         || isGuildJoinableListReadCommand(normalizedEvent.message)
         || isPunchFamilyDispatchCandidate(normalizedEvent.message)
         || isPetSkillBoastReadCommand(normalizedEvent.message)
         || isPetAppearanceCommandCandidate(normalizedEvent.message)
         || isPetFeedIntimacyCandidate(normalizedEvent.message)
         || isFreeMarketLifecycleCandidate(normalizedEvent.message)
         || isPlayerTitleSellCandidate(normalizedEvent.message)
         || isCarrotBoardReadCommand(normalizedEvent.message)
         || isCarrotBoardDeleteCommand(normalizedEvent.message)
         || isCarrotBoardCompleteCommand(normalizedEvent.message)
         || isCarrotTemperatureRankReadCommand(normalizedEvent.message)
         || isCarrotBanListReadCommand(normalizedEvent.message)
         || isCarrotBanListAddCommand(normalizedEvent.message)
         || isCarrotBanListRemoveCommand(normalizedEvent.message)
         || isPlayerOverallRankReadCommand(normalizedEvent.message)
         || isPlayerChatRankReadCommand(normalizedEvent.message)
         || isPlayerTitleSelectCandidate(normalizedEvent.message)
         || isPlayerTitleListReadCandidate(normalizedEvent.message)
         || isPlayerTitleInfoReadCandidate(normalizedEvent.message)
         || isPlayerTitleGiftCandidate(normalizedEvent.message)
         || isTitleGiftTicketGrantCandidate(normalizedEvent.message)
         || isHomeFurnitureEquipCandidate(normalizedEvent.message)
        || isHomeFurnitureFullCleanupCommand(normalizedEvent.message)
        || isHomeFurnitureInfoReadCandidate(normalizedEvent.message)
        || isHomeFurnitureMutationCandidate(normalizedEvent.message)
        || isHomeFurnitureStatsReadCommand(normalizedEvent.message)
        || isSocialOwnHeartCandidate(normalizedEvent.message)
        || isPetStatusCommand(normalizedEvent.message)
        || isPetIntimacyRankCommand(normalizedEvent.message)
        || isPetTitleCommandCandidate(normalizedEvent.message)
        || isPetRebirthCommandCandidate(normalizedEvent.message)
        || isPetDuelEmoteCommandCandidate(normalizedEvent.message)
        || isGuildPetSkillStockGrantCandidate(normalizedEvent.message)
        || packageDispatchCandidate
        || packageCatalogAdminDispatchCandidate
        || pointShopCatalogDispatchCandidate
        || commentPinDeleteDispatchCandidate
        || commentDeleteDispatchCandidate
        || commentPinDispatchCandidate
        || legacyDataCleanupDispatchCandidate
        || debugModeDispatchCandidate
        || homeFurnitureEquipSyncDispatchCandidate
        || homeBaseballPitchDispatchCandidate
        || legendaryStoneDrawDispatchCandidate
        || petExploreRecordsResetDispatchCandidate
        || supportPassRegistryDispatchMessage !== undefined
        || passSubscriptionRetiredDispatchCandidate
        || oneDayPassSubscriptionDispatchCandidate
        || oneDayPassDispatchCandidate
        || dailyCommentDispatchCandidate
        || homeLikeDispatchCandidate
        || legacyLikeDispatchCandidate
        || homeProfileViewDispatchCandidate
        || homeActivityAlertReadDispatchCandidate
        || homeFeedMutationDispatchCandidate
        || homeBadgeInventoryDispatchCandidate
        || homeBadgeGachaDispatchCandidate
        || homeBadgeCubeDispatchCandidate
        || inventoryWalletRngOpenDispatchCandidate
        || inventoryFortunePouchDispatchCandidate
        || homeHeartExpressionDispatchCandidate
        || supportPremiumNoticeDispatchCandidate
        || guildBoardDispatchCandidate
        || homeBadgeEquipDispatchCandidate
        || homeBadgePermanentDeleteDispatchCandidate
        || homeCommentFileBootstrapDispatchCandidate
         || homeVisitResetDispatchCandidate
         || homeSocialBadgeMigrationDispatchCandidate
         || homePassReformCleanupDispatchCandidate
         || homeFeedMigrationDispatchCandidate
         || homeActivityRestoreDispatchCandidate
         || homeActivityFileBootstrapDispatchCandidate
         || packageCatalogWizardControlCandidate
        || packageCatalogWizardActiveInput;
      const partialDispatchEnabled = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED === "true"
        || (config.nodeEnv !== "production" && process.env.PARTIAL_COMMAND_DISPATCH_ENABLED !== "false");
      const petSkillDispatchMessage = resolvePetSkillDispatchMessage(normalizedEvent.message);
      const partialDispatchDecision = database !== undefined
        && normalizedEvent.direction === "incoming"
        && partialDispatchCandidate
        ? await new CommandDispatcher(new MariaCommandDispatchRepository(database), {
          enabled: partialDispatchEnabled,
          allowAllCanaries: config.nodeEnv !== "production",
          canaryUserIds: parseCanaryUserIds(process.env.PARTIAL_COMMAND_CANARY_USER_IDS)
        }).resolve({
          eventId: normalizedEvent.eventId,
          message: isSocialOwnHeartCandidate(normalizedEvent.message)
            ? normalizeSocialOwnHeartDispatchMessage(normalizedEvent.message ?? "")
            : isHomeFurnitureMutationCandidate(normalizedEvent.message)
            ? normalizeHomeFurnitureMutationDispatchMessage(normalizedEvent.message ?? "")
             : isHomeFurnitureRankCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isHomeRankingReadCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isPlayerRankReadCommandCandidate(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isPlayerLevelResetCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isAdminPlayerInfoReadCandidate(normalizedEvent.message)
             ? normalizeAdminPlayerInfoReadDispatchMessage(normalizedEvent.message ?? "")
             : isDeveloperNoteReadCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isSocialBoardReadCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isLetterBoardCandidate(normalizedEvent.message)
             ? normalizeLetterBoardDispatchMessage(normalizedEvent.message ?? "")
             : isRecordBoardCommandCandidate(normalizedEvent.message)
             ? normalizeRecordBoardCommand(normalizedEvent.message)!
             : parseGuildAdminDetailCommand(normalizedEvent.message) !== null
             ? normalizeGuildAdminDetailDispatchMessage(normalizedEvent.message ?? "")
             : isPunchFamilyDispatchCandidate(normalizedEvent.message)
             ? normalizePunchFamilyDispatchMessage(normalizedEvent.message ?? "")
             : isPetAppearanceCommandCandidate(normalizedEvent.message)
             ? normalizePetAppearanceDispatchMessage(normalizedEvent.message ?? "")
             : isPetFeedIntimacyCandidate(normalizedEvent.message)
             ? normalizePetFeedIntimacyCommand(normalizedEvent.message)!
             : isFreeMarketLifecycleCandidate(normalizedEvent.message)
             ? normalizeFreeMarketLifecycleDispatchMessage(normalizedEvent.message ?? "")
             : isPlayerTitleSellCandidate(normalizedEvent.message)
             ? normalizePlayerTitleSellDispatchMessage(normalizedEvent.message ?? "")
             : isCarrotBoardReadCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isCarrotBoardDeleteCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isCarrotBoardCompleteCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isCarrotTemperatureRankReadCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isCarrotBanListReadCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isCarrotBanListAddCommand(normalizedEvent.message)
             ? normalizeCarrotBanListAddDispatchMessage(normalizedEvent.message) ?? ""
             : isCarrotBanListRemoveCommand(normalizedEvent.message)
             ? normalizeCarrotBanListRemoveDispatchMessage(normalizedEvent.message) ?? ""
             : isPlayerOverallRankReadCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isPlayerChatRankReadCommand(normalizedEvent.message)
             ? normalizedEvent.message ?? ""
             : isPlayerTitleSelectCandidate(normalizedEvent.message)
             ? normalizePlayerTitleSelectDispatchMessage(normalizedEvent.message ?? "")
             : isPlayerTitleListReadCandidate(normalizedEvent.message)
             ? normalizePlayerTitleListReadDispatchMessage(normalizedEvent.message ?? "")
             : isPlayerTitleInfoReadCandidate(normalizedEvent.message)
             ? normalizePlayerTitleInfoReadDispatchMessage(normalizedEvent.message ?? "")
             : isPlayerTitleGiftCandidate(normalizedEvent.message)
             ? normalizePlayerTitleGiftDispatchMessage(normalizedEvent.message ?? "")
             : isTitleGiftTicketGrantCandidate(normalizedEvent.message)
             ? normalizeTitleGiftTicketGrantDispatchMessage(normalizedEvent.message ?? "")
             : isHomeFurnitureInfoReadCandidate(normalizedEvent.message)
            ? normalizeHomeFurnitureInfoReadDispatchMessage(normalizedEvent.message ?? "")
            : isHomeFurnitureFullCleanupCommand(normalizedEvent.message)
            ? normalizedEvent.message ?? ""
            : isHomeFurnitureEquipCandidate(normalizedEvent.message)
            ? normalizeHomeFurnitureEquipDispatchMessage(normalizedEvent.message ?? "")
            : isHomeFurnitureCarrotTransferCandidate(normalizedEvent.message)
            ? normalizeHomeFurnitureCarrotTransferDispatchMessage(normalizedEvent.message ?? "")
            : isHomeFurnitureMarketListingCandidate(normalizedEvent.message)
            ? normalizeHomeFurnitureMarketListingDispatchMessage(normalizedEvent.message ?? "")
            : isHomeFurnitureBagCandidate(normalizedEvent.message)
            ? normalizeHomeFurnitureBagDispatchMessage(normalizedEvent.message ?? "")
            : isHopePremiumDeleteCandidate(normalizedEvent.message)
            ? normalizeHopePremiumDeleteDispatchMessage(normalizedEvent.message ?? "")
            : petSkillDispatchMessage !== undefined
            ? petSkillDispatchMessage
            : isGuildPetSkillStockGrantCandidate(normalizedEvent.message)
            ? normalizeGuildPetSkillStockGrantDispatchMessage(normalizedEvent.message ?? "")
            : isPetDuelEmoteCommandCandidate(normalizedEvent.message)
            ? normalizePetDuelEmoteDispatchMessage(normalizedEvent.message ?? "")
            : isPetRebirthCommandCandidate(normalizedEvent.message)
            ? normalizePetRebirthDispatchMessage(normalizedEvent.message ?? "")
            : isPetTitleCommandCandidate(normalizedEvent.message)
            ? normalizePetTitleDispatchMessage(normalizedEvent.message ?? "")
            : isPendantDeleteCommandCandidate(normalizedEvent.message)
            ? normalizePendantDeleteDispatchMessage(normalizedEvent.message ?? "")
            : isPendantRestoreCommandCandidate(normalizedEvent.message)
            ? normalizePendantRestoreDispatchMessage(normalizedEvent.message ?? "")
            : isPendantCarrotTradeCommandCandidate(normalizedEvent.message)
            ? normalizePendantCarrotTradeDispatchMessage(normalizedEvent.message ?? "")
            : isMiniPetCarrotTradeCandidate(normalizedEvent.message)
            ? normalizeMiniPetCarrotTradeDispatchMessage(normalizedEvent.message ?? "")
            : isPendantDurabilityCorrectionCommandCandidate(normalizedEvent.message)
            ? normalizePendantDurabilityCorrectionDispatchMessage(normalizedEvent.message ?? "")
            : isPendantMarketInfoCommandCandidate(normalizedEvent.message)
            ? normalizePendantMarketInfoDispatchMessage(normalizedEvent.message ?? "")
            : isPendantMarketRegisterCommandCandidate(normalizedEvent.message)
            ? normalizePendantMarketRegisterDispatchMessage(normalizedEvent.message ?? "")
            : isPendantEnhanceCorrectionCommandCandidate(normalizedEvent.message)
            ? normalizePendantEnhanceCorrectionDispatchMessage(normalizedEvent.message ?? "")
            : isPendantEnhanceCommandCandidate(normalizedEvent.message)
            ? normalizePendantEnhanceDispatchMessage(normalizedEvent.message ?? "")
             : isPendantBagCleanupCommandCandidate(normalizedEvent.message)
             ? normalizePendantBagCleanupDispatchMessage(normalizedEvent.message ?? "")
             : isPendantDrawOpenCommandCandidate(normalizedEvent.message)
             ? normalizePendantDrawOpenDispatchMessage(normalizedEvent.message ?? "")
             : isPendantEquipCommandCandidate(normalizedEvent.message)
             ? normalizePendantEquipDispatchMessage(normalizedEvent.message ?? "")
             : isMiniPetEquipOrBulkCleanupCommand(normalizedEvent.message)
             ? normalizeMiniPetEquipOrBulkCleanupDispatchMessage(normalizedEvent.message ?? "")
             : isPendantEquipResetCommandCandidate(normalizedEvent.message)
             ? normalizePendantEquipResetDispatchMessage(normalizedEvent.message ?? "")
             : isPendantInfoCommandCandidate(normalizedEvent.message)
             ? normalizePendantInfoDispatchMessage(normalizedEvent.message ?? "")
             : isPendantGrantCommandCandidate(normalizedEvent.message)
             ? normalizePendantGrantDispatchMessage(normalizedEvent.message ?? "")
             : isPendantSellCommandCandidate(normalizedEvent.message)
             ? normalizePendantSellDispatchMessage(normalizedEvent.message ?? "")
            : packageDispatchCandidate
            ? normalizePackageDispatchMessage(normalizedEvent.message ?? "")
            : packageCatalogAdminDispatchCandidate
              ? normalizePackageCatalogAdminDispatchMessage(normalizedEvent.message ?? "")
              : pointShopCatalogDispatchCandidate
                ? normalizePointShopCatalogDispatchMessage(normalizedEvent.message ?? "")
                : commentPinDeleteDispatchCandidate
                  ? normalizeCommentPinDeleteDispatchMessage(normalizedEvent.message ?? "")
                : commentDeleteDispatchCandidate
                  ? normalizeCommentDeleteDispatchMessage(normalizedEvent.message ?? "")
                : commentPinDispatchCandidate
                  ? normalizeCommentPinDispatchMessage(normalizedEvent.message ?? "")
                : legacyDataCleanupDispatchCandidate
                  ? normalizeLegacyDataCleanupDispatchMessage(normalizedEvent.message ?? "")
                : debugModeDispatchCandidate
                  ? normalizeDebugModeDispatchMessage(normalizedEvent.message ?? "")
                : homeFurnitureEquipSyncDispatchCandidate
                  ? normalizeHomeFurnitureEquipSyncDispatchMessage(normalizedEvent.message ?? "")
                : homeBaseballPitchDispatchCandidate
                  ? normalizeHomeBaseballPitchDispatchMessage(normalizedEvent.message ?? "")
                : legendaryStoneDrawDispatchCandidate
                  ? normalizeLegendaryStoneDrawDispatchMessage(normalizedEvent.message ?? "")
                : petExploreRecordsResetDispatchCandidate
                  ? normalizePetExploreRecordsResetDispatchMessage(normalizedEvent.message ?? "")
                : supportPassRegistryDispatchMessage !== undefined
                  ? supportPassRegistryDispatchMessage
                : passSubscriptionRetiredDispatchCandidate
                  ? normalizePassSubscriptionRetiredDispatchMessage(normalizedEvent.message ?? "")
                : oneDayPassSubscriptionDispatchCandidate
                  ? normalizeOneDayPassSubscriptionDispatchMessage(normalizedEvent.message ?? "")
                : oneDayPassDispatchCandidate
                  ? normalizeOneDayPassDispatchMessage(normalizedEvent.message ?? "")
                : dailyCommentDispatchCandidate
                  ? normalizeDailyCommentDispatchMessage(normalizedEvent.message ?? "")
                : homeLikeDispatchCandidate
                  ? normalizeHomeLikeDispatchMessage(normalizedEvent.message ?? "")
                : legacyLikeDispatchCandidate
                  ? normalizeLegacyLikeDispatchMessage(normalizedEvent.message ?? "")
                : homeProfileViewDispatchCandidate
                  ? normalizeHomeProfileViewDispatchMessage(normalizedEvent.message ?? "")
                : homeActivityAlertReadDispatchCandidate
                  ? normalizeHomeActivityAlertReadDispatchMessage(normalizedEvent.message ?? "")
                : homeFeedMutationDispatchCandidate
                  ? normalizeHomeFeedMutationDispatchMessage(normalizedEvent.message ?? "")
                : homeBadgeInventoryDispatchCandidate
                  ? normalizeHomeBadgeInventoryDispatchMessage(normalizedEvent.message ?? "")
                : homeBadgeGachaDispatchCandidate
                  ? normalizeHomeBadgeGachaDispatchMessage(normalizedEvent.message ?? "")
                : homeBadgeCubeDispatchCandidate
                  ? normalizeHomeBadgeCubeDispatchMessage(normalizedEvent.message ?? "")
                : inventoryWalletRngOpenDispatchCandidate
                  ? normalizeInventoryWalletRngOpenDispatchMessage(normalizedEvent.message ?? "")
                : inventoryFortunePouchDispatchCandidate
                  ? normalizeInventoryFortunePouchDispatchMessage(normalizedEvent.message ?? "")
                : homeHeartExpressionDispatchCandidate
                  ? normalizeHomeHeartExpressionDispatchMessage(normalizedEvent.message ?? "")
                : supportPremiumNoticeDispatchCandidate
                  ? normalizeSupportPremiumNoticeDispatchMessage(normalizedEvent.message ?? "")
                : guildBoardDispatchCandidate
                  ? normalizeGuildBoardDispatchMessage(normalizedEvent.message ?? "")
                : homeBadgeEquipDispatchCandidate
                  ? normalizeHomeBadgeEquipDispatchMessage(normalizedEvent.message ?? "")
                : homeBadgePermanentDeleteDispatchCandidate
                  ? normalizeHomeBadgePermanentDeleteDispatchMessage(normalizedEvent.message ?? "")
                : homeCommentFileBootstrapDispatchCandidate
                  ? normalizeHomeCommentFileBootstrapDispatchMessage(normalizedEvent.message ?? "")
                : homeVisitResetDispatchCandidate
                  ? normalizeHomeVisitResetDispatchMessage(normalizedEvent.message ?? "")
                : homeSocialBadgeMigrationDispatchCandidate
                  ? normalizeHomeSocialBadgeMigrationDispatchMessage(normalizedEvent.message ?? "")
                : homePassReformCleanupDispatchCandidate
                  ? normalizeHomePassReformCleanupDispatchMessage(normalizedEvent.message ?? "")
                : homeFeedMigrationDispatchCandidate
                  ? normalizeHomeFeedMigrationDispatchMessage(normalizedEvent.message ?? "")
                : homeActivityRestoreDispatchCandidate
                  ? normalizeHomeActivityRestoreDispatchMessage(normalizedEvent.message ?? "")
                : homeActivityFileBootstrapDispatchCandidate
                  ? normalizeHomeActivityFileBootstrapDispatchMessage(normalizedEvent.message ?? "")
               : isHappyFoundationCommand(normalizedEvent.message)
                ? normalizeHappyFoundationDispatchMessage(normalizedEvent.message ?? "")
              : isDiamondBoxCraftCommand(normalizedEvent.message)
                ? normalizeDiamondBoxCraftDispatchMessage(normalizedEvent.message ?? "")
              : isAdminDiamondEditCommand(normalizedEvent.message)
                ? normalizeAdminDiamondEditDispatchMessage(normalizedEvent.message ?? "")
              : isAdminAccountSuspensionCommand(normalizedEvent.message)
                ? normalizeAdminAccountSuspensionDispatchMessage(normalizedEvent.message ?? "")
              : isAdminDiamondResetAllCommand(normalizedEvent.message)
                ? normalizeAdminDiamondResetAllDispatchMessage(normalizedEvent.message ?? "")
              : isAdminPackageDeleteCommand(normalizedEvent.message)
                ? normalizeAdminPackageDeleteDispatchMessage(normalizedEvent.message ?? "")
              : isAdminGlobalGiftCommand(normalizedEvent.message)
                ? normalizeAdminGlobalGiftDispatchMessage(normalizedEvent.message ?? "")
              : isMiniPetRankRewardPayoutCommand(normalizedEvent.message)
                ? normalizeMiniPetRankRewardPayoutDispatchMessage(normalizedEvent.message ?? "")
              : isTierRewardPayoutCommand(normalizedEvent.message)
                ? normalizeTierRewardPayoutDispatchMessage(normalizedEvent.message ?? "")
              : isMiniPetBindingReleaseCommand(normalizedEvent.message)
                ? normalizeMiniPetBindingReleaseDispatchMessage(normalizedEvent.message ?? "")
              : isOperationNoticeCommandCandidate(normalizedEvent.message)
                ? normalizeOperationNoticeDispatchMessage(normalizedEvent.message ?? "")
              : isFirstSponsorCommandCandidate(normalizedEvent.message)
                ? normalizeFirstSponsorDispatchMessage(normalizedEvent.message ?? "")
                : normalizedEvent.message ?? "",
          userId: normalizedEvent.userId,
          hasTrustedDisplayName: commandEvent.displayNameTrust === "trusted"
        })
        : undefined;
      const isDiagnosticMembership = channelAccess.mode === "diagnostic" && isMembershipEvent;
      const eventProcessor = database === undefined
        || (!isOperationalChannel && !isObservationChannel && !isDiagnosticModeration && !isDiagnosticMembership)
        ? undefined
        : new ProcessIrisEventService(database);
      const channelNameObservation: ChannelNameObservation | undefined = kakaoDatabaseSnapshot?.roomName === undefined
        || kakaoDatabaseSnapshot.roomNameSource === "unavailable"
        ? undefined
        : { displayName: kakaoDatabaseSnapshot.roomName, sourceCode: kakaoDatabaseSnapshot.roomNameSource === "open_link" ? "kakao_open_link" : "kakao_chat_room_meta" };
      const atomicPetSkillProbability = database !== undefined && isOperationalChannel
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pet_skill_probability"
        && isPetSkillProbabilityCommand(normalizedEvent.message);
      if (atomicPetSkillProbability && dependencies.environmentContext === undefined) {
        throw new Error("PET_SKILL_PROBABILITY_VERIFIED_ENVIRONMENT_REQUIRED");
      }
      const processing = atomicPetSkillProbability
        ? await processPetSkillProbabilityAtomicIngress({
            database: database!, event: normalizedEvent, replyIdentity: commandEvent,
            environmentContext: dependencies.environmentContext!,
            channelType: channelAccess.channelClass === "open_direct" ? "open_direct" : "open_group",
            ...(channelNameObservation === undefined ? {} : { channelName: channelNameObservation })
          })
        : eventProcessor === undefined
        ? undefined
        : isOperationalChannel || isObservationChannel || isDiagnosticMembership
          ? await eventProcessor.execute(normalizedEvent, commandEvent, channelAccess.channelClass === "open_direct"
            ? "open_direct"
            : "open_group", {
              allowCommands: isOperationalChannel,
              ...(channelNameObservation === undefined ? {} : { channelName: channelNameObservation })
            })
          : await eventProcessor.executeDiagnosticModeration(normalizedEvent);
      await dispatchAccountSwitchCommand(
        accountPlatformIrisContextProvider,
        eventProcessor,
        isOperationalChannel,
        processing?.duplicate,
        commandEvent,
        processing?.replies,
      );
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && (partialDispatchDecision.handlerKey === "PACKAGE_BAG"
          || partialDispatchDecision.handlerKey === "PACKAGE_USE")) {
        const packageResponse = await new PackageIrisCommandHandler(database).execute(normalizedEvent);
        processing.replies.push(await eventProcessor.queueCommandReply(
          normalizedEvent,
          packageResponse.commandCode,
          packageResponse.message,
        ));
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && (partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_ADD"
          || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_EDIT"
          || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_REMOVE"
          || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_ENABLE")) {
        const catalogResponse = await new PackageCatalogAdminIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({
          outboxId: catalogResponse.outboxId,
          room: normalizedEvent.channelId!,
          data: catalogResponse.message,
        });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && (partialDispatchDecision.handlerKey === "POINT_SHOP_CATALOG_READ"
          || partialDispatchDecision.handlerKey === "POINT_SHOP_CATALOG_UPSERT"
          || partialDispatchDecision.handlerKey === "POINT_SHOP_CATALOG_REMOVE"
          || partialDispatchDecision.handlerKey === "DIAMOND_SHOP_CATALOG_READ"
          || partialDispatchDecision.handlerKey === "DIAMOND_SHOP_BUY")) {
        const shopResponse = await new PointShopCatalogIrisHandler(database).execute(normalizedEvent);
        processing.replies.push(shopResponse.outboxId
          ? { outboxId: shopResponse.outboxId, room: normalizedEvent.channelId!, data: shopResponse.message }
          : await eventProcessor.queueCommandReply(normalizedEvent, shopResponse.commandCode, shopResponse.message));
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "HOME_COMMENT_PIN_DELETE") {
        const pinResponse = await new CommentPinDeleteIrisHandler(database).execute(normalizedEvent);
        processing.replies.push(pinResponse.outboxId
          ? { outboxId: pinResponse.outboxId, room: normalizedEvent.channelId!, data: pinResponse.message }
          : await eventProcessor.queueCommandReply(normalizedEvent, "HOME_COMMENT_PIN_DELETE", pinResponse.message));
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "HOME_COMMENT_DELETE") {
        const commentResponse = await new CommentDeleteIrisHandler(database).execute(normalizedEvent);
        processing.replies.push(commentResponse.outboxId
          ? { outboxId: commentResponse.outboxId, room: normalizedEvent.channelId!, data: commentResponse.message }
          : await eventProcessor.queueCommandReply(normalizedEvent, "HOME_COMMENT_DELETE", commentResponse.message));
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "HOME_COMMENT_PIN") {
        const pinAddResponse = await new CommentPinIrisHandler(database).execute(normalizedEvent);
        processing.replies.push(pinAddResponse.outboxId
          ? { outboxId: pinAddResponse.outboxId, room: normalizedEvent.channelId!, data: pinAddResponse.message }
          : await eventProcessor.queueCommandReply(normalizedEvent, "HOME_COMMENT_PIN", pinAddResponse.message));
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "ADMIN_LEGACY_DATA_CLEANUP") {
        const cleanupResponse = await new LegacyDataCleanupIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: cleanupResponse.outboxId, room: normalizedEvent.channelId!, data: cleanupResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "ADMIN_DEBUG_MODE") {
        const debugResponse = await new DebugModeIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: debugResponse.outboxId, room: normalizedEvent.channelId!, data: debugResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_furniture_equip_sync") {
        const syncResponse = await new HomeFurnitureEquipSyncIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: syncResponse.outboxId, room: normalizedEvent.channelId!, data: syncResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_baseball_pitch") {
        const baseballResponses = await new HomeBaseballPitchIrisHandler(database).execute(normalizedEvent);
        for (const response of baseballResponses) processing.replies.push({ outboxId: response.outboxId, room: normalizedEvent.channelId!, data: response.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "legendary_stone_draw") {
        const drawResponses = await new LegendaryStoneDrawIrisHandler(database, config.irisAllowedOpenChatIds).execute(normalizedEvent);
        for (const response of drawResponses) processing.replies.push({ outboxId: response.outboxId, room: response.room, data: response.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pet_explore_records_reset") {
        const resetResponse = await new PetExploreRecordsResetIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: resetResponse.outboxId, room: resetResponse.room, data: resetResponse.message });
      }
      await dispatchSupportPassRegistryCommand(database, eventProcessor, processing?.duplicate, partialDispatchDecision?.route, partialDispatchDecision?.handlerKey, normalizedEvent, processing?.replies);
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pass_subscription_retired") {
        const passResponse = await new PassSubscriptionRetiredIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: passResponse.outboxId, room: passResponse.room, data: passResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "one_day_pass_subscription") {
        const passResponse = await new OneDayPassSubscriptionIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: passResponse.outboxId, room: passResponse.room, data: passResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "one_day_pass_registry") {
        const passResponse = await new OneDayPassIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: passResponse.outboxId, room: passResponse.room, data: passResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && (partialDispatchDecision.handlerKey === "home_comment_action" || partialDispatchDecision.handlerKey === "home_like_action" || partialDispatchDecision.handlerKey === "legacy_social_like" || partialDispatchDecision.handlerKey === "home_profile_view" || partialDispatchDecision.handlerKey === "home_activity_alert_read" || partialDispatchDecision.handlerKey === "home_feed_mutate" || (partialDispatchDecision.handlerKey as string) === "home_badge_gacha_open" || (partialDispatchDecision.handlerKey as string) === "home_badge_cube" || (partialDispatchDecision.handlerKey as string) === "inventory_wallet_rng_open" || (partialDispatchDecision.handlerKey as string) === "guild_board")) {
        const homeResponse = partialDispatchDecision.handlerKey === "home_like_action"
          ? await new HomeLikeIrisHandler(database).execute(normalizedEvent)
          : partialDispatchDecision.handlerKey === "legacy_social_like"
            ? await new LegacyLikeIrisHandler(database).execute(normalizedEvent)
          : partialDispatchDecision.handlerKey === "home_profile_view"
            ? await new HomeProfileViewIrisHandler(database).execute(normalizedEvent)
            : partialDispatchDecision.handlerKey === "home_activity_alert_read"
              ? await new HomeActivityAlertReadIrisHandler(database).execute(normalizedEvent)
            : partialDispatchDecision.handlerKey === "home_feed_mutate"
              ? await new HomeFeedMutationIrisHandler(database).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "home_badge_inventory_read"
              ? await new HomeBadgeInventoryIrisHandler(database).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "home_badge_gacha_open"
              ? await new HomeBadgeGachaIrisHandler(database, (process.env.HOME_BADGE_GACHA_BROADCAST_IDS ?? "").split(",").map(value => value.trim()).filter(value => value !== "")).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "home_badge_cube"
              ? await new HomeBadgeCubeIrisHandler(database, (process.env.HOME_BADGE_CUBE_BROADCAST_IDS ?? "").split(",").map(value => value.trim()).filter(value => value !== "")).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "inventory_wallet_rng_open"
              ? await new InventoryWalletRngOpenIrisHandler(database).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "inventory_fortune_pouch_open"
              ? await new InventoryFortunePouchIrisHandler(database).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "home_heart_expression"
              ? await new HomeHeartExpressionIrisHandler(database).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "support_premium_notice_send"
              ? await new SupportPremiumNoticeIrisHandler(database, process.env.SUPPORT_PREMIUM_NOTICE_BROADCAST_DESTINATION_ID ?? "broadcast:all").execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "guild_board"
              ? await new GuildBoardIrisHandler(database).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "home_badge_equip"
              ? await new HomeBadgeEquipIrisHandler(database).execute(normalizedEvent)
            : (partialDispatchDecision.handlerKey as string) === "home_badge_permanent_delete"
              ? await new HomeBadgePermanentDeleteIrisHandler(database).execute(normalizedEvent)
            : await new DailyCommentIrisHandler(database).execute(normalizedEvent);
        if (homeResponse !== null) processing.replies.push({ outboxId: homeResponse.outboxId, room: homeResponse.room, data: homeResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_comment_file_bootstrap") {
        const bootstrapResponse = await new HomeCommentFileBootstrapIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: bootstrapResponse.outboxId, room: normalizedEvent.channelId!, data: bootstrapResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_visit_reset") {
        const visitResetResponse = await new HomeVisitResetIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: visitResetResponse.outboxId, room: normalizedEvent.channelId!, data: visitResetResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_social_badge_migration") {
        const migrationResponse = await new HomeSocialBadgeMigrationIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: migrationResponse.outboxId, room: normalizedEvent.channelId!, data: migrationResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_pass_reform_cleanup") {
        const cleanupResponse = await new HomePassReformCleanupIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: cleanupResponse.outboxId, room: normalizedEvent.channelId!, data: cleanupResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_feed_migration") {
        const migrationResponse = await new HomeFeedMigrationIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: migrationResponse.outboxId, room: normalizedEvent.channelId!, data: migrationResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_activity_restore") {
        const restoreResponse = await new HomeActivityRestoreIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: restoreResponse.outboxId, room: normalizedEvent.channelId!, data: restoreResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "home_activity_file_bootstrap") {
        const bootstrapResponse = await new HomeActivityFileBootstrapIrisHandler(database).execute(normalizedEvent);
        processing.replies.push({ outboxId: bootstrapResponse.outboxId, room: normalizedEvent.channelId!, data: bootstrapResponse.message });
      }
      if (database !== undefined
        && eventProcessor !== undefined
        && processing !== undefined
        && !processing.duplicate
        && packageCatalogWizardHandler !== undefined
        && (packageCatalogWizardActiveInput
          || (partialDispatchDecision?.route === "MODERN"
            && (partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_WIZARD_GUIDE"
              || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_WIZARD_START"
              || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_WIZARD_CANCEL"
              || partialDispatchDecision.handlerKey === "PACKAGE_CATALOG_WIZARD_STATUS")))) {
        const wizardResponse = await packageCatalogWizardHandler.execute(normalizedEvent);
        if (wizardResponse.outboxId) {
          processing.replies.push({ outboxId: wizardResponse.outboxId, room: normalizedEvent.channelId!, data: wizardResponse.message });
        } else {
          processing.replies.push(await eventProcessor.queueCommandReply(normalizedEvent, wizardResponse.commandCode, wizardResponse.message));
        }
      }
      const isRetainedContentChannel = commandEvent.channelId !== undefined
        && (isOperationalChannel || isObservationChannel);
      const isWithinRetainedContentScope = isRetainedContentChannel
        && (config.retainedEventContentScope === "all_verified_open"
          || retainedContentChannelIds.has(commandEvent.channelId!));
      if (config.retainedEventContentEnabled && isWithinRetainedContentScope && retainIrisEventContent !== undefined
        && (processing === undefined || !processing.duplicate)) {
        try {
          await retainIrisEventContent(request.body, commandEvent);
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "retained_event_content.failed");
        }
      }
      let membershipSummary: MembershipLogSummary | null | undefined;
      if (database !== undefined && processing !== undefined && !processing.duplicate
        && isMembershipEvent && commandEvent.channelId !== undefined && commandEvent.userId !== undefined) {
        try {
          membershipSummary = await new MembershipLogService(database)
            .getSummary(commandEvent.channelId, commandEvent.userId);
        } catch (error) {
          request.log.warn({ requestId: request.id, err: error }, "membership.summary_unavailable");
        }
      }
      const eventMonitorMessage = shouldCreateEventMonitorMessage
        ? formatIrisEventMonitorMessage(
            request.body,
            commandEvent,
            kakaoDatabaseSnapshot?.roomName,
            processing?.incidentId,
            membershipSummary ?? undefined
          )
        : undefined;

      if (isInteractiveChannel && moderationIncidentNumber !== null && database !== undefined
        && commandEvent.channelId !== undefined) {
        const incidentService = new ModerationIncidentService(database);
        const incident = await incidentService.findByNumber(moderationIncidentNumber);
        let incidentReply: string;
        if (incident === null) {
          incidentReply = `🔎 [삭제 메시지 열람]\n⚠️ 열람 번호 #${moderationIncidentNumber}을(를) 찾을 수 없습니다.`;
        } else {
          const isSourceRoom = commandEvent.channelId === incident.sourceChannelId;
          const isMonitoringRoom = commandEvent.channelId === config.irisEventMonitorRoomId;
          if (!isSourceRoom && !isMonitoringRoom) {
            incidentReply = "🔎 [삭제 메시지 열람]\n⚠️ 삭제가 감지된 방 또는 모니터링방에서만 열람할 수 있습니다.";
          } else {
            const incidentSnapshot = await inspectIrisKakaoDatabase(incident.lookupEvent);
            incidentReply = formatModerationIncidentReadMessage({
              incidentId: incident.incidentId,
              incidentType: incident.incidentType,
              roomName: incidentSnapshot.roomName,
              displayName: incidentSnapshot.nicknameSource === "iris_sender"
                ? undefined
                : incidentSnapshot.nickname,
              originalMessage: readOriginalMessage(incidentSnapshot)
            });
          }
        }
        if (processing !== undefined && !processing.duplicate) {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            commandEvent,
            "moderation_incident_read",
            incidentReply
          ));
        } else if (processing === undefined) {
          try {
            await replyToIris({ room: commandEvent.channelId, data: incidentReply });
            request.log.info({ requestId: request.id }, "iris.moderation_incident_read.sent");
          } catch (error) {
            request.log.error({ requestId: request.id, err: error }, "iris.moderation_incident_read.failed");
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.message === "/info"
        && commandEvent.channelId !== undefined && kakaoDatabaseSnapshot !== undefined) {
        const diagnosticChunks = splitIrisKakaoDiagnostic(
          formatIrisKakaoDiagnostic(request.body, normalizedEvent, kakaoDatabaseSnapshot)
        );
        for (const [index, diagnosticChunk] of diagnosticChunks.entries()) {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            commandEvent,
            `iris_kakao_database_info_${index + 1}`,
            diagnosticChunk
          ));
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.message === "/내정보"
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "USER_PROFILE"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const profile = await new GetMyProfileService(new MariaProfileRepository(database!))
            .execute("kakao", normalizedEvent.userId);
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent,
            "my_profile",
            formatLegacyMyProfile(profile)
          ));
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "IDENTITY_MAPPING_REQUIRED") {
            request.log.warn({ requestId: request.id }, "iris.profile.identity_mapping_required");
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && isBagCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const bag = await new GetBagService(new MariaBagRepository(database!))
            .execute("kakao", normalizedEvent.userId);
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent,
            "bag_read",
            formatLegacyBag(bag)
          ));
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "IDENTITY_MAPPING_REQUIRED") {
            request.log.warn({ requestId: request.id }, "iris.bag.identity_mapping_required");
          } else {
            throw error;
          }
        }
      }

      await dispatchPetExploreCommandConsumers(petExploreAppWiringIngress,isOperationalChannel,processing?.duplicate,normalizedEvent);
      const petDataCompareDisposition = await dispatchPetDataCompareCommand(
        petDataCompareAppWiringIngress,
        isOperationalChannel,
        processing?.duplicate,
        normalizedEvent,
      );

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isBagAttributeCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new BagAttributeService(new MariaBagAttributeRepository(database!)).handle({
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.outboxId !== undefined && result.data !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } else if (result.status !== "ignored_forbidden" && result.data !== undefined) {
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "bag_attribute_validation", result.data));
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isBagAddCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new BagAddService(new MariaBagAddRepository(database!)).handle({
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.outboxId !== undefined && result.data !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } else if (result.status !== "ignored_forbidden" && result.data !== undefined) {
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "bag_add_validation", result.data));
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isInventorySnapshotCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new InventorySnapshotService(new MariaInventorySnapshotRepository(database!)).handle({
          externalUserId: normalizedEvent.userId,
          channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result.outboxId !== undefined && result.data !== undefined) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.message?.startsWith("/서버이동 ")
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new IrisAdminCommandService(database!).changePlayerServer({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "change_player_server", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && petDataCompareDisposition !== "claimed"
        && isPointEditCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await irisAdminCommandService!.changePlayerPoint({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "changed") {
            const replies = result.replies ?? [{ outboxId: result.outboxId, data: result.data }];
            for (const reply of replies) {
              processing.replies.push({ outboxId: reply.outboxId, room: reply.room ?? normalizedEvent.channelId, data: reply.data });
            }
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "admin_point_edit_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isAdminDiamondEditCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "admin_diamond_edit"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new AdminDiamondEditService(database!).handle({
            externalUserId: normalizedEvent.userId, channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!, eventId: normalizedEvent.eventId
          });
          if (result.status === "changed") {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "admin_diamond_edit_error", error.message));
          } else {
            throw error;
          }
        }
      }
      processing?.replies.push(...await dispatchAdminAccountSuspensionCommand({
        database: database!,
        isOperationalChannel,
        duplicate: processing?.duplicate,
        route: partialDispatchDecision?.route,
        handlerKey: partialDispatchDecision?.handlerKey,
        externalUserId: normalizedEvent.userId,
        channelId: normalizedEvent.channelId,
        message: normalizedEvent.message,
        eventId: normalizedEvent.eventId,
        queueError: (code, message) => eventProcessor!.queueCommandReply(normalizedEvent, code, message)
      }));

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isOperationNoticeCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "operation_notice_mutate"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new OperationNoticeService(database!).handle({
            externalUserId: normalizedEvent.userId, channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!, eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 409, 422, 503].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "operation_notice_mutate_error", error.message));
          } else throw error;
        }
      }

      processing?.replies.push(...await dispatchAdminGlobalGiftCommand({database:database!,isOperationalChannel,duplicate:processing?.duplicate,route:partialDispatchDecision?.route,handlerKey:partialDispatchDecision?.handlerKey,eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,channelId:normalizedEvent.channelId,message:normalizedEvent.message,queueError:(code,message)=>eventProcessor!.queueCommandReply(normalizedEvent,code,message)}));

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && ((isAdminDiamondResetAllCommand(normalizedEvent.message) && partialDispatchDecision?.handlerKey === "admin_diamond_reset_all")
          || isTierCommandDispatch(normalizedEvent.message, partialDispatchDecision?.handlerKey)
          || (isAdminPackageDeleteCommand(normalizedEvent.message) && partialDispatchDecision?.handlerKey === "admin_package_delete")
          || (isMiniPetRankRewardPayoutCommand(normalizedEvent.message) && partialDispatchDecision?.handlerKey === "mini_pet_rank_reward_payout")
          || (isTierRewardPayoutCommand(normalizedEvent.message) && partialDispatchDecision?.handlerKey === "tier_reward_payout")
          || (isMiniPetBindingReleaseCommand(normalizedEvent.message) && partialDispatchDecision?.handlerKey === "mini_pet_binding_release"))
        && partialDispatchDecision?.route === "MODERN"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const service = partialDispatchDecision.handlerKey === "admin_diamond_reset_all"
            ? new AdminDiamondResetAllService(database!)
            : isTierCommandHandler(partialDispatchDecision.handlerKey)
              ? createTierCommandService(database!, partialDispatchDecision.handlerKey)
            : partialDispatchDecision.handlerKey === "admin_package_delete"
              ? new AdminPackageDeleteService(database!)
              : partialDispatchDecision.handlerKey === "mini_pet_rank_reward_payout"
                ? new MiniPetRankRewardPayoutService(database!)
                : partialDispatchDecision.handlerKey === "tier_reward_payout"
                  ? new TierRewardPayoutService(database!) : new MiniPetBindingReleaseService(database!);
          const result = await service.handle({
            externalUserId: normalizedEvent.userId, channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!, eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: String("data" in result ? result.data : result.reply) });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, `${partialDispatchDecision.handlerKey}_error`, error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isDailyPrayerCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new DailyPrayerIrisCommandService(database!, {
            random: dependencies.dailyPrayerRandom
          }).execute({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "completed") {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "daily_prayer_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isAutoExploreFixedConfigCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new AutoExploreFixedConfigService(database!).handleIris({ externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId, message: normalizedEvent.message!, eventId: normalizedEvent.eventId });
          if (result.status === "completed") processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [404,422].includes(error.statusCode)) processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"auto_explore_fixed_config_error",error.message));
          else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isHappyFoundationCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "happy_foundation"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new HappyFoundationCommandService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.outboxId !== undefined && result.data !== undefined) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "happy_foundation_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isFirstSponsorCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "admin_first_sponsor_registry"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new FirstSponsorRegistryService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "admin_first_sponsor_registry_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isInventoryBulkSellCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "inventory_bulk_sell"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new InventoryBulkSellService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if ((result.status === "sold" || result.status === "nothing_to_sell")
            && result.outboxId !== undefined && result.data !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "inventory_bulk_sell_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && normalizedEvent.direction === "incoming" && isDiamondBoxCraftCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "diamond_box_craft"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new DiamondBoxCraftService(database!).handle({ externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId, message: normalizedEvent.message!, eventId: normalizedEvent.eventId });
          if (result.status !== "ignored_unregistered" && result.outboxId !== undefined && result.data !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"diamond_box_craft_error",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isLetterBoardCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "letter_board"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new LetterBoardService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isRecordBoardCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "record_board"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new RecordBoardService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxIds[result.outboxIds.length - 1]!, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && parseGuildAdminDetailCommand(normalizedEvent.message) !== null
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "guild_admin_detail_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new GuildAdminDetailReadService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildProfileReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "guild_profile_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new GuildProfileReadService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildJoinableListReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "guild_joinable_list_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new GuildJoinableListReadService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSocialPunchReactionCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "social_punch_reaction"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new SocialPunchReactionService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetSkillBoastReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pet_skill_boast_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PetSkillBoastReadService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetAppearanceCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "admin_pet_appearance_set"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new AdminPetAppearanceService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetFeedIntimacyCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pet_feed_intimacy"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PetFeedIntimacyService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerTitleSellCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "player_title_sell"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerTitleSellService(database!).handle({
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId,
          message: normalizedEvent.message!
        });
        if (result !== null && result.status !== "blocked_by_castle_siege" && result.status !== "ignored_unregistered") {
          processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.direction === "incoming"
        && verificationCode !== null
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && commandEvent.displayNameTrust === "trusted" && commandEvent.displayName !== undefined) {
        try {
          const result = await new ProviderVerificationService(database!, config.userVerificationPepper)
            .verifyInitialKakao({
              code: verificationCode,
              externalUserId: normalizedEvent.userId,
              displayName: commandEvent.displayName,
              channelId: normalizedEvent.channelId
            });
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent, "site_signup_kakao_verify", result.data
          ));
        } catch (error) {
          if (error instanceof ApplicationError) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "site_signup_kakao_verify", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetStatusCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pet_status_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PetStatusService(database!).read({
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId,
          idempotencyKey: normalizedEvent.eventId,
          sourceEventId: normalizedEvent.eventId,
        });
        if (result.status === "displayed" && result.data !== null && result.outboxId !== null) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetIntimacyRankCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pet_intimacy_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PetIntimacyRankReadService(database!).read({
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId,
          eventId: normalizedEvent.eventId,
        });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      const petTitleDisposition=await dispatchPetTitleCommand(
        petTitleAppWiringIngress,
        isOperationalChannel,
        processing?.duplicate,
        normalizedEvent,
        processing?.replies,
      );

      if (petTitleDisposition!=="claimed"&&isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetTitleCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pet_title_lifecycle"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetTitleLifecycleService(database!, new PetTitleDefinitionLinkProvider(new MariaPetTitleDefinitionLinkRepository())).handle({
            externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId,
            eventId: normalizedEvent.eventId, message: normalizedEvent.message!,
          });
          if (result.status !== "silent" && result.data !== null && result.outboxId !== null) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_title_lifecycle_error", error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetRebirthCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "pet_rebirth"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetRebirthService(database!).handle({
            externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId,
            eventId: normalizedEvent.eventId, message: normalizedEvent.message!,
            broadcastDestinationIds: config.irisAllowedOpenChatIds,
          });
          for (const commandReply of result.replies) processing.replies.push(commandReply);
        } catch (error) {
          if (error instanceof ApplicationError && [403,404,409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_rebirth_error",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetSkillBagReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "pet_skill_bag_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetSkillBagReadService(database!).read({
            eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId,
            destinationId: normalizedEvent.channelId,
          });
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_bag_read",result.reply));
        } catch (error) {
          if (error instanceof ApplicationError && [404,409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_bag_read_error",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetSkillDuplicateReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "pet_skill_duplicate_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetSkillDuplicateReadService(database!).read({
            eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId,
            destinationId: normalizedEvent.channelId,
          });
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_duplicate_read",result.reply));
        } catch (error) {
          if (error instanceof ApplicationError && [404,409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_duplicate_read_error",error.message));
          } else throw error;
        }
      }

      await dispatchPetSkillMutationCommands({database,eventProcessor,isOperationalChannel,processing,route:partialDispatchDecision?.route,handlerKey:partialDispatchDecision?.handlerKey,event:normalizedEvent});

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHopePremiumDeleteCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "hope_premium_delete"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new HopePremiumDeleteService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.reply });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureBagCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_bag_lifecycle"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new HomeFurnitureBagLifecycleService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.reply });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureInfoReadCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_info_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new HomeFurnitureInfoReadService(database!).read({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        if(result.reply!==undefined&&result.outboxId!==undefined)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.reply});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureRemoveCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_remove"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new HomeFurnitureRemoveService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        if(result.reply!==undefined&&result.outboxId!==undefined)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.reply});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureAddCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_add"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new HomeFurnitureAddService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        if(result.reply!==undefined&&result.outboxId!==undefined)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.reply});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureFullCleanupCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_full_cleanup"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new HomeFurnitureFullCleanupService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId});
        if(result.reply!==undefined&&result.outboxId!==undefined)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.reply});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureEquipCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_equip"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new HomeFurnitureEquipService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.reply});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
         && isHomeFurnitureRankCommand(normalizedEvent.message)
         && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_rank_read"
         && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
         const result=await new HomeFurnitureRankReadService(database!).read({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId});
         processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
         && isHomeRankingReadCommand(normalizedEvent.message)
         && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_ranking_read"
         && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
         const result=await new HomeRankingReadService(database!).read({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId});
         processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerCumulativeLevelRankReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_cumulative_level_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerCumulativeLevelRankReadService(database!).read({
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId
        });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerCumulativeLikeRankReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_cumulative_like_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerCumulativeLikeRankReadService(database!).read({
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId
        });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerDiamondRankReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_diamond_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerDiamondRankReadService(database!).read({
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId
        });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerLevelResetCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_level_reset"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerLevelResetService(database!).reset({
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId
        });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerLevelRankReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_level_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerLevelRankReadService(database!).read({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerVerificationRankReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_verification_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerVerificationRankReadService(database!).read({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isAdminPlayerInfoReadCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "admin_player_info_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new AdminPlayerInfoReadService(database!).read({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isDeveloperNoteReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "admin_developer_note_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new DeveloperNoteReadService(database!).read({
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId
        });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSocialBoardReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "social_board_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new SocialBoardReadService(database!).read({
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId
        });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isFreeMarketReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "free_market_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new FreeMarketReadService(database!).read({
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId
        });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isFreeMarketMutationDispatch(normalizedEvent.message, partialDispatchDecision?.route, partialDispatchDecision?.handlerKey)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await handleFreeMarketMutation(database!, {
          eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          handlerKey: partialDispatchDecision!.handlerKey!
        }, (errorCode, message) => eventProcessor!.queueCommandReply(normalizedEvent, errorCode, message));
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCarrotBoardReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "carrot_board_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new CarrotBoardReadService(database!).read({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCarrotBoardDeleteCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "carrot_board_delete"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new CarrotBoardDeleteService(database!).clear({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isFreeMarketInitCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new FreeMarketInitService(database!).execute({
            externalUserId: normalizedEvent.userId,
            destinationId: normalizedEvent.channelId,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 409].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "free_market_init_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCarrotRankReadCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new CarrotRankReadService(database!).read({
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId,
          eventId: normalizedEvent.eventId
        });
        if (result !== null) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCarrotBoardAddCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new CarrotBoardAddService(database!).add({
          externalUserId: normalizedEvent.userId,
          destinationId: normalizedEvent.channelId,
          message: normalizedEvent.message!,
          eventId: normalizedEvent.eventId
        });
        if (result !== null) {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCarrotBoardCompleteCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "carrot_board_complete"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new CarrotBoardCompleteService(database!).complete({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCarrotTemperatureRankReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "carrot_temperature_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new CarrotTemperatureRankReadService(database!).read({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId});
        if (result !== null) processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && isCarrotBanListReadCommand(normalizedEvent.message) && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "carrot_ban_list_read" && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new CarrotBanListReadService(database!).read({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        if(result!==null)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && isCarrotBanListAddCommand(normalizedEvent.message) && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "carrot_ban_list_add" && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new CarrotBanListAddService(database!).add({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        if(result!==null)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && isCarrotBanListRemoveCommand(normalizedEvent.message) && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "carrot_ban_list_remove" && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new CarrotBanListRemoveService(database!).remove({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        if(result!==null)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerOverallRankReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_overall_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerOverallRankReadService(database!).read({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerChatRankReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_chat_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerChatRankReadService(database!).read({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerTitleSelectCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_title_select"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerTitleSelectService(database!).select({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message!, senderDisplayName: commandEvent.displayName ?? normalizedEvent.userId });
        processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && (isPlayerTitleListReadCandidate(normalizedEvent.message) || isPlayerTitleInfoReadCandidate(normalizedEvent.message))
        && partialDispatchDecision?.route === "MODERN"
        && (partialDispatchDecision.handlerKey === "player_title_list_read" || partialDispatchDecision.handlerKey === "player_title_info_read")
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerTitleReadService(database!).read({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPlayerTitleGiftCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "player_title_gift"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PlayerTitleGiftService(database!).gift({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isTitleGiftTicketGrantCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "admin_title_gift_ticket_grant"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new TitleGiftTicketGrantService(database!).grant({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result !== null) processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureStatsReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_stats_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new HomeFurnitureStatsReadService(database!).read({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId});
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && (isHomeFurnitureDrawCandidate(normalizedEvent.message) || isHomeFurnitureSellCandidate(normalizedEvent.message) || isHomeFurnitureCleanCandidate(normalizedEvent.message))
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === (isHomeFurnitureDrawCandidate(normalizedEvent.message) ? "home_furniture_draw" : isHomeFurnitureCleanCandidate(normalizedEvent.message) ? "home_furniture_clean" : "home_furniture_sell")
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const input={eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!};
        const result=isHomeFurnitureDrawCandidate(normalizedEvent.message)
          ? await new HomeFurnitureDrawService(database!).handle(input)
          : isHomeFurnitureCleanCandidate(normalizedEvent.message)
          ? await new HomeFurnitureCleanService(database!).handle(input)
          : await new HomeFurnitureSellService(database!).handle(input);
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.reply});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureUnequipCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_unequip"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new HomeFurnitureUnequipService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.reply});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSocialOwnHeartCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "social_own_heart"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new SocialOwnHeartService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.reply});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureCarrotTransferCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_carrot_transfer"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try { const result = await new HomeFurnitureCarrotTransferService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!}); processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"home_furniture_carrot_transfer",result.reply)); }
        catch(error){ if(error instanceof ApplicationError) processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"home_furniture_carrot_transfer",error.message)); else throw error; }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isHomeFurnitureMarketListingCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "home_furniture_market_listing"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new HomeFurnitureMarketListingService(database!).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        const replyData = result.data;
        if (replyData !== undefined) processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: replyData });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetSkillMarketListingCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "pet_skill_market_listing"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetSkillMarketListingService(database!).handle({
            eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId,
            destinationId: normalizedEvent.channelId, message: normalizedEvent.message!,
          });
          if (result.data !== undefined) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_market_listing",result.data));
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_market_listing_error",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetSkillCarrotTradeCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "pet_skill_carrot_trade"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetSkillCarrotTradeService(database!).handle({
            eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId,
            destinationId: normalizedEvent.channelId, message: normalizedEvent.message!,
          });
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_carrot_trade",result.reply));
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_carrot_trade_error",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetSkillBookCombineCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "pet_skill_book_combine"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetSkillBookCombineService(database!).handle({
            eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId,
            destinationId: normalizedEvent.channelId, message: normalizedEvent.message!,
          });
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_book_combine",result.reply));
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_skill_book_combine_error",error.message));
          } else throw error;
        }
      }

      await dispatchPetSkillReadCommands({database,eventProcessor,isOperationalChannel,duplicate:processing?.duplicate,route:partialDispatchDecision?.route,handlerKey:partialDispatchDecision?.handlerKey,event:normalizedEvent,replies:processing?.replies});
      await evaluatePetSkillInfoShadow({database,isOperationalChannel,duplicate:processing?.duplicate,route:partialDispatchDecision?.route,handlerKey:partialDispatchDecision?.handlerKey,event:commandEvent});

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetDuelEmoteCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "pet_duel_emote"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetDuelEmoteService(database!).handle({
            eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId,
            destinationId: normalizedEvent.channelId, message: normalizedEvent.message!,
          });
          processing.replies.push(result.reply);
        } catch (error) {
          if (error instanceof ApplicationError && [404,409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"pet_duel_emote_error",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildPetSkillStockGrantCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN" && partialDispatchDecision.handlerKey === "guild_pet_skill_stock_grant"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildPetSkillStockGrantService(database!).handle({
            eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId,
            destinationId: normalizedEvent.channelId, message: normalizedEvent.message!,
          });
          if (result.reply !== null) processing.replies.push(result.reply);
        } catch (error) {
          if (error instanceof ApplicationError && [404,409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"guild_pet_skill_stock_grant_error",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetInfoCommand(normalizedEvent.message) && normalizedEvent.userId !== undefined
        && normalizedEvent.channelId !== undefined) {
        try {
          const replies = await new GetPetInfoService(new MariaPetInfoRepository(database!))
            .execute("kakao", normalizedEvent.userId);
          for (let index = 0; index < replies.length; index++) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, `pet_info_${index + 1}`, replies[index]!.data
            ));
          }
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "PET_NOT_FOUND") {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_info", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSpiritRankCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "spirit_rank_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new SpiritRankService(database!).read({ eventId:normalizedEvent.eventId,
          externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId });
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSpiritInfoCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "spirit_info_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new SpiritInfoService(database!).read({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId,
          displayName: commandEvent.displayName, displayNameTrust: commandEvent.displayNameTrust });
        for (const reply of result.replies) processing.replies.push({ outboxId: reply.outboxId, room: normalizedEvent.channelId, data: reply.data });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantBagCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_bag_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantBagService(database!).read({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status === "replied") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantBagCleanupCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_bag_cleanup"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantBagCleanupService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantEnhanceCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_enhance"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantEnhanceService(database!, new PendantPolicyCatalogReadProvider(new MariaPendantPolicyCatalogRepository(database!))).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantEnhanceCorrectionCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_enhance_correction"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantEnhanceCorrectionService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantDurabilityCorrectionCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_durability_correction"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantDurabilityCorrectionService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantMarketRegisterCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_market_register"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantMarketRegisterService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantMarketInfoCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_market_info"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantMarketInfoService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantCarrotTradeCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_carrot_trade"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new PendantCarrotTradeService(database!).handle({ eventId: normalizedEvent.eventId,
          externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message! });
        if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPendantRestoreCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "pendant_restore"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result=await new PendantRestoreService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});
        if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});
      }

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantDeleteCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_delete"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantDeleteService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantRankCommand(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_rank_read"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantRankService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantDrawOpenCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_draw_open"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantDrawOpenService(database!,Math.random,config.irisAllowedOpenChatIds).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});for(const reply of result.replies??[])processing.replies.push({outboxId:reply.outboxId,room:reply.room,data:reply.data});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantEquipCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&(partialDispatchDecision.handlerKey==="pendant_equip"||partialDispatchDecision.handlerKey==="pendant_unequip")&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantEquipService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantEquipResetCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_equip_reset"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantEquipResetService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantInfoCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_info_read"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantInfoService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantGrantCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_grant"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantGrantService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantSellCommandCandidate(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_sell"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantSellService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if(isOperationalChannel&&processing!==undefined&&!processing.duplicate&&isPendantProbabilityCommand(normalizedEvent.message)&&partialDispatchDecision?.route==="MODERN"&&partialDispatchDecision.handlerKey==="pendant_probability_read"&&normalizedEvent.userId!==undefined&&normalizedEvent.channelId!==undefined){const result=await new PendantProbabilityService(database!).handle({eventId:normalizedEvent.eventId,externalUserId:normalizedEvent.userId,destinationId:normalizedEvent.channelId,message:normalizedEvent.message!});if(result.status!=="silent")processing.replies.push({outboxId:result.outboxId!,room:normalizedEvent.channelId,data:result.data!});}

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSpiritNameCommandCandidate(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "spirit_name_mutate"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new SpiritNameService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "renamed") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "spirit_name_mutate", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isSpiritNameCombineCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "spirit_name_combine"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new SpiritNameCombineService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "spirit_name_combine", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isAutoDailyQuestCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "auto_daily_quest_orchestration"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"auto_daily_quest_progress","자동일퀘 계산 중입니다. 잠시만 기다려 주세요."));
          const responses = await new AutoDailyQuestOrchestrationIrisHandler(database!).execute(normalizedEvent);
          for (const response of responses) processing.replies.push({ outboxId:response.outboxId,room:response.room,data:response.message });
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"auto_daily_quest_orchestration",error.message));
          else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleBattleSelfRecordCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "castle_battle_self_record_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new CastleBattleSelfRecordReadService(database!).handle({
            externalUserId:normalizedEvent.userId,channelId:normalizedEvent.channelId,
            message:normalizedEvent.message!,eventId:normalizedEvent.eventId
          });
          processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"castle_battle_self_record_read",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleKingdomStatusReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "castle_kingdom_status_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new CastleKingdomStatusReadService(database!).handle({
          externalUserId:normalizedEvent.userId,channelId:normalizedEvent.channelId,
          message:normalizedEvent.message!,eventId:normalizedEvent.eventId
        });
        if (result !== null) processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleStateResetCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "castle_state_reset"
        && normalizedEvent.userId !== undefined) {
        await new CastleStateResetService(database!).handle({
          externalUserId:normalizedEvent.userId,message:normalizedEvent.message!,eventId:normalizedEvent.eventId
        });
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetBagThresholdCleanCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "mini_pet_bag_threshold_clean"
        && normalizedEvent.userId !== undefined) {
        const result=await new MiniPetBagThresholdCleanService(database!).handle({
          externalUserId:normalizedEvent.userId,message:normalizedEvent.message!,eventId:normalizedEvent.eventId
        });
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId!,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetGradeCleanupCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "mini_pet_grade_cleanup"
        && normalizedEvent.userId !== undefined) {
        const result=await new MiniPetGradeCleanupService(database!).handle({
          externalUserId:normalizedEvent.userId,message:normalizedEvent.message!,eventId:normalizedEvent.eventId
        });
        processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId!,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetAdminOwnedDeleteCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "mini_pet_admin_owned_delete"
        && normalizedEvent.userId !== undefined) {
        const result=await new MiniPetAdminOwnedDeleteService(database!).handle({
          externalUserId:normalizedEvent.userId,message:normalizedEvent.message!,eventId:normalizedEvent.eventId,destinationId:normalizedEvent.channelId!
        });
        if(result.outboxId!==undefined&&result.data!==undefined)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId!,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetEquippedCustomizeCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "mini_pet_equipped_customize"
        && normalizedEvent.userId !== undefined) {
        const result=await new MiniPetEquippedCustomizeService(database!).handle({
          externalUserId:normalizedEvent.userId,message:normalizedEvent.message!,eventId:normalizedEvent.eventId,channelId:normalizedEvent.channelId!
        });
        if(result.outboxId!==undefined&&result.data!==undefined)processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId!,data:result.data});
      }

      await dispatchMiniPetEquipOrBulkCleanup({
        database,
        isOperationalChannel,
        duplicate: processing?.duplicate,
        route: partialDispatchDecision?.route,
        handlerKey: partialDispatchDecision?.handlerKey,
        normalizedEvent,
        replies: processing?.replies
      });

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isRaidCharmRankingReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "raid_charm_ranking_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new RaidCharmRankingReadService(database!).handle({
          externalUserId:normalizedEvent.userId,channelId:normalizedEvent.channelId,
          message:normalizedEvent.message!,eventId:normalizedEvent.eventId
        });
        if (result !== null) processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleCharmRankingReadCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "castle_charm_ranking_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new CastleCharmRankingReadService(database!).handle({
          externalUserId:normalizedEvent.userId,channelId:normalizedEvent.channelId,
          message:normalizedEvent.message!,eventId:normalizedEvent.eventId
        });
        if (result !== null) processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetBattleLeaderboardCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "mini_pet_battle_leaderboard_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new MiniPetBattleLeaderboardReadService(database!).handle({
            externalUserId:normalizedEvent.userId,channelId:normalizedEvent.channelId,
            message:normalizedEvent.message!,eventId:normalizedEvent.eventId
          });
          processing.replies.push({outboxId:result.outboxId,room:normalizedEvent.channelId,data:result.data});
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"mini_pet_battle_leaderboard_read",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isMiniPetBattleCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "mini_pet_battle_execute"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const responses = await new MiniPetBattleExecuteIrisHandler(database!).execute(normalizedEvent);
          for (const response of responses) processing.replies.push({ outboxId:response.outboxId,room:response.room,data:response.message });
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"mini_pet_battle_execute",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleBattleExecuteCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "castle_battle_execute"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const responses = await new CastleBattleExecuteIrisHandler(database!).execute(normalizedEvent);
          for (const response of responses) processing.replies.push({ outboxId:response.outboxId,room:response.room,data:response.message });
        } catch (error) {
          if (error instanceof ApplicationError && [409,422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent,"castle_battle_execute",error.message));
          } else throw error;
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleBattleRankingCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "castle_battle_ranking_read"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new CastleBattleRankingService(new MariaCastleBattleRankingRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && error.code === "IDENTITY_MAPPING_REQUIRED") {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "castle_battle_ranking_read", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isRiftForceAdminCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "rift_force_admin"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        const result = await new RiftForceAdminService(database!).handle({
          externalUserId: normalizedEvent.userId, channelId: normalizedEvent.channelId,
          message: normalizedEvent.message!, eventId: normalizedEvent.eventId, nodeEnv: config.nodeEnv
        });
        if (result.status !== "handled_no_reply") {
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildRecruitmentToggleCommand(normalizedEvent.message)
        && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "guild_recruitment_toggle"
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildRecruitmentToggleService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(
              normalizedEvent, "guild_recruitment_toggle_error", error.message
            ));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildForceExpelCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildForceExpelService(new MariaGuildForceExpelRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.data !== undefined && result.outboxId !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          } else if (result.data !== undefined) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_force_expel", result.data));
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_force_expel_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isConstructionEditCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new ConstructionEditService(new MariaConstructionEditRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.data !== undefined && result.outboxId !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          } else if (result.data !== undefined) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "construction_edit", result.data));
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "construction_edit_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildJoinConditionCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildJoinConditionService(new MariaGuildJoinConditionRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.data !== undefined && result.outboxId !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          } else if (result.data !== undefined) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_join_condition", result.data));
          }
        } catch (error) {
          if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_join_condition_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isGuildJoinCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new GuildJoinService(new MariaGuildJoinRepository(database!)).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.data !== undefined && result.outboxId !== undefined) {
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [404, 409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "guild_join_error", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetFoodBoxCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetFoodBoxCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_food_box_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate) {
        const inventoryCleanupReply = await new InventoryCleanupIrisHandler(database!).execute(normalizedEvent, (code, message) => eventProcessor!.queueCommandReply(normalizedEvent, code, message));
        if (inventoryCleanupReply !== null) processing.replies.push(inventoryCleanupReply);
      }
      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isRaidStrikeSealCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new RaidStrikeSealCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "raid_strike_seal_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isCastleBattleResetCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new CastleBattleResetCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "castle_battle_reset_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetRenameTicketCraftCommand(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetRenameTicketCraftService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "crafted") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_rename_ticket_craft", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetRenameCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetRenameService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          if (result.status === "renamed") {
            processing.replies.push({ outboxId: result.outboxId!, room: normalizedEvent.channelId, data: result.data! });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_rename", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate
        && isPetCreationCommandCandidate(normalizedEvent.message)
        && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
        try {
          const result = await new PetCreationService(database!).handle({
            externalUserId: normalizedEvent.userId,
            channelId: normalizedEvent.channelId,
            message: normalizedEvent.message!,
            eventId: normalizedEvent.eventId
          });
          for (const petReply of result.replies) {
            processing.replies.push({ outboxId: petReply.outboxId, room: normalizedEvent.channelId, data: petReply.data });
          }
        } catch (error) {
          if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
            processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "pet_create", error.message));
          } else {
            throw error;
          }
        }
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.direction === "incoming"
        && verificationCode !== null && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined
        && commandEvent.displayNameTrust !== "trusted") {
        processing.replies.push(await eventProcessor!.queueCommandReply(
          normalizedEvent,
          "site_signup_kakao_verify_name_unavailable",
          "카카오톡 DB에서 현재 닉네임을 확인할 수 없어 인증을 완료하지 않았습니다. Iris sender 캐시값은 인증에 사용하지 않습니다."
        ));
      }

      if (isOperationalChannel && processing !== undefined && !processing.duplicate && normalizedEvent.direction === "incoming"
        && isSignupCommand(normalizedEvent.message) && partialDispatchDecision?.route === "MODERN"
        && partialDispatchDecision.handlerKey === "USER_SIGNUP" && normalizedEvent.channelId !== undefined) {
        if (isSiteSignupEntryCommand(normalizedEvent.message)) {
          processing.replies.push(await eventProcessor!.queueCommandReply(
            normalizedEvent,
            "site_signup_web_entry",
            buildSiteSignupEntryMessage()
          ));
        } else if (normalizedEvent.userId !== undefined && commandEvent.displayNameTrust === "trusted"
          && commandEvent.displayName !== undefined) {
          try {
            const result = await new SignupService(database!).handle({
              externalUserId: normalizedEvent.userId,
              displayName: commandEvent.displayName,
              channelId: normalizedEvent.channelId,
              message: normalizedEvent.message!,
              eventId: normalizedEvent.eventId
            });
            processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
          } catch (error) {
            if (error instanceof ApplicationError && [409, 422].includes(error.statusCode)) {
              processing.replies.push(await eventProcessor!.queueCommandReply(normalizedEvent, "signup", error.message));
            } else {
              throw error;
            }
          }
        }
      }

      if (processing !== undefined && !processing.duplicate && eventMonitorMessage !== undefined) {
        processing.replies.push(await eventProcessor!.queueCommandReply(
          commandEvent,
          "iris_event_monitor",
          eventMonitorMessage,
          config.irisEventMonitorRoomId
        ));
      }

      if (processing !== undefined) {
        for (const pendingReply of processing.replies) {
          try {
            await replyToIris({ room: pendingReply.room, data: pendingReply.data });
            await recordOutboxDelivery(database!, pendingReply.outboxId, { ok: true });
            request.log.info({ requestId: request.id }, "iris.outbox_reply.sent");
          } catch (error) {
            await recordOutboxDelivery(database!, pendingReply.outboxId, { ok: false, errorCode: "IRIS_REPLY_FAILED" });
            request.log.error({ requestId: request.id, err: error }, "iris.outbox_reply.failed");
          }
        }
      } else if (isInteractiveChannel && normalizedEvent.message === "/info" && commandEvent.channelId !== undefined
        && kakaoDatabaseSnapshot !== undefined) {
        try {
          const diagnosticChunks = splitIrisKakaoDiagnostic(
            formatIrisKakaoDiagnostic(request.body, normalizedEvent, kakaoDatabaseSnapshot)
          );
          for (const diagnosticChunk of diagnosticChunks) {
            await replyToIris({ room: commandEvent.channelId, data: diagnosticChunk });
          }
          request.log.info({ requestId: request.id }, "iris.database_info_reply.sent");
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "iris.database_info_reply.failed");
        }
      } else if (isInteractiveChannel && normalizedEvent.message === "/ping") {
        const sender = commandEvent.displayNameTrust === "trusted"
          ? commandEvent.displayName ?? ""
          : "미확인 사용자";
        const chatId = commandEvent.channelId ?? "";

        if (sender !== "" && chatId !== "") {
          try {
            await replyToIris({ room: chatId, data: `${sender} pong` });
            request.log.info({ requestId: request.id }, "iris.ping_reply.sent");
          } catch (error) {
            request.log.error({ requestId: request.id, err: error }, "iris.ping_reply.failed");
          }
        } else {
          request.log.warn({ requestId: request.id }, "iris.ping_reply.missing_context");
        }
      }

      if (processing === undefined && eventMonitorMessage !== undefined) {
        try {
          await replyToIris({ room: config.irisEventMonitorRoomId, data: eventMonitorMessage });
          request.log.info({ requestId: request.id }, "iris.event_monitor.sent");
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "iris.event_monitor.failed");
        }
      }

      const imageUrl = readIncomingSingleImageUrl(
        request.body,
        config.irisImageForwardRoomId
      );
      if (isOperationalChannel && imageUrl !== undefined
        && config.irisImageForwardRoomId !== "") {
        try {
          await forwardImageToIris({ room: config.irisImageForwardRoomId, imageUrl });
          request.log.info({ requestId: request.id }, "iris.image_forward.sent");
        } catch (error) {
          request.log.error({ requestId: request.id, err: error }, "iris.image_forward.failed");
        }
      }

      return reply.code(202).send({
        ok: true,
        accepted: true,
        ignored: false,
        channelMode: channelAccess.mode,
        duplicate: processing?.duplicate ?? false,
        requestId: request.id
      });
    }
  );

  app.get<{ Querystring: TokenQuery }>(
    "/api/v1/debug/recent-events",
    { preHandler: tokenGuard },
    async (request: FastifyRequest<{ Querystring: TokenQuery }>, reply: FastifyReply) => {
      if (!config.recentEventsEnabled) {
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "최근 이벤트 조회 기능이 비활성화되어 있습니다." },
          requestId: request.id
        });
      }

      return { ok: true, events: recentEvents.list(), requestId: request.id };
    }
  );

  return app;
}
import { isPlayerTitleSellCandidate, normalizePlayerTitleSellDispatchMessage, PlayerTitleSellService } from "./player/player-title-sell-service.js";
import { isLetterBoardCandidate, LetterBoardService, normalizeLetterBoardDispatchMessage } from "./social/letter-board-service.js";
import { isRecordBoardCommandCandidate, normalizeRecordBoardCommand, RecordBoardService } from "./social/record-board-service.js";
import { GuildAdminDetailReadService, normalizeGuildAdminDetailDispatchMessage, parseGuildAdminDetailCommand } from "./guild/guild-admin-detail-read-service.js";
import { GuildProfileReadService, isGuildProfileReadCommand } from "./guild/guild-profile-read-service.js";
import { isSocialPunchReactionCommandCandidate, normalizeSocialPunchReactionDispatchMessage, SocialPunchReactionService } from "./social/social-punch-reaction-service.js";
import { isPunchActionCommandCandidate, normalizePunchActionDispatchMessage } from "./battle/punch-action-service.js";

// 명치 반응과 펀치 action을 기존 단일 partial-dispatch 슬롯에서 구분합니다.
function isPunchFamilyDispatchCandidate(message: string | undefined): boolean { return isSocialPunchReactionCommandCandidate(message) || isPunchActionCommandCandidate(message); }

// 펀치 family 인자 명령을 각 command registry 대표 alias로 정규화합니다.
function normalizePunchFamilyDispatchMessage(message: string): string { return isPunchActionCommandCandidate(message) ? normalizePunchActionDispatchMessage(message)! : normalizeSocialPunchReactionDispatchMessage(message); }
import { isPetSkillBoastReadCommand, PetSkillBoastReadService } from "./pet/pet-skill-boast-read-service.js";
import { AdminPetAppearanceService, isPetAppearanceCommandCandidate, normalizePetAppearanceDispatchMessage } from "./pet/admin-pet-appearance-service.js";
import { isPetFeedIntimacyCandidate, normalizePetFeedIntimacyCommand, PetFeedIntimacyService } from "./pet/pet-feed-intimacy-service.js";
// 계정 정지 세 명령을 큰 Iris 이벤트 함수 밖에서 판별·실행해 TypeScript 제어흐름 크기를 제한합니다.
async function dispatchAdminAccountSuspensionCommand(input: {
  database: ConstructorParameters<typeof AdminAccountSuspensionService>[0];
  isOperationalChannel: boolean;
  duplicate: boolean | undefined;
  route: string | undefined;
  handlerKey: string | undefined;
  externalUserId: string | undefined;
  channelId: string | undefined;
  message: string | undefined;
  eventId: string;
  queueError: (code: string, message: string) => Promise<{ outboxId: string; room: string; data: string }>;
}): Promise<Array<{ outboxId: string; room: string; data: string }>> {
  if (!input.isOperationalChannel || input.duplicate === true || !isAdminAccountSuspensionCommand(input.message)
    || input.route !== "MODERN" || input.handlerKey !== "admin_account_suspension"
    || input.externalUserId === undefined || input.channelId === undefined || input.message === undefined) return [];
  try {
    const result = await new AdminAccountSuspensionService(input.database).handle({
      externalUserId: input.externalUserId, channelId: input.channelId, message: input.message, eventId: input.eventId
    });
    return result.status === "changed" ? [{ outboxId: result.outboxId, room: input.channelId, data: result.data }] : [];
  } catch (error) {
    if (error instanceof ApplicationError && [403, 404, 409, 422].includes(error.statusCode)) {
      return [await input.queueError("admin_account_suspension_error", error.message)];
    }
    throw error;
  }
}
