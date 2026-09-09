export async function executeFakeRestart({ consumerId, harnessCaseId }) {
  return { executedConsumerId: consumerId, executedCaseId: harnessCaseId, moduleExecutionId: "constant-module-execution", assertionCount: 1, reply: "same", result: "{}" };
}
