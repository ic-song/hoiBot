import { createHash } from "node:crypto";
import {
  CASTLE_CARD_COMMAND_CODE,
  CASTLE_CARD_CONSUMER,
  castleCardRandom,
  castleCardSeed,
  parseCastleCardOpenCommand,
  planCastleCardOpen,
  type CastleCardRandomSource
} from "./castle-card-open-policy.js";
import type { CastleCardOpenRepository, CastleCardStoredResult } from "./castle-card-open-repository.js";

export interface CastleCardOpenCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export type CastleCardOpenResult = CastleCardStoredResult | {
  status: "blocked_by_castle_siege" | "ignored_unregistered" | "consumer_required";
  data?: string;
};

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export class CastleCardOpenService {
  constructor(private readonly repository: CastleCardOpenRepository,
    private readonly randomFactory: (seed: string) => CastleCardRandomSource = castleCardRandom) {}

  async handle(command: CastleCardOpenCommand): Promise<CastleCardOpenResult> {
    const parsed = parseCastleCardOpenCommand(command.message);
    return this.repository.withTransaction(async (transaction) => {
      const actor = await transaction.findActor(command.externalUserId);
      if (actor === null) return { status: "ignored_unregistered" };
      const scope = `inventory.castle-card-open:${actor.identityId}:${CASTLE_CARD_COMMAND_CODE}`;
      const key = eventKey(command.eventId);
      const stored = await transaction.findStoredResult(scope, key);
      if (stored !== null) return { ...stored, duplicate: true };
      const state = await transaction.lockState(actor);
      if (await transaction.isCastleSiegeActive()) return { status: "blocked_by_castle_siege" };
      const consumer = state.items.get(CASTLE_CARD_CONSUMER.code)!;
      if (consumer.quantity < BigInt(parsed.openCount)) {
        return {
          status: "consumer_required",
          data: `[${actor.rankLabel}] ${actor.senderName} 님\n${CASTLE_CARD_CONSUMER.shortageName}이 부족합니다. (보유: ${consumer.quantity}개)`
        };
      }
      const rngSeed = castleCardSeed(command.eventId);
      const plan = planCastleCardOpen({ parsed, rankLabel: actor.rankLabel, rngSeed, random: this.randomFactory(rngSeed) });
      return transaction.persist(actor, scope, key, command, state, plan);
    });
  }
}
