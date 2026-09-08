import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import type { BagView } from "./bag.js";
import type { CanonicalItemBagShadowReadProvider } from "./canonical-item-bag-shadow-read-provider.js";
import { formatLegacyBag } from "./legacy-bag-formatter.js";
import { resolveGuildTerritoryWarAuthority } from "../guild/guild-territory-war-authority.js";

export const ITEM_BAG_CANONICAL_CONSUMER_ID = "legacy-94904fa11988ff04";

export type CanonicalItemBagFallbackReason =
  | "CASTLE_SIEGE_ACTIVE"
  | "CASTLE_AUTHORITY_UNPROVEN"
  | "PLAYER_CONTEXT_UNPROVEN"
  | "ACTIVE_PLAYER_PARITY_UNAVAILABLE"
  | "PRESENTATION_PARITY_UNPROVEN"
  | "CANONICAL_IMPORT_INCOMPLETE";

export type CanonicalItemBagDirectReadResult =
  | {
    readonly status: "direct_reply";
    readonly consumerId: typeof ITEM_BAG_CANONICAL_CONSUMER_ID;
    readonly playerId: string;
    readonly parityFingerprint: string;
    readonly data: string;
  }
  | {
    readonly status: "legacy_reply";
    readonly consumerId: typeof ITEM_BAG_CANONICAL_CONSUMER_ID;
    readonly reason: CanonicalItemBagFallbackReason;
    readonly playerId: string;
    readonly parityFingerprint: string;
    readonly data: string;
  }
  | {
    readonly status: "silent";
    readonly consumerId: typeof ITEM_BAG_CANONICAL_CONSUMER_ID;
    readonly reason: CanonicalItemBagFallbackReason;
  };

export function isCanonicalItemBagCommand(message: string | undefined): boolean {
  return message === "/가방" || message === "ㄴㄴㄴ";
}

interface AdvertisementRow { version: bigint | number | string; string_value: string | null; }
interface TerritoryAuthorityRow { active: boolean | number; lifecycle_state: string; }

// 동일 read-only snapshot 안에서 active player, import parity, 공성전 억제를 모두 증명한 경우에만 답합니다.
export class CanonicalItemBagDirectReadService {
  constructor(
    private readonly shadowRead: Pick<CanonicalItemBagShadowReadProvider, "read">,
  ) {}

  async execute(database: AppWiringReadParticipant, input: {
    providerCode: string;
    externalUserId: string;
    externalContextId: string;
  }): Promise<CanonicalItemBagDirectReadResult> {
    const shadow = await this.shadowRead.read(database, input);
    if (shadow.status === "silent") return { status: "silent", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: shadow.reason };
    const { context, parity, ownerLabel, importReady, intimacyKeyUnique } = shadow;

    let wars: TerritoryAuthorityRow[];
    try {
      wars = await database.query<TerritoryAuthorityRow[]>(
        `SELECT war.active,war.lifecycle_state FROM guild_territory_start_scopes scope_row
           JOIN guild_territory_wars war ON war.id=scope_row.war_id WHERE scope_row.scope_code='world'`,
      );
    } catch {
      return { status: "silent", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: "CASTLE_AUTHORITY_UNPROVEN" };
    }
    if (wars.length !== 1) {
      return { status: "silent", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: "CASTLE_AUTHORITY_UNPROVEN" };
    }
    let castleActive: boolean;
    try { castleActive = resolveGuildTerritoryWarAuthority(wars[0]!.active, wars[0]!.lifecycle_state); }
    catch { return { status: "silent", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: "CASTLE_AUTHORITY_UNPROVEN" }; }
    if (castleActive) {
      return { status: "silent", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: "CASTLE_SIEGE_ACTIVE" };
    }

    if (ownerLabel === null) {
      return { status: "silent", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: "PRESENTATION_PARITY_UNPROVEN" };
    }

    let advertisements: AdvertisementRow[];
    try {
      advertisements = await database.query<AdvertisementRow[]>(
        `SELECT head.version,value.string_value FROM operation_notice_heads head
           JOIN configuration_values value ON value.configuration_set_id=head.active_configuration_set_id
          WHERE head.set_code='operation_notices' AND value.config_key='notice.advertisement'`,
      );
    } catch {
      return { status: "silent", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: "PRESENTATION_PARITY_UNPROVEN" };
    }
    let advertisementVersionValid = false;
    try { advertisementVersionValid = advertisements.length === 1 && BigInt(advertisements[0]!.version) >= 1n; }
    catch { advertisementVersionValid = false; }
    if (!advertisementVersionValid || advertisements[0]!.string_value === null) {
      return { status: "silent", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: "PRESENTATION_PARITY_UNPROVEN" };
    }
    const presentation = { ownerLabel, advertisement: advertisements[0]!.string_value };
    if (!parity.cutoverReady || !importReady || !intimacyKeyUnique) {
      const legacyBag: BagView = { ...parity.legacyBag, ...presentation };
      return { status: "legacy_reply", consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID, reason: "CANONICAL_IMPORT_INCOMPLETE", playerId: context.legacyPlayerId, parityFingerprint: parity.resultFingerprint, data: formatLegacyBag(legacyBag) };
    }
    const bag: BagView = {
      ...parity.canonicalBag,
      ownerLabel,
      advertisement: advertisements[0]!.string_value,
    };
    return {
      status: "direct_reply",
      consumerId: ITEM_BAG_CANONICAL_CONSUMER_ID,
      playerId: context.canonicalPlayerId,
      parityFingerprint: parity.resultFingerprint,
      data: formatLegacyBag(bag),
    };
  }
}
