import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { MariaPetInfoRepository } from "../pet/maria-pet-info-repository.js";
import { CastleBattleExecuteService } from "../castle/castle-battle-execute-service.js";
import { MiniPetBattleExecuteService } from "../mini-pet/mini-pet-battle-execute-service.js";
import { TrialTowerProvider } from "../trial/trial-tower-provider.js";
import { ApplicationError } from "../shared/application-error.js";

const ALIASES = new Set(["/자동일퀘", "ㅇㅋㅋ"]);
const AUTO_MAX = 20n;
const BASE_TOWER_MAX = 15n;
const BASE_CASTLE_MAX = 15n;
const BASE_MINI_MAX = 15n;
const BASE_EXPLORE_MAX = 10n;
const TICKET_CODE = "auto_daily_quest_ticket";

type Numeric = bigint | number | string;
type DailyState = { tower: bigint; castle: bigint; mini: bigint; explore: bigint; weekly: bigint; dailyRewarded: boolean; passRewarded: boolean; premiumRewarded: boolean; };
type RewardRow = { reward_scope: string; reward_order: number; item_id: Numeric; quantity: Numeric };

export interface AutoDailyQuestPlan { towerRuns: number; castleRuns: number; miniRuns: number; }
export interface AutoDailyQuestResult {
  status: "completed" | "ticket_required" | "already_completed";
  playerId: string;
  data: string;
  outboxId: string;
  runs: AutoDailyQuestPlan;
  claimedScopes: string[];
  stopReasons: string[];
  replayed: boolean;
}

// 자동일퀘는 레거시 exact 명령과 단축 트리거만 허용합니다.
export function isAutoDailyQuestCommand(message: string | undefined): boolean { return message !== undefined && ALIASES.has(message); }

// 현재 카운터에서 보너스 포함 20회 상한까지 필요한 실행 수를 계산합니다.
export function buildAutoDailyQuestPlan(state: Pick<DailyState,"tower"|"castle"|"mini">): AutoDailyQuestPlan {
  const remaining = (value: bigint) => Number(value >= AUTO_MAX ? 0n : AUTO_MAX - value);
  return { towerRuns: remaining(state.tower), castleRuns: remaining(state.castle), miniRuns: remaining(state.mini) };
}

// 재시도에서도 같은 시련탑 난수열을 사용합니다.
function deterministicRandom(seed: string): () => number {
  let index = 0;
  return () => {
    const value = createHash("sha256").update(`${seed}:${index++}`).digest().readUInt32BE(0);
    return value / 0x100000000;
  };
}

function stored(value: string | AutoDailyQuestResult): AutoDailyQuestResult { return typeof value === "string" ? JSON.parse(value) as AutoDailyQuestResult : value; }
function integer(value: Numeric): bigint { return BigInt(String(value).split(".")[0]!); }

// 자동일퀘 결과를 내부 전투 카드 대신 한 장의 요약으로 표시합니다.
export function formatAutoDailyQuestResult(input: { runs: AutoDailyQuestPlan; claimedScopes: readonly string[]; stopReasons: readonly string[] }): string {
  const claimed = input.claimedScopes.length === 0 ? "지급 조건 미충족" : input.claimedScopes.join(", ");
  const stopped = input.stopReasons.length === 0 ? "없음" : input.stopReasons.join(" / ");
  return ["📜 자동일퀘 결과", "[자동일퀘 보너스 발동!]", "[시탑😈,🏆캐대,🐹미대 5판 추가 보상👌]", "",
    `시련의탑: ${input.runs.towerRuns}회`, `캐슬대전: ${input.runs.castleRuns}회`, `미니펫대전: ${input.runs.miniRuns}회`,
    `퀘스트 보상: ${claimed}`, `중단 사유: ${stopped}`].join("\n");
}

// 세 child provider와 퀘스트 보상을 한 상위 transaction으로 묶습니다.
export class AutoDailyQuestOrchestrationService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<AutoDailyQuestResult> {
    if (!isAutoDailyQuestCommand(command.message)) throw new ApplicationError("AUTO_DAILY_COMMAND_INVALID","정확한 /자동일퀘 또는 ㅇㅋㅋ를 입력해 주세요.",422);
    return this.database.withTransaction(async transaction => {
      const identity = (await transaction.query<Array<{ identity_id: Numeric; player_id: Numeric }>>(
        "SELECT id identity_id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL FOR UPDATE",
        [command.externalUserId]))[0];
      if (identity === undefined) throw new ApplicationError("AUTO_DAILY_IDENTITY_REQUIRED","가입된 회원 정보를 찾을 수 없습니다.",409);
      const playerId = String(identity.player_id), scope = `auto.daily.quest:${identity.identity_id}`;
      const eventKey = createHash("sha256").update(command.eventId).digest("hex");
      const prior = (await transaction.query<Array<{ result_json: string | AutoDailyQuestResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,eventKey]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed:true };
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,eventKey,identity.identity_id]);
      const date = (await transaction.query<Array<{ record_date: string }>>("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d') record_date"))[0]!.record_date;
      await transaction.execute("INSERT INTO player_pet_daily_records(player_id,record_date) VALUES (?,?) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)",[playerId,date]);
      const before = await this.readState(transaction,playerId,date);
      const ticket = (await transaction.query<Array<{ quantity: Numeric }>>(
        "SELECT COALESCE(stack.quantity,0) quantity FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.code=? AND item.active=TRUE FOR UPDATE",
        [playerId,TICKET_CODE]))[0];
      if (before.dailyRewarded) return this.finish(transaction,operation.insertId,identity.identity_id,playerId,date,before,before,{status:"already_completed",runs:{towerRuns:0,castleRuns:0,miniRuns:0},claimedScopes:[],stopReasons:["금일 일일퀘스트 보상 지급 완료"]},command);
      if (integer(ticket?.quantity ?? 0) < 1n) return this.finish(transaction,operation.insertId,identity.identity_id,playerId,date,before,before,{status:"ticket_required",runs:{towerRuns:0,castleRuns:0,miniRuns:0},claimedScopes:[],stopReasons:["자동일퀘권📝이 필요합니다."]},command);

      const scoped = createScopedDatabaseClient(transaction), plan = buildAutoDailyQuestPlan(before);
      const runs: AutoDailyQuestPlan = { towerRuns:0,castleRuns:0,miniRuns:0 }, stopReasons: string[] = [];
      for (let index=0; index<plan.towerRuns; index++) {
        const view = await new MariaPetInfoRepository(scoped).findByExternalIdentity("kakao",command.externalUserId);
        if (view === null) { stopReasons.push("시련의탑: 펫 정보 없음"); break; }
        const skills = await transaction.query<Array<{ display_name: string }>>(`SELECT definition.display_name FROM player_pets pet JOIN pet_skills assignment ON assignment.player_pet_id=pet.id AND assignment.equipped=TRUE JOIN skill_definitions definition ON definition.id=assignment.skill_id AND definition.active=TRUE WHERE pet.player_id=? ORDER BY assignment.slot_no`,[view.playerId]);
        const result = await new TrialTowerProvider(scoped,deterministicRandom(`${eventKey}:tower:${index}`)).attempt({eventId:`${eventKey}:tower:${index}`,destinationId:command.channelId,playerId:view.playerId,recordDate:date,autoBonus:true,suppressOutbox:true,profile:{charm:Number(view.charm.total),petType:view.pet.typeName,upgrade:Number(view.charm.effectiveEnhancement),skills:skills.map(row=>row.display_name)}});
        if (result.status !== "win" && result.status !== "lose") { stopReasons.push(`시련의탑: ${result.data}`); break; }
        runs.towerRuns++;
      }
      for (let index=0; index<plan.castleRuns; index++) {
        try { await new CastleBattleExecuteService(scoped).handle({externalUserId:command.externalUserId,channelId:command.channelId,message:"/캐슬대전",eventId:`${eventKey}:castle:${index}`,mode:"auto",suppressOutbox:true}); runs.castleRuns++; }
        catch (error) { if (error instanceof ApplicationError) { stopReasons.push(`캐슬대전: ${error.message}`); break; } throw error; }
      }
      for (let index=0; index<plan.miniRuns; index++) {
        try { const result=await new MiniPetBattleExecuteService(scoped).handle({externalUserId:command.externalUserId,channelId:command.channelId,message:"/미니펫대전",eventId:`${eventKey}:mini:${index}`,mode:"auto",suppressOutbox:true}); if(result.status!=="completed"){stopReasons.push("미니펫대전: 공성전 진행 중");break;} runs.miniRuns++; }
        catch (error) { if (error instanceof ApplicationError) { stopReasons.push(`미니펫대전: ${error.message}`); break; } throw error; }
      }

      const afterBattles = await this.readState(transaction,playerId,date);
      const claimedScopes = await this.claimRewards(transaction,operation.insertId,playerId,date,afterBattles);
      const after = await this.readState(transaction,playerId,date);
      return this.finish(transaction,operation.insertId,identity.identity_id,playerId,date,before,after,{status:"completed",runs,claimedScopes,stopReasons},command);
    });
  }

  private async readState(transaction: DatabaseTransaction,playerId:string,date:string):Promise<DailyState>{
    const row=(await transaction.query<Array<{tower_attempts:Numeric;castle_battle_attempts:Numeric;mini_battle_attempts:Numeric;explore_attempts:Numeric;weekly_quest_count:Numeric;daily_quest_rewarded:number;pass_daily_quest_rewarded:number;premium_daily_quest_rewarded:number}>>(
      "SELECT tower_attempts,castle_battle_attempts,mini_battle_attempts,explore_attempts,weekly_quest_count,daily_quest_rewarded,pass_daily_quest_rewarded,premium_daily_quest_rewarded FROM player_pet_daily_records WHERE player_id=? AND record_date=? FOR UPDATE",[playerId,date]))[0]!;
    return{tower:integer(row.tower_attempts),castle:integer(row.castle_battle_attempts),mini:integer(row.mini_battle_attempts),explore:integer(row.explore_attempts),weekly:integer(row.weekly_quest_count),dailyRewarded:Boolean(row.daily_quest_rewarded),passRewarded:Boolean(row.pass_daily_quest_rewarded),premiumRewarded:Boolean(row.premium_daily_quest_rewarded)};
  }

  private async claimRewards(transaction:DatabaseTransaction,operationId:bigint,playerId:string,date:string,state:DailyState):Promise<string[]>{
    const scopes:string[]=[];
    const pass=(await transaction.query<Array<{base_pass:number;premium_pass:number}>>(`SELECT EXISTS(SELECT 1 FROM player_passes WHERE player_id=? AND enabled=TRUE AND pass_code IN ('support','beginner') AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3))) base_pass,EXISTS(SELECT 1 FROM player_passes WHERE player_id=? AND enabled=TRUE AND pass_code='premium' AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3))) premium_pass`,[playerId,playerId]))[0]!;
    const baseComplete=state.tower>=BASE_TOWER_MAX&&state.castle>=BASE_CASTLE_MAX&&state.mini>=BASE_MINI_MAX&&state.explore>=BASE_EXPLORE_MAX;
    const passComplete=state.explore>=BASE_EXPLORE_MAX;
    if(baseComplete&&!state.dailyRewarded){scopes.push("DAILY");state.weekly++;await transaction.execute("UPDATE player_pet_daily_records SET daily_quest_rewarded=TRUE,weekly_quest_count=?,version=version+1 WHERE player_id=? AND record_date=?",[state.weekly,playerId,date]);}
    if(state.weekly>=7n&&scopes.includes("DAILY")){scopes.push("WEEKLY");state.weekly=0n;await transaction.execute("UPDATE player_pet_daily_records SET weekly_quest_count=0,version=version+1 WHERE player_id=? AND record_date=?",[playerId,date]);}
    if(Boolean(pass.base_pass)&&passComplete&&!state.passRewarded){scopes.push("PASS_DAILY");await transaction.execute("UPDATE player_pet_daily_records SET pass_daily_quest_rewarded=TRUE,version=version+1 WHERE player_id=? AND record_date=?",[playerId,date]);}
    if(Boolean(pass.premium_pass)&&passComplete&&!state.premiumRewarded){scopes.push("PREMIUM_DAILY");await transaction.execute("UPDATE player_pet_daily_records SET premium_daily_quest_rewarded=TRUE,version=version+1 WHERE player_id=? AND record_date=?",[playerId,date]);}
    if(scopes.length===0)return scopes;
    const placeholders=scopes.map(()=>"?").join(",");
    const rewards=await transaction.query<RewardRow[]>(`SELECT reward_scope,reward_order,item_id,quantity FROM auto_daily_quest_reward_definitions WHERE active=TRUE AND reward_scope IN (${placeholders}) ORDER BY reward_scope,reward_order FOR UPDATE`,scopes);
    let sequence=1;
    for(const reward of rewards){await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1",[playerId,reward.item_id,reward.quantity]);await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'auto_daily_quest_reward')",[operationId,sequence++,playerId,reward.item_id,reward.quantity]);}
    return scopes;
  }

  private async finish(transaction:DatabaseTransaction,operationId:bigint,identityId:Numeric,playerId:string,date:string,before:DailyState,after:DailyState,summary:{status:AutoDailyQuestResult["status"];runs:AutoDailyQuestPlan;claimedScopes:string[];stopReasons:string[]},command:{channelId:string;eventId:string}):Promise<AutoDailyQuestResult>{
    const data=summary.status==="ticket_required"?"자동일퀘권📝이 필요합니다.":summary.status==="already_completed"?"오늘 일일퀘스트 보상을 이미 받았습니다.":formatAutoDailyQuestResult(summary);
    const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operationId,command.channelId,JSON.stringify({data})]);
    const result:AutoDailyQuestResult={status:summary.status,playerId,data,outboxId:outbox.insertId.toString(),runs:summary.runs,claimedScopes:summary.claimedScopes,stopReasons:summary.stopReasons,replayed:false};
    await transaction.execute("INSERT INTO auto_daily_quest_runs(operation_id,player_id,record_date,before_json,after_json,run_count_json,claimed_scope_json,stop_reason_json) VALUES (?,?,?,?,?,?,?,?)",[operationId,playerId,date,JSON.stringify(before,(_k,v)=>typeof v==="bigint"?v.toString():v),JSON.stringify(after,(_k,v)=>typeof v==="bigint"?v.toString():v),JSON.stringify(summary.runs),JSON.stringify(summary.claimedScopes),JSON.stringify(summary.stopReasons)]);
    await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'AUTO_DAILY_QUEST_ORCHESTRATION',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[command.eventId,operationId,summary.status]);
    await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'auto.daily.quest','success','Iris /자동일퀘',?,UTC_TIMESTAMP(3))",[operationId,identityId,playerId,JSON.stringify({status:summary.status,runs:summary.runs,claimedScopes:summary.claimedScopes,stopReasons:summary.stopReasons})]);
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operationId]);
    return result;
  }
}
