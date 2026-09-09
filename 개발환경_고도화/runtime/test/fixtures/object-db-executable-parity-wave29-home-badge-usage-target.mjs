import { randomUUID } from "node:crypto";
import { isHomeBadgeGachaCommandCandidate, parseHomeBadgeGachaCommand } from "../../src/home/home-badge-gacha-command.js";
import { formatHomeBadgeGachaUsage } from "../../src/home/home-badge-gacha-service.js";

const MODULE_EXECUTION_ID = randomUUID();
const assert = (value, message) => { if (!value) throw new Error(message); };

export async function executeWave29HomeBadgeUsage({ binding }) {
  const message = binding.scenarioKind === "NEGATIVE_GUARD" ? binding.negativeInput : binding.input;
  const candidate = isHomeBadgeGachaCommandCandidate(message);
  const parsed = parseHomeBadgeGachaCommand(message);
  const reply = candidate && parsed !== null && !parsed.valid
    ? formatHomeBadgeGachaUsage("🏆테스터", parsed.variant)
    : "NO_REPLY";
  assert(reply === binding.expectedReply, `Wave29 exact reply drift: ${binding.scenarioId}`);
  if (binding.scenarioKind === "NEGATIVE_GUARD") assert(candidate === false && parsed === null, "Wave29 negative guard executed");
  else assert(candidate === true && parsed?.variant === binding.variant && parsed.valid === false, "Wave29 usage path drift");
  return {
    executedConsumerId: binding.consumerId,
    executedCaseId: `case:wave29:${binding.consumerId}`,
    moduleExecutionId: MODULE_EXECUTION_ID,
    assertionCount: 3,
    reply,
    result: JSON.stringify({ candidate, parsed, reply, sourceDomainDmlCount: 0 }),
    databaseEvidence: { calls: [], sourceDomainDmlCount: 0 }
  };
}
