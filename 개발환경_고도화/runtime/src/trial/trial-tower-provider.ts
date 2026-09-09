import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { critChance, critMultiplier, typeBuff } from "../battle/matzang-field-provider.js";
import { RaidStrikeSealCanonicalOwnershipProvider } from "../raid/raid-strike-seal-canonical-ownership-provider.js";

const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const parse = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;
const valid = (sample: number) => { if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("invalid trial tower RNG sample"); return sample; };

export type TrialTowerReward = { itemCode: string; quantity: number; boostable?: boolean };
export type TrialTowerProfile = { charm: number; petType: string | null; upgrade: number; skills: readonly string[] };
export type TrialTowerPolicy = { win: boolean; directWin: boolean; playerFinal: number; triggeredSkill: string | null; guideUsed: boolean; junkReward: number; worship: boolean; samples: readonly number[] };
export type TrialTowerResult = { status: "win" | "lose" | "inactive" | "limit" | "insufficient_point" | "no_pet" | "no_boss"; data: string; outboxId: string; floor?: string; policy?: TrialTowerPolicy };

export function trialJunkReward(sample: number): number { const value = valid(sample) * 100; return value < 86 ? 1 : value < 96 ? 5 : value < 99 ? 20 : value < 99.9 ? 50 : 300; }

export function resolveTrialTower(profile: TrialTowerProfile, boss: { charm: number; petType: string | null }, samples: readonly number[], hasGuide: boolean): TrialTowerPolicy {
  if (samples.length < 6) throw new Error("six trial tower RNG samples are required");
  samples.forEach(valid);
  const skills = new Set(profile.skills), [buff] = typeBuff(profile.petType, boss.petType);
  let base = profile.charm, triggeredSkill: string | null = null;
  if (skills.has("구원") && samples[0]! < .5) { base += 500000; triggeredSkill = "구원"; }
  else if (skills.has("십원") && samples[0]! < .4) { base += 1000000; triggeredSkill = "십원"; }
  const buffed = Math.round(base * buff), critical = samples[1]! < critChance(profile.upgrade);
  const playerFinal = critical ? Math.round(buffed * critMultiplier(profile.upgrade)) : buffed;
  const directWin = playerFinal > boss.charm;
  const walker = !directWin && skills.has("시련을 걷는 자") && samples[2]! < .1;
  const guideUsed = !directWin && !walker && hasGuide;
  const guideWin = guideUsed && samples[3]! < .7;
  const win = directWin || walker || guideWin;
  return { win, directWin, playerFinal, triggeredSkill: walker ? "시련을 걷는 자" : triggeredSkill, guideUsed, junkReward: win ? trialJunkReward(samples[4]!) : 0, worship: skills.has("탑 숭배자") && samples[5]! < .1, samples };
}

type Season = { season_key: string; max_daily_attempts: number; auto_bonus_attempts: number; free_floor_max: bigint; paid_entry_point: string };
type Boss = { boss_code: string; display_name: string; pet_type_name: string | null; rewards_json: string | TrialTowerReward[] };
type Item = { id: bigint; code: string; quantity: bigint };

export class TrialTowerProvider {
  constructor(private readonly db: DatabaseClient, private readonly random: () => number = Math.random,private readonly raidSealOwnership=new RaidStrikeSealCanonicalOwnershipProvider()) {}

  async attempt(input: { eventId: string; destinationId: string; playerId: string; profile: TrialTowerProfile; recordDate: string; autoBonus?: boolean; masterBypass?: boolean; suppressOutbox?: boolean; format?: (result: TrialTowerResult) => string }): Promise<TrialTowerResult> {
    return this.db.withTransaction(async tx => {
      const prior = await tx.query<Array<{ result_json: string | TrialTowerResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='trial.tower.attempt' AND idempotency_key=? FOR UPDATE", [input.eventId]);
      if (prior[0]?.result_json != null) return parse<TrialTowerResult>(prior[0].result_json);
      const operation = await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status) VALUES (?,'trial.tower.attempt',?,'player',?,'iris','processing')", [randomUUID(), input.eventId, input.playerId]);
      let status: TrialTowerResult["status"] = "inactive", floor: bigint | undefined, policy: TrialTowerPolicy | undefined;
      const season = (await tx.query<Season[]>("SELECT * FROM trial_tower_seasons WHERE active=TRUE ORDER BY season_key LIMIT 1 FOR UPDATE"))[0];
      if (!season) return this.finish(tx, operation.insertId, input, { status, data: "현재 시련의 탑이 진행 중이 아닙니다.", outboxId: "" });
      if (!Number.isFinite(input.profile.charm) || input.profile.charm < 0) return this.finish(tx, operation.insertId, input, { status: "no_pet", data: "펫 정보가 없습니다.", outboxId: "" });
      await tx.execute("INSERT IGNORE INTO player_pet_daily_records(player_id,record_date) VALUES (?,?)", [input.playerId, input.recordDate]);
      const daily = (await tx.query<Array<{ tower_attempts: bigint }>>("SELECT tower_attempts FROM player_pet_daily_records WHERE player_id=? AND record_date=? FOR UPDATE", [input.playerId, input.recordDate]))[0]!;
      const max = BigInt(season.max_daily_attempts + (input.autoBonus ? season.auto_bonus_attempts : 0));
      if (!input.masterBypass && daily.tower_attempts >= max) return this.finish(tx, operation.insertId, input, { status: "limit", data: "오늘 시련의 탑 도전 횟수를 모두 사용했습니다.", outboxId: "" });
      await tx.execute("INSERT IGNORE INTO trial_tower_progress(season_key,player_id) VALUES (?,?)", [season.season_key, input.playerId]);
      const progress = (await tx.query<Array<{ floor: bigint }>>("SELECT floor FROM trial_tower_progress WHERE season_key=? AND player_id=? FOR UPDATE", [season.season_key, input.playerId]))[0]!;
      floor = progress.floor + 1n;
      const boss = (await tx.query<Boss[]>(`SELECT boss_code,display_name,pet_type_name,rewards_json FROM trial_tower_event_bosses WHERE season_key=? AND floor=? AND active=TRUE UNION ALL SELECT boss_code,display_name,pet_type_name,rewards_json FROM trial_tower_boss_bands WHERE season_key=? AND ? BETWEEN min_floor AND max_floor AND active=TRUE ORDER BY boss_code LIMIT 1 FOR UPDATE`, [season.season_key, floor, season.season_key, floor]))[0];
      if (!boss) return this.finish(tx, operation.insertId, input, { status: "no_boss", data: "해당 층의 보스 정보가 없습니다.", outboxId: "", floor: floor.toString() });
      const items = await tx.query<Item[]>(`SELECT d.id,d.code,COALESCE(s.quantity,0) quantity FROM item_definitions d LEFT JOIN inventory_stacks s ON s.item_id=d.id AND s.player_id=? WHERE d.code IN ('trial_reset_ticket','trial_guide','trial_booster','trial_junk','trial_magic_stone') FOR UPDATE`, [input.playerId]);
      const byCode = new Map(items.map(item => [item.code, item]));
      const reset = byCode.get("trial_reset_ticket"), guide = byCode.get("trial_guide"), booster = byCode.get("trial_booster");
      let pointCost = 0n, resetUsed = 0n;
      if (floor > season.free_floor_max) {
        if ((reset?.quantity ?? 0n) > 0n) resetUsed = 1n;
        else {
          pointCost = BigInt(season.paid_entry_point.split('.')[0]!);
          await tx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance) VALUES (?,'point',0)", [input.playerId]);
          const account = (await tx.query<Array<{ balance: string }>>("SELECT balance FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [input.playerId]))[0]!;
          if (BigInt(account.balance.split('.')[0]!) < pointCost) return this.finish(tx, operation.insertId, input, { status: "insufficient_point", data: "시련의 탑 입장 포인트가 부족합니다.", outboxId: "", floor: floor.toString() });
          await tx.execute("UPDATE currency_accounts SET balance=balance-?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point'", [pointCost, input.playerId]);
          await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) SELECT ?,1,player_id,currency_code,-?,balance,'TRIAL_TOWER_ENTRY' FROM currency_accounts WHERE player_id=? AND currency_code='point'", [operation.insertId, pointCost, input.playerId]);
        }
      }
      const samples = Array.from({ length: 6 }, () => valid(this.random()));
      policy = resolveTrialTower(input.profile, { charm: Number(floor * 1000n), petType: boss.pet_type_name }, samples, (guide?.quantity ?? 0n) > 0n);
      status = policy.win ? "win" : "lose";
      let inventorySeq = 1, boosterUsed = 0n;
      const mutate = async (item: Item | undefined, delta: bigint, reason: string) => { if (!item || delta === 0n) return; if (delta < 0n) await tx.execute("UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=?", [-delta, input.playerId, item.id]); else await tx.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1", [input.playerId, item.id, delta]); await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,?)", [operation.insertId, inventorySeq++, input.playerId, item.id, delta, reason]); };
      await mutate(reset, -resetUsed, "TRIAL_TOWER_RESET_TICKET");
      await mutate(guide, policy.guideUsed ? -1n : 0n, "TRIAL_TOWER_GUIDE");
      if (policy.win) {
        await mutate(byCode.get("trial_junk"), BigInt(policy.junkReward), "TRIAL_TOWER_JUNK_REWARD");
        const rewards=parse<TrialTowerReward[]>(boss.rewards_json);
        for (let rewardIndex=0;rewardIndex<rewards.length;rewardIndex+=1) {
          const reward=rewards[rewardIndex]!;
          const item = byCode.get(reward.itemCode); let quantity = BigInt(reward.quantity);
          if (reward.boostable && booster) { boosterUsed += booster.quantity < quantity ? booster.quantity : quantity; quantity += booster.quantity < quantity ? booster.quantity : quantity; }
          if(this.raidSealOwnership.isLegacyCompatibilityInput(reward.itemCode))await this.raidSealOwnership.change(tx,{actor:"trial-tower",legacyPlayerId:input.playerId,requestKey:`tower:${input.eventId}:${floor}:${rewardIndex}`,quantityDelta:quantity,reasonType:"TRIAL_TOWER_BOSS_REWARD"});
          else await mutate(item, quantity, "TRIAL_TOWER_BOSS_REWARD");
        }
        await mutate(booster, -boosterUsed, "TRIAL_TOWER_BOOSTER");
        await tx.execute("UPDATE trial_tower_progress SET floor=?,last_win_at=UTC_TIMESTAMP(3),version=version+1 WHERE season_key=? AND player_id=?", [floor, season.season_key, input.playerId]);
        if (floor % 10000n === 0n) await tx.execute("INSERT IGNORE INTO player_titles(player_id,title_id,acquired_at,display_order) SELECT ?,definition.id,UTC_TIMESTAMP(3),COALESCE(MAX(owned.display_order),0)+1 FROM title_definitions definition LEFT JOIN player_titles owned ON owned.player_id=? WHERE definition.code='trial_floor_10000' GROUP BY definition.id", [input.playerId, input.playerId]);
      }
      if (policy.worship) await tx.execute("UPDATE player_pets SET experience=experience+1,version=version+1 WHERE player_id=?", [input.playerId]);
      await tx.execute("UPDATE player_pet_daily_records SET tower_attempts=tower_attempts+1,tower_floor=?,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND record_date=?", [floor, input.playerId, input.recordDate]);
      await tx.execute("INSERT INTO trial_tower_attempts(operation_id,season_key,player_id,floor,boss_code,status,direct_win,player_charm,player_final_charm,boss_charm,point_cost,reset_ticket_used,guide_used,booster_used,junk_reward,triggered_skill) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, season.season_key, input.playerId, floor, boss.boss_code, status, policy.directWin, input.profile.charm, policy.playerFinal, floor * 1000n, pointCost, resetUsed, policy.guideUsed ? 1 : 0, boosterUsed, policy.junkReward, policy.triggeredSkill]);
      for (let index = 0; index < samples.length; index++) await tx.execute("INSERT INTO trial_tower_rng_samples(operation_id,sequence_no,sample_code,sample_value,outcome_code) VALUES (?,?,?,?,?)", [operation.insertId, index + 1, ["rescue","critical","walker","guide","junk","worship"][index], samples[index]!.toFixed(17), "sampled"]);
      const result: TrialTowerResult = { status, data: `${floor.toString()}층 ${boss.display_name}: ${status}`, outboxId: "", floor: floor.toString(), policy };
      return this.finish(tx, operation.insertId, input, result);
    });
  }

  private async finish(tx: DatabaseTransaction, operationId: bigint, input: { eventId: string; destinationId: string; playerId: string; suppressOutbox?: boolean; format?: (result: TrialTowerResult) => string }, result: TrialTowerResult): Promise<TrialTowerResult> {
    result.data = input.format ? input.format(result) : result.data;
    if (!input.suppressOutbox) {
      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status) VALUES (?,'iris',?,'text',?,'pending')", [operationId, input.destinationId, JSON.stringify({ data: result.data })]);
      result.outboxId = outbox.insertId.toString();
    }
    await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json) VALUES (?,'player',?,'trial_tower',NULL,'trial.tower.attempt',?,'Iris /시련의탑',?)", [operationId, input.playerId, result.status, json({ status: result.status, floor: result.floor ?? null })]);
    await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'TRIAL_TOWER_PROVIDER',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operationId, result.status]);
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [json(result), operationId]);
    return result;
  }
}
