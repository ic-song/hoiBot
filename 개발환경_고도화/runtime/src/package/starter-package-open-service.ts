import { createHash } from "node:crypto";
import { buildStarterPackageOpenReply, buildStarterPackageRequiredReply, parseStarterPackageOpenCommand } from "./starter-package-open-policy.js";
import type { StarterPackageOpenRepository, StarterPackageStoredResult } from "./starter-package-open-repository.js";

export interface StarterPackageOpenCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export type StarterPackageOpenResult = StarterPackageStoredResult | { status: "blocked_by_castle_siege" | "ignored_unregistered" };

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export class StarterPackageOpenService {
  constructor(private readonly repository: StarterPackageOpenRepository) {}

  async handle(command: StarterPackageOpenCommand): Promise<StarterPackageOpenResult> {
    const definition = parseStarterPackageOpenCommand(command.message);
    return this.repository.withTransaction(async (transaction) => {
      const actor = await transaction.findActor(command.externalUserId);
      if (actor === null) return { status: "ignored_unregistered" };
      const scope = `package.starter-open:${actor.identityId}:${definition.commandCode}`;
      const key = eventKey(command.eventId);
      const stored = await transaction.findStoredResult(scope, key);
      if (stored !== null) return { ...stored, duplicate: true };
      if (await transaction.isCastleSiegeActive()) return { status: "blocked_by_castle_siege" };
      const catalog = await transaction.lockCatalog(definition);
      const state = await transaction.lockState(actor, catalog);
      const consumer = state.items.get(definition.consumerCode)!;
      if (consumer.quantity === 0n) {
        return transaction.persistRequired(actor, scope, key, command, catalog, state,
          buildStarterPackageRequiredReply(actor.rankLabel));
      }
      return transaction.persistOpened(actor, scope, key, command, catalog, state,
        buildStarterPackageOpenReply(definition, actor.rankLabel));
    });
  }
}
