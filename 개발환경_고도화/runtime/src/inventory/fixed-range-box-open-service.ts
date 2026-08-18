import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/application-error.js";
import {
  fixedRangeRandom,
  fixedRangeSeed,
  parseFixedRangeBoxCommand,
  planFixedRangeBoxOpen,
  type FixedRangeRandomSource
} from "./fixed-range-box-open-policy.js";
import type { FixedRangeBoxOpenRepository, FixedRangeBoxStoredResult } from "./fixed-range-box-open-repository.js";

export interface FixedRangeBoxOpenCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export type FixedRangeBoxOpenResult = FixedRangeBoxStoredResult | {
  status: "blocked_by_castle_siege" | "ignored_unregistered" | "box_required";
  data?: string;
};

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export class FixedRangeBoxOpenService {
  constructor(private readonly repository: FixedRangeBoxOpenRepository,
    private readonly randomFactory: (seed: string) => FixedRangeRandomSource = fixedRangeRandom) {}

  async handle(command: FixedRangeBoxOpenCommand): Promise<FixedRangeBoxOpenResult> {
    const parsed = parseFixedRangeBoxCommand(command.message);
    if (parsed === null) throw new ApplicationError("INVALID_FIXED_RANGE_BOX_OPEN_COMMAND", "올바른 상자 오픈 명령을 입력해주세요.", 422);
    return this.repository.withTransaction(async (transaction) => {
      if (await transaction.isCastleSiegeActive()) return { status: "blocked_by_castle_siege" };
      const actor = await transaction.findActor(command.externalUserId);
      if (actor === null) return { status: "ignored_unregistered" };
      const scope = `inventory.fixed-range-box-open:${actor.identityId}:${parsed.definition.commandCode}`;
      const key = eventKey(command.eventId);
      const stored = await transaction.findStoredResult(scope, key);
      if (stored !== null) return { ...stored, duplicate: true };
      const state = await transaction.lockState(actor, parsed.definition);
      if (state.boxQuantity <= 0n) return { status: "box_required", data: `${parsed.definition.boxName}가 필요합니다.` };
      const rngSeed = fixedRangeSeed(command.eventId, parsed.definition.commandCode);
      const plan = planFixedRangeBoxOpen({
        parsed,
        boxQuantity: state.boxQuantity,
        rewardQuantity: state.rewardQuantity,
        rewardStackExists: state.rewardStackExists,
        rankLabel: actor.rankLabel,
        rngSeed,
        random: this.randomFactory(rngSeed)
      });
      return transaction.persist(actor, scope, key, command, parsed.definition, state, plan);
    });
  }
}
