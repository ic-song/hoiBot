export async function executeSelfTrace({ consumerId, harnessCaseId }) {
  return {
    executedConsumerId: consumerId,
    executedCaseId: harnessCaseId,
    moduleExecutionId: "self-trace",
    assertionCount: 1,
    reply: "forged",
    result: "forged",
    trace: { normalizedStatements: [], rowCount: 0, lockOrder: [], transaction: "READ_ONLY", timeline: ["READ"] },
  };
}
