import { createHash } from "node:crypto";
import {
  MINIPET_PACKAGE_TARGET_REQUIRED,
  isMinipetPackageGrantCandidate,
  parseMinipetPackageGrant
} from "./minipet-package-grant-policy.js";
import type {
  MinipetPackageGrantCommand,
  MinipetPackageGrantRepository,
  MinipetPackageGrantStoredResult
} from "./minipet-package-grant-repository.js";

export type MinipetPackageGrantResult = MinipetPackageGrantStoredResult
  | { status: "ignored_forbidden" | "ignored_outside_room" | "ignored_not_candidate" }
  | { status: "invalid_format" | "invalid_amount" | "target_not_found"; data: string };

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export class MinipetPackageGrantService {
  constructor(private readonly repository: MinipetPackageGrantRepository) {}

  async handle(command: MinipetPackageGrantCommand & { roomAllowed: boolean }): Promise<MinipetPackageGrantResult> {
    if (!isMinipetPackageGrantCandidate(command.message)) return { status: "ignored_not_candidate" };
    return this.repository.withTransaction(async (transaction) => {
      const operatorId = await transaction.findAuthorizedOperator(command.externalUserId);
      if (operatorId === null) return { status: "ignored_forbidden" };
      if (!command.roomAllowed) return { status: "ignored_outside_room" };
      const parsed = parseMinipetPackageGrant(command.message);
      if (parsed.status !== "parsed") return parsed;
      const scope = `admin.minipet-package-grant:${operatorId}:${parsed.value.definition.commandCode}`;
      const key = eventKey(command.eventId);
      const stored = await transaction.findStoredResult(scope, key);
      if (stored !== null) return { ...stored, duplicate: true };
      const result = await transaction.grant(operatorId, scope, key, command, parsed.value);
      return result ?? { status: "target_not_found", data: MINIPET_PACKAGE_TARGET_REQUIRED };
    });
  }
}
