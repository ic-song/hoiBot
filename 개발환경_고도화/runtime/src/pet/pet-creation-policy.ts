export const LEGACY_PET_PERSONALITIES = [
  "다정한", "츤데레", "시크", "고양이말투", "강아지말투", "교양있는집사", "시인", "개그맨", "AI로봇", "어린아이",
  "철학자", "모험가", "해적", "요정", "귀족", "현자", "장군", "요리사", "연인", "과학자", "아이돌", "악동",
  "성실한", "외로운", "고집스러운", "개구쟁이", "용감한", "대담한", "장난꾸러기", "촐랑이", "무사태평", "조심스러운",
  "의젓한", "덜렁이", "냉정한", "차분한", "얌전한", "신중한", "건방진", "겁쟁이", "성급한", "명랑한", "천진난만한",
  "바보스러운", "가소로운", "멍청한", "호이스러운", "소시오패스", "나르시스트", "똘끼가 있는", "온화한", "산만한",
  "감성 있는", "마음이 따듯한", "주사위 굴리는", "도박중독", "냉철한", "멋쟁이", "존예여신", "희생적인", "절제하는",
  "개척적인", "기꺼이 하는", "논쟁을 좋아하는", "공손한", "설득력 있는", "신중한", "인기 있는", "변화가 많은", "체계적인",
  "엄격한", "호의적인", "참신한", "지도력 있는", "일관성 있는", "참을성 없는", "경쟁심이 있는", "포옹력 있는", "강력한",
  "활기 있는", "사교적인", "회의적인", "독립심이 강한", "겸손한", "충동적인", "친절한", "변덕스러운", "꼼꼼한", "논리적인",
  "느린", "쾌활한", "눕기 좋아하는", "무서움을 모르는", "완고한", "인내심이 좋은", "느긋한", "사려 깊은", "완벽주의자",
  "전통적인", "충성스러운", "단호한", "마초적인", "슈퍼맨같은", "사이코패스", "깡패같은", "행복을 주는", "달달한",
  "빠가스러운", "천재적인", "야한", "밝히는", "졸렬한", "월급루팡", "월급쿠팡", "맞고다니는", "매력이 넘치는", "귀여운",
  "혓 바닥이 긴", "얼굴 짱 큰", "운이 좋은", "주정뱅이", "담배 맛을 아는", "입냄새 나는", "애인이 없는", "현타온",
  "폭주하는", "변비 있는", "진료가 필요한", "약먹을 시간이 지난", "패드립퍼", "오타쿠", "아이시떼루!", "맛집을 좋아하는",
  "명품백을 좋아하는", "무신사를 사랑하는", "주인을 좋아하는", "주인을 사랑하는", "주인을 싫어하는", "주인을 극혐하는", "약골.."
] as const;

const PET_TYPES = [
  { code: "legacy-sky", displayName: "하늘", normal: ["🦃", "🐓", "🐥", "🐦", "🕊", "🦅", "🦆", "🦢", "🦉", "🦤", "🦩", "🦚", "🦜", "🐦‍⬛", "🦋", "🐝", "🐤", "🦇"], unique: ["🧚‍♂️", "🧚‍♀️", "🧚", "🐉"] },
  { code: "legacy-land", displayName: "땅", normal: ["🦧", "🐕", "🐩", "🐈", "🐈‍⬛", "🫏", "🦌", "🦬", "🐄", "🐖", "🐏", "🦛", "🐀", "🐇", "🐿", "🦔", "🦥", "🦦", "🦨", "🦘", "🐍", "🐆", "🦓"], unique: ["🧟‍♂️", "🧟‍♀️", "🧟", "🦄", "🦖", "🐅"] },
  { code: "legacy-sea", displayName: "바다", normal: ["🐧", "🐢", "🐊", "🐋", "🐬", "🦭", "🐟", "🐠", "🐡", "🦈", "🐙", "🦀", "🦞", "🦐", "🦑", "🪼"], unique: ["🧜‍♂️", "🧜‍♀️", "🧜", "🐳"] }
] as const;

export interface GeneratedStarterPet {
  typeCode: string;
  typeDisplayName: string;
  imageValue: string;
  personality: string;
  unique: boolean;
}

// `/펫생성` 전체 문자열을 검증하고 공백 없는 1~6자 펫 이름만 반환합니다.
export function parsePetCreationCommand(message: string): string | null {
  const match = /^\/펫생성\s+(\S+)$/u.exec(message);
  const name = match?.[1];
  return name !== undefined && name.length >= 1 && name.length <= 6 ? name : null;
}

// 기존 펫 생성과 같은 후보군에서 성격·종족·이모지를 선택합니다.
export function generateStarterPet(random: () => number = Math.random): GeneratedStarterPet {
  const personality = LEGACY_PET_PERSONALITIES[Math.floor(random() * LEGACY_PET_PERSONALITIES.length)]!;
  const type = PET_TYPES[Math.floor(random() * PET_TYPES.length)]!;
  const unique = random() < 0.1;
  const images = unique ? type.unique : type.normal;
  const imageValue = images[Math.floor(random() * images.length)]!;
  return { typeCode: type.code, typeDisplayName: type.displayName, imageValue, personality, unique };
}
