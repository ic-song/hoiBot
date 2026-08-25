import type { MiniPetReadResult } from "./catalog-projection-repository.js";

// 인자 없는 미니펫 컬렉션 명령만 실행 대상으로 인정합니다.
export function isMiniPetCollectionReadCommand(message: string | undefined): boolean {
  return message === "/미니펫컬렉션";
}

// stage reward와 고정 8등급 등록 현황을 legacy 순서로 출력합니다.
export function formatMiniPetCollection(result: MiniPetReadResult): string {
  const stage = Math.max(1, ...result.collection.map((item) => item.stage));
  const completedStage = Math.max(0, ...result.collection.map((item) => item.completedStage));
  const reward = result.stageRewards[String(stage)] ?? result.stageRewards[`stage_${stage}`] ?? "등록된 보상 없음";
  const rewardText = typeof reward === "string" ? reward : JSON.stringify(reward);
  const lines = [
    "🐹 미니펫 컬렉션",
    `현재 단계: ${stage}`,
    `완료 단계: ${completedStage}`,
    `단계 보상: ${rewardText}`,
    "",
    ...result.collectionGrades.map((row) => `${row.registered ? "✅" : "⬜"} ${row.grade}`)
  ];
  if (result.collectionRepairRequired) lines.push("", "⚠️ 컬렉션 데이터 점검이 필요합니다.");
  return lines.join("\n");
}
