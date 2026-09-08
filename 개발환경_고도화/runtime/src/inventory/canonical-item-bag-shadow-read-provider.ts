import type { PlayerContext, PlayerContextPort } from "../account-platform/player-context-provider.js";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import { BagShadowParityProvider, type BagShadowParityResult } from "./bag-shadow-parity-provider.js";
import type { CanonicalItemBagImportReadinessProvider } from "./canonical-item-bag-import-readiness-provider.js";
import type { LegacyBagOwnerLabelProvider } from "./legacy-bag-owner-label-provider.js";

const INTIMACY_ITEM = /^펫 친밀도🐾\s*\[Lv\.\d+\]\(\d+\/1000\)\+\d+💕$/;
const LEGACY_ACTIVE_FILTER = " AND item.active=TRUE";
const CANONICAL_ACTIVE_FILTER = " AND item.active_flag=TRUE";

function removeExactSourceActiveFilter(sql: string, tableFragment: string, filter: string): string {
  if (!sql.includes(tableFragment)) return sql;
  const occurrences = sql.split(filter).length - 1;
  if (occurrences !== 1) throw new Error("ITEM_BAG_SOURCE_PARITY_QUERY_SHAPE_MISMATCH");
  return sql.replace(filter, "");
}

export type CanonicalItemBagShadowReadResult =
  | { readonly status: "ready"; readonly context: PlayerContext; readonly parity: BagShadowParityResult; readonly ownerLabel: string | null; readonly importReady: boolean; readonly intimacyKeyUnique: boolean }
  | { readonly status: "silent"; readonly reason: "PLAYER_CONTEXT_UNPROVEN" | "CANONICAL_IMPORT_INCOMPLETE" | "ACTIVE_PLAYER_PARITY_UNAVAILABLE" };

// 기존 Wave6 compare source는 보존하면서 WBS776에 필요한 resolved identity와 source-parity 보정을 조립합니다.
export class CanonicalItemBagShadowReadProvider {
  constructor(
    private readonly playerContext: PlayerContextPort,
    private readonly bagParity: Pick<BagShadowParityProvider, "compare">,
    private readonly ownerLabel: Pick<LegacyBagOwnerLabelProvider, "resolve">,
    private readonly importReadiness: Pick<CanonicalItemBagImportReadinessProvider, "inspect">,
  ) {}

  async read(database: AppWiringReadParticipant, input: { providerCode: string; externalUserId: string; externalContextId: string }): Promise<CanonicalItemBagShadowReadResult> {
    let context: PlayerContext;
    try {
      context = await this.playerContext.resolveSelf(database, { identityProviderCode: input.providerCode, externalUserId: input.externalUserId, externalContextId: input.externalContextId });
    } catch {
      return { status: "silent", reason: "PLAYER_CONTEXT_UNPROVEN" };
    }
    const resolvedDatabase: AppWiringReadParticipant = {
      query: async <T>(sql: string, values?: readonly unknown[]): Promise<T> => {
        if (sql.includes("FROM external_identities identity") && sql.includes("canonical_player_identity_crosswalks")) {
          return [{ legacy_player_id: context.legacyPlayerId, display_name: context.displayName, legacy_identity_status: "LINKED", canonical_player_id: context.canonicalPlayerId, crosswalk_status: "LINKED" }] as T;
        }
        const legacyParitySql = removeExactSourceActiveFilter(sql, "FROM inventory_stacks stack", LEGACY_ACTIVE_FILTER);
        const sourceParitySql = removeExactSourceActiveFilter(legacyParitySql, "FROM canonical_owned_item_stacks stack", CANONICAL_ACTIVE_FILTER);
        return database.query<T>(sourceParitySql, values);
      },
    };
    let parity: BagShadowParityResult;
    try { parity = await this.bagParity.compare(resolvedDatabase, input.providerCode, input.externalUserId); }
    catch { return { status: "silent", reason: "ACTIVE_PLAYER_PARITY_UNAVAILABLE" }; }
    if (parity.legacyPlayerId !== context.legacyPlayerId || parity.canonicalPlayerId !== context.canonicalPlayerId) return { status: "silent", reason: "ACTIVE_PLAYER_PARITY_UNAVAILABLE" };
    let ownerLabel: string | null = null;
    try { ownerLabel = await this.ownerLabel.resolve(database, context); } catch { ownerLabel = null; }
    let importReady = false;
    try { importReady = await this.importReadiness.inspect(database, context); } catch { importReady = false; }
    const intimacyKeyUnique = parity.legacyBag.items.filter((item) => INTIMACY_ITEM.test(item.displayName)).length <= 1
      && parity.canonicalBag.items.filter((item) => INTIMACY_ITEM.test(item.displayName)).length <= 1;
    return { status: "ready", context, parity, ownerLabel, importReady, intimacyKeyUnique };
  }
}
