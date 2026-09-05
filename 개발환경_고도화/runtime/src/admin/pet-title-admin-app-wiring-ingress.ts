import { createHash } from "node:crypto";
import type { PlayerContextPort, PlayerTarget } from "../account-platform/player-context-provider.js";
import type { AppWiringMutationParticipant } from "../dispatch/app-wiring-operation-provider.js";
import { MariaAppWiringOperationProvider } from "../dispatch/app-wiring-operation-provider.js";
import type { CommandDispatcher } from "../dispatch/command-dispatcher.js";
import { executeAppWiringMutationReplyEntrypoint } from "../dispatch/app-wiring-entrypoint-runner.js";
import type { PetTitleCanonicalMutationProvider } from "../pet/pet-title-canonical-mutation-provider.js";
import { ApplicationError } from "../shared/application-error.js";
import type { PetTitleAddCommand } from "./pet-title-add-service.js";

export interface PetTitleAdminIngressInput {
  readonly externalUserId:string;
  readonly channelId:string;
  readonly message:string;
  readonly eventId:string;
}

export interface PetTitleAdminIngressResult {
  readonly status:"changed";
  readonly data:string;
  readonly outboxId:string;
  readonly replayed:boolean;
  readonly resultFingerprint:string;
}
export type PetTitleAdminDispatchResult=PetTitleAdminIngressResult|{readonly status:"shadow"|"legacy_fallback"};

function externalRequestId(value:string):string{
  return /^[A-Za-z0-9._:@/-]{1,172}$/.test(value)?value:`sha256:${createHash("sha256").update(value,"utf8").digest("hex")}`;
}

// 호출 방의 활성 계정 선택과 운영자 권한 행을 같은 transaction에서 잠급니다.
async function lockOperatorContext(database:AppWiringMutationParticipant,input:PetTitleAdminIngressInput,roles:readonly string[]):Promise<string>{
  const contexts=await database.query<Array<{active_player_selection_id:string}>>(
    `SELECT selection.active_player_selection_id
       FROM account_platform_identities platform_identity
       JOIN account_platform_context_memberships membership
         ON membership.platform_identity_id=platform_identity.platform_identity_id AND membership.membership_status='ACTIVE'
       JOIN account_platform_contexts context_row
         ON context_row.platform_context_id=membership.platform_context_id AND context_row.context_status='ACTIVE'
       JOIN account_platform_active_player_selections selection
         ON selection.platform_context_membership_id=membership.platform_context_membership_id AND selection.selection_status='ACTIVE'
      WHERE platform_identity.platform_code='KAKAO' AND platform_identity.identity_scope_key=?
        AND platform_identity.external_user_key=? AND platform_identity.identity_status='ACTIVE'
        AND context_row.context_type='ROOM' AND context_row.external_context_key=? FOR UPDATE`,
    [input.channelId,input.externalUserId,input.channelId],
  );
  if(contexts.length!==1)throw new ApplicationError("PET_TITLE_ADMIN_CONTEXT_REQUIRED","활성 게임계정이 선택된 운영방에서 실행해 주세요.",409);
  const operators=await database.query<Array<{operator_id:bigint|string}>>(
    `SELECT DISTINCT mapping.operator_id FROM external_identities identity_row
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity_row.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
       WHERE identity_row.provider_code='kakao' AND identity_row.external_user_id=? AND identity_row.status='linked'
         AND role.code IN (${roles.map(()=>"?").join(",")}) ORDER BY mapping.operator_id LIMIT 2 FOR UPDATE`,
    [input.externalUserId,...roles],
  );
  if(operators.length!==1)throw new ApplicationError("FORBIDDEN","펫타이틀 관리 권한이 없습니다.",403);
  return BigInt(operators[0]!.operator_id).toString();
}

// 표시명 조회 결과를 legacy player와 canonical crosswalk까지 잠가 지급 대상을 고정합니다.
async function lockTarget(database:AppWiringMutationParticipant,target:PlayerTarget,targetName:string):Promise<void>{
  const rows=await database.query<Array<{player_id:bigint|string;canonical_player_id:string}>>(
    `SELECT player.id AS player_id,crosswalk.player_id AS canonical_player_id
       FROM players player
       JOIN player_profiles profile ON profile.player_id=player.id
       JOIN external_identities identity_row ON identity_row.player_id=player.id AND identity_row.status='linked'
       JOIN canonical_player_identity_crosswalks crosswalk ON crosswalk.provider_code=identity_row.provider_code
        AND crosswalk.external_user_id=identity_row.external_user_id AND crosswalk.crosswalk_status='LINKED'
      WHERE player.id=? AND player.status='active' AND player.deleted_at IS NULL
        AND BINARY profile.current_display_name=BINARY ? AND crosswalk.player_id=? FOR UPDATE`,
    [target.legacyPlayerId,targetName,target.canonicalPlayerId],
  );
  const pairs=new Set(rows.map(row=>`${BigInt(row.player_id)}:${row.canonical_player_id}`));
  if(pairs.size!==1)throw new ApplicationError("PLAYER_CONTEXT_MAPPING_DRIFT","펫타이틀 지급 대상 연결이 변경되었습니다.",409);
}

// 실제 Iris 관리자 명령을 공용 mutation reply coordinator와 typed receipt로 처리합니다.
export class PetTitleAdminAppWiringIngress {
  constructor(
    private readonly provider:MariaAppWiringOperationProvider,
    private readonly dispatcher:CommandDispatcher,
    private readonly contexts:PlayerContextPort,
    private readonly mutations:Pick<PetTitleCanonicalMutationProvider,"adminGrant"|"adminSync"|"adminReset">,
  ){}

  async add(input:PetTitleAdminIngressInput,command:PetTitleAddCommand):Promise<PetTitleAdminDispatchResult>{
    return this.execute(input,"ADMIN_PET_TITLE_ADD","admin_pet_title_add",{targetName:command.targetName,titleName:command.titleName,priceDigits:command.priceDigits},async(database,claim)=>{
      await database.query("SELECT lock_key FROM canonical_pet_title_global_locks WHERE lock_key='PET_TITLE' FOR UPDATE");
      const operatorId=await lockOperatorContext(database,input,["super_admin","manager"]);
      const target=await this.contexts.resolveUniqueLegacyDisplayTarget(database,{targetKey:command.targetName});
      await lockTarget(database,target,command.targetName);
      const result=await this.mutations.adminGrant(database,claim,{actor:`pet_title_admin_operator_${operatorId}`,playerId:target.canonicalPlayerId,titleName:command.titleName,priceDigits:command.priceDigits});
      return {operationId:result.operationId,resultFingerprint:result.resultFingerprint,receiptKind:"PET_TITLE" as const,data:`[${target.displayName}] 님에게\n[${command.titleName}] 펫 타이틀이 부여되었습니다.`};
    });
  }

  async sync(input:PetTitleAdminIngressInput):Promise<PetTitleAdminDispatchResult>{
    const decision=await this.dispatcher.resolveByCodeReadOnly({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},"ADMIN_PET_TITLE_SYNC");
    // 해시형 legacy JSON player key를 해석하는 승인된 active-member authority가 공급되기 전에는 삭제형 sync를 실행하지 않습니다.
    return{status:decision.route==="SHADOW"?"shadow":"legacy_fallback"};
  }

  async reset(input:PetTitleAdminIngressInput):Promise<PetTitleAdminDispatchResult>{
    return this.execute(input,"ADMIN_PET_TITLE_STORE_RESET","admin_pet_title_store_reset",{},async(database,claim)=>{
      await database.query("SELECT lock_key FROM canonical_pet_title_global_locks WHERE lock_key='PET_TITLE' FOR UPDATE");
      const operatorId=await lockOperatorContext(database,input,["super_admin","manager"]);
      const result=await this.mutations.adminReset(database,claim,{actor:`pet_title_admin_operator_${operatorId}`});
      return {operationId:result.operationId,resultFingerprint:result.resultFingerprint,receiptKind:"PET_TITLE_BATCH" as const,data:"✅ 펫 타이틀 데이터 파일이 성공적으로 생성되었습니다."};
    });
  }

  private async execute(input:PetTitleAdminIngressInput,commandCode:string,handlerKey:string,payload:object,handler:(database:AppWiringMutationParticipant,claim:Parameters<PetTitleCanonicalMutationProvider["adminSync"]>[1])=>Promise<{operationId:string;resultFingerprint:string;receiptKind:"PET_TITLE"|"PET_TITLE_BATCH";data:string}>):Promise<PetTitleAdminDispatchResult>{
    const decision=await this.dispatcher.resolveByCodeReadOnly({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},commandCode);
    if(decision.route==="SHADOW")return{status:"shadow"};
    if(decision.route!=="MODERN")return{status:"legacy_fallback"};
    const route={...decision,effectMode:"MUTATION" as const};
    const persisted=await executeAppWiringMutationReplyEntrypoint<{replayed:boolean;resultFingerprint:string}>(this.provider,{
      claim:{entrypointKind:"IRIS",externalRequestId:externalRequestId(input.eventId),normalizedPayload:{channelId:input.channelId,commandCode,message:input.message,...payload},actor:"pet_title_admin_app_wiring"},
      resolveRoute:()=>route,
      handler:async(database,claim)=>{
        const result=await handler(database,claim);
        const typedReceipt=result.receiptKind==="PET_TITLE"
          ?{receiptKind:"PET_TITLE" as const,petTitleOperationId:result.operationId,resultFingerprint:result.resultFingerprint}
          :{receiptKind:"PET_TITLE_BATCH" as const,petTitleBatchOperationId:result.operationId,resultFingerprint:result.resultFingerprint};
        return {value:{replayed:false,resultFingerprint:result.resultFingerprint},reply:{eventId:input.eventId,commandCode,destinationId:input.channelId,data:result.data},receipt:{status:"REPLY_QUEUED",resultFingerprint:result.resultFingerprint},typedReceipt};
      },
      replayCompleted:async(stored)=>({replayed:true,resultFingerprint:stored.result?.resultFingerprint??""}),
      replayFailed:async()=>{throw new Error("PET_TITLE_ADMIN_APP_WIRING_PREVIOUSLY_FAILED");},
      errorCode:error=>error instanceof ApplicationError?error.code:"PET_TITLE_ADMIN_MUTATION_FAILED",
    });
    return {status:"changed",data:persisted.reply.data,outboxId:persisted.reply.outboxId,replayed:persisted.value.replayed,resultFingerprint:persisted.value.resultFingerprint};
  }
}
