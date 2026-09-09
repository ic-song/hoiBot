// 번호별 source-derived projection과 대표 실DB 관측을 영수증 결과로 결합합니다.
export function executeWave27SlotNewbieProjection({variant,scenarioKind,trace}){
  return {scenarioKind,consumerId:variant.consumerId,trigger:variant.trigger,variantNo:variant.variantNo,itemName:variant.itemName,reply:variant.reply,payload:variant.payload,representativeTransaction:{outcome:trace.attempts.at(-1).outcome,committedRowCount:trace.committedRowCount,rolledBackAffectedRowCount:trace.rolledBackAffectedRowCount,replayed:trace.replayed,errorCode:trace.errorCode}};
}
