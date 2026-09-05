import type { DatabaseClient } from "../database.js";
import { createObjectAuditValues, createObjectIdentityCandidate } from "../identity/object-identity-audit-provider.js";
import { CanonicalItemInventoryRepository } from "../inventory/canonical-item-inventory-repository.js";
import { insertWithCuid8CollisionRetry, withMariaTransactionRetry } from "../shared/maria-database-error-policy.js";

export const GUILD_TERRITORY_RUNTIME4_POLICY = Object.freeze([
  { role: "DEFENSE" as const, priority: 1, sourceIdentifier: "ITEM-TERRITORY-DEFENSE-50", itemName: "영지절대방어권🛡(50%)", successBps: 5000, sourceLocator: "main.js:31496-31516" },
  { role: "DEFENSE" as const, priority: 2, sourceIdentifier: "ITEM-TERRITORY-DEFENSE-20", itemName: "영지절대방어권🛡(20%)", successBps: 2000, sourceLocator: "main.js:31496-31516" },
  { role: "ATTACK" as const, priority: 1, sourceIdentifier: "ITEM-TERRITORY-AMBUSH-40", itemName: "영지기습공격권🔥(40%)", successBps: 4000, sourceLocator: "main.js:31502-31540" },
  { role: "ATTACK" as const, priority: 2, sourceIdentifier: "ITEM-TERRITORY-AMBUSH-10", itemName: "영지기습공격권🔥(10%)", successBps: 1000, sourceLocator: "main.js:31502-31540" },
]);

type ExistingCandidate = { item_id: string; success_bps: number; source_locator: string; active_flag: number };
type CanonicalDefinition = { item_name: string; item_kind: string; stackable_flag: number; active_flag: number; definition_options: string | Record<string, unknown> | null };
type LegacyDefinition = { display_name: string; active: number };

// 공용 canonical item/import 및 CUID8/audit provider로 runtime4 정책을 멱등 구성합니다.
export class GuildTerritoryAttackRuntime4PolicyProvider {
  constructor(private readonly database: DatabaseClient) {}

  async apply(actor = "guild-territory-runtime4-policy"): Promise<{ inserted: number; replayed: number }> {
    const itemRepository = new CanonicalItemInventoryRepository(this.database);
    return withMariaTransactionRetry(this.database, {
      maxAttempts: 3,
      allowRetry: () => true,
      exhaustedErrorCode: "GUILD_TERRITORY_RUNTIME4_POLICY_TRANSACTION_RETRY_EXHAUSTED",
    }, async (transaction) => {
      const policy = (await transaction.query<Array<{ policy_version: bigint }>>(
        "SELECT policy_version FROM guild_territory_attack_policy_versions WHERE policy_scope_code='world-attack' AND policy_version=1 FOR UPDATE"
      ))[0];
      if (policy === undefined) throw new Error("GUILD_TERRITORY_RUNTIME4_BASE_POLICY_MISSING");
      const itemIdBySource = new Map<string, string>();
      for (const entry of GUILD_TERRITORY_RUNTIME4_POLICY) {
        const definition = await itemRepository.registerDefinition({
          actor,
          sourceSystem: "RUNTIME_DB",
          sourceNamespace: "item_definitions",
          sourceIdentifier: entry.sourceIdentifier,
          itemName: entry.itemName,
          itemKind: "STACK",
          stackable: true,
          active: true,
          definitionOptions: { domain: "guild_territory_attack" },
        });
        const canonical = (await transaction.query<CanonicalDefinition[]>(
          "SELECT item_name,item_kind,stackable_flag,active_flag,definition_options FROM canonical_item_definitions WHERE item_id=? FOR UPDATE",
          [definition.itemId],
        ))[0];
        const expectedOptions = { domain: "guild_territory_attack" };
        const actualOptions = typeof canonical?.definition_options === "string" ? JSON.parse(canonical.definition_options) as Record<string, unknown> : canonical?.definition_options;
        if (canonical === undefined || canonical.item_name !== entry.itemName || canonical.item_kind !== "STACK" || canonical.stackable_flag !== 1 || canonical.active_flag !== 1 || JSON.stringify(actualOptions) !== JSON.stringify(expectedOptions)) {
          throw new Error("GUILD_TERRITORY_RUNTIME4_DEFINITION_DRIFT");
        }
        const legacy = (await transaction.query<LegacyDefinition[]>(
          "SELECT display_name,active FROM item_definitions WHERE code=? FOR UPDATE",
          [entry.sourceIdentifier],
        ))[0];
        if (legacy === undefined || legacy.display_name !== entry.itemName || legacy.active !== 1) {
          throw new Error("GUILD_TERRITORY_RUNTIME4_LEGACY_CROSSWALK_DRIFT");
        }
        itemIdBySource.set(entry.sourceIdentifier, definition.itemId);
      }
      const audit = createObjectAuditValues(actor);
      let inserted = 0;
      let replayed = 0;
      for (const entry of GUILD_TERRITORY_RUNTIME4_POLICY) {
        const itemId = itemIdBySource.get(entry.sourceIdentifier)!;
        const existing = (await transaction.query<ExistingCandidate[]>(
          "SELECT item_id,success_bps,source_locator,active_flag FROM guild_territory_attack_item_candidates WHERE policy_scope_code='world-attack' AND policy_version=1 AND candidate_role=? AND priority_order=? FOR UPDATE",
          [entry.role, entry.priority],
        ))[0];
        if (existing !== undefined) {
          if (existing.item_id !== itemId || existing.success_bps !== entry.successBps || existing.source_locator !== entry.sourceLocator || existing.active_flag !== 1) {
            throw new Error("GUILD_TERRITORY_RUNTIME4_POLICY_DRIFT");
          }
          replayed++;
          continue;
        }
        await insertWithCuid8CollisionRetry(async (candidateId) => {
          await transaction.execute(
            `INSERT INTO guild_territory_attack_item_candidates(
               guild_territory_attack_item_candidate_id,policy_scope_code,policy_version,candidate_role,priority_order,item_id,success_bps,
               active_flag,source_locator,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME
             ) VALUES (?,'world-attack',1,?,?,?,?,TRUE,?,?,?,?,?)`,
            [candidateId, entry.role, entry.priority, itemId, entry.successBps, entry.sourceLocator, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
          );
        }, { generate: createObjectIdentityCandidate, maxAttempts: 8, exhaustedErrorCode: "GUILD_TERRITORY_RUNTIME4_POLICY_CUID_COLLISION_RETRY_EXHAUSTED" });
        inserted++;
      }
      return { inserted, replayed };
    });
  }
}
