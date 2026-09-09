import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "PUNCH_ACTION";
const HANDLER_KEY = "punch_action";
const SCOPE_PREFIX = "punch.action";
const TICKET_CODE = "punch_ticket";
const REWARD_CODE = "mini_pet_draw";
const TITLE_CODE = "TITLE-PUNCH-LEGEND";
const POINT_COST = 100000n;
const TITLE_PRICE = 100000000n;
const MAX_COUNT = 100n;

type Numeric = bigint | number | string;
interface ActorRow { identity_id: Numeric; player_id: Numeric; display_name: string }
interface StackRow { item_id: Numeric; item_code: string; quantity: Numeric; version: Numeric }
interface StatRow { best_score: Numeric; best_rank: string; total_play: Numeric; total_reward: Numeric; legend_count: Numeric; last_score: Numeric; last_rank: string; source_order: Numeric; version: Numeric }
interface StateRow { next_source_order: Numeric; version: Numeric }
interface ReplayRow { player_id: Numeric; result_json: string | PunchActionResult }

export interface PunchCommand { requestedCount: bigint; clampedCount: bigint }
export interface PunchRound { outcomeCode: string; rankName: string; score: bigint; rewardQuantity: bigint; legend: boolean; tierSample: number; scoreSample: number }
export interface PunchActionResult {
  status: "completed" | "rejected";
  reasonCode: "success" | "ticket_required" | "point_required";
  operationId: string;
  requestedCount: string;
  executedCount: string;
  ticketQuantityAfter: string;
  pointBalanceAfter: string;
  rewardQuantity: string;
  legendCount: string;
  titleGranted: boolean;
  bestScore: string;
  bestRank: string;
  lastScore: string;
  lastRank: string;
  data: string;
  outboxId: string;
}

interface PunchActionOptions { tierRandom?: () => number; scoreRandom?: () => number }

const TIERS = [
  { threshold: 0.35, outcomeCode: "COTTON", rankName: "솜주먹🐣", reward: 3n, min: 0n, max: 99n },
  { threshold: 0.60, outcomeCode: "BEAN", rankName: "콩알펀치🫘", reward: 4n, min: 100n, max: 199n },
  { threshold: 0.78, outcomeCode: "BEGINNER", rankName: "초보 파이터🥊", reward: 6n, min: 200n, max: 299n },
  { threshold: 0.88, outcomeCode: "LOCAL", rankName: "동네 주먹🤜", reward: 8n, min: 300n, max: 449n },
  { threshold: 0.94, outcomeCode: "MUSCLE", rankName: "불끈 주먹💪", reward: 12n, min: 450n, max: 599n },
  { threshold: 0.97, outcomeCode: "STEEL", rankName: "강철 주먹🔥", reward: 20n, min: 600n, max: 749n },
  { threshold: 0.985, outcomeCode: "POWER", rankName: "괴력의 파이터💥", reward: 50n, min: 750n, max: 879n },
  { threshold: 0.993, outcomeCode: "CHAMPION", rankName: "오락실 챔피언🏆", reward: 120n, min: 880n, max: 949n },
  { threshold: 0.998, outcomeCode: "MONSTER", rankName: "괴물 주먹🦍", reward: 250n, min: 950n, max: 989n },
  { threshold: 0.9995, outcomeCode: "DESTROYER", rankName: "기계파괴자💀", reward: 500n, min: 990n, max: 999n },
  { threshold: 1, outcomeCode: "LEGEND", rankName: "전설의 핵주먹👑", reward: 1000n, min: 2000n, max: 1000n }
] as const;

// trim 후 exact `/펀치` 또는 양의 정수 횟수 형식만 허용합니다.
export function isPunchActionCommandCandidate(message: string | undefined): boolean { if (message === undefined) return false; const trimmed = message.trim(); return trimmed === "/펀치" || /^\/펀치 [1-9]\d*$/.test(trimmed); }

// partial dispatcher에서 인자 명령을 대표 alias로 정규화합니다.
export function normalizePunchActionDispatchMessage(message: string): string | null { return isPunchActionCommandCandidate(message) ? "/펀치" : null; }

// 요청 횟수를 파싱하고 레거시 100회 상한을 적용합니다.
export function parsePunchActionCommand(message: string | undefined): PunchCommand | null { if (!isPunchActionCommandCandidate(message)) return null; const token = message!.trim().split(" ")[1]; const requestedCount = token === undefined ? 1n : BigInt(token); return { requestedCount, clampedCount: requestedCount > MAX_COUNT ? MAX_COUNT : requestedCount }; }

// 두 RNG 표본을 레거시 누적 임계·점수 범위와 결정적으로 매핑합니다.
export function resolvePunchRound(tierSample: number, scoreSample: number): PunchRound {
  assertSample(tierSample); assertSample(scoreSample);
  const tier = TIERS.find((candidate) => tierSample < candidate.threshold)!;
  const score = tier.outcomeCode === "LEGEND" ? 2000n : tier.min + BigInt(Math.floor(scoreSample * Number(tier.max - tier.min + 1n)));
  return { outcomeCode: tier.outcomeCode, rankName: tier.rankName, score, rewardQuantity: tier.reward, legend: tier.outcomeCode === "LEGEND", tierSample, scoreSample };
}

// 펀치 결과를 단일 Iris payload로 안정적으로 요약합니다.
export function formatPunchActionReply(input: { executedCount: bigint; ticketAfter: bigint; pointAfter: bigint; reward: bigint; best: PunchRound; last: PunchRound; legendCount: bigint; titleGranted: boolean }): string {
  const lines = ["🥊 펀치 결과", `실행: ${input.executedCount}회`, `최고: ${input.best.score.toLocaleString("en-US")}점 [${input.best.rankName}]`, `마지막: ${input.last.score.toLocaleString("en-US")}점 [${input.last.rankName}]`, `획득: 미니펫뽑기🐹 x${input.reward.toLocaleString("en-US")}`, `남은 핵꿀밤: ${input.ticketAfter.toLocaleString("en-US")}개`, `남은 포인트: ${input.pointAfter.toLocaleString("en-US")}`];
  if (input.legendCount > 0n) lines.push(`👑 전설의 핵주먹 ${input.legendCount}회: 공개 기준 1,000점 / 레거시 저장 2,000점`);
  if (input.titleGranted) lines.push("신규 타이틀: 👑전설의 핵주먹");
  return lines.join("\n");
}

// inventory·point·stats·title·RNG evidence를 단일 MariaDB transaction으로 처리합니다.
export class PunchActionService {
  private readonly tierRandom: () => number;
  private readonly scoreRandom: () => number;
  public constructor(private readonly database: DatabaseClient, options: PunchActionOptions = {}) { this.tierRandom = options.tierRandom ?? Math.random; this.scoreRandom = options.scoreRandom ?? Math.random; }

  // command registry rollout과 partial dispatch evidence를 확인한 뒤 실행 service를 호출합니다.
  public async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<PunchActionResult | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }> {
    if (!isPunchActionCommandCandidate(input.message)) return { status: "legacy_fallback" };
    const definition = (await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]))[0];
    const dispatch = new MariaCommandDispatchRepository(this.database), dispatchInput = { eventId: input.eventId, message: normalizePunchActionDispatchMessage(input.message)!, userId: input.externalUserId, hasTrustedDisplayName: true };
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") { await dispatch.record(dispatchInput, { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY }); return { status: "legacy_fallback" }; }
    if (definition.rollout_state !== "ACTIVE") { await dispatch.record(dispatchInput, { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY }); return { status: "shadow" }; }
    await dispatch.record(dispatchInput, { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
    try { return await this.execute(input); } catch (error) { if (error instanceof ApplicationError && error.code === "PUNCH_ACTOR_REQUIRED") return { status: "handled_no_reply" }; throw error; }
  }

  // event replay를 먼저 확인하고 자원 잠금 후 최대 100 round를 확정합니다.
  public async execute(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<PunchActionResult> {
    const command = parsePunchActionCommand(input.message); if (command === null) throw new ApplicationError("INVALID_PUNCH_ACTION_COMMAND", "펀치 명령 형식이 올바르지 않습니다.", 422);
    return this.database.withTransaction(async (transaction) => {
      const actor = await lockActor(transaction, input.externalUserId), scope = `${SCOPE_PREFIX}:${actor.player_id}`, requestKey = eventKey(input.eventId);
      const replay = (await transaction.query<ReplayRow[]>("SELECT player_id,result_json FROM punch_action_runs WHERE request_key=? FOR UPDATE", [requestKey]))[0];
      if (replay !== undefined) { if (String(replay.player_id) !== String(actor.player_id)) throw new ApplicationError("PUNCH_ACTION_REPLAY_ACTOR_MISMATCH", "같은 펀치 요청의 회원이 다릅니다.", 409); return stored(replay.result_json); }
      const prior = (await transaction.query<Array<{ result_json: string | PunchActionResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, requestKey]))[0];
      if (prior?.result_json != null) return stored(prior.result_json);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, requestKey, actor.identity_id]);
      const definitions = await transaction.query<Array<{ id: Numeric; code: string }>>("SELECT id,code FROM item_definitions WHERE code IN (?,?) AND active=TRUE AND stackable=TRUE ORDER BY code FOR UPDATE", [TICKET_CODE,REWARD_CODE]);
      const ticketDefinition = definitions.find((row) => row.code === TICKET_CODE), rewardDefinition = definitions.find((row) => row.code === REWARD_CODE);
      if (ticketDefinition === undefined || rewardDefinition === undefined) throw new ApplicationError("PUNCH_ITEM_DEFINITION_REQUIRED", "펀치 아이템 정의가 완성되지 않았습니다.", 409);
      await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,1),(?,?,0,1)", [actor.player_id,ticketDefinition.id,actor.player_id,rewardDefinition.id]);
      const stacks = await transaction.query<StackRow[]>("SELECT stack.item_id,item.code item_code,stack.quantity,stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND stack.item_id IN (?,?) ORDER BY stack.item_id FOR UPDATE", [actor.player_id,ticketDefinition.id,rewardDefinition.id]);
      const ticket = stacks.find((row) => row.item_code === TICKET_CODE)!, reward = stacks.find((row) => row.item_code === REWARD_CODE)!;
      await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1)", [actor.player_id]);
      const account = (await transaction.query<Array<{ balance: string; version: Numeric }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]))[0]!;
      const pointBefore = decimalInteger(account.balance), ticketBefore = BigInt(ticket.quantity), executedCount = min(command.clampedCount,ticketBefore), requiredPoint = executedCount * POINT_COST;
      if (executedCount === 0n) return finishRejected(transaction, { input, actor, operationId: operation.insertId, command, ticketBefore, pointBefore, reasonCode: "ticket_required" });
      if (pointBefore < requiredPoint) return finishRejected(transaction, { input, actor, operationId: operation.insertId, command, ticketBefore, pointBefore, reasonCode: "point_required" });

      const state = (await transaction.query<StateRow[]>("SELECT next_source_order,version FROM punch_action_state WHERE state_key='default' FOR UPDATE"))[0];
      if (state === undefined) throw new Error("PUNCH_ACTION_STATE_MISSING");
      const stats = (await transaction.query<StatRow[]>("SELECT best_score,best_rank,total_play,total_reward,legend_count,last_score,last_rank,source_order,version FROM player_punch_rank_stats WHERE player_id=? FOR UPDATE", [actor.player_id]))[0];
      const title = (await transaction.query<Array<{ id: Numeric }>>("SELECT id FROM title_definitions WHERE code=? AND active=TRUE FOR UPDATE", [TITLE_CODE]))[0];
      if (title === undefined) throw new Error("PUNCH_LEGEND_TITLE_MISSING");
      const ownedTitle = (await transaction.query<Array<{ title_id: Numeric }>>("SELECT title_id FROM player_titles WHERE player_id=? AND title_id=? FOR UPDATE", [actor.player_id,title.id]))[0];

      const rounds: PunchRound[] = [];
      for (let index=0; index<Number(executedCount); index+=1) { const round=resolvePunchRound(this.tierRandom(),this.scoreRandom()); rounds.push(round); await transaction.execute("INSERT INTO punch_action_rounds(operation_id,sequence_no,tier_sample,score_sample,outcome_code,rank_name,score,reward_quantity,legend) VALUES (?,?,?,?,?,?,?,?,?)", [operation.insertId,index+1,round.tierSample.toFixed(17),round.scoreSample.toFixed(17),round.outcomeCode,round.rankName,round.score,round.rewardQuantity,round.legend]); }
      const rewardQuantity = rounds.reduce((sum,round)=>sum+round.rewardQuantity,0n), legendCount = BigInt(rounds.filter((round)=>round.legend).length), last = rounds[rounds.length-1]!, roundBest = rounds.reduce((best,round)=>round.score>best.score?round:best), previousTotalPlay = stats===undefined?0n:BigInt(stats.total_play), previousBestScore=stats===undefined?0n:BigInt(stats.best_score), best = stats===undefined || previousTotalPlay===0n || roundBest.score>previousBestScore ? roundBest : { ...roundBest, score: previousBestScore, rankName: stats.best_rank };
      const ticketAfter=ticketBefore-executedCount, pointAfter=pointBefore-requiredPoint, rewardAfter=BigInt(reward.quantity)+rewardQuantity;
      const ticketWrite=await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[ticketAfter,actor.player_id,ticket.item_id,ticket.version]);
      const rewardWrite=await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[rewardAfter,actor.player_id,reward.item_id,reward.version]);
      const pointWrite=await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[pointAfter,actor.player_id,account.version]);
      if(ticketWrite.affectedRows!==1n||rewardWrite.affectedRows!==1n||pointWrite.affectedRows!==1n)throw new ApplicationError("PUNCH_ACTION_VERSION_CONFLICT","펀치 자원이 먼저 변경되었습니다.",409);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'PUNCH_TICKET_USED'),(?,2,?,?,?,'PUNCH_REWARD_GRANTED')",[operation.insertId,actor.player_id,ticket.item_id,-executedCount,operation.insertId,actor.player_id,reward.item_id,rewardQuantity]);
      await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'PUNCH_ACTION_COST')",[operation.insertId,actor.player_id,-requiredPoint,pointAfter]);

      let sourceOrder: bigint;
      if(stats===undefined){sourceOrder=BigInt(state.next_source_order);await transaction.execute("INSERT INTO player_punch_rank_stats(player_id,best_score,best_rank,total_play,total_reward,legend_count,last_score,last_rank,source_order,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,UTC_TIMESTAMP(3))",[actor.player_id,best.score,best.rankName,executedCount,rewardQuantity,legendCount,last.score,last.rankName,sourceOrder]);const stateWrite=await transaction.execute("UPDATE punch_action_state SET next_source_order=next_source_order+1,version=version+1 WHERE state_key='default' AND version=?",[state.version]);if(stateWrite.affectedRows!==1n)throw new Error("PUNCH_ACTION_STATE_CONFLICT");}
      else{sourceOrder=BigInt(stats.source_order);const statsWrite=await transaction.execute("UPDATE player_punch_rank_stats SET best_score=?,best_rank=?,total_play=total_play+?,total_reward=total_reward+?,legend_count=legend_count+?,last_score=?,last_rank=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",[best.score,best.rankName,executedCount,rewardQuantity,legendCount,last.score,last.rankName,actor.player_id,stats.version]);if(statsWrite.affectedRows!==1n)throw new ApplicationError("PUNCH_STATS_VERSION_CONFLICT","펀치 순위 기록이 먼저 변경되었습니다.",409);}

      let titleGranted=false;
      if(legendCount>0n&&ownedTitle===undefined){const order=(await transaction.query<Array<{ max_order: Numeric|null }>>("SELECT MAX(display_order) max_order FROM player_title_instances WHERE player_id=? FOR UPDATE",[actor.player_id]))[0]?.max_order??0n;await transaction.execute("INSERT INTO player_title_instances(instance_key,player_id,title_id,source_operation_id,source_sequence_no,price_value,display_order,status,equipped,acquired_at,version) VALUES (UUID(),?,?,?,?,?,?,'owned',FALSE,UTC_TIMESTAMP(3),1)",[actor.player_id,title.id,operation.insertId,1,TITLE_PRICE,BigInt(order)+1n]);await transaction.execute("INSERT INTO player_titles(player_id,title_id,acquired_at,equipped,display_order,acquisition_price) VALUES (?,?,UTC_TIMESTAMP(3),FALSE,?,?)",[actor.player_id,title.id,BigInt(order)+1n,TITLE_PRICE]);titleGranted=true;}
      const data=formatPunchActionReply({executedCount,ticketAfter,pointAfter,reward:rewardQuantity,best,last,legendCount,titleGranted}),outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.channelId,JSON.stringify({data})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,COMMAND_CODE,operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'punch.action','success','Iris /펀치',?,UTC_TIMESTAMP(3))",[operation.insertId,actor.identity_id,actor.player_id,JSON.stringify({requestedCount:command.requestedCount.toString(),clampedCount:command.clampedCount.toString(),executedCount:executedCount.toString(),ticketUsed:executedCount.toString(),pointUsed:requiredPoint.toString(),rewardQuantity:rewardQuantity.toString(),legendCount:legendCount.toString(),titleGranted,bestScore:best.score.toString(),lastScore:last.score.toString(),sourceOrder:sourceOrder.toString()})]);
      const result:PunchActionResult={status:"completed",reasonCode:"success",operationId:operation.insertId.toString(),requestedCount:command.requestedCount.toString(),executedCount:executedCount.toString(),ticketQuantityAfter:ticketAfter.toString(),pointBalanceAfter:pointAfter.toString(),rewardQuantity:rewardQuantity.toString(),legendCount:legendCount.toString(),titleGranted,bestScore:best.score.toString(),bestRank:best.rankName,lastScore:last.score.toString(),lastRank:last.rankName,data,outboxId:outbox.insertId.toString()};
      await transaction.execute("INSERT INTO punch_action_runs(operation_id,request_key,identity_id,player_id,requested_count,clamped_count,executed_count,ticket_quantity_before,ticket_quantity_after,point_balance_before,point_balance_after,reward_quantity,legend_count,title_granted,result_code,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[operation.insertId,requestKey,actor.identity_id,actor.player_id,command.requestedCount,command.clampedCount,executedCount,ticketBefore,ticketAfter,pointBefore,pointAfter,rewardQuantity,legendCount,titleGranted,"success",JSON.stringify(result)]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
}

// 자원 부족을 변경 없는 멱등 결과·감사·outbox로 완료합니다.
async function finishRejected(transaction:DatabaseTransaction,input:{input:{eventId:string;channelId:string};actor:ActorRow;operationId:bigint;command:PunchCommand;ticketBefore:bigint;pointBefore:bigint;reasonCode:"ticket_required"|"point_required"}):Promise<PunchActionResult>{const data=input.reasonCode==="ticket_required"?"핵꿀밤🥊(/펀치)이 없습니다.":`포인트가 부족합니다.\n필요 포인트: ${(min(input.command.clampedCount,input.ticketBefore)*POINT_COST).toLocaleString("en-US")}`,outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.input.channelId,JSON.stringify({data})]),result:PunchActionResult={status:"rejected",reasonCode:input.reasonCode,operationId:input.operationId.toString(),requestedCount:input.command.requestedCount.toString(),executedCount:"0",ticketQuantityAfter:input.ticketBefore.toString(),pointBalanceAfter:input.pointBefore.toString(),rewardQuantity:"0",legendCount:"0",titleGranted:false,bestScore:"0",bestRank:"기록없음",lastScore:"0",lastRank:"기록없음",data,outboxId:outbox.insertId.toString()};await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.input.eventId,COMMAND_CODE,input.operationId,input.reasonCode]);await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'punch.action',?,'Iris /펀치',?,UTC_TIMESTAMP(3))",[input.operationId,input.actor.identity_id,input.actor.player_id,input.reasonCode,JSON.stringify({requestedCount:input.command.requestedCount.toString(),ticketQuantity:input.ticketBefore.toString(),pointBalance:input.pointBefore.toString(),mutation:false})]);await transaction.execute("INSERT INTO punch_action_runs(operation_id,request_key,identity_id,player_id,requested_count,clamped_count,executed_count,ticket_quantity_before,ticket_quantity_after,point_balance_before,point_balance_after,reward_quantity,legend_count,title_granted,result_code,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[input.operationId,eventKey(input.input.eventId),input.actor.identity_id,input.actor.player_id,input.command.requestedCount,input.command.clampedCount,0,input.ticketBefore,input.ticketBefore,input.pointBefore,input.pointBefore,0,0,false,input.reasonCode,JSON.stringify(result)]);await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]);return result;}

// Kakao 외부 identity와 활성 player를 동일 행 잠금으로 결정합니다.
async function lockActor(transaction:DatabaseTransaction,externalUserId:string):Promise<ActorRow>{const row=(await transaction.query<ActorRow[]>("SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE",[externalUserId]))[0];if(row===undefined)throw new ApplicationError("PUNCH_ACTOR_REQUIRED","가입된 회원 정보를 찾을 수 없습니다.",409);return row;}
function assertSample(value:number):void{if(!Number.isFinite(value)||value<0||value>=1)throw new ApplicationError("INVALID_PUNCH_RNG_SAMPLE","펀치 RNG 표본이 유효하지 않습니다.",500);}
function min(a:bigint,b:bigint):bigint{return a<b?a:b;}
function decimalInteger(value:string):bigint{return BigInt(value.split(".")[0]!);}
function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|PunchActionResult):PunchActionResult{return typeof value==="string"?JSON.parse(value) as PunchActionResult:value;}
