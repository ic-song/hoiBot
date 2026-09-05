const ZERO_DML_MUTATION_SCENARIOS = new Set([
  "AUTH_DENIED",
  "WRONG_ROOM_REJECTED",
  "PAYLOAD_DRIFT_FAIL_CLOSED",
  "DUPLICATE_REPLAY_DML_ZERO",
  "RESTART_REPLAY",
]);

export function executeSyntheticConsumer({ consumerId, harnessCaseId, scenarioKind, fixturePayload }) {
  const read = fixturePayload.accessClass === "READ";
  const dmlZero = read || ZERO_DML_MUTATION_SCENARIOS.has(scenarioKind);
  const rollback = scenarioKind === "DOMAIN_FAILURE_ROLLBACK" || scenarioKind === "PAYLOAD_DRIFT_FAIL_CLOSED";
  const transaction = read ? "READ_ONLY" : rollback ? "ROLLBACK" : "COMMIT";
  return {
    executedConsumerId: consumerId,
    executedCaseId: harnessCaseId,
    reply: `reply:${scenarioKind}`,
    result: `result:${scenarioKind}`,
    trace: {
      normalizedStatements: dmlZero ? [] : ["UPDATE canonical_owned_item_stacks SET quantity = ? WHERE owned_item_stack_id = ?"],
      rowCount: dmlZero ? 0 : 1,
      lockOrder: read ? [] : ["canonical_players", "canonical_owned_item_stacks"],
      transaction,
      timeline: transaction === "READ_ONLY" ? ["READ"] : transaction === "ROLLBACK" ? ["BEGIN", "ROLLBACK"] : ["BEGIN", "COMMIT"],
    },
  };
}
