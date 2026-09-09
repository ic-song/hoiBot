export async function executeQueryDelete({ consumerId, harnessCaseId, database }) {
  await database.query("DELETE FROM canonical_owned_member_title_instances WHERE player_id=?", ["player01"]);
  return { executedConsumerId: consumerId, executedCaseId: harnessCaseId, moduleExecutionId: "delete-target", assertionCount: 1, reply: "deleted", result: "deleted" };
}
