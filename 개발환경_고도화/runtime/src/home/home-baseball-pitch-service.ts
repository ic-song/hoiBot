import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseHomeBaseballPitchCommand } from "./home-baseball-pitch-command.js";

const COMMAND_CODE = "HOME_BASEBALL_PITCH";
const BALL_CODE = "ITEM-RWD-014";
const SHOP_CODE = "ITEM-RWD-001";
const SPIRIT_STONE_CODE = "ITEM-ELEMENTAL-UPGRADE-STONE";
const PET_STONE_CODE = "ITEM-RWD-026";
const TITLE_CODE = "TITLE-BASEBALL-GRAND-SLAM";
const ALLSEE = "\u200b".repeat(500);

type Owner = { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null };
type Item = { id: bigint; code: string };
type Stack = { item_id: bigint; code: string; quantity: bigint; version: bigint };
type Account = { balance: string; version: bigint };

export interface BaseballPitchCounts {
  hit: bigint;
  double: bigint;
  triple: bigint;
  homerun: bigint;
  grandSlam: bigint;
  point: bigint;
}

export interface HomeBaseballPitchResult {
  status: "applied" | "usage" | "limit" | "insufficient";
  replies: Array<{ message: string; outboxId: string }>;
  replayed: boolean;
  useCount: string;
  remaining: string;
  pointReward: string;
  counts: { hit: string; double: string; triple: string; homerun: string; grandSlam: string };
}

function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | HomeBaseballPitchResult): HomeBaseballPitchResult { return typeof value === "string" ? JSON.parse(value) as HomeBaseballPitchResult : value; }
function integral(value: unknown): bigint {
  const text = String(value);
  if (!/^-?\d+(?:\.0+)?$/.test(text)) throw new Error("Expected an integral database value: " + text);
  return BigInt(text.split(".")[0]!);
}

// 매 타석 확률 경계와 포인트 보상을 레거시 순서대로 계산합니다.
export function resolveBaseballPitch(samples: number[]): BaseballPitchCounts {
  const counts: BaseballPitchCounts = { hit: 0n, double: 0n, triple: 0n, homerun: 0n, grandSlam: 0n, point: 0n };
  for (const sample of samples) {
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("invalid baseball RNG sample");
    if (sample < 0.01) { counts.grandSlam += 1n; counts.point += 10_000_000_000n; }
    else if (sample < 0.05) { counts.homerun += 1n; counts.point += 100_000_000n; }
    else if (sample < 0.15) { counts.triple += 1n; counts.point += 10_000_000n; }
    else if (sample < 0.35) { counts.double += 1n; counts.point += 3_000_000n; }
    else { counts.hit += 1n; counts.point += 1_000_000n; }
  }
  return counts;
}

function countResult(counts: BaseballPitchCounts): HomeBaseballPitchResult["counts"] {
  return { hit: counts.hit.toString(), double: counts.double.toString(), triple: counts.triple.toString(), homerun: counts.homerun.toString(), grandSlam: counts.grandSlam.toString() };
}

// 레거시 경기 결과와 300ms 후 기본 보상 메시지를 순서대로 생성합니다.
export function buildHomeBaseballPitchMessages(input: { displayName: string; rankEmoji: string | null; useCount: bigint; remaining: bigint; counts: BaseballPitchCounts }): string[] {
  const rankName = `${input.rankEmoji ?? ""}${input.displayName}`;
  const resultLine: string[] = [];
  if (input.counts.hit > 0n) resultLine.push(`안타: ${input.counts.hit}회`);
  if (input.counts.double > 0n) resultLine.push(`2루타: ${input.counts.double}회`);
  if (input.counts.triple > 0n) resultLine.push(`3루타: ${input.counts.triple}회`);
  if (input.counts.homerun > 0n) resultLine.push(`홈런: ${input.counts.homerun}회`);
  if (input.counts.grandSlam > 0n) resultLine.push(`그랜드슬램: ${input.counts.grandSlam}회`);
  let liveText: string;
  let image: string;
  if (input.counts.grandSlam > 0n) { liveText = `그랜드슬램이 터졌습니다! 오늘 경기의 주인공은 단연 [${rankName}] 선수입니다!`; image = "https://ibb.co/hxnKPFPP"; }
  else if (input.counts.homerun > 0n) { liveText = `홈런포가 터졌습니다! [${rankName}] 선수 오늘 완전히 담장을 지배합니다!`; image = "https://ibb.co/8D56Xvsc"; }
  else if (input.counts.triple > 0n) { liveText = `3루타가 나왔습니다! [${rankName}] 선수의 폭발적인 주루 플레이!`; image = "https://ibb.co/RT3fBm5Y"; }
  else if (input.counts.double > 0n) { liveText = `2루타 성공! [${rankName}] 선수의 시원한 장타가 나옵니다!`; image = "https://ibb.co/7dQTCM47"; }
  else { liveText = `안타가 나왔습니다! [${rankName}] 선수 꾸준히 출루에 성공합니다!`; image = "https://ibb.co/X64N9cx"; }
  let result = `⚾️ 투수 던집니다! ⚾️\n[${rankName}] 선수(${input.useCount}회 타석)\n\n📊 경기 결과\n[${resultLine.join(" ")}]\n`;
  result += `💰 총 추가 포인트: 🅟${commas(input.counts.point)}\n👜 남은 보유: ${input.remaining}개\n`;
  if (input.counts.grandSlam > 0n) result += `\n🏅 타이틀 획득: ${input.counts.grandSlam}개\n🏷️ 타이틀명: ⚾️그랜드슬램을 달성한 선수🏆\n`;
  result += `\n⚾️ 경기 생중계\n${liveText}\n\n🖼️ 하이라이트\n${image}`;
  const base = `📦 기본 지급 아이템 ${ALLSEE}\n\n펫스윗홈인테리어샵🖼️(/샵오픈) ${input.useCount * 30n}개\n정령 강화석🥀 ${input.useCount * 10n}개\n펫 강화석⭐ ${input.useCount * 10n}개`;
  return [result, base];
}

async function complete(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; owner: Owner; status: HomeBaseballPitchResult["status"]; messages: string[]; useCount: bigint; remaining: bigint; counts: BaseballPitchCounts; summary: Record<string, unknown> }): Promise<HomeBaseballPitchResult> {
  const replies: HomeBaseballPitchResult["replies"] = [];
  for (const message of input.messages) {
    const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId,input.destinationId,JSON.stringify({data:message})]);
    replies.push({ message, outboxId: outbox.insertId.toString() });
  }
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,COMMAND_CODE,input.operationId,input.status]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'home.baseball.pitch',?,'Iris /투수던집니다',?,UTC_TIMESTAMP(3))", [input.operationId,input.owner.identity_id,input.owner.player_id,input.status,JSON.stringify(input.summary)]);
  const result: HomeBaseballPitchResult = { status: input.status,replies,replayed:false,useCount:input.useCount.toString(),remaining:input.remaining.toString(),pointReward:input.counts.point.toString(),counts:countResult(input.counts) };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),input.operationId]);
  return result;
}

// 야구공 소비와 아이템·포인트·타이틀 인스턴스 보상을 하나의 transaction으로 처리합니다.
export class HomeBaseballPitchService {
  public constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<HomeBaseballPitchResult> {
    const command = parseHomeBaseballPitchCommand(input.message);
    if (command === undefined) throw new ApplicationError("HOME_BASEBALL_PITCH_COMMAND_INVALID","투수 명령 형식을 확인해 주세요.",422);
    return this.database.withTransaction(async transaction => {
      const owner = (await transaction.query<Owner[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
        JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (owner === undefined) throw new ApplicationError("HOME_BASEBALL_PITCH_USER_REQUIRED","가입 정보를 확인할 수 없습니다.",403);
      const key = eventKey(input.eventId);
      const prior = (await transaction.query<Array<{result_json:string|HomeBaseballPitchResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='home.baseball.pitch' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (prior?.result_json != null) return {...stored(prior.result_json),replayed:true};
      const operationId = (await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.baseball.pitch',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(),key,owner.identity_id])).insertId;
      const zero: BaseballPitchCounts = {hit:0n,double:0n,triple:0n,homerun:0n,grandSlam:0n,point:0n};
      if (command.kind === "usage") return complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,owner,status:"usage",messages:["사용법: /투수던집니다 [숫자]\n예시: /투수던집니다 10"],useCount:0n,remaining:0n,counts:zero,summary:{mutation:false,reason:"usage"}});
      if (command.kind === "limit") return complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,owner,status:"limit",messages:["한 번에 최대 100개까지만 사용할 수 있습니다."],useCount:0n,remaining:0n,counts:zero,summary:{mutation:false,reason:"limit"}});

      const items = await transaction.query<Item[]>("SELECT id,code FROM item_definitions WHERE code IN (?,?,?,?) AND active=TRUE ORDER BY id FOR UPDATE", [BALL_CODE,SHOP_CODE,SPIRIT_STONE_CODE,PET_STONE_CODE]);
      if (items.length !== 4) throw new ApplicationError("HOME_BASEBALL_PITCH_ITEM_REQUIRED","야구 보상 아이템 정의를 확인할 수 없습니다.",409);
      const byCode = new Map(items.map(item=>[item.code,item]));
      for (const code of [SHOP_CODE,SPIRIT_STONE_CODE,PET_STONE_CODE]) await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,1)",[owner.player_id,byCode.get(code)!.id]);
      const stacks = await transaction.query<Stack[]>(`SELECT stack.item_id,item.code,stack.quantity,stack.version FROM item_definitions item
        LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.code IN (?,?,?,?) ORDER BY item.id FOR UPDATE`, [owner.player_id,BALL_CODE,SHOP_CODE,SPIRIT_STONE_CODE,PET_STONE_CODE]);
      const ball = stacks.find(row=>row.code===BALL_CODE);
      const owned = ball?.quantity == null ? 0n : BigInt(ball.quantity);
      if (ball === undefined || owned < command.count) return complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,owner,status:"insufficient",messages:[`호이베이스볼⚾️(/투수던집니다) 보유 수량이 부족합니다.\n현재 보유: ${owned}개`],useCount:command.count,remaining:owned,counts:zero,summary:{mutation:false,requested:command.count.toString(),owned:owned.toString()}});

      const samples = Array.from({length:Number(command.count)},()=>this.random());
      const counts = resolveBaseballPitch(samples);
      const accountRows = await transaction.query<Account[]>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[owner.player_id]);
      if (accountRows[0]===undefined) { await transaction.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1)",[owner.player_id]); }
      const account = (await transaction.query<Account[]>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[owner.player_id]))[0]!;
      const pointBefore = integral(account.balance), pointAfter = pointBefore + counts.point, remaining = owned-command.count;
      const consumed = await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[remaining,owner.player_id,ball.item_id,ball.version]);
      if(consumed.affectedRows!==1n)throw new ApplicationError("HOME_BASEBALL_PITCH_CONFLICT","야구공 보유량이 먼저 변경되었습니다.",409);
      let ledgerSequence=1;
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'HOME_BASEBALL_PITCH_CONSUME')",[operationId,ledgerSequence++,owner.player_id,ball.item_id,-command.count]);
      const grants:[[string,bigint],[string,bigint],[string,bigint]]=[[SHOP_CODE,command.count*30n],[SPIRIT_STONE_CODE,command.count*10n],[PET_STONE_CODE,command.count*10n]];
      for(const [code,quantity] of grants){const stack=stacks.find(row=>row.code===code)!;const changed=await transaction.execute("UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[quantity,owner.player_id,stack.item_id,stack.version]);if(changed.affectedRows!==1n)throw new ApplicationError("HOME_BASEBALL_PITCH_CONFLICT","보상 가방이 먼저 변경되었습니다.",409);await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'HOME_BASEBALL_PITCH_REWARD')",[operationId,ledgerSequence++,owner.player_id,stack.item_id,quantity]);}
      const pointChanged=await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[pointAfter,owner.player_id,account.version]);
      if(pointChanged.affectedRows!==1n)throw new ApplicationError("HOME_BASEBALL_PITCH_CONFLICT","포인트가 먼저 변경되었습니다.",409);
      await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'HOME_BASEBALL_PITCH_REWARD')",[operationId,owner.player_id,counts.point,pointAfter]);
      const title=(await transaction.query<Array<{id:bigint}>>("SELECT id FROM title_definitions WHERE code=? AND active=TRUE FOR UPDATE",[TITLE_CODE]))[0];
      if(title===undefined)throw new ApplicationError("HOME_BASEBALL_PITCH_TITLE_REQUIRED","야구 타이틀 정의를 확인할 수 없습니다.",409);
      if(counts.grandSlam>0n){const order=(await transaction.query<Array<{max_order:bigint|null}>>("SELECT MAX(display_order) max_order FROM player_title_instances WHERE player_id=?",[owner.player_id]))[0]?.max_order??0n;for(let i=1n;i<=counts.grandSlam;i++)await transaction.execute("INSERT INTO player_title_instances(instance_key,player_id,title_id,source_operation_id,source_sequence_no,price_value,display_order,status,equipped,acquired_at,version) VALUES (UUID(),?,?,?,?,100000000,?,'owned',FALSE,UTC_TIMESTAMP(3),1)",[owner.player_id,title.id,operationId,i,order+i]);await transaction.execute("INSERT IGNORE INTO player_titles(player_id,title_id,acquired_at,equipped) VALUES (?,?,UTC_TIMESTAMP(3),FALSE)",[owner.player_id,title.id]);}
      for(let index=0;index<samples.length;index++)await transaction.execute("INSERT INTO baseball_pitch_rng_samples(operation_id,sequence_no,sample_value,outcome_code) VALUES (?,?,?,?)",[operationId,index+1,samples[index]!.toFixed(17),samples[index]!<0.01?"grand_slam":samples[index]!<0.05?"homerun":samples[index]!<0.15?"triple":samples[index]!<0.35?"double":"hit"]);
      await transaction.execute("INSERT INTO baseball_pitch_operations(operation_id,player_id,use_count,hit_count,double_count,triple_count,homerun_count,grand_slam_count,point_reward,ball_remaining,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))",[operationId,owner.player_id,command.count,counts.hit,counts.double,counts.triple,counts.homerun,counts.grandSlam,counts.point,remaining]);
      const messages=buildHomeBaseballPitchMessages({displayName:owner.display_name,rankEmoji:owner.rank_emoji,useCount:command.count,remaining,counts});
      return complete(transaction,{operationId,eventId:input.eventId,destinationId:input.destinationId,owner,status:"applied",messages,useCount:command.count,remaining,counts,summary:{mutation:true,useCount:command.count.toString(),remaining:remaining.toString(),pointReward:counts.point.toString(),counts:countResult(counts),titleInstances:counts.grandSlam.toString()}});
    });
  }
}
