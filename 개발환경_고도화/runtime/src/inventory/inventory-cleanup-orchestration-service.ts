import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { OperationNoticeReader } from "../admin/operation-notice-service.js";
import { CombineAllService, type CombineAllResult } from "../crafting/combine-all-service.js";
import { GuildMedalAutoPurchaseService, type GuildMedalAutoPurchaseResult } from "../guild/guild-medal-auto-purchase-service.js";
import { GuildTerritoryBoosterContributeService, type GuildTerritoryBoosterContributeResult } from "../guild/guild-territory-booster-contribute-service.js";
import { QuestRewardClaimService, type QuestRewardClaimResult } from "../quest/quest-reward-claim-service.js";
import { ApplicationError } from "../shared/application-error.js";
import { InventoryBulkSellService, type InventoryBulkSellResult } from "./bulk-sell-service.js";
import { MariaOpenAllRepository } from "./maria-open-all-repository.js";
import { OpenAllService, type OpenAllResult } from "./open-all-service.js";

const ALIASES = new Set(["/정리", "ㅇㅇㅇ"]);
const BOOSTER_CODE = "ITEM-GUILD-TERRITORY-BOOSTER";
export interface InventoryCleanupResult { status: "completed" | "blocked_by_castle_siege" | "ignored_unregistered"; playerId?: string; data?: string; outboxId?: string; childResults?: Record<string, unknown>; replayed?: boolean; }

export function isInventoryCleanupCommand(message: string | undefined): boolean { return message !== undefined && ALIASES.has(message); }
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | InventoryCleanupResult): InventoryCleanupResult { return typeof value === "string" ? JSON.parse(value) as InventoryCleanupResult : value; }
function deterministic(seed: string): () => number { let index = 0; return () => createHash("sha256").update(`${seed}:${index++}`).digest().readUInt32BE(0) / 0x100000000; }

export function formatInventoryCleanupReply(input: { displayName: string; notice: string; open: OpenAllResult; combine: CombineAllResult | { status: "nothing_to_combine"; data: string }; sell: InventoryBulkSellResult; booster: GuildTerritoryBoosterContributeResult | null; medal: GuildMedalAutoPurchaseResult | null; quest: QuestRewardClaimResult | null }): string {
  const lines = [`[${input.displayName}]님 가방정리 완료🧳`, "💡TIP : ㅇㅇㅇ 로도 명령어가 작동됩니다."];
  if (input.notice) lines.push("━━━━━━━━━━━━", `(알림) ${input.notice}`);
  lines.push("━━━━━━━━━━━━━━━", "🎁 [전체 오픈 결과]", "data" in input.open && input.open.data ? input.open.data : "오픈할 수 있는 상자가 없습니다.");
  lines.push("", "━━━━━━━━━━━━━━━", "🛠️ [전체 조합 결과]", "data" in input.combine && input.combine.data ? input.combine.data : "❌ 조합 가능한 재료가 없습니다.");
  lines.push("", "━━━━━━━━━━━━━━━", "💰 [전체 판매 결과]", input.sell.data ?? "판매할 수 있는 아이템이 없습니다.");
  if (input.booster?.status === "contributed") lines.push("━━━━━━━━━━━━━━━", input.booster.data);
  if (input.medal?.status === "purchased") lines.push("━━━━━━━━━━━━━━━", input.medal.data);
  if (input.quest?.data) lines.push("━━━━━━━━━━━━━━━", input.quest.data);
  return lines.join("\n").trim();
}

// 검증된 child provider를 savepoint로 호출해 /정리 전체를 한 상위 transaction으로 묶습니다.
export class InventoryCleanupOrchestrationService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<InventoryCleanupResult> {
    if (!isInventoryCleanupCommand(input.message)) throw new ApplicationError("INVENTORY_CLEANUP_COMMAND_INVALID", "정확한 /정리 또는 ㅇㅇㅇ를 입력해주세요.", 422);
    return this.database.withTransaction(async transaction => {
      const siege = await transaction.query<Array<{ active_count: bigint }>>("SELECT COUNT(*) active_count FROM castle_battle_seasons WHERE status='active' AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))");
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };
      const actor = (await transaction.query<Array<{ identity_id: bigint; player_id: bigint; display_name: string }>>("SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE", [input.externalUserId]))[0];
      if (actor === undefined) return { status: "ignored_unregistered" };
      const key = eventKey(input.eventId), scope = `inventory.cleanup:${actor.identity_id}`;
      const prior = (await transaction.query<Array<{ result_json: string | InventoryCleanupResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actor.identity_id]);
      const scoped = createScopedDatabaseClient(transaction), child = (name: string) => `${key}:cleanup:${name}`;
      const open = await new OpenAllService(new MariaOpenAllRepository(scoped), { next: deterministic(child("open")) }).handle({ ...input, message: "/전체오픈", eventId: child("open"), suppressOutbox: true });
      let combine: CombineAllResult | { status: "nothing_to_combine"; data: string };
      try { combine = await new CombineAllService(scoped).handle({ ...input, message: "/전체조합", eventId: child("combine"), suppressOutbox: true }); }
      catch (error) { if (error instanceof ApplicationError && error.code === "NO_COMBINABLE_SPIRIT_FRAGMENTS") combine = { status: "nothing_to_combine", data: error.message }; else throw error; }
      const sell = await new InventoryBulkSellService(scoped).handle({ ...input, message: "/전체판매", eventId: child("sell"), suppressOutbox: true });
      const boosterState = (await transaction.query<Array<{ quantity: bigint; guild_id: bigint | null }>>("SELECT COALESCE(stack.quantity,0) quantity,membership.guild_id FROM external_identities identity LEFT JOIN guild_members membership ON membership.player_id=identity.player_id LEFT JOIN item_definitions item ON item.code=? AND item.active=TRUE LEFT JOIN inventory_stacks stack ON stack.player_id=identity.player_id AND stack.item_id=item.id WHERE identity.id=? FOR UPDATE", [BOOSTER_CODE, actor.identity_id]))[0];
      const booster = boosterState !== undefined && boosterState.guild_id !== null && boosterState.quantity > 0n ? await new GuildTerritoryBoosterContributeService(scoped).contribute({ externalUserId: input.externalUserId, channelId: input.channelId, eventId: child("booster"), command: { requestedCount: boosterState.quantity }, suppressOutbox: true }) : null;
      const medal = await new GuildMedalAutoPurchaseService(scoped).handle({ externalUserId: input.externalUserId, channelId: input.channelId, eventId: child("medal"), suppressOutbox: true });
      const quest = await new QuestRewardClaimService(scoped).handle({ externalUserId: input.externalUserId, channelId: input.channelId, message: "/퀘스트완료", eventId: child("quest"), suppressOutbox: true });
      let notice = "";
      try { notice = (await new OperationNoticeReader(scoped).readActiveSnapshot()).cleanup; } catch (error) { if (!(error instanceof ApplicationError && error.code === "OPERATION_NOTICE_CONFIG_MISSING")) throw error; }
      const data = formatInventoryCleanupReply({ displayName: actor.display_name, notice, open, combine, sell, booster, medal, quest });
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.channelId, JSON.stringify({ data })]);
      const childResults = { open, combine, sell, booster, medal, quest };
      const result: InventoryCleanupResult = { status: "completed", playerId: actor.player_id.toString(), data, outboxId: outbox.insertId.toString(), childResults, replayed: false };
      await transaction.execute("INSERT INTO inventory_cleanup_orchestration_runs(operation_id,player_id,source_contract,child_result_json) VALUES (?,?,'v2.400',?)", [operation.insertId, actor.player_id, JSON.stringify(childResults)]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'INVENTORY_CLEANUP_ORCHESTRATION',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'inventory.cleanup.orchestration','success','Iris /정리 v2.400',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.identity_id, actor.player_id, JSON.stringify({ childStatuses: { open: open.status, combine: combine.status, sell: sell.status, booster: booster?.status ?? "skipped", medal: medal?.status ?? "skipped", quest: quest?.status ?? "skipped" } })]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
