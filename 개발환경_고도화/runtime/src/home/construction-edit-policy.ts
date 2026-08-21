const COMMAND = "/건설수정";

const HOME_NAMES_BY_GROUP = [
  "서울역 4번출구🚉", "쓰레기더미 움막⛺", "풍경만 있는 시골방🏞️", "산이 보이는 텐트집🏕️", "꽃이피는 천막집🌷",
  "귀신 나오는 단칸방👻", "창문 있는 옥탑방🪟", "조용한 판잣집🪵", "거품 기와집🫧", "벽돌 깨진 단층주택🧱",
  "햇빛드는 일층집🌞", "마당 있는 이층집🏠", "따끈따끈 보일러 집🌡️", "빨간 벽돌집🧱", "장미가 핀 단독 주택🥀",
  "감나무 있는 마당집🌳", "배나무 있는 마당집⛴️", "사과나무 있는 마당집🍎", "강아지 키우는 마당집🐕", "고양이 키우는 마당집🐈",
  "호랑이 키우는 마당집🐅", "드래곤 키우는 마당집🐉", "역세권 빌라촌🏘️", "역세권 쓰리룸 빌라촌🏘️", "발코니가 있는 빌라🌟",
  "테라스 감성 빌라✨", "바베큐 타레스 빌라🥩", "구축 소형 아파트🏚️", "구축 중형 아파트🏚️", "리모델링된 구축 아파트🏚️",
  "소형 호e편한 세상🏚️", "중소형 호e편한 세상🏚️", "대단지 호미안🏚️", "신축 호르지오🏠", "대단지 신축 홋데캐슬🏠",
  "한강 뷰 아파트🏠", "갱냄 3구 아파트🏠", "갤러리아 호레🏠", "아크로 서울 호레스트🏠", "호인원 한남🏠",
  "한남더딜🏠", "아프로 호월포레스트🏠", " 호월 리버파크🏠", "호월레움 하우스🏠", "더 인피호월니움🏠",
  "클로버 호월힐🏠", "블루밍 호월츠🏠", "호월브릿지 레지던스🏠", "호월 오브제 하우스🏠", "에버 그로버 호월🏠",
  "포레스트 아트 호월힐🏠", "하모니 호월 코트🏠", "더 넥스트 호월 뷰🏠", "포레스트 아트 호월힐🏠", "브릿지 호월 노르웨이🏠",
  "벨로시티 호월하임🏠", "호월갤러리아 오션뷰🏠", "리브온 호월 플레이스 🏠", " 트마제 호월🏠", "시그 호엘🏠", "더 펜트호월스 🏠"
] as const;

export type ParsedConstructionEditCommand =
  | { kind: "ignored" }
  | { kind: "usage" }
  | { kind: "numeric_error" }
  | { kind: "invalid_floor" }
  | { kind: "edit"; targetName: string; floorArea: number; homeName: string };

// `/건설수정`과 정확히 분리된 인자형 명령만 dispatch 후보로 분류합니다.
export function isConstructionEditCommandCandidate(message: string | undefined): boolean {
  return message === COMMAND || message?.indexOf(COMMAND + " ") === 0;
}

// 레거시 homeInfo의 결번·중복 우선순위를 포함해 평수별 집 이름을 반환합니다.
export function findLegacyHomeName(floorArea: number): string | undefined {
  if (!Number.isSafeInteger(floorArea) || floorArea < 1 || floorArea > 300 || floorArea === 189 || floorArea === 207) return undefined;
  let group = Math.floor(floorArea / 5);
  if (floorArea === 190) group = 37;
  else if (floorArea >= 208 && floorArea <= 210) group = 41;
  else if (floorArea >= 211 && floorArea <= 264) group = Math.floor((floorArea - 1) / 5);
  return HOME_NAMES_BY_GROUP[group];
}

// 공백 포함 닉네임과 마지막 정수 평수를 레거시 순서대로 해석합니다.
export function parseConstructionEditCommand(message: string): ParsedConstructionEditCommand {
  if (!isConstructionEditCommandCandidate(message)) return { kind: "ignored" };
  const parts = message.trim().split(/\s+/);
  if (parts.length < 3) return { kind: "usage" };
  const floorText = parts[parts.length - 1]!;
  if (!/^\d+$/.test(floorText)) return { kind: "numeric_error" };
  const floorArea = Number.parseInt(floorText, 10);
  const homeName = findLegacyHomeName(floorArea);
  if (homeName === undefined) return { kind: "invalid_floor" };
  return { kind: "edit", targetName: parts.slice(1, -1).join(" "), floorArea, homeName };
}

// 건설 수정 성공 답장을 레거시 줄바꿈 형식으로 생성합니다.
export function buildConstructionEditCompletedMessage(input: { targetName: string; floorArea: number; homeName: string; baseExperience: string }): string {
  return "✅ 건설 수정 완료\n대상: " + input.targetName + "\n변경 평수: " + input.floorArea
    + "평\n집 이름: " + input.homeName + "\n누적 매력: " + input.baseExperience + "💕";
}
