import { createHash,randomUUID } from "node:crypto";
import type { DatabaseClient,DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE="GUILD_TERRITORY_WAR_STATE_START",SCOPE_CODE="world",PREPARE_MS=20_000,OPENING_MS=5_000,TURN_MS=5_000;
const PREPARE_MESSAGE="[🏰 길드 영지전 준비 🏰]\n[길드 영지전 20초뒤 시작🏰]\n\n길드영지전쟁에 참여해주신\n길드 여러분 환영합니다.\n\n※ 20초뒤 길드영지전이 시작됩니다.\nhttps://open.kakao.com/o/gaP4Xybh";
const START_MESSAGE="[🎖️길드 영지전 시작🎖️]\n길드 영지전이 시작되었습니다.\n\n'/영지공격 [숫자]' 명령어로 영지를 점령해보세요.\n길드의 '소드마스터🤺'만 영지공격이 가능하며,\n종료 시점에 최종 점령 중인 길드가 해당 영지를 차지합니다.";

export interface GuildTerritoryWarStartInput{eventId:string;externalUserId:string;channelId:string;message:string;}
export interface GuildTerritoryWarStartResult{status:"pending_start";warId:string;warKey:string;generationVersion:string;attackerCount:number;prepareDueAt:string;openingDueAt:string;transitionKeys:string[];data:string;outboxIds:string[];auditId:string;}
export interface GuildTerritoryAttacker{guildId:bigint;guildName:string;guildMark:string|null;playerId:bigint;playerName:string;rankEmoji:string|null;}
interface Options{random?:()=>number;now?:()=>Date;token?:()=>string;}
interface OperatorRow{operator_id:bigint;player_id:bigint;}
interface ScopeRow{war_id:bigint;}
interface WarRow{id:bigint;war_key:string;active:number;lifecycle_state:"READY"|"PENDING_START"|"ACTIVE_OPENING"|"ACTIVE_READY";start_ready:number;pending_start_token:string|null;opening_token:string|null;version:bigint;}
interface ReplayRow{operator_id:bigint;result_json:string|GuildTerritoryWarStartResult;}
interface DestinationRow{destination_id:string;destination_kind:"NOTICE"|"CASTLE";}
interface TransitionRow{transition_key:string;war_id:bigint;transition_code:"START_OPENING"|"ENABLE_ATTACKS";operation_id:bigint;expected_war_version:bigint;payload_json:string|{token:string;generationVersion:string};}
interface TurnRow{ordinal:number;guild_id:bigint;guild_name:string;guild_mark:string|null;attacker_player_id:bigint;player_name:string;rank_emoji:string|null;}

// `/길드영지시작`만 exact command로 허용합니다.
export function isGuildTerritoryWarStateStartCommand(message:string|undefined):boolean{return message==="/길드영지시작";}

// 표본과 선택 인덱스를 함께 반환해 무작위 순서를 DB 원장으로 재현할 수 있게 합니다.
export function shuffleGuildTerritoryAttackers(rows:GuildTerritoryAttacker[],random:()=>number):{rows:GuildTerritoryAttacker[];draws:Array<{drawNo:number;upperBound:number;sample:number;selectedIndex:number}>}{
  const shuffled=rows.slice(),draws:Array<{drawNo:number;upperBound:number;sample:number;selectedIndex:number}>=[];
  for(let i=shuffled.length-1,drawNo=1;i>0;i--,drawNo++){
    const sample=random();if(!Number.isFinite(sample)||sample<0||sample>=1)throw new ApplicationError("INVALID_GUILD_TERRITORY_START_RNG","길드 영지전 순서 표본이 유효하지 않습니다.",500);
    const selectedIndex=Math.floor(sample*(i+1));draws.push({drawNo,upperBound:i+1,sample,selectedIndex});
    const current=shuffled[i]!,selected=shuffled[selectedIndex]!;shuffled[i]=selected;shuffled[selectedIndex]=current;
  }
  return{rows:shuffled,draws};
}

// 기존 20초 준비 안내 문구를 그대로 반환합니다.
export function formatGuildTerritoryPrepareMessage():string{return PREPARE_MESSAGE;}

// 영지전 시작 요청과 두 단계 예약 전이를 원자 기록하고 재시작 가능한 상태기로 진행합니다.
export class GuildTerritoryWarStateStartService{
  private readonly random:()=>number;private readonly now:()=>Date;private readonly token:()=>string;
  constructor(private readonly database:DatabaseClient,options:Options={}){this.random=options.random??Math.random;this.now=options.now??(()=>new Date());this.token=options.token??randomUUID;}

  async handleIris(input:GuildTerritoryWarStartInput):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"}|{status:"legacy_fallback"}>{
    if(!isGuildTerritoryWarStateStartCommand(input.message))throw new ApplicationError("INVALID_GUILD_TERRITORY_START_COMMAND","길드 영지전 시작 명령 형식이 올바르지 않습니다.",422);
    const rollout=(await this.database.query<Array<{rollout_state:string;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]))[0];
    if(rollout===undefined||rollout.enabled!==1||rollout.rollout_state==="LEGACY_ONLY")return{status:"legacy_fallback"};
    if(rollout.rollout_state!=="ACTIVE")return{status:"shadow"};
    const result=await this.start(input);return{status:"changed",data:result.data,outboxId:result.outboxIds[0]??""};
  }

  async start(input:GuildTerritoryWarStartInput):Promise<GuildTerritoryWarStartResult>{
    if(!isGuildTerritoryWarStateStartCommand(input.message))throw new ApplicationError("INVALID_GUILD_TERRITORY_START_COMMAND","길드 영지전 시작 명령 형식이 올바르지 않습니다.",422);
    const operator=await this.findOperator(input.externalUserId),key=eventKey(input.eventId);
    const existing=(await this.database.query<ReplayRow[]>("SELECT operator_id,result_json FROM guild_territory_start_runs WHERE request_key=?",[key]))[0];
    if(existing!==undefined){if(existing.operator_id!==operator.operator_id)throw new ApplicationError("GUILD_TERRITORY_START_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(existing.result_json);}
    return this.database.withTransaction(async tx=>{
      const scope=(await tx.query<ScopeRow[]>("SELECT war_id FROM guild_territory_start_scopes WHERE scope_code=? FOR UPDATE",[SCOPE_CODE]))[0];
      if(scope===undefined)throw new ApplicationError("GUILD_TERRITORY_START_SCOPE_REQUIRED","길드 영지전 시작 범위가 설정되지 않았습니다.",409);
      const war=(await tx.query<WarRow[]>("SELECT id,war_key,active,lifecycle_state,start_ready,pending_start_token,opening_token,version FROM guild_territory_wars WHERE id=? FOR UPDATE",[scope.war_id]))[0];
      if(war===undefined)throw new ApplicationError("GUILD_TERRITORY_WAR_REQUIRED","길드 영지전 상태를 확인할 수 없습니다.",409);
      const replay=(await tx.query<ReplayRow[]>("SELECT operator_id,result_json FROM guild_territory_start_runs WHERE request_key=? FOR UPDATE",[key]))[0];
      if(replay!==undefined){if(replay.operator_id!==operator.operator_id)throw new ApplicationError("GUILD_TERRITORY_START_REPLAY_ACTOR_MISMATCH","동일 요청의 실행자가 다릅니다.",409);return stored(replay.result_json);}
      if(war.active===1||war.lifecycle_state!=="READY")throw new ApplicationError("GUILD_TERRITORY_START_ALREADY_RUNNING","이미 진행 또는 시작 대기 중인 길드 영지전이 있습니다.",409);
      const destinations=await tx.query<DestinationRow[]>("SELECT destination_id,destination_kind FROM guild_territory_start_destinations WHERE active=TRUE ORDER BY destination_kind,position_no FOR UPDATE");
      if(!destinations.some(row=>row.destination_kind==="NOTICE")||!destinations.some(row=>row.destination_kind==="CASTLE"))throw new ApplicationError("GUILD_TERRITORY_START_DESTINATIONS_REQUIRED","길드 영지전 공지 대상 방 설정이 필요합니다.",409);
      const attackers=await this.loadAttackers(tx,war.id);
      if(attackers.length===0)throw new ApplicationError("GUILD_TERRITORY_START_NO_READY_ATTACKERS","길드 영지전을 준비한 공격자가 없습니다.",409);
      const shuffled=shuffleGuildTerritoryAttackers(attackers,this.random),startedAt=this.now(),prepareDueAt=new Date(startedAt.getTime()+PREPARE_MS),openingDueAt=new Date(startedAt.getTime()+PREPARE_MS+OPENING_MS),token=this.token();
      const generationVersion=war.version+1n,scopeName=`guild.territory.start:${SCOPE_CODE}`;
      const operation=await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',?)",[randomUUID(),scopeName,key,operator.operator_id,startedAt]);
      for(const draw of shuffled.draws)await tx.execute("INSERT INTO guild_territory_turn_random_draws(operation_id,draw_no,upper_bound,sample_value,selected_index) VALUES (?,?,?,?,?)",[operation.insertId,draw.drawNo,draw.upperBound,draw.sample.toFixed(18),draw.selectedIndex]);
      for(let index=0;index<shuffled.rows.length;index++){const attacker=shuffled.rows[index]!;await tx.execute("INSERT INTO guild_territory_turns(war_id,generation_version,ordinal,guild_id,attacker_player_id,attack_limit,attacks_used,turn_state) VALUES (?,?,?,?,?,30,0,'PENDING')",[war.id,generationVersion,index+1,attacker.guildId,attacker.playerId]);}
      const write=await tx.execute("UPDATE guild_territory_wars SET active=FALSE,lifecycle_state='PENDING_START',start_ready=FALSE,pending_start_token=?,pending_start_due_at=?,opening_token=NULL,opening_due_at=?,current_turn_no=0,turn_deadline_at=NULL,started_at=NULL,start_operation_id=?,version=version+1 WHERE id=? AND version=?",[token,prepareDueAt,openingDueAt,operation.insertId,war.id,war.version]);
      if(write.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_START_VERSION_CONFLICT","길드 영지전 상태가 먼저 변경되었습니다.",409);
      const transitionKeys=[`guild-territory:${war.id}:${generationVersion}:opening`,`guild-territory:${war.id}:${generationVersion}:ready`];
      const payload=JSON.stringify({token,generationVersion:generationVersion.toString()});
      await tx.execute("INSERT INTO guild_territory_scheduled_transitions(transition_key,war_id,transition_code,scheduled_for,status,operation_id,expected_war_version,payload_json) VALUES (?,?,'START_OPENING',?,'PENDING',?,?,?),(?,?,'ENABLE_ATTACKS',?,'PENDING',?,?,?)",[transitionKeys[0],war.id,prepareDueAt,operation.insertId,generationVersion,payload,transitionKeys[1],war.id,openingDueAt,operation.insertId,generationVersion+1n,payload]);
      const outboxIds=await this.enqueue(tx,operation.insertId,destinations.filter(row=>row.destination_kind==="NOTICE"),[PREPARE_MESSAGE],startedAt);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','pending_start',?,?)",[key,COMMAND_CODE,operation.insertId,startedAt,startedAt]);
      const audit=await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'guild_territory_war',?,'guild.territory.start','pending_start','Iris 길드영지시작',?,?)",[operation.insertId,operator.operator_id,war.id,JSON.stringify({warKey:war.war_key,generationVersion:generationVersion.toString(),attackerCount:shuffled.rows.length,prepareDueAt:prepareDueAt.toISOString(),openingDueAt:openingDueAt.toISOString(),transitionKeys}),startedAt]);
      const result:GuildTerritoryWarStartResult={status:"pending_start",warId:war.id.toString(),warKey:war.war_key,generationVersion:generationVersion.toString(),attackerCount:shuffled.rows.length,prepareDueAt:prepareDueAt.toISOString(),openingDueAt:openingDueAt.toISOString(),transitionKeys,data:PREPARE_MESSAGE,outboxIds,auditId:audit.insertId.toString()};
      await tx.execute("INSERT INTO guild_territory_start_runs(request_key,operation_id,operator_id,war_id,generation_version,result_json) VALUES (?,?,?,?,?,?)",[key,operation.insertId,operator.operator_id,war.id,generationVersion,JSON.stringify(result)]);
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=? WHERE id=?",[JSON.stringify(result),startedAt,operation.insertId]);return result;
    });
  }

  // 기한이 지난 전이를 순서대로 실행해 프로세스 재시작 뒤에도 개방 단계를 복구합니다.
  async runDueTransitions(limit=20,at=this.now()):Promise<{processed:number;skipped:number}>{
    let processed=0,skipped=0;for(let index=0;index<limit;index++){const state=await this.advanceOne(at);if(state==="none")break;if(state==="processed")processed++;else skipped++;}return{processed,skipped};
  }

  private async advanceOne(at:Date):Promise<"processed"|"skipped"|"none">{
    return this.database.withTransaction(async tx=>{
      const transition=(await tx.query<TransitionRow[]>("SELECT transition_key,war_id,transition_code,operation_id,expected_war_version,payload_json FROM guild_territory_scheduled_transitions WHERE status='PENDING' AND scheduled_for<=? ORDER BY scheduled_for,transition_key LIMIT 1 FOR UPDATE",[at]))[0];
      if(transition===undefined)return"none";
      const payload=parsePayload(transition.payload_json),war=(await tx.query<WarRow[]>("SELECT id,war_key,active,lifecycle_state,start_ready,pending_start_token,opening_token,version FROM guild_territory_wars WHERE id=? FOR UPDATE",[transition.war_id]))[0];
      const expectedState=transition.transition_code==="START_OPENING"?"PENDING_START":"ACTIVE_OPENING",expectedToken=transition.transition_code==="START_OPENING"?war?.pending_start_token:war?.opening_token;
      if(war===undefined||war.version!==transition.expected_war_version||war.lifecycle_state!==expectedState||expectedToken!==payload.token){await tx.execute("UPDATE guild_territory_scheduled_transitions SET status='SKIPPED',version=version+1,completed_at=?,updated_at=? WHERE transition_key=?",[at,at,transition.transition_key]);return"skipped";}
      const destinations=await tx.query<DestinationRow[]>("SELECT destination_id,destination_kind FROM guild_territory_start_destinations WHERE active=TRUE AND destination_kind='CASTLE' ORDER BY position_no FOR UPDATE");
      if(destinations.length===0)throw new ApplicationError("GUILD_TERRITORY_CASTLE_DESTINATION_REQUIRED","길드 영지전 공성전 방 설정이 필요합니다.",409);
      const turns=await this.loadTurns(tx,war.id,BigInt(payload.generationVersion));
      if(turns.length===0)throw new ApplicationError("GUILD_TERRITORY_TURNS_REQUIRED","길드 영지전 공격 순서가 없습니다.",409);
      if(transition.transition_code==="START_OPENING"){
        const write=await tx.execute("UPDATE guild_territory_wars SET active=TRUE,lifecycle_state='ACTIVE_OPENING',start_ready=FALSE,pending_start_token=NULL,pending_start_due_at=NULL,opening_token=?,version=version+1 WHERE id=? AND version=?",[payload.token,war.id,war.version]);
        if(write.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_OPENING_VERSION_CONFLICT","길드 영지전 오프닝 상태가 먼저 변경되었습니다.",409);
        await this.enqueue(tx,transition.operation_id,destinations,[formatOrder(turns)],at);
      }else{
        const deadline=new Date(at.getTime()+TURN_MS),write=await tx.execute("UPDATE guild_territory_wars SET active=TRUE,lifecycle_state='ACTIVE_READY',start_ready=TRUE,opening_token=NULL,opening_due_at=NULL,current_turn_no=1,turn_deadline_at=?,started_at=?,version=version+1 WHERE id=? AND version=?",[deadline,at,war.id,war.version]);
        if(write.affectedRows!==1n)throw new ApplicationError("GUILD_TERRITORY_READY_VERSION_CONFLICT","길드 영지전 공격 가능 상태가 먼저 변경되었습니다.",409);
        await tx.execute("UPDATE guild_territory_turns SET turn_state=IF(ordinal=1,'ACTIVE','PENDING') WHERE war_id=? AND generation_version=?",[war.id,payload.generationVersion]);
        const occupations=await tx.query<Array<{territory_no:bigint;territory_name:string;guild_name:string|null;guild_mark:string|null}>>("SELECT occupation.territory_no,occupation.territory_name,guild.display_name guild_name,guild.mark guild_mark FROM guild_territory_occupations occupation LEFT JOIN guilds guild ON guild.id=occupation.owner_guild_id WHERE occupation.war_id=? ORDER BY occupation.territory_no",[war.id]);
        await this.enqueue(tx,transition.operation_id,destinations,[formatStatus(occupations),START_MESSAGE,formatTurn(turns[0]!)],at);
      }
      await tx.execute("UPDATE guild_territory_scheduled_transitions SET status='COMPLETED',version=version+1,completed_at=?,updated_at=? WHERE transition_key=?",[at,at,transition.transition_key]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) SELECT ?,actor_type,actor_id,'guild_territory_war',?,'guild.territory.start.transition',?,'durable scheduled transition',?,? FROM operations WHERE id=?",[transition.operation_id,war.id,transition.transition_code.toLowerCase(),JSON.stringify({transitionKey:transition.transition_key,state:transition.transition_code}),at,transition.operation_id]);
      return"processed";
    });
  }

  private async findOperator(externalUserId:string):Promise<OperatorRow>{const row=(await this.database.query<OperatorRow[]>("SELECT mapping.operator_id,identity.player_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN guild_territory_start_operator_allowlist allowlist ON allowlist.operator_id=operator.id AND allowlist.active=TRUE WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1",[externalUserId]))[0];if(row===undefined)throw new ApplicationError("GUILD_TERRITORY_START_PERMISSION_REQUIRED","길드 영지전 시작 권한이 없습니다.",403);return row;}

  private async loadAttackers(tx:DatabaseTransaction,warId:bigint):Promise<GuildTerritoryAttacker[]>{
    const rows=await tx.query<Array<{guild_id:bigint;guild_name:string;guild_mark:string|null;player_id:bigint;player_name:string;rank_emoji:string|null;authority_code:string}>>("SELECT ready.guild_id,guild.display_name guild_name,guild.mark guild_mark,authorization.player_id,profile.current_display_name player_name,rank_profile.rank_emoji,authorization.authority_code FROM guild_territory_ready_guilds ready JOIN guilds guild ON guild.id=ready.guild_id AND guild.status='active' JOIN guild_territory_rift_authorizations authorization ON authorization.guild_id=ready.guild_id AND authorization.active=TRUE JOIN guild_members member ON member.guild_id=authorization.guild_id AND member.player_id=authorization.player_id JOIN players player ON player.id=authorization.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE ready.war_id=? AND ready.ready=TRUE AND ready.eliminated_at IS NULL ORDER BY ready.guild_id,FIELD(authorization.authority_code,'sword_master','combat_commander'),authorization.player_id FOR UPDATE",[warId]);
    const seen=new Set<string>(),result:GuildTerritoryAttacker[]=[];for(const row of rows){const key=row.guild_id.toString();if(seen.has(key))continue;seen.add(key);result.push({guildId:row.guild_id,guildName:row.guild_name,guildMark:row.guild_mark,playerId:row.player_id,playerName:row.player_name,rankEmoji:row.rank_emoji});}return result;
  }

  private async loadTurns(tx:DatabaseTransaction,warId:bigint,generationVersion:bigint):Promise<TurnRow[]>{return tx.query<TurnRow[]>("SELECT turn.ordinal,turn.guild_id,guild.display_name guild_name,guild.mark guild_mark,turn.attacker_player_id,profile.current_display_name player_name,rank_profile.rank_emoji FROM guild_territory_turns turn JOIN guilds guild ON guild.id=turn.guild_id JOIN player_profiles profile ON profile.player_id=turn.attacker_player_id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=turn.attacker_player_id WHERE turn.war_id=? AND turn.generation_version=? ORDER BY turn.ordinal FOR UPDATE",[warId,generationVersion]);}

  private async enqueue(tx:DatabaseTransaction,operationId:bigint,destinations:DestinationRow[],messages:string[],availableAt:Date):Promise<string[]>{const ids:string[]=[];for(const destination of destinations)for(const data of messages){const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',?,?)",[operationId,destination.destination_id,JSON.stringify({data}),availableAt,availableAt]);ids.push(outbox.insertId.toString());}return ids;}
}

// 긴 provider event ID는 DB key 제한 안에서 안정적으로 해시합니다.
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
// 저장된 JSON 결과는 MariaDB driver 반환 형식과 무관하게 복구합니다.
function stored(value:string|GuildTerritoryWarStartResult):GuildTerritoryWarStartResult{return typeof value==="string"?JSON.parse(value) as GuildTerritoryWarStartResult:value;}
// 예약 전이 payload를 문자열/JSON 반환 형식 모두에서 복구합니다.
function parsePayload(value:TransitionRow["payload_json"]):{token:string;generationVersion:string}{return typeof value==="string"?JSON.parse(value) as {token:string;generationVersion:string}:value;}
// 검증된 길드 영지 순서표 형식으로 현재 generation을 표시합니다.
function formatOrder(turns:TurnRow[]):string{return"📜 길드 영지전 공격 순서표 📜\n"+"​".repeat(500)+turns.map((row,index)=>`${index+1}. [${row.rank_emoji??""}${row.player_name}] [${guildLabel(row.guild_name,row.guild_mark)}]`).join("\n")+"\n";}
// 현재 점령 projection을 시작 직전 상황 메시지로 표시합니다.
function formatStatus(rows:Array<{territory_no:bigint;territory_name:string;guild_name:string|null;guild_mark:string|null}>):string{return"🎖️현 길드 영지전 상황🎖️\n🔮현재 점령 중인 길드🔮\n"+rows.map(row=>`[${row.territory_no}] ${row.territory_name}: ${row.guild_name===null?"미점령":guildLabel(row.guild_name,row.guild_mark)}`).join("\n")+"\n\n명령어: /영지공격 [영지번호]";}
// 첫 공격자와 같은 길드의 대체 공격 가능 안내를 표시합니다.
function formatTurn(row:TurnRow):string{return`[${guildLabel(row.guild_name,row.guild_mark)}] 길드의(1/30⚔)\n[${row.rank_emoji??""}${row.player_name}] 님의 공격 차례입니다.\n\n같은 길드의 '소드마스터🤺'는 대신\n/영지공격 [숫자] 입력이 가능합니다.\n[1]🏰 [2]🥀 [3]💍 [4]⭐️ [5]💫 [6]📙 [7]🪙 [8]🌀 [9]😭`;}
// 길드명과 마크를 레거시 표시 규칙으로 결합합니다.
function guildLabel(name:string,mark:string|null):string{return name+(mark===null||mark===""?"":`(${mark})`);}
