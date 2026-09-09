import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "GUILD_CONTRIBUTION_APPLY";
const COMMAND_ALIAS = "/길드공헌 [숫자]";
const MEDAL_CODE = "guild_contribution_medal";
const PET_FOOD_CODE = "pet_food";
const MINI_PET_DRAW_CODE = "mini_pet_draw";
const FURNITURE_DRAW_CODE = "furniture_draw";
const PET_SKILL_BOOK_CODE = "pet_skill_book_fragment";
const PET_ENHANCE_STONE_CODE = "pet_enhance_stone";
const MAX_UINT64 = 18_446_744_073_709_551_615n;

export interface GuildContributionApplyResult {
  status: "contributed" | "guild_required" | "item_shortage";
  count: string;
  contributionAfter: string;
  guildExperienceAfter: string;
  guildLevelAfter: number;
  heartBonus: boolean;
  reachedLevels: number[];
  data: string;
  outboxId: string;
}

interface ActorRow { identity_id: bigint; player_id: bigint; display_name: string; guild_id: bigint | null; guild_name: string | null; }
interface ItemRow { id: bigint; code: string; display_name: string; }
interface ProgressRow { level: number; experience: bigint; max_members: number; version: bigint; }
interface PolicyRow { target_level: number; required_experience: bigint; max_member_increment: number; guild_fund_reward: bigint; pet_skill_book_reward: bigint; pet_enhance_stone_reward: bigint; all_member_pet_food_reward: bigint; }

// /길드공헌과 양의 정수 하나만 받아 /길드공헌추가 prefix 충돌을 차단합니다.
export function parseGuildContributionCount(message: string | undefined): bigint | null {
  if (message === undefined) return null;
  const match = /^\/길드공헌\s+([1-9]\d*)$/.exec(message);
  if (match === null) return null;
  const count = BigInt(match[1]!);
  return count <= MAX_UINT64 ? count : null;
}

export function isGuildContributionApplyCandidate(message: string | undefined): boolean { return parseGuildContributionCount(message) !== null; }
export function normalizeGuildContributionApplyDispatchMessage(message: string): string { return isGuildContributionApplyCandidate(message) ? COMMAND_ALIAS : message; }

// 장착 스킬이 있을 때만 실행당 한 번의 1% 추첨 결과를 반환합니다.
export function rollGuildHeartBonus(hasEquippedSkill: boolean, randomValue: number): boolean {
  return hasEquippedSkill && randomValue >= 0 && randomValue < 0.01;
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildContributionApplyResult): GuildContributionApplyResult { return typeof value === "string" ? JSON.parse(value) as GuildContributionApplyResult : value; }
function comma(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function addChecked(left: bigint, right: bigint, code: string): bigint { const value = left + right; if (value > MAX_UINT64) throw new ApplicationError(code, "수량 한도를 초과합니다.", 409); return value; }

// 개인·길드·인벤토리·레벨보상·RNG 증거를 동일 transaction에서 반영합니다.
export class GuildContributionApplyService {
  constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  async handleDispatchedIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }> {
    const decision = await new CommandDispatcher(new MariaCommandDispatchRepository(this.database), { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }).resolve({ eventId: input.eventId, message: normalizeGuildContributionApplyDispatchMessage(input.message), userId: input.externalUserId, hasTrustedDisplayName: true });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.handle(input);
    return result === null ? { status: "handled_no_reply" } : { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<GuildContributionApplyResult | null> {
    const count = parseGuildContributionCount(input.message);
    if (count === null) throw new ApplicationError("INVALID_GUILD_CONTRIBUTION_COMMAND", "사용법: /길드공헌 [숫자]", 422);
    const key = eventKey(input.eventId);
    return withRetry(() => this.database.withTransaction(async transaction => {
      const previous = (await transaction.query<Array<{ result_json: string | GuildContributionApplyResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='guild.contribution.apply' AND idempotency_key=? FOR UPDATE", [key]))[0];
      if (previous?.result_json != null) return stored(previous.result_json);
      const actor = (await transaction.query<ActorRow[]>("SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,membership.guild_id,guild.display_name guild_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN guild_members membership ON membership.player_id=player.id LEFT JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE", [input.externalUserId]))[0];
      if (actor === undefined) return null;
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.contribution.apply',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, actor.identity_id]);
      if (actor.guild_id === null || actor.guild_name === null) return complete(transaction, operation.insertId, input, actor, { status: "guild_required", count, contributionAfter: 0n, guildExperienceAfter: 0n, guildLevelAfter: 1, heartBonus: false, reachedLevels: [], data: "길드에 가입한 회원만 길드공헌을 할 수 있습니다." });

      const definitions = await transaction.query<ItemRow[]>("SELECT id,code,display_name FROM item_definitions WHERE code IN (?,?,?,?,?,?) AND active=TRUE AND stackable=TRUE FOR UPDATE", [MEDAL_CODE, PET_FOOD_CODE, MINI_PET_DRAW_CODE, FURNITURE_DRAW_CODE, PET_SKILL_BOOK_CODE, PET_ENHANCE_STONE_CODE]);
      const items = new Map(definitions.map(item => [item.code, item]));
      for (const code of [MEDAL_CODE, PET_FOOD_CODE, MINI_PET_DRAW_CODE, FURNITURE_DRAW_CODE, PET_SKILL_BOOK_CODE, PET_ENHANCE_STONE_CODE]) if (!items.has(code)) throw new Error(`Guild contribution item definition is missing: ${code}`);
      const medal = items.get(MEDAL_CODE)!;
      const stack = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [actor.player_id, medal.id]))[0];
      if (stack === undefined || BigInt(stack.quantity) < count) return complete(transaction, operation.insertId, input, actor, { status: "item_shortage", count, contributionAfter: 0n, guildExperienceAfter: 0n, guildLevelAfter: 1, heartBonus: false, reachedLevels: [], data: `${medal.display_name} 보유 수량이 부족합니다.` });

      await transaction.execute("INSERT IGNORE INTO guild_progression_states(guild_id,level,experience,max_members,version) VALUES (?,1,0,5,1)", [actor.guild_id]);
      await transaction.execute("INSERT IGNORE INTO guild_member_contribution_states(guild_id,player_id,contribution_total,version) VALUES (?,?,0,1)", [actor.guild_id, actor.player_id]);
      await transaction.execute("INSERT IGNORE INTO player_counters(player_id,counter_code,period_key,value,updated_at) VALUES (?,'guild_contribution_usage_count','lifetime',0,UTC_TIMESTAMP(3))", [actor.player_id]);
      const progress = (await transaction.query<ProgressRow[]>("SELECT level,experience,max_members,version FROM guild_progression_states WHERE guild_id=? FOR UPDATE", [actor.guild_id]))[0]!;
      const contribution = (await transaction.query<Array<{ contribution_total: bigint; version: bigint }>>("SELECT contribution_total,version FROM guild_member_contribution_states WHERE guild_id=? AND player_id=? FOR UPDATE", [actor.guild_id, actor.player_id]))[0]!;
      const usage = (await transaction.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='guild_contribution_usage_count' AND period_key='lifetime' FOR UPDATE", [actor.player_id]))[0]!;
      const contributionAfter = addChecked(BigInt(contribution.contribution_total), count, "GUILD_CONTRIBUTION_OVERFLOW");
      const experienceAfter = addChecked(BigInt(progress.experience), count, "GUILD_EXPERIENCE_OVERFLOW");

      const consumed = await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=?", [count, actor.player_id, medal.id, stack.version, count]);
      if (consumed.affectedRows !== 1n) throw new Error("Guild contribution medal inventory conflict.");
      const memberChanged = await transaction.execute("UPDATE guild_member_contribution_states SET contribution_total=?,version=version+1 WHERE guild_id=? AND player_id=? AND version=?", [contributionAfter, actor.guild_id, actor.player_id, contribution.version]);
      if (memberChanged.affectedRows !== 1n) throw new Error("Guild contribution member conflict.");
      await transaction.execute("UPDATE player_counters SET value=value+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND counter_code='guild_contribution_usage_count' AND period_key='lifetime' AND value=?", [actor.player_id, usage.value]);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'GUILD_CONTRIBUTION_CONSUME')", [operation.insertId, actor.player_id, medal.id, -count]);

      let inventorySequence = 2;
      inventorySequence = await grantPlayerItem(transaction, operation.insertId, inventorySequence, actor.player_id, items.get(PET_FOOD_CODE)!, count * 5n, "GUILD_CONTRIBUTION_REWARD");
      inventorySequence = await grantPlayerItem(transaction, operation.insertId, inventorySequence, actor.player_id, items.get(MINI_PET_DRAW_CODE)!, count * 3n, "GUILD_CONTRIBUTION_REWARD");
      inventorySequence = await grantPlayerItem(transaction, operation.insertId, inventorySequence, actor.player_id, items.get(FURNITURE_DRAW_CODE)!, count * 2n, "GUILD_CONTRIBUTION_REWARD");

      const skillCount = (await transaction.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_pets pet JOIN pet_skills owned ON owned.player_pet_id=pet.id AND owned.equipped=TRUE JOIN skill_definitions definition ON definition.id=owned.skill_id AND definition.display_name='길드의 심장' AND definition.active=TRUE WHERE pet.player_id=?", [actor.player_id]))[0]?.count_value ?? 0n;
      const hasHeart = skillCount > 0n;
      const roll = hasHeart ? this.random() : null;
      const heartBonus = roll !== null && rollGuildHeartBonus(true, roll);
      if (roll !== null) await transaction.execute("INSERT INTO guild_contribution_random_draws(operation_id,draw_code,roll_value,threshold_value,triggered) VALUES (?,'GUILD_HEART',?,0.0100000000,?)", [operation.insertId, roll.toFixed(10), heartBonus]);

      const policies = await transaction.query<PolicyRow[]>("SELECT target_level,required_experience,max_member_increment,guild_fund_reward,pet_skill_book_reward,pet_enhance_stone_reward,all_member_pet_food_reward FROM guild_contribution_level_policies WHERE target_level>? AND required_experience<=? ORDER BY target_level FOR UPDATE", [progress.level, experienceAfter]);
      let levelAfter = progress.level;
      let maxMembersAfter = progress.max_members;
      let warehouseSequence = 1;
      let resourceSequence = 1;
      if (heartBonus) resourceSequence = await grantGuildFund(transaction, operation.insertId, resourceSequence, actor.guild_id, 1_000_000n, "GUILD_HEART_BONUS");
      const reachedLevels: number[] = [];
      const guildMembers = policies.some(policy => BigInt(policy.all_member_pet_food_reward) > 0n) ? await transaction.query<Array<{ player_id: bigint }>>("SELECT player_id FROM guild_members WHERE guild_id=? ORDER BY player_id FOR UPDATE", [actor.guild_id]) : [];
      for (const policy of policies) {
        levelAfter = policy.target_level;
        maxMembersAfter += policy.max_member_increment;
        reachedLevels.push(policy.target_level);
        if (BigInt(policy.guild_fund_reward) > 0n) resourceSequence = await grantGuildFund(transaction, operation.insertId, resourceSequence, actor.guild_id, BigInt(policy.guild_fund_reward), "GUILD_LEVEL_REWARD");
        if (BigInt(policy.pet_skill_book_reward) > 0n) warehouseSequence = await grantGuildItem(transaction, operation.insertId, warehouseSequence, actor.guild_id, items.get(PET_SKILL_BOOK_CODE)!, BigInt(policy.pet_skill_book_reward), "GUILD_LEVEL_REWARD");
        if (BigInt(policy.pet_enhance_stone_reward) > 0n) warehouseSequence = await grantGuildItem(transaction, operation.insertId, warehouseSequence, actor.guild_id, items.get(PET_ENHANCE_STONE_CODE)!, BigInt(policy.pet_enhance_stone_reward), "GUILD_LEVEL_REWARD");
        if (BigInt(policy.all_member_pet_food_reward) > 0n) for (const member of guildMembers) inventorySequence = await grantPlayerItem(transaction, operation.insertId, inventorySequence, member.player_id, items.get(PET_FOOD_CODE)!, BigInt(policy.all_member_pet_food_reward), "GUILD_LEVEL_ALL_MEMBER_REWARD");
        await transaction.execute("INSERT INTO guild_contribution_level_reward_runs(operation_id,target_level,guild_fund_reward,pet_skill_book_reward,pet_enhance_stone_reward,all_member_pet_food_reward) VALUES (?,?,?,?,?,?)", [operation.insertId, policy.target_level, policy.guild_fund_reward, policy.pet_skill_book_reward, policy.pet_enhance_stone_reward, policy.all_member_pet_food_reward]);
      }
      const progressChanged = await transaction.execute("UPDATE guild_progression_states SET level=?,experience=?,max_members=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND version=?", [levelAfter, experienceAfter, maxMembersAfter, actor.guild_id, progress.version]);
      if (progressChanged.affectedRows !== 1n) throw new Error("Guild contribution progression conflict.");
      await transaction.execute("INSERT INTO guild_contribution_ledger(operation_id,guild_id,player_id,contribution_delta,member_contribution_after,guild_experience_after,guild_level_after) VALUES (?,?,?,?,?,?,?)", [operation.insertId, actor.guild_id, actor.player_id, count, contributionAfter, experienceAfter, levelAfter]);
      await transaction.execute("INSERT INTO guild_contribution_runs(operation_id,event_key,guild_id,player_id,medal_item_id,requested_count,medal_before,medal_after,member_contribution_after,guild_experience_after,guild_level_before,guild_level_after,heart_bonus,reached_levels_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, key, actor.guild_id, actor.player_id, medal.id, count, stack.quantity, BigInt(stack.quantity) - count, contributionAfter, experienceAfter, progress.level, levelAfter, heartBonus, JSON.stringify(reachedLevels)]);
      const levelText = reachedLevels.length === 0 ? "" : `\n🎉 길드 레벨: Lv.${progress.level} → Lv.${levelAfter}`;
      const heartText = heartBonus ? "\n💖 길드의 심장 발동: 길드자금 +1,000,000" : "";
      const data = `✅ ${actor.display_name}님의 길드공헌이 완료되었습니다.\n🌟 공헌: ${comma(count)}\n🏰 ${actor.guild_name} 누적 경험치: ${comma(experienceAfter)}\n🎁 펫먹이 +${comma(count * 5n)}, 미니펫뽑기 +${comma(count * 3n)}, 가구뽑기 +${comma(count * 2n)}${levelText}${heartText}`;
      return complete(transaction, operation.insertId, input, actor, { status: "contributed", count, contributionAfter, guildExperienceAfter: experienceAfter, guildLevelAfter: levelAfter, heartBonus, reachedLevels, data });
    }));
  }
}

async function grantPlayerItem(transaction: DatabaseTransaction, operationId: bigint, sequence: number, playerId: bigint, item: ItemRow, amount: bigint, reason: string): Promise<number> {
  await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,1)", [playerId, item.id]);
  const row = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [playerId, item.id]))[0]!;
  const after = addChecked(BigInt(row.quantity), amount, "PLAYER_REWARD_OVERFLOW");
  const changed = await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [after, playerId, item.id, row.version]);
  if (changed.affectedRows !== 1n) throw new Error("Guild contribution reward inventory conflict.");
  await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,?)", [operationId, sequence, playerId, item.id, amount, reason]);
  return sequence + 1;
}

async function grantGuildItem(transaction: DatabaseTransaction, operationId: bigint, sequence: number, guildId: bigint, item: ItemRow, amount: bigint, reason: string): Promise<number> {
  await transaction.execute("INSERT IGNORE INTO guild_warehouse_stacks(guild_id,item_id,quantity,version) VALUES (?,?,0,1)", [guildId, item.id]);
  const row = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity,version FROM guild_warehouse_stacks WHERE guild_id=? AND item_id=? FOR UPDATE", [guildId, item.id]))[0]!;
  const after = addChecked(BigInt(row.quantity), amount, "GUILD_ITEM_REWARD_OVERFLOW");
  const changed = await transaction.execute("UPDATE guild_warehouse_stacks SET quantity=?,version=version+1 WHERE guild_id=? AND item_id=? AND version=?", [after, guildId, item.id, row.version]);
  if (changed.affectedRows !== 1n) throw new Error("Guild contribution warehouse conflict.");
  await transaction.execute("INSERT INTO guild_warehouse_ledger(operation_id,sequence_no,guild_id,item_id,quantity_delta,quantity_after,reason_code) VALUES (?,?,?,?,?,?,?)", [operationId, sequence, guildId, item.id, amount, after, reason]);
  return sequence + 1;
}

async function grantGuildFund(transaction: DatabaseTransaction, operationId: bigint, sequence: number, guildId: bigint, amount: bigint, reason: string): Promise<number> {
  await transaction.execute("INSERT IGNORE INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,'guild_fund',0,1)", [guildId]);
  const row = (await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT balance,version FROM guild_resource_accounts WHERE guild_id=? AND currency_code='guild_fund' FOR UPDATE", [guildId]))[0]!;
  const before = BigInt(row.balance.split(".")[0]!);
  const after = addChecked(before, amount, "GUILD_FUND_REWARD_OVERFLOW");
  const changed = await transaction.execute("UPDATE guild_resource_accounts SET balance=?,version=version+1 WHERE guild_id=? AND currency_code='guild_fund' AND version=?", [after.toString(), guildId, row.version]);
  if (changed.affectedRows !== 1n) throw new Error("Guild contribution fund conflict.");
  await transaction.execute("INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,?,?,'guild_fund',?,?,?)", [operationId, sequence, guildId, amount.toString(), after.toString(), reason]);
  return sequence + 1;
}

async function complete(transaction: DatabaseTransaction, operationId: bigint, input: { eventId: string; channelId: string }, actor: ActorRow, state: { status: GuildContributionApplyResult["status"]; count: bigint; contributionAfter: bigint; guildExperienceAfter: bigint; guildLevelAfter: number; heartBonus: boolean; reachedLevels: number[]; data: string }): Promise<GuildContributionApplyResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.channelId, JSON.stringify({ data: state.data })]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, operationId, state.status]);
  const result: GuildContributionApplyResult = { status: state.status, count: state.count.toString(), contributionAfter: state.contributionAfter.toString(), guildExperienceAfter: state.guildExperienceAfter.toString(), guildLevelAfter: state.guildLevelAfter, heartBonus: state.heartBonus, reachedLevels: state.reachedLevels, data: state.data, outboxId: outbox.insertId.toString() };
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild',?,'guild.contribution.apply',?,'Iris /길드공헌',?,UTC_TIMESTAMP(3))", [operationId, actor.identity_id, actor.guild_id ?? actor.player_id, state.status, JSON.stringify(result)]);
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
  return result;
}

async function withRetry<T>(work: () => Promise<T>): Promise<T> { for (let attempt = 0; attempt < 4; attempt += 1) { try { return await work(); } catch (error) { const value = error as { code?: unknown; errno?: unknown }; const retryable = value.code === "ER_LOCK_DEADLOCK" || value.code === "ER_LOCK_WAIT_TIMEOUT" || value.code === "ER_DUP_ENTRY" || value.errno === 1213 || value.errno === 1205 || value.errno === 1062; if (!retryable || attempt === 3) throw error; } } throw new Error("Guild contribution retry exhausted."); }
