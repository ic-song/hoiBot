import { createHash } from "node:crypto";
import { isOpenAllCommand, planOpenAll, type RandomSource } from "./open-all-policy.js";
import type { OpenAllRepository, OpenAllStoredResult } from "./open-all-repository.js";
import { ApplicationError } from "../shared/application-error.js";

export interface OpenAllCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export type OpenAllResult = OpenAllStoredResult | { status: "blocked_by_castle_siege" | "ignored_unregistered" };

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }

export class OpenAllService {
  constructor(private readonly repository: OpenAllRepository, private readonly random: RandomSource = { next: Math.random }) {}

  async handle(command: OpenAllCommand): Promise<OpenAllResult> {
    if (!isOpenAllCommand(command.message)) throw new ApplicationError("INVALID_OPEN_ALL_COMMAND", "정확한 /전체오픈을 입력해주세요.", 422);
    return this.repository.withTransaction(async (transaction) => {
      if (await transaction.isCastleSiegeActive()) return { status: "blocked_by_castle_siege" };
      const actor = await transaction.findActor(command.externalUserId);
      if (actor === null) return { status: "ignored_unregistered" };
      const scope = `inventory.open-all:${actor.identityId}`;
      const key = eventKey(command.eventId);
      const stored = await transaction.findStoredResult(scope, key);
      if (stored !== null) return { ...stored, duplicate: true };
      const state = await transaction.lockState(actor);
      const plan = planOpenAll(state, this.random);
      return transaction.persist(actor, scope, key, command, plan);
    });
  }
}
