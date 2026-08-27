import type { DatabaseClient } from "../database.js";
import { CurrencyService } from "../currency/currency-service.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ChangePlayerServerService } from "../player/change-player-server-service.js";
import { ApplicationError } from "../shared/application-error.js";
import { GuildTerritoryDimensionGateService, isGuildTerritoryDimensionGateCommand, parseGuildTerritoryDimensionGateCommand } from "../guild/guild-territory-dimension-gate-service.js";
import { isRingRewardClaimCommand, RingRewardClaimService } from "../ring/ring-reward-claim-service.js";
import { isRingReadCommandCandidate, RingReadService } from "../ring/ring-read-service.js";
import { isRingRewardUseCommand, RingRewardUseService } from "../ring/ring-reward-use-service.js";
import { isSpiritEnhanceCommand, SpiritEnhanceService } from "../pet/spirit-enhance-service.js";
import { isSpiritAttributeCommandCandidate, SpiritAttributeService } from "./spirit-attribute-service.js";
import { isPetEnhancementLevelSetCommandCandidate, PetEnhancementLevelSetService } from "./pet-enhancement-level-set-service.js";
import { AuthCheckCountResetService, isAuthCheckCountResetCommand } from "./auth-check-count-reset-service.js";
import { HoiLandEditService } from "./hoiland-edit-service.js";
import { LordIncomeService } from "./lord-income-service.js";
import { isOperationIntervalResetCommand, OperationIntervalResetService } from "./operation-interval-reset-service.js";
import { isPetDataCompareCommand, PetDataCompareService } from "./pet-data-compare-service.js";
import { isPetMemberCharacterCountCommand, PetMemberCharacterCountService } from "./pet-member-character-count-service.js";
import { isPetDataSyncCommand, PetDataSyncService } from "./pet-data-sync-service.js";
import { isPetTitleAddCommandCandidate, parsePetTitleAddCommand, PetTitleAddService } from "./pet-title-add-service.js";
import { isPetTitleStoreResetCommand, PetTitleStoreResetService } from "./pet-title-store-reset-service.js";
import { isPetTitleSyncCommand, PetTitleSyncService } from "./pet-title-sync-service.js";
import { isRequestMonitorConfigCommandCandidate, parseRequestMonitorConfigCommand, RequestMonitorConfigService } from "./request-monitor-config-service.js";
import { isRequestMonitorExceptionCommandCandidate, parseRequestMonitorExceptionCommand, RequestMonitorExceptionService } from "./request-monitor-exception-service.js";
import { isRetiredRingCommandCandidate, parseRetiredRingCommand, RetiredRingCommandService } from "./retired-ring-command-service.js";
import { isSpecialBadgeGrantCommandCandidate, SpecialBadgeGrantService } from "./special-badge-grant-service.js";
import { isSpecialBadgeRevokeCommandCandidate, SpecialBadgeRevokeService } from "./special-badge-revoke-service.js";
import { isWeeklyQuestCountCommandCandidate, parseWeeklyQuestCountCommand, WeeklyQuestCountService } from "./weekly-quest-count-service.js";
import { isMiniPetDuelResetGrantCommandCandidate, MiniPetDuelResetGrantService } from "./mini-pet-duel-reset-grant-service.js";
import { isPetDungeonEntryGrantCommandCandidate, PetDungeonEntryGrantService } from "./pet-dungeon-entry-grant-service.js";
import { isMiniPetDrawGrantCommandCandidate, MiniPetDrawGrantService } from "./mini-pet-draw-grant-service.js";
import { isPetSkillBookGrantCommandCandidate, PetSkillBookGrantService } from "./pet-skill-book-grant-service.js";
import { isPetResetCommandCandidate, PetResetService } from "./pet-reset-service.js";
import { isPetOwnerReadCommand, PetOwnerReadService } from "../pet/pet-owner-read-service.js";
import { isMatzangTimeCheckCommandCandidate, MatzangTimeCheckService } from "./matzang-time-check-service.js";
import { isMatzangSessionCommand, MatzangSessionCommandService } from "../battle/matzang-session-command-service.js";
import { isTrialTowerSyncCommand, TrialTowerSyncService } from "../trial/trial-tower-sync-service.js";
import { isTrialTowerAdminModifyCommandCandidate, TrialTowerAdminModifyService } from "../trial/trial-tower-admin-modify-service.js";
import { isTrialTowerSeasonLifecycleCommand, TrialTowerSeasonLifecycleService } from "../trial/trial-tower-season-lifecycle-service.js";
import { isTrialTowerSeasonResetCommand, TrialTowerSeasonResetService } from "../trial/trial-tower-season-reset-service.js";
import { AutoExploreSchedulerService, isAutoExploreSchedulerStartCommand } from "../pet/auto-explore-scheduler-service.js";

// 기존 `/서버이동 대상 서버명`을 같은 Application Service로 실행합니다.
export class IrisAdminCommandService {
  constructor(private readonly database: DatabaseClient, private readonly broadcastIds: string[] = []) {}

  async changePlayerServer(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<{ data: string; outboxId: string }> {
    if (!/^\/서버이동\s+\S.+$/.test(input.message)) {
      throw new ApplicationError("INVALID_SERVER_CHANGE_COMMAND", "서버이동 명령 형식이 올바르지 않습니다.", 422);
    }
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
       JOIN admin_operators operator ON operator.id = mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
       JOIN admin_role_permissions permission ON permission.role_id = operator_role.role_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND operator.status = 'active'
         AND permission.permission_code = 'player.server.assign' LIMIT 1`,
      [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "서버이동 권한이 없습니다.", 403);

    const servers = await this.database.query<Array<{ code: string; display_name: string }>>(
      "SELECT code, display_name FROM game_servers WHERE active = TRUE ORDER BY CHAR_LENGTH(display_name) DESC"
    );
    const commandBody = input.message.replace(/^\/서버이동\s+/, "").trim();
    const server = servers.find((candidate) => commandBody.endsWith(candidate.display_name));
    if (server === undefined) throw new ApplicationError("INVALID_SERVER", `❌ 유효하지 않은 서버입니다.\n\n가능 서버:\n- ${servers.map((item) => item.display_name).join("\n- ")}`, 422);
    const targetName = commandBody.slice(0, -server.display_name.length).trim();
    const targets = await this.database.query<Array<{ player_id: bigint; version: bigint }>>(
      `SELECT player_id, version FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2`,
      [targetName]
    );
    if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
    if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 관리자 화면에서 player ID로 변경해야 합니다.", 409);
    const responseText = `✅ [${targetName}] 님의 서버가 [${server.display_name}] 로 이동되었습니다.`;
    const result = await new ChangePlayerServerService(this.database).execute({
      playerId: targets[0]!.player_id.toString(), serverCode: server.code,
      expectedVersion: targets[0]!.version.toString(), reason: "Iris 관리자 /서버이동",
      idempotencyKey: input.eventId, actorId: operators[0].operator_id.toString(), sourceCode: "iris",
      irisReply: { destinationId: input.channelId, data: responseText }, sourceEventId: input.eventId
    });
    if (result.replyOutboxId === undefined) throw new Error("Iris server-change reply outbox was not created.");
    return { data: responseText, outboxId: result.replyOutboxId };
  }

  // rollout 상태와 관리자 권한을 확인한 뒤 회원 포인트를 절대값으로 설정합니다.
  async changePlayerPoint(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string; replies?: Array<{ data: string; outboxId: string; room?: string }> }
    | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    if (isMatzangSessionCommand(input.message)) return new MatzangSessionCommandService(this.database).handleIris(input);
    if (isMatzangTimeCheckCommandCandidate(input.message)) return new MatzangTimeCheckService(this.database).handleIris(input);
    if (isMiniPetDuelResetGrantCommandCandidate(input.message)) return this.handleMiniPetDuelResetGrant(input);
    if (isPetDungeonEntryGrantCommandCandidate(input.message)) return this.handlePetDungeonEntryGrant(input);
    if (isMiniPetDrawGrantCommandCandidate(input.message)) return this.handleMiniPetDrawGrant(input);
    if (isPetSkillBookGrantCommandCandidate(input.message)) return this.handlePetSkillBookGrant(input);
    if (isPetResetCommandCandidate(input.message)) return new PetResetService(this.database).handleIris(input);
    if (isPetOwnerReadCommand(input.message)) return new PetOwnerReadService(this.database).handleIris(input);
    if (isPetEnhancementLevelSetCommandCandidate(input.message)) return new PetEnhancementLevelSetService(this.database).handleIris(input);
    if (isSpiritAttributeCommandCandidate(input.message)) return new SpiritAttributeService(this.database).handleIris(input);
    if (isSpiritEnhanceCommand(input.message)) return new SpiritEnhanceService(this.database).handleIris(input);
    if (isRingRewardUseCommand(input.message)) return new RingRewardUseService(this.database).handleIris(input);
    if (isRingReadCommandCandidate(input.message)) return new RingReadService(this.database).handleIris(input);
    if (isRingRewardClaimCommand(input.message)) return new RingRewardClaimService(this.database).handleIris(input);
    if (isRetiredRingCommandCandidate(input.message)) return this.handleRetiredRingCommand(input);
    if (isPetMemberCharacterCountCommand(input.message)) return this.handlePetMemberCharacterCount(input);
    if (isPetDataCompareCommand(input.message)) return this.handlePetDataCompare(input);
    if (isPetTitleAddCommandCandidate(input.message)) return this.handlePetTitleAdd(input);
    if (isPetTitleStoreResetCommand(input.message)) return this.handlePetTitleStoreReset(input);
    if (isPetTitleSyncCommand(input.message)) return this.handlePetTitleSync(input);
    if (isPetDataSyncCommand(input.message)) return this.handlePetDataSync(input);
    if (isTrialTowerSyncCommand(input.message)) return this.handleTrialTowerSync(input);
    if (isTrialTowerAdminModifyCommandCandidate(input.message)) return this.handleTrialTowerAdminModify(input);
    if (isTrialTowerSeasonLifecycleCommand(input.message)) return this.handleTrialTowerSeasonLifecycle(input);
    if (isTrialTowerSeasonResetCommand(input.message)) return new TrialTowerSeasonResetService(this.database).handleIris(input);
    if (isAutoExploreSchedulerStartCommand(input.message)) return new AutoExploreSchedulerService(this.database).handleIris(input);
    if (isSpecialBadgeGrantCommandCandidate(input.message)) return this.handleSpecialBadgeGrant(input);
    if (isSpecialBadgeRevokeCommandCandidate(input.message)) return this.handleSpecialBadgeRevoke(input);
    if (isGuildTerritoryDimensionGateCommand(input.message)) return this.handleGuildTerritoryDimensionGate(input);
    if (isOperationIntervalResetCommand(input.message)) return this.handleOperationIntervalReset(input);
    if (isWeeklyQuestCountCommandCandidate(input.message)) return this.handleWeeklyQuestCount(input);
    if (isRequestMonitorExceptionCommandCandidate(input.message)) return this.handleRequestMonitorException(input);
    if (isRequestMonitorConfigCommandCandidate(input.message)) return this.handleRequestMonitorConfig(input);
    if (isAuthCheckCountResetCommand(input.message)) return this.handleAuthCheckCountReset(input);
    if (isLordIncomeCommandCandidate(input.message)) return this.handleLordIncomeCommand(input);
    if (isHoiLandEditCommandCandidate(input.message)) return this.changeHoiLandAmount(input);
    const match = /^\/포인트수정\s+(.+?)\s+(\d{1,27})$/.exec(input.message);
    if (match === null) throw new ApplicationError("INVALID_POINT_EDIT_COMMAND", "포인트수정 명령 형식이 올바르지 않습니다.", 422);
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state, enabled FROM command_registry WHERE command_code = 'ADMIN_POINT_EDIT' LIMIT 1"
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: "ADMIN_POINT_EDIT", handlerKey: "ADMIN_POINT_EDIT" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_POINT_EDIT", handlerKey: "ADMIN_POINT_EDIT" });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: "ADMIN_POINT_EDIT", handlerKey: "ADMIN_POINT_EDIT" });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
       JOIN admin_operators operator ON operator.id = mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id = operator.id
       JOIN admin_role_permissions permission ON permission.role_id = operator_role.role_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND operator.status = 'active'
         AND permission.permission_code = 'game.currency.change' LIMIT 1`,
      [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "포인트수정 권한이 없습니다.", 403);
    const targetName = match[1]!.trim();
    const targets = await this.database.query<Array<{ player_id: bigint }>>(
      "SELECT player_id FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2", [targetName]
    );
    if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `❌ [${targetName}] 님은 존재하지 않습니다.`, 404);
    if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 관리가 필요합니다.", 409);
    const result = await new CurrencyService(this.database).setAbsolute({
      playerId: targets[0]!.player_id.toString(), targetDisplayName: targetName, currencyCode: "point", balance: match[2]!,
      reasonCode: "admin_point_edit", reason: "Iris 총괄 운영자 /포인트수정", idempotencyKey: input.eventId,
      actor: { type: "admin_operator", id: operators[0]!.operator_id.toString() }, sourceCode: "iris",
      sourceEventId: input.eventId, irisReplyDestinationId: input.channelId
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 총괄 운영자의 `/대전` 리셋권 지급을 rollout과 전용 권한 뒤 원자 처리합니다.
  async handleMiniPetDuelResetGrant(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const commandCode = "ADMIN_MINI_PET_DUEL_RESET_GRANT";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]);
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true },{ route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode,handlerKey:commandCode });
      return { status:"legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true },{ route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode,handlerKey:commandCode });
      return { status:"shadow" };
    }
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='inventory.mini_pet_duel_reset.grant'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]
    );
    if (operators[0] === undefined) return { status:"handled_no_reply" };
    await dispatch.record({ eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true },{ route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode,handlerKey:commandCode });
    const result = await new MiniPetDuelResetGrantService(this.database).grant({ eventId:input.eventId,destinationId:input.channelId,operatorId:operators[0]!.operator_id.toString(),message:input.message });
    return { status:"changed",data:result.data,outboxId:result.outboxId };
  }

  // 총괄 운영자의 `/던전` 입장권 지급을 공용 stack provider로 처리합니다.
  async handlePetDungeonEntryGrant(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"|"handled_no_reply"}>{
    const commandCode="ADMIN_PET_DUNGEON_ENTRY_GRANT",rollout=await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[commandCode]),definition=rollout[0],dispatch=new MariaCommandDispatchRepository(this.database);
    if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode,handlerKey:commandCode});return{status:"legacy_fallback"};}
    if(definition.rollout_state==="SHADOW"||definition.rollout_state==="CANARY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode,handlerKey:commandCode});return{status:"shadow"};}
    const operators=await this.database.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='inventory.pet_dungeon_entry.grant' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,[input.externalUserId]);
    if(operators[0]===undefined)return{status:"handled_no_reply"};
    await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode,handlerKey:commandCode});
    const result=await new PetDungeonEntryGrantService(this.database).grant({eventId:input.eventId,destinationId:input.channelId,operatorId:operators[0]!.operator_id.toString(),message:input.message});return{status:"changed",data:result.data,outboxId:result.outboxId};
  }

  // 총괄 운영자의 `/펫미니` 미니펫뽑기 지급을 공용 stack provider로 처리합니다.
  async handleMiniPetDrawGrant(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"|"handled_no_reply"}>{
    const commandCode="ADMIN_MINI_PET_DRAW_GRANT",rollout=await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[commandCode]),definition=rollout[0],dispatch=new MariaCommandDispatchRepository(this.database);
    if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode,handlerKey:commandCode});return{status:"legacy_fallback"};}
    if(definition.rollout_state==="SHADOW"||definition.rollout_state==="CANARY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode,handlerKey:commandCode});return{status:"shadow"};}
    const operators=await this.database.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='inventory.mini_pet_draw.grant' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,[input.externalUserId]);
    if(operators[0]===undefined)return{status:"handled_no_reply"};
    await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode,handlerKey:commandCode});
    const result=await new MiniPetDrawGrantService(this.database).grant({eventId:input.eventId,destinationId:input.channelId,operatorId:operators[0]!.operator_id.toString(),message:input.message});return{status:"changed",data:result.data,outboxId:result.outboxId};
  }

  // 총괄 운영자의 `/펫북` 펫스킬북 지급을 공용 stack provider로 처리합니다.
  async handlePetSkillBookGrant(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"|"handled_no_reply"}>{
    const commandCode="ADMIN_PET_SKILL_BOOK_GRANT",rollout=await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[commandCode]),definition=rollout[0],dispatch=new MariaCommandDispatchRepository(this.database);
    if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode,handlerKey:commandCode});return{status:"legacy_fallback"};}
    if(definition.rollout_state==="SHADOW"||definition.rollout_state==="CANARY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode,handlerKey:commandCode});return{status:"shadow"};}
    const operators=await this.database.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='inventory.pet_skill_book.grant' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,[input.externalUserId]);
    if(operators[0]===undefined)return{status:"handled_no_reply"};
    await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode,handlerKey:commandCode});
    const result=await new PetSkillBookGrantService(this.database).grant({eventId:input.eventId,destinationId:input.channelId,operatorId:operators[0]!.operator_id.toString(),message:input.message});return{status:"changed",data:result.data,outboxId:result.outboxId};
  }

  // rollout과 레거시 Master 권한을 확인한 뒤 종료된 반지 명령 안내를 원자 기록합니다.
  async handleRetiredRingCommand(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const command = parseRetiredRingCommand(input.message);
    if (command === null) return { status: "handled_no_reply" };
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [command.commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: command.commandCode, handlerKey: command.handlerKey });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: command.commandCode, handlerKey: command.handlerKey });
      return { status: "shadow" };
    }
    const identities = await this.database.query<Array<{ id: bigint }>>(
      "SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1",
      [input.externalUserId]
    );
    const identity = identities[0];
    if (identity === undefined) {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "IDENTITY_NOT_VERIFIED", commandCode: command.commandCode, handlerKey: command.handlerKey });
      return { status: "legacy_fallback" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: command.commandCode, handlerKey: command.handlerKey });
    if (command.requiresMaster) {
      const operators = await this.database.query<Array<{ operator_id: bigint }>>(
        `SELECT mapping.operator_id FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id
         JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
         JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
           AND operator.status='active' LIMIT 1`, [input.externalUserId]
      );
      if (operators[0] === undefined) return { status: "handled_no_reply" };
    }
    const result = await new RetiredRingCommandService(this.database).reply({
      command, idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, actorId: identity.id.toString(),
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 확인된 사용자는 member_pet 원문 snapshot의 Rhino UTF-16 글자 수를 조회합니다.
  async handlePetMemberCharacterCount(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const commandCode = "ADMIN_PET_MEMBER_CHARACTER_COUNT";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    const identities = await this.database.query<Array<{ identity_id: bigint }>>(
      `SELECT id AS identity_id FROM external_identities
       WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL LIMIT 1`,
      [input.externalUserId]
    );
    const identity = identities[0];
    if (identity === undefined) {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "IDENTITY_NOT_VERIFIED", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const result = await new PetMemberCharacterCountService(this.database).count({
      idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, identityId: identity.identity_id.toString(),
    });
    if (result.data === null || result.outboxId === null) return { status: "handled_no_reply" };
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 총괄 운영자는 회원·펫 데이터의 안정 PK 개수를 같은 snapshot에서 비교합니다.
  async handlePetDataCompare(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string; replies?: Array<{ data: string; outboxId: string }> }
    | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_PET_DATA_COMPARE";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "펫데이터 비교 권한이 없습니다.", 403);
    const result = await new PetDataCompareService(this.database).compare({
      idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString(),
    });
    return {
      status: "changed", data: result.replies[0]!.data, outboxId: result.replies[0]!.outboxId,
      replies: result.replies,
    };
  }

  // 총괄 운영자는 비활성·프로필 소실 회원의 펫 집합을 원자적으로 정리합니다.
  async handlePetDataSync(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_PET_DATA_SYNC";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "펫데이터 동기화 권한이 없습니다.", 403);
    const result = await new PetDataSyncService(this.database).sync({
      idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString(),
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 레거시 `호이 남` 운영자만 활성 회원 원본에 없는 시련의 탑 진행을 정리합니다.
  async handleTrialTowerSync(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_TRIAL_TOWER_SYNC";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0], dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: "trial_tower_sync" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state !== "ACTIVE") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: "trial_tower_sync" });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: "trial_tower_sync" });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND operator.display_name='호이 남' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "시련의탑 동기화 권한이 없습니다.", 403);
    const result = await new TrialTowerSyncService(this.database).sync({
      idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString(),
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 레거시 `호이 남` 운영자만 현재 시즌의 대상 시련의 탑 층수를 수정합니다.
  async handleTrialTowerAdminModify(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode="ADMIN_TRIAL_TOWER_MODIFY",dispatch=new MariaCommandDispatchRepository(this.database);
    const definition=(await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[commandCode]))[0];
    if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode,handlerKey:"trial_tower_admin_modify"});return{status:"legacy_fallback"};}
    if(definition.rollout_state!=="ACTIVE"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode,handlerKey:"trial_tower_admin_modify"});return{status:"shadow"};}
    await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode,handlerKey:"trial_tower_admin_modify"});
    const operator=(await this.database.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active' AND operator.display_name='호이 남' LIMIT 1`,[input.externalUserId]))[0];
    if(operator===undefined)throw new ApplicationError("FORBIDDEN","시련의탑 수정 권한이 없습니다.",403);
    const result=await new TrialTowerAdminModifyService(this.database).modify({message:input.message,idempotencyKey:input.eventId,sourceEventId:input.eventId,destinationId:input.channelId,operatorId:operator.operator_id.toString()});
    return{status:"changed",data:result.data,outboxId:result.outboxId};
  }

  // 레거시 `호이 남` 운영자만 현재 시련의 탑 시즌 flag를 바꾸고 운영방에 공지합니다.
  async handleTrialTowerSeasonLifecycle(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<{status:"changed";data:string;outboxId:string;replies:Array<{data:string;outboxId:string;room?:string}>}|{status:"shadow"|"legacy_fallback"}>{
    const commandCode=input.message==="/시련의탑시즌시작"?"ADMIN_TRIAL_TOWER_SEASON_START":"ADMIN_TRIAL_TOWER_SEASON_END",dispatch=new MariaCommandDispatchRepository(this.database),definition=(await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[commandCode]))[0];
    if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode,handlerKey:"trial_tower_season_lifecycle"});return{status:"legacy_fallback"};}
    if(definition.rollout_state!=="ACTIVE"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode,handlerKey:"trial_tower_season_lifecycle"});return{status:"shadow"};}
    await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode,handlerKey:"trial_tower_season_lifecycle"});
    const op=(await this.database.query<Array<{operator_id:bigint}>>(`SELECT mapping.operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active' AND operator.display_name='호이 남' LIMIT 1`,[input.externalUserId]))[0];if(op===undefined)throw new ApplicationError("FORBIDDEN","시련의탑 시즌 관리 권한이 없습니다.",403);
    const r=await new TrialTowerSeasonLifecycleService(this.database,this.broadcastIds).change({message:input.message,idempotencyKey:input.eventId,sourceEventId:input.eventId,operatorId:op.operator_id.toString()});return{status:"changed",data:r.data,outboxId:r.outboxId,replies:r.replies};
  }

  // 총괄 운영자는 비활성·프로필 소실 회원의 펫 타이틀 할당만 원자적으로 정리합니다.
  async handlePetTitleSync(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_PET_TITLE_SYNC";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "펫타이틀 동기화 권한이 없습니다.", 403);
    const result = await new PetTitleSyncService(this.database).sync({
      idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString(),
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 운영자는 안정 KEY와 사용자별 순서를 가진 펫 타이틀 지급 인스턴스를 추가합니다.
  async handlePetTitleAdd(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const command = parsePetTitleAddCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_PET_TITLE_ADD_COMMAND",
      "올바른 명령어 형식을 사용해주세요.\n예: /펫타이틀추가 [유저명], [타이틀명] [가격]", 422);
    const commandCode = "ADMIN_PET_TITLE_ADD";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "펫타이틀 추가 권한이 없습니다.", 403);
    const result = await new PetTitleAddService(this.database).add({
      ...command, idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString(),
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 운영자는 레거시 펫 타이틀 전체 저장소를 감사 가능한 단일 transaction으로 초기화합니다.
  async handlePetTitleStoreReset(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_PET_TITLE_STORE_RESET";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "펫타이틀 파일 초기화 권한이 없습니다.", 403);
    const result = await new PetTitleStoreResetService(this.database).reset({
      idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString(),
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // rollout과 운영자 권한을 확인한 뒤 회원의 모든 호이랜드 카테고리 수치를 설정합니다.
  async changeHoiLandAmount(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const match = /^\/수정\s+(.+?)\s+(\d{1,27})$/.exec(input.message);
    if (match === null) throw new ApplicationError("INVALID_HOILAND_EDIT_COMMAND", "수정 명령 형식이 올바르지 않습니다.", 422);
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state, enabled FROM command_registry WHERE command_code='ADMIN_HOILAND_EDIT' LIMIT 1"
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: "ADMIN_HOILAND_EDIT", handlerKey: "ADMIN_HOILAND_EDIT" });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: "ADMIN_HOILAND_EDIT", handlerKey: "ADMIN_HOILAND_EDIT" });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: "ADMIN_HOILAND_EDIT", handlerKey: "ADMIN_HOILAND_EDIT" });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=?
         AND identity.status='linked' AND operator.status='active'
         AND permission.permission_code='game.currency.change' LIMIT 1`,
      [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "수정 권한이 없습니다.", 403);
    const targetName = match[1]!.trim();
    const targets = await this.database.query<Array<{ player_id: bigint }>>(
      "SELECT player_id FROM player_profiles WHERE current_display_name=? ORDER BY player_id LIMIT 2", [targetName]
    );
    if (targets.length === 0) throw new ApplicationError("PLAYER_NOT_FOUND", `${targetName}은(는) 등록되어 있지 않습니다.`, 404);
    if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 회원이 여러 명이므로 player ID 기반 관리가 필요합니다.", 409);
    const result = await new HoiLandEditService(this.database).setAbsolute({
      playerId: targets[0]!.player_id.toString(), targetDisplayName: targetName, amount: match[2]!,
      idempotencyKey: input.eventId, operatorId: operators[0]!.operator_id.toString(), sourceEventId: input.eventId,
      irisReplyDestinationId: input.channelId
    });
    if (result === null || result.outboxIds[0] === undefined) {
      throw new ApplicationError("HOILAND_ENTRY_NOT_FOUND", "변경할 호이랜드 항목이 없습니다.", 404);
    }
    return { status: "changed", data: result.data, outboxId: result.outboxIds[0] };
  }

  // 영주 수익 순위 조회와 총괄 운영자 전역 초기화를 같은 rollout 경계에서 처리합니다.
  async handleLordIncomeCommand(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const reset = input.message === "/영주수익순위초기화";
    const commandCode = reset ? "ADMIN_LORD_INCOME_RESET" : "LORD_INCOME_RANK_READ";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const service = new LordIncomeService(this.database);
    if (!reset) {
      const result = await service.readRanking({ idempotencyKey: input.eventId, sourceEventId: input.eventId,
        destinationId: input.channelId, externalUserId: input.externalUserId });
      return { status: "changed", data: result.data, outboxId: result.outboxId };
    }
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='game.currency.change' LIMIT 1`, [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "영주수익순위 초기화 권한이 없습니다.", 403);
    const result = await service.reset({ idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operators[0]!.operator_id.toString() });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 총괄 운영자 인증 횟수 초기화를 rollout·권한·원자 transaction 경계에서 처리합니다.
  async handleAuthCheckCountReset(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_AUTH_CHECK_COUNT_RESET";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='admin.check_count.reset' LIMIT 1`, [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "인증초기화 권한이 없습니다.", 403);
    const result = await new AuthCheckCountResetService(this.database).reset({ idempotencyKey: input.eventId,
      sourceEventId: input.eventId, destinationId: input.channelId, operatorId: operators[0]!.operator_id.toString() });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 관리자 요청 감지 설정 조회·변경을 rollout과 versioned singleton transaction으로 처리합니다.
  async handleRequestMonitorConfig(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_REQUEST_MONITOR_CONFIG";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='admin.request_monitor.configure' LIMIT 1`, [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "요청 설정 권한이 없습니다.", 403);
    const result = await new RequestMonitorConfigService(this.database).handle({ command: parseRequestMonitorConfigCommand(input.message),
      idempotencyKey: input.eventId, sourceEventId: input.eventId, destinationId: input.channelId, operatorId: operators[0]!.operator_id.toString() });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 관리자 요청 예외 명령·방 add/delete를 rollout과 versioned singleton transaction으로 처리합니다.
  async handleRequestMonitorException(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_REQUEST_MONITOR_EXCEPTION_CONFIG";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='admin.request_monitor.configure' LIMIT 1`, [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "요청 예외 설정 권한이 없습니다.", 403);
    const result = await new RequestMonitorExceptionService(this.database).handle({ command: parseRequestMonitorExceptionCommand(input.message),
      idempotencyKey: input.eventId, sourceEventId: input.eventId, destinationId: input.channelId, operatorId: operators[0]!.operator_id.toString() });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 총괄 운영자 주간 횟수 수정·초기화를 stable current-date row transaction으로 처리합니다.
  async handleWeeklyQuestCount(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_WEEKLY_QUEST_COUNT_MUTATE";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='admin.weekly_quest_count.manage' LIMIT 1`, [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "주간 횟수 관리 권한이 없습니다.", 403);
    const result = await new WeeklyQuestCountService(this.database).handle({ command: parseWeeklyQuestCountCommand(input.message),
      idempotencyKey: input.eventId, sourceEventId: input.eventId, destinationId: input.channelId, operatorId: operators[0]!.operator_id.toString() });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // 총괄 운영자는 전역, 일반 운영자는 등록된 관리자방에서만 운영 주기를 초기화합니다.
  async handleOperationIntervalReset(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_OPERATION_INTERVAL_RESET";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint; role_code: string }>>(
      `SELECT mapping.operator_id,role.code AS role_code FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='admin.operation_interval.reset'
       ORDER BY role.code='super_admin' DESC LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "주기리셋 권한이 없습니다.", 403);
    if (operator.role_code !== "super_admin") {
      const scopes = await this.database.query<Array<{ allowed: number }>>(
        "SELECT 1 AS allowed FROM operation_interval_room_scopes WHERE provider_code='iris' AND destination_id=? AND active=TRUE LIMIT 1",
        [input.channelId]
      );
      if (scopes[0] === undefined) throw new ApplicationError("FORBIDDEN", "주기리셋은 지정된 관리자방에서만 실행할 수 있습니다.", 403);
    }
    const result = await new OperationIntervalResetService(this.database).reset({
      idempotencyKey: input.eventId, sourceEventId: input.eventId, destinationId: input.channelId, operatorId: operator.operator_id.toString()
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // rollout과 운영자 권한을 확인한 뒤 차원의 문 전역 설정을 변경합니다.
  async handleGuildTerritoryDimensionGate(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "GUILD_TERRITORY_DIMENSION_GATE_TOGGLE";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='guild.territory.dimension_gate.configure' LIMIT 1`, [input.externalUserId]
    );
    if (operators[0] === undefined) throw new ApplicationError("FORBIDDEN", "❌ 차원의 문 설정은 관리자만 변경할 수 있습니다.", 403);
    const result = await new GuildTerritoryDimensionGateService(this.database).setEnabled({
      command: parseGuildTerritoryDimensionGateCommand(input.message), idempotencyKey: input.eventId,
      sourceEventId: input.eventId, destinationId: input.channelId, operatorId: operators[0]!.operator_id.toString()
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // rollout과 운영자 권한을 확인한 뒤 특별 펫홈 뱃지를 원자 지급합니다.
  async handleSpecialBadgeGrant(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_SPECIAL_BADGE_GRANT";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "ROLLOUT_ACTIVE", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint; display_name: string }>>(
      `SELECT operator.id operator_id,operator.display_name FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='pet_home.special_badge.grant' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "❌ 특별 뱃지 관리 권한이 없습니다.", 403);
    const result = await new SpecialBadgeGrantService(this.database).grant({
      message: input.message, idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString(), operatorDisplayName: operator.display_name
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  // rollout과 운영자 권한을 확인한 뒤 특별 펫홈 뱃지를 원자 회수합니다.
  async handleSpecialBadgeRevoke(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const commandCode = "ADMIN_SPECIAL_BADGE_REVOKE";
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]
    );
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey: commandCode });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey: commandCode });
      return { status: "shadow" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey: commandCode });
    const operators = await this.database.query<Array<{ operator_id: bigint; display_name: string }>>(
      `SELECT mapping.operator_id,operator.display_name FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.code IN ('super_admin','manager') AND role.active=TRUE
       JOIN admin_role_permissions permission ON permission.role_id=role.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code='pet_home.special_badge.revoke' LIMIT 1`, [input.externalUserId]
    );
    const operator = operators[0];
    if (operator === undefined) throw new ApplicationError("FORBIDDEN", "❌ 특별 뱃지 관리 권한이 없습니다.", 403);
    const result = await new SpecialBadgeRevokeService(this.database).revoke({
      message: input.message, idempotencyKey: input.eventId, sourceEventId: input.eventId,
      destinationId: input.channelId, operatorId: operator.operator_id.toString(), operatorDisplayName: operator.display_name
    });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }
}

// 포인트수정 후보를 전체 형식으로 제한해 접미 문구 실행을 막습니다.
export function isPointEditCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && (/^\/포인트수정\s+.+?\s+\d{1,27}$/.test(message) || isHoiLandEditCommandCandidate(message)
    || isLordIncomeCommandCandidate(message) || isAuthCheckCountResetCommand(message) || isRequestMonitorConfigCommandCandidate(message)
    || isRequestMonitorExceptionCommandCandidate(message) || isWeeklyQuestCountCommandCandidate(message)
    || isOperationIntervalResetCommand(message) || isGuildTerritoryDimensionGateCommand(message)
    || isSpecialBadgeGrantCommandCandidate(message) || isSpecialBadgeRevokeCommandCandidate(message) || isPetDataSyncCommand(message) || isPetDataCompareCommand(message)
    || isTrialTowerSyncCommand(message)
    || isTrialTowerAdminModifyCommandCandidate(message)
    || isTrialTowerSeasonLifecycleCommand(message)
    || isTrialTowerSeasonResetCommand(message)
    || isAutoExploreSchedulerStartCommand(message)
    || isPetMemberCharacterCountCommand(message) || isPetTitleSyncCommand(message) || isPetTitleAddCommandCandidate(message)
    || isPetTitleStoreResetCommand(message) || isRetiredRingCommandCandidate(message) || isRingRewardClaimCommand(message)
    || isRingReadCommandCandidate(message) || isRingRewardUseCommand(message) || isSpiritEnhanceCommand(message)
    || isSpiritAttributeCommandCandidate(message) || isMiniPetDuelResetGrantCommandCandidate(message)
    || isPetDungeonEntryGrantCommandCandidate(message) || isMiniPetDrawGrantCommandCandidate(message)
    || isPetSkillBookGrantCommandCandidate(message) || isPetResetCommandCandidate(message)
    || isPetOwnerReadCommand(message));
}

// 운영 수정 후보를 공백이 포함된 대상명과 마지막 정수의 전체 형식으로 제한합니다.
export function isHoiLandEditCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && /^\/수정\s+.+?\s+\d{1,27}$/.test(message);
}

// 영주 수익 순위 조회와 초기화는 두 정확 일치 명령만 후보로 허용합니다.
export function isLordIncomeCommandCandidate(message: string | undefined): boolean {
  return message === "/영주수익순위" || message === "/영주수익순위초기화";
}
