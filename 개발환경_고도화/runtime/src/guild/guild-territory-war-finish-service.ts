import { createHash, randomUUID } from "node:crypto";
import { resolveCanonicalCurrencyCode } from "../currency/currency-code-scope-resolver.js";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { resolveGuildTerritoryWarAuthority } from "./guild-territory-war-authority.js";

const COMMAND="/길드영지종료",COMMAND_CODE="GUILD_TERRITORY_WAR_FINISH",SCOPE="world",RULE_SCOPE="world-finish",RULE_VERSION=1n;
type Trigger="manual"|"auto"|"event";
type LifecycleAction="settle"|"cancel_pending"|"inactive";
type Json=Record<string,unknown>;
interface Operator{operator_id:bigint}
interface War{id:bigint;war_key:string;active:number;lifecycle_state:string;start_operation_id:bigint|null;started_at:Date|null;version:bigint}
interface Occupation{territory_no:bigint;territory_name:string;owner_guild_id:bigint|null;owner_player_id:bigint|null}
interface Rule{rank_from:number;rank_to:number;reward_json:string|Json;guide_text:string}
interface Profile{guild_id:bigint;territory_booster:bigint;tax_rate:string}

export interface GuildTerritoryWarFinishInput{eventId:string;channelId:string;trigger:Trigger;operatorId?:bigint;expectedWarVersion?:bigint}
export interface GuildTerritoryWarFinishResult{status:"finished"|"cancelled_pending"|"inactive";warId:string;warKey:string;finishKey:string;trigger:Trigger;lifecycleBefore:string;lifecycleAfter:string;warVersionBefore:string;warVersionAfter:string;occupiedTerritories:number;rewardedGuilds:number;pendingTransitionsSkipped:number;data:string;outboxId:string;auditId:string}
export type GuildTerritoryWarFinishIrisResult=null|{status:"shadow"}|{status:"handled_no_reply"}|{status:"changed";result:GuildTerritoryWarFinishResult};

// exact 종료 명령만 공용 dispatcher 후보로 인정합니다.
export function isGuildTerritoryWarFinishCommand(message:string|undefined):boolean{return message===COMMAND;}

// 현재 영지전 상태를 정산·대기취소·무변화 중 하나로 분류합니다.
export function classifyGuildTerritoryWarFinish(active:boolean|number,lifecycle:string):LifecycleAction{return resolveGuildTerritoryWarAuthority(active,lifecycle)?"settle":lifecycle==="PENDING_START"?"cancel_pending":"inactive";}

// 수동·자동·전투 종료를 하나의 회차 키와 DB transaction으로 정산합니다.
export class GuildTerritoryWarFinishService{
  constructor(private readonly database:DatabaseClient){}

  async handleIris(input:{eventId:string;externalUserId:string;channelId:string;message:string}):Promise<GuildTerritoryWarFinishIrisResult>{
    if(!isGuildTerritoryWarFinishCommand(input.message))return null;
    const registry=(await this.database.query<Array<{rollout_state:string;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=?",[COMMAND_CODE]))[0];
    if(registry===undefined||registry.enabled!==1||registry.rollout_state==="LEGACY_ONLY")return null;
    if(registry.rollout_state!=="ACTIVE")return {status:"shadow"};
    const operator=(await this.database.query<Operator[]>(`SELECT operator_row.id operator_id FROM external_identities identity JOIN admin_operator_external_identities link ON link.external_identity_id=identity.id JOIN admin_operators operator_row ON operator_row.id=link.operator_id AND operator_row.status='active' JOIN guild_territory_finish_operator_allowlist allow_row ON allow_row.operator_id=operator_row.id AND allow_row.external_channel_id=? AND allow_row.active=TRUE WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,[input.channelId,input.externalUserId]))[0];
    if(operator===undefined)return {status:"handled_no_reply"};
    return {status:"changed",result:await this.finish({eventId:input.eventId,channelId:input.channelId,trigger:"manual",operatorId:operator.operator_id})};
  }

  async finish(input:GuildTerritoryWarFinishInput):Promise<GuildTerritoryWarFinishResult>{
    const key=eventKey(input.eventId);
    return retryDeadlock(()=>this.database.withTransaction(async tx=>{
      const prior=(await tx.query<Array<{result_json:string|GuildTerritoryWarFinishResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[`guild.territory.finish:${input.trigger}`,key]))[0];
      if(prior?.result_json!=null)return parseResult(prior.result_json);
      if(input.trigger==="manual")await this.requireOperator(tx,input.operatorId,input.channelId);
      const scope=(await tx.query<Array<{war_id:bigint}>>("SELECT war_id FROM guild_territory_start_scopes WHERE scope_code=? FOR UPDATE",[SCOPE]))[0];
      if(scope===undefined)throw new ApplicationError("GUILD_TERRITORY_FINISH_SCOPE_MISSING","길드 영지전 범위를 찾을 수 없습니다.",409);
      const war=(await tx.query<War[]>("SELECT id,war_key,active,lifecycle_state,start_operation_id,started_at,version FROM guild_territory_wars WHERE id=? FOR UPDATE",[scope.war_id]))[0];
      if(war===undefined)throw new ApplicationError("GUILD_TERRITORY_FINISH_WAR_MISSING","길드 영지전 상태를 찾을 수 없습니다.",404);
      const finishKey=generationKey(war),existing=(await tx.query<Array<{result_json:string|GuildTerritoryWarFinishResult}>>("SELECT result_json FROM guild_territory_finish_runs WHERE finish_key=? FOR UPDATE",[finishKey]))[0];
      if(existing!==undefined)return parseResult(existing.result_json);
      if(input.expectedWarVersion!==undefined&&war.version!==input.expectedWarVersion)throw new ApplicationError("GUILD_TERRITORY_FINISH_VERSION_CONFLICT","길드 영지전 상태가 먼저 변경되었습니다.",409);
      const actorType=input.trigger==="manual"?"admin_operator":"system",actorId=input.trigger==="manual"?input.operatorId??null:null;
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,?,?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),`guild.territory.finish:${input.trigger}`,key,actorType,actorId]);
      const action=classifyGuildTerritoryWarFinish(war.active,war.lifecycle_state);
      if(action!=="settle")return this.completeNonSettlement(tx,input,war,finishKey,operation.insertId,action,actorType,actorId);
      const occupations=await tx.query<Occupation[]>("SELECT territory_no,territory_name,owner_guild_id,owner_player_id FROM guild_territory_occupations WHERE war_id=? ORDER BY territory_no FOR UPDATE",[war.id]);
      if(occupations.length!==7||occupations.some((row,index)=>row.territory_no!==BigInt(index+1)))throw new ApplicationError("GUILD_TERRITORY_FINISH_OCCUPATIONS_INVALID","영지 7곳의 상태가 완전하지 않습니다.",409);
      const rules=await this.loadRules(tx);
      const ownerSnapshot=occupations.map(row=>({territoryNo:row.territory_no.toString(),territoryName:row.territory_name,ownerGuildId:row.owner_guild_id?.toString()??null,ownerPlayerId:row.owner_player_id?.toString()??null}));
      const rankingSnapshot=ownerSnapshot.filter(row=>row.ownerGuildId!==null);
      const run=await tx.execute("INSERT INTO guild_territory_finish_runs(finish_key,operation_id,war_id,generation_operation_id,trigger_code,lifecycle_before,lifecycle_after,war_version_before,war_version_after,owner_snapshot_json,ranking_snapshot_json,result_json) VALUES (?,?,?,?,? ,?,'READY',?,?,?,? ,JSON_OBJECT())",[finishKey,operation.insertId,war.id,war.start_operation_id,input.trigger,war.lifecycle_state,war.version,war.version+1n,JSON.stringify(ownerSnapshot),JSON.stringify(rankingSnapshot)]);
      const summaries=await this.applyRewards(tx,operation.insertId,run.insertId,occupations,rules);
      const skipped=await tx.execute("UPDATE guild_territory_scheduled_transitions SET status='SKIPPED',completed_at=UTC_TIMESTAMP(3),version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE war_id=? AND status='PENDING'",[war.id]);
      await tx.execute("UPDATE guild_territory_turns SET turn_state=CASE WHEN turn_state='ACTIVE' THEN 'COMPLETED' ELSE 'SKIPPED' END WHERE war_id=? AND turn_state IN ('ACTIVE','PENDING')",[war.id]);
      const changed=await tx.execute("UPDATE guild_territory_wars SET active=FALSE,lifecycle_state='READY',start_ready=FALSE,pending_start_token=NULL,pending_start_due_at=NULL,opening_token=NULL,opening_due_at=NULL,current_turn_no=0,turn_deadline_at=NULL,rift_event_status=NULL,rift_event_at=NULL,rift_event_guild_id=NULL,version=version+1 WHERE id=? AND version=?",[war.id,war.version]);
      if(changed.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_FINISH_VERSION_CONFLICT","길드 영지전 상태가 먼저 변경되었습니다.",409);
      const data="✅ 길드 영지전이 종료되었습니다.",outbox=await this.outbox(tx,operation.insertId,input.channelId,data),audit=await this.audit(tx,operation.insertId,actorType,actorId,war.id,"finished",{finishKey,occupiedTerritories:rankingSnapshot.length,rewardedGuilds:summaries.size,pendingTransitionsSkipped:Number(skipped.affectedRows)});
      const result:GuildTerritoryWarFinishResult={status:"finished",warId:war.id.toString(),warKey:war.war_key,finishKey,trigger:input.trigger,lifecycleBefore:war.lifecycle_state,lifecycleAfter:"READY",warVersionBefore:war.version.toString(),warVersionAfter:(war.version+1n).toString(),occupiedTerritories:rankingSnapshot.length,rewardedGuilds:summaries.size,pendingTransitionsSkipped:Number(skipped.affectedRows),data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};
      await this.finishOperation(tx,input.eventId,operation.insertId,result);await tx.execute("UPDATE guild_territory_finish_runs SET result_json=? WHERE id=?",[JSON.stringify(result),run.insertId]);return result;
    }));
  }

  private async requireOperator(tx:DatabaseTransaction,operatorId:bigint|undefined,channelId:string):Promise<void>{
    if(operatorId===undefined)throw new ApplicationError("GUILD_TERRITORY_FINISH_OPERATOR_REQUIRED","종료 권한이 없습니다.",403);
    const row=(await tx.query<Operator[]>("SELECT operator_id FROM guild_territory_finish_operator_allowlist WHERE operator_id=? AND external_channel_id=? AND active=TRUE FOR UPDATE",[operatorId,channelId]))[0];
    if(row===undefined)throw new ApplicationError("GUILD_TERRITORY_FINISH_OPERATOR_DENIED","종료 권한이 없습니다.",403);
  }

  private async loadRules(tx:DatabaseTransaction):Promise<Rule[]>{
    const version=(await tx.query<Array<{status:string}>>("SELECT status FROM guild_territory_reward_rule_versions WHERE territory_scope_code=? AND rule_version=? FOR UPDATE",[RULE_SCOPE,RULE_VERSION]))[0];
    if(version?.status!=="published")throw new ApplicationError("GUILD_TERRITORY_FINISH_RULE_UNAVAILABLE","영지 종료 보상 규칙을 찾을 수 없습니다.",503);
    const rows=await tx.query<Rule[]>("SELECT rank_from,rank_to,reward_json,guide_text FROM guild_territory_reward_rule_tiers WHERE territory_scope_code=? AND rule_version=? ORDER BY rank_from FOR UPDATE",[RULE_SCOPE,RULE_VERSION]);
    if(rows.length!==7||rows.some((row,index)=>row.rank_from!==index+1||row.rank_to!==index+1))throw new ApplicationError("GUILD_TERRITORY_FINISH_RULE_INVALID","영지 종료 보상 규칙이 완전하지 않습니다.",503);
    return rows;
  }

  private async applyRewards(tx:DatabaseTransaction,operationId:bigint,runId:bigint,occupations:Occupation[],rules:Rule[]):Promise<Map<string,{count:number;scoreDelta:bigint}>>{
    const guildIds=[...new Set(occupations.flatMap(row=>row.owner_guild_id===null?[]:[row.owner_guild_id.toString()]))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    const summaries=new Map<string,{count:number;scoreDelta:bigint}>();if(guildIds.length===0){for(const row of occupations)await this.entry(tx,runId,row,rules[Number(row.territory_no)-1]!,"unoccupied");return summaries;}
    const marks=guildIds.map(()=>"?").join(",");await tx.query(`SELECT id FROM guilds WHERE id IN (${marks}) ORDER BY id FOR UPDATE`,guildIds);
    for(const guildId of guildIds){await tx.execute("INSERT IGNORE INTO guild_profile_details(guild_id) VALUES (?)",[guildId]);await tx.execute("INSERT IGNORE INTO guild_territory_score_accounts(guild_id,score,version) VALUES (?,0,0)",[guildId]);}
    const profiles=await tx.query<Profile[]>(`SELECT guild_id,territory_booster,CAST(tax_rate AS CHAR) tax_rate FROM guild_profile_details WHERE guild_id IN (${marks}) ORDER BY guild_id FOR UPDATE`,guildIds),profileMap=new Map(profiles.map(row=>[row.guild_id.toString(),row]));
    let warehouseSeq=0,resourceSeq=0,scoreSeq=0;
    for(const row of occupations){const rule=rules[Number(row.territory_no)-1]!;if(row.owner_guild_id===null){await this.entry(tx,runId,row,rule,"unoccupied");continue;}const guildId=row.owner_guild_id.toString(),reward=json(rule.reward_json),summary=summaries.get(guildId)??{count:0,scoreDelta:0n};summary.count++;summaries.set(guildId,summary);
      if(reward.kind==="tax_rate")await tx.execute("UPDATE guild_profile_details SET tax_rate=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=?",[String(reward.taxRatePercent),guildId]);
      else if(reward.kind==="warehouse_item"){warehouseSeq++;await this.grantWarehouse(tx,operationId,warehouseSeq,guildId,String(reward.itemCode),BigInt(String(reward.quantity)));}
      else if(reward.kind==="guild_resource"){resourceSeq++;await this.grantResource(tx,operationId,resourceSeq,guildId,String(reward.currencyCode),String(reward.amount));}
      else if(reward.kind==="fund_score"){resourceSeq++;await this.grantResource(tx,operationId,resourceSeq,guildId,String(reward.currencyCode),String(reward.amount));const delta=BigInt(String(reward.territoryScore));scoreSeq++;const after=await this.grantScore(tx,operationId,scoreSeq,guildId,row.territory_no,delta);summary.scoreDelta+=delta;void after;}
      else throw new ApplicationError("GUILD_TERRITORY_FINISH_REWARD_KIND_INVALID","지원하지 않는 종료 보상입니다.",503);
      await this.entry(tx,runId,row,rule,"granted");}
    for(const guildId of guildIds){const profile=profileMap.get(guildId)!;await tx.execute("UPDATE guild_profile_details SET territory_booster=0,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=?",[guildId]);const score=(await tx.query<Array<{score:bigint}>>("SELECT score FROM guild_territory_score_accounts WHERE guild_id=?",[guildId]))[0]!.score,tax=(await tx.query<Array<{tax_rate:string}>>("SELECT CAST(tax_rate AS CHAR) tax_rate FROM guild_profile_details WHERE guild_id=?",[guildId]))[0]!.tax_rate,summary=summaries.get(guildId)!;await tx.execute("INSERT INTO guild_territory_finish_guild_summaries(finish_run_id,guild_id,territory_count,score_delta,score_after,booster_before,booster_after,tax_rate_after) VALUES (?,?,?,?,?,?,0,?)",[runId,guildId,summary.count,summary.scoreDelta,score,profile.territory_booster,tax]);}
    return summaries;
  }

  private async entry(tx:DatabaseTransaction,runId:bigint,row:Occupation,rule:Rule,status:"granted"|"unoccupied"){await tx.execute("INSERT INTO guild_territory_finish_entries(finish_run_id,territory_no,owner_guild_id,owner_player_id,reward_json,reward_status) VALUES (?,?,?,?,?,?)",[runId,row.territory_no,row.owner_guild_id,row.owner_player_id,JSON.stringify(json(rule.reward_json)),status]);}
  private async grantWarehouse(tx:DatabaseTransaction,operationId:bigint,sequence:number,guildId:string,itemCode:string,delta:bigint){const item=(await tx.query<Array<{id:bigint}>>("SELECT id FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE FOR UPDATE",[itemCode]))[0];if(item===undefined)throw new ApplicationError("GUILD_TERRITORY_FINISH_ITEM_MISSING",`종료 보상 아이템 ${itemCode}을 찾을 수 없습니다.`,503);await tx.execute("INSERT IGNORE INTO guild_warehouse_stacks(guild_id,item_id,quantity,version) VALUES (?,?,0,0)",[guildId,item.id]);const stack=(await tx.query<Array<{quantity:bigint;version:bigint}>>("SELECT quantity,version FROM guild_warehouse_stacks WHERE guild_id=? AND item_id=? FOR UPDATE",[guildId,item.id]))[0]!,after=stack.quantity+delta;await tx.execute("UPDATE guild_warehouse_stacks SET quantity=?,version=version+1 WHERE guild_id=? AND item_id=? AND version=?",[after,guildId,item.id,stack.version]);await tx.execute("INSERT INTO guild_warehouse_ledger(operation_id,sequence_no,guild_id,item_id,quantity_delta,quantity_after,reason_code) VALUES (?,?,?,?,?,?,'guild_territory_finish_reward')",[operationId,sequence,guildId,item.id,delta,after]);}
  private async grantResource(tx:DatabaseTransaction,operationId:bigint,sequence:number,guildId:string,currencyCode:string,delta:string){const canonicalCurrencyCode=resolveCanonicalCurrencyCode({providerContext:"GUILD_REWARD",ownerScope:"GUILD",sourceCode:currencyCode});await tx.execute("INSERT IGNORE INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,?,0,0)",[guildId,canonicalCurrencyCode]);const account=(await tx.query<Array<{balance:string;version:bigint}>>("SELECT CAST(balance AS CHAR) balance,version FROM guild_resource_accounts WHERE guild_id=? AND currency_code=? FOR UPDATE",[guildId,canonicalCurrencyCode]))[0]!,after=(BigInt(account.balance.split('.')[0]??"0")+BigInt(delta)).toString();await tx.execute("UPDATE guild_resource_accounts SET balance=?,version=version+1 WHERE guild_id=? AND currency_code=? AND version=?",[after,guildId,canonicalCurrencyCode,account.version]);await tx.execute("INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,?,?,?,?,?, 'guild_territory_finish_reward')",[operationId,sequence,guildId,canonicalCurrencyCode,delta,after]);}
  private async grantScore(tx:DatabaseTransaction,operationId:bigint,sequence:number,guildId:string,territoryNo:bigint,delta:bigint):Promise<bigint>{const account=(await tx.query<Array<{score:bigint;version:bigint}>>("SELECT score,version FROM guild_territory_score_accounts WHERE guild_id=? FOR UPDATE",[guildId]))[0]!,after=account.score+delta;await tx.execute("UPDATE guild_territory_score_accounts SET score=?,version=version+1 WHERE guild_id=? AND version=?",[after,guildId,account.version]);await tx.execute("INSERT INTO guild_territory_score_ledger(operation_id,sequence_no,guild_id,territory_no,score_delta,score_after,reason_code) VALUES (?,?,?,?,?,?,'guild_territory_finish_reward')",[operationId,sequence,guildId,territoryNo,delta,after]);return after;}

  private async completeNonSettlement(tx:DatabaseTransaction,input:GuildTerritoryWarFinishInput,war:War,finishKey:string,operationId:bigint,action:Exclude<LifecycleAction,"settle">,actorType:string,actorId:bigint|null):Promise<GuildTerritoryWarFinishResult>{let after=war.lifecycle_state,version=war.version,skipped=0,status:GuildTerritoryWarFinishResult["status"]="inactive",data="현재 진행 중인 길드 영지전이 없습니다.";if(action==="cancel_pending"){const transitions=await tx.execute("UPDATE guild_territory_scheduled_transitions SET status='SKIPPED',completed_at=UTC_TIMESTAMP(3),version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE war_id=? AND status='PENDING'",[war.id]);skipped=Number(transitions.affectedRows);await tx.execute("UPDATE guild_territory_turns SET turn_state='SKIPPED' WHERE war_id=? AND turn_state='PENDING'",[war.id]);const write=await tx.execute("UPDATE guild_territory_wars SET lifecycle_state='READY',start_ready=FALSE,pending_start_token=NULL,pending_start_due_at=NULL,opening_token=NULL,opening_due_at=NULL,current_turn_no=0,turn_deadline_at=NULL,version=version+1 WHERE id=? AND version=?",[war.id,war.version]);if(write.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_FINISH_VERSION_CONFLICT","길드 영지전 상태가 먼저 변경되었습니다.",409);after="READY";version++;status="cancelled_pending";data="길드 영지전 시작 대기를 취소했습니다.";}
    const outbox=await this.outbox(tx,operationId,input.channelId,data),audit=await this.audit(tx,operationId,actorType,actorId,war.id,status,{finishKey,pendingTransitionsSkipped:skipped}),result:GuildTerritoryWarFinishResult={status,warId:war.id.toString(),warKey:war.war_key,finishKey,trigger:input.trigger,lifecycleBefore:war.lifecycle_state,lifecycleAfter:after,warVersionBefore:war.version.toString(),warVersionAfter:version.toString(),occupiedTerritories:0,rewardedGuilds:0,pendingTransitionsSkipped:skipped,data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString()};await tx.execute("INSERT INTO guild_territory_finish_runs(finish_key,operation_id,war_id,generation_operation_id,trigger_code,lifecycle_before,lifecycle_after,war_version_before,war_version_after,owner_snapshot_json,ranking_snapshot_json,result_json) VALUES (?,?,?,?,?,?,?,?,?,JSON_ARRAY(),JSON_ARRAY(),?)",[finishKey,operationId,war.id,war.start_operation_id,input.trigger,war.lifecycle_state,after,war.version,version,JSON.stringify(result)]);await this.finishOperation(tx,input.eventId,operationId,result);return result;}
  private outbox(tx:DatabaseTransaction,operationId:bigint,channelId:string,data:string){return tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operationId,channelId,JSON.stringify({data})]);}
  private audit(tx:DatabaseTransaction,operationId:bigint,actorType:string,actorId:bigint|null,warId:bigint,resultCode:string,summary:Json){return tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,?,?,'guild_territory_war',?,'guild.territory.finish',?,'Iris guild territory finish',?,UTC_TIMESTAMP(3))",[operationId,actorType,actorId,warId,resultCode,JSON.stringify(summary)]);}
  private async finishOperation(tx:DatabaseTransaction,eventId:string,operationId:bigint,result:GuildTerritoryWarFinishResult){await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[eventId,COMMAND_CODE,operationId,result.status]);await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operationId]);}
}

function eventKey(value:string):string{const trimmed=value.trim();return trimmed.length<=191?trimmed:createHash("sha256").update(trimmed).digest("hex");}
function generationKey(war:War):string{return war.start_operation_id===null?`war:${war.id}:legacy:${war.started_at?.toISOString()??war.version}`:`war:${war.id}:operation:${war.start_operation_id}`;}
function json(value:string|Json):Json{return typeof value==="string"?JSON.parse(value) as Json:value;}
function parseResult(value:string|GuildTerritoryWarFinishResult):GuildTerritoryWarFinishResult{return typeof value==="string"?JSON.parse(value) as GuildTerritoryWarFinishResult:value;}
async function retryDeadlock<T>(work:()=>Promise<T>):Promise<T>{for(let attempt=0;;attempt++){try{return await work();}catch(error){const dbError=error as {errno?:number;code?:string};if(attempt>=2||(dbError.errno!==1213&&dbError.errno!==1205&&dbError.code!=="ER_LOCK_DEADLOCK"&&dbError.code!=="ER_LOCK_WAIT_TIMEOUT"))throw error;await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)));}}}
