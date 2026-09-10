// WBS801 실제 실행으로 고정한 소비자별 타이틀 선택 mutation 결과를 재생합니다.
export function executeWave34MemberTitleSelect(payload, binding) {
  const observation = payload.observations.find(candidate => candidate.scenarioKind === binding.scenarioKind);
  if (!observation) throw new Error("Wave34 observation missing");
  return { reply: observation.reply, result: { consumerId: binding.consumerId, ...observation.result }, trace: observation.trace };
}
