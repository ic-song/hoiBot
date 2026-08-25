export type FixtureItemType =
  | "STACK" | "POINT" | "PET" | "MINI_PET" | "FURNITURE"
  | "MEMBER_TITLE" | "PET_TITLE" | "PET_APPEARANCE" | "GUILD_RESOURCE";
export type RewardOperation = "ADD" | "REMOVE" | "REPLACE";
export type OwnerScope = "USER" | "GUILD" | "TARGET_PET";

export interface FixedRewardFixture {
  itemId: string;
  name: string;
  itemType: FixtureItemType;
  quantity: bigint;
  operation: RewardOperation;
  ownerScope: OwnerScope;
  targetSelector?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface WeightedChoiceFixture {
  itemId: string;
  name: string;
  itemType: "STACK";
  legacyWeight: number;
  quantity: bigint;
  bundleRewards?: readonly FixedRewardFixture[];
}

export type DynamicRewardRuleFixture =
  | {
      kind: "WEIGHTED_ONE";
      ruleId: string;
      outputType: "STACK";
      failureWeight: number;
      successWeight: number;
      legacySuccessWeightTotal: number;
      normalizeSuccessWeights: true;
      choices: readonly WeightedChoiceFixture[];
    }
  | {
      kind: "CATALOG_RANDOM";
      ruleId: string;
      outputType: "MINI_PET";
      gradeCatalog: string;
      itemCatalog: string;
      maxSuccessCount: number;
      consumeOnlySuccessCount: true;
      capacityPolicy: "START_MUST_HAVE_SPACE";
    }
  | {
      kind: "UNIFORM_ONE";
      ruleId: string;
      outputType: "PET_APPEARANCE";
      ownerScope: "TARGET_PET";
      targetSelector: "REQUESTED_PET";
      choices: readonly {
        itemId: string;
        name: string;
        metadata: Readonly<Record<string, unknown>>;
      }[];
    }
  | {
      kind: "RANDOM_INTEGER";
      ruleId: string;
      outputType: "POINT";
      min: bigint;
      max: bigint;
      step: bigint;
      signedResult: boolean;
      positiveOperation: "ADD";
      negativeOperation: "REMOVE";
    };

export interface IndependentPackageFixture {
  packageId: string;
  commandId: string;
  legacyCommand: string;
  consumeItemId: string;
  consumeItemName: string;
  consumeQuantity: bigint;
  maxOpenCount: number;
  fixedRewards: readonly FixedRewardFixture[];
  dynamicRules: readonly DynamicRewardRuleFixture[];
}

const add = (
  itemId: string,
  name: string,
  itemType: FixtureItemType,
  quantity: bigint,
  metadata?: Readonly<Record<string, unknown>>,
  ownerScope: OwnerScope = "USER",
  targetSelector?: string
): FixedRewardFixture => ({
  itemId, name, itemType, quantity, operation: "ADD", ownerScope, targetSelector, metadata
});

const point = (quantity: bigint): FixedRewardFixture =>
  add("ITEM-RWD-011", "포인트", "POINT", quantity);

const miniPet = (
  itemId: string,
  name: string,
  emoji: string,
  grade: string,
  battleExp: bigint,
  price: bigint | null,
  extra: Readonly<Record<string, unknown>> = {}
): FixedRewardFixture => add(itemId, name + emoji, "MINI_PET", 1n, {
  name, emoji, grade, battleExp: battleExp.toString(),
  ...(price === null ? {} : { price: price.toString() }),
  ...extra
});

const pkg = (
  commandId: string,
  legacyCommand: string,
  consumeItemName: string,
  fixedRewards: readonly FixedRewardFixture[],
  dynamicRules: readonly DynamicRewardRuleFixture[] = [],
  maxOpenCount = 1,
  consumeItemId?: string
): IndependentPackageFixture => ({
  packageId: "PKG-" + commandId,
  commandId,
  legacyCommand,
  consumeItemId: consumeItemId ?? "ITEM-PACKAGE-" + commandId,
  consumeItemName,
  consumeQuantity: 1n,
  maxOpenCount,
  fixedRewards,
  dynamicRules
});

const fishingRaw: readonly (readonly [string, string, number, bigint])[] = [
  ["001", "잉어🐡", 0.1, 90n], ["002", "연어🍣", 0.08, 30n],
  ["003", "고등어🐟", 0.08, 90n], ["004", "은갈치🐟", 0.07, 90n],
  ["005", "광어🐠", 0.06, 300n], ["006", "오징어🦑", 0.06, 90n],
  ["007", "새우🦐", 0.06, 60n], ["008", "문어🐙", 0.05, 60n],
  ["009", "게🦀", 0.05, 360n], ["010", "조개🐚", 0.05, 450n],
  ["011", "전복🐚", 0.03, 750n], ["012", "장어🐟", 0.03, 900n],
  ["013", "방어🐟", 0.03, 840n], ["014", "복어🐡", 0.025, 540n],
  ["015", "참치🐟", 0.02, 1_200n], ["016", "대게🦀", 0.02, 1_350n],
  ["017", "해마🐴", 0.02, 600n], ["018", "랍스터🦞", 0.015, 1_500n],
  ["019", "참돔🐟", 0.01, 900n], ["020", "황금잉어👑", 0.001, 100_000n]
];

const fishingChoices: readonly WeightedChoiceFixture[] = fishingRaw.map(
  ([suffix, name, legacyWeight, quantity]) => ({
    itemId: "ITEM-RWD-FISH-" + suffix,
    name,
    itemType: "STACK",
    legacyWeight,
    quantity,
    bundleRewards: suffix === "020" ? [add(
      "ITEM-RWD-FISH-TITLE",
      "황금잉어👑를 낚은 전설의 낚시꾼",
      "MEMBER_TITLE",
      1n,
      { name: "황금잉어👑를 낚은 전설의 낚시꾼", price: "0", deduplicateBy: "name" }
    )] : undefined
  })
);

const halloweenRaw: readonly (readonly [string, string, string])[] = [
  ["001", "🎃 할로윈 호박", "🎃"], ["002", "💀 해골", "💀"],
  ["003", "🍬 사탕", "🍬"], ["004", "🍭 롤리팝", "🍭"],
  ["005", "🤡 광대", "🤡"], ["006", "👻 유령", "👻"],
  ["007", "🕯 촛불", "🕯"]
];

const halloweenChoices = halloweenRaw.map(([suffix, name, petimg]) => ({
  itemId: "ITEM-RWD-HALLOWEEN-" + suffix,
  name,
  metadata: { event: "HALLOWEEN", name: petimg, emoji: name, legacyField: "petimg" }
}));

export const INDEPENDENT_PACKAGE_FIXTURES: readonly IndependentPackageFixture[] = [
  pkg("078", "/고생하셨습니다", "부방상여패키지3(/고생하셨습니다)", [
    add("ITEM-RWD-001", "펫스윗홈인테리어샵🖼️(/샵오픈)", "STACK", 20_000n),
    add("ITEM-RWD-002", "탐험확률UP🗻(20%)", "STACK", 20n),
    add("ITEM-RWD-003", "길드공헌훈장🌟(/길드공헌 숫자)", "STACK", 30n),
    add("ITEM-RWD-004", "길드창고패키지🧳(/길드창고패키지오픈", "STACK", 1n),
    add("ITEM-RWD-005", "확성기📢(/알림 내용 30자)", "STACK", 5n)
  ]),
  pkg("088", "/길드창고패키지오픈", "길드창고패키지🧳(/길드창고패키지오픈)", [
    add("ITEM-RWD-006", "길드자금", "GUILD_RESOURCE", 50_000_000n, { legacyField: "warehouse.fund" }, "GUILD"),
    add("ITEM-RWD-007", "펫스킬북", "GUILD_RESOURCE", 1n, { legacyField: "warehouse.petSkillBook" }, "GUILD"),
    add("ITEM-RWD-008", "펜던트", "GUILD_RESOURCE", 1n, { legacyField: "warehouse.pendant" }, "GUILD"),
    add("ITEM-RWD-009", "펫", "GUILD_RESOURCE", 15n, { legacyField: "warehouse.pet" }, "GUILD"),
    add("ITEM-RWD-010", "미니펫", "GUILD_RESOURCE", 5n, { legacyField: "warehouse.miniPet" }, "GUILD")
  ], [], 10_000),
  pkg("093", "/낚시오픈", "낚시패키지🎣[1](/낚시오픈)", [], [{
    kind: "WEIGHTED_ONE", ruleId: "fishing-item-draw", outputType: "STACK",
    failureWeight: 0.3, successWeight: 0.7, legacySuccessWeightTotal: 0.861,
    normalizeSuccessWeights: true, choices: fishingChoices
  }]),
  pkg("097", "/도파민오픈1", "도파민패키지🤩[1](/도파민오픈1)", [
    add("ITEM-PACKAGE-105", "미니펫뽑기🐹(/미니펫오픈)", "STACK", 5_000n),
    add("ITEM-RWD-001", "펫스윗홈인테리어샵🖼️(/샵오픈)", "STACK", 10_000n),
    add("ITEM-RWD-014", "호이베이스볼⚾️(/투수던집니다)", "STACK", 150n)
  ]),
  pkg("098", "/도파민오픈2", "도파민패키지🤩[2](/도파민오픈2)", [
    add("ITEM-PACKAGE-105", "미니펫뽑기🐹(/미니펫오픈)", "STACK", 4_000n),
    add("ITEM-RWD-001", "펫스윗홈인테리어샵🖼️(/샵오픈)", "STACK", 7_000n),
    add("ITEM-RWD-014", "호이베이스볼⚾️(/투수던집니다)", "STACK", 200n),
    add("ITEM-RWD-015", "환생버섯🍄", "STACK", 1n),
    add("ITEM-RWD-016", "강화확률뽑기⚒️(/강화뽑기)", "STACK", 50n)
  ]),
  pkg("100", "/로열오픈", "[🏡가구]로열패키지 확정(/로열오픈)", [
    add("ITEM-RWD-017", "고대서적📘", "FURNITURE", 1n, {
      name: "고대서적📘", exp: "140000", rate: 0.00001, grade: "로열 루미에르",
      displayName: "고대서적📘(+140,000💕)[로열 루미에르]"
    })
  ]),
  pkg("103", "/미강오픈", "미니펫강화석패키지💫(/미강오픈)", [
    add("ITEM-RWD-018", "미니펫 강화석💫", "STACK", 1_000n),
    add("ITEM-RWD-019", "미니펫강화확률UP🐷(30%)", "STACK", 50n)
  ]),
  pkg("105", "/미니펫오픈", "미니펫뽑기🐹(/미니펫오픈)", [], [{
    kind: "CATALOG_RANDOM", ruleId: "mini-pet-grade-draw", outputType: "MINI_PET",
    gradeCatalog: "miniPetData.gradeTable", itemCatalog: "miniPetData.miniPet",
    maxSuccessCount: 3_000, consumeOnlySuccessCount: true, capacityPolicy: "START_MUST_HAVE_SPACE"
  }], 3_000),
  pkg("156", "/창조오픈", "[🐹미니펫]창조패키지 확정(/창조오픈)", [
    miniPet("ITEM-RWD-021", "호이빛", "💖", "창조", 1_350_000n, null, {
      castleExp: "1350000", raidExp: "1350000"
    })
  ]),
  pkg("157", "/초보오픈1", "초보자 스타터패키지🌟[1](/초보오픈1)", [
    add("ITEM-RWD-022", "티어 승급티켓🎟", "STACK", 10n),
    add("ITEM-RWD-023", "정령 강화석🥀", "STACK", 100n),
    add("ITEM-RWD-024", "펫먹이특식🥡(/특식오픈)", "STACK", 30n),
    add("ITEM-RWD-025", "펫먹이🍼", "STACK", 700n), point(100_000_000n)
  ]),
  pkg("158", "/초보오픈2", "초보자 스타터패키지🌟[2](/초보오픈2)", [
    add("ITEM-RWD-022", "티어 승급티켓🎟", "STACK", 10n),
    add("ITEM-RWD-023", "정령 강화석🥀", "STACK", 100n),
    add("ITEM-RWD-024", "펫먹이특식🥡(/특식오픈)", "STACK", 35n),
    add("ITEM-RWD-025", "펫먹이🍼", "STACK", 700n), point(100_000_000n)
  ]),
  pkg("159", "/초보오픈3", "초보자 스타터패키지🌟[3](/초보오픈3)", [
    add("ITEM-RWD-022", "티어 승급티켓🎟", "STACK", 10n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 200n),
    add("ITEM-RWD-023", "정령 강화석🥀", "STACK", 100n),
    add("ITEM-RWD-024", "펫먹이특식🥡(/특식오픈)", "STACK", 35n),
    add("ITEM-RWD-025", "펫먹이🍼", "STACK", 700n), point(100_000_000n)
  ]),
  pkg("160", "/초보오픈4", "초보자 스타터패키지🌟[4](/초보오픈4)", [
    add("ITEM-RWD-022", "티어 승급티켓🎟", "STACK", 10n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 200n),
    add("ITEM-RWD-023", "정령 강화석🥀", "STACK", 200n),
    add("ITEM-RWD-024", "펫먹이특식🥡(/특식오픈)", "STACK", 35n), point(100_000_000n)
  ]),
  pkg("161", "/초보오픈5", "초보자 스타터패키지🌟[5](/초보오픈5)", [
    add("ITEM-RWD-022", "티어 승급티켓🎟", "STACK", 10n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 200n),
    add("ITEM-RWD-023", "정령 강화석🥀", "STACK", 200n),
    add("ITEM-RWD-024", "펫먹이특식🥡(/특식오픈)", "STACK", 35n),
    add("ITEM-RWD-025", "펫먹이🍼", "STACK", 1_000n), point(100_000_000n)
  ]),
  pkg("162", "/초보오픈6", "초보자 스타터패키지🌟[6](/초보오픈6)", [
    add("ITEM-RWD-022", "티어 승급티켓🎟", "STACK", 10n),
    add("ITEM-RWD-027", "럭키박스🍀(/럭키오픈)", "STACK", 30n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 200n),
    add("ITEM-RWD-023", "정령 강화석🥀", "STACK", 200n),
    add("ITEM-RWD-024", "펫먹이특식🥡(/특식오픈)", "STACK", 35n),
    add("ITEM-RWD-025", "펫먹이🍼", "STACK", 1_000n), point(100_000_000n)
  ]),
  pkg("165", "/컬렉션창세오픈", "컬렉션창세패키지🐹(/컬렉션창세오픈)", [
    add("ITEM-PACKAGE-105", "미니펫뽑기🐹(/미니펫오픈)", "STACK", 1_500n),
    miniPet("ITEM-RWD-028", "컬렉션창세 미니펫", "🐹", "창세", 1n, 1n)
  ]),
  pkg("166", "/컬렉션창조오픈", "컬렉션창조패키지🐹(/컬렉션창조오픈)", [
    add("ITEM-PACKAGE-105", "미니펫뽑기🐹(/미니펫오픈)", "STACK", 2_000n),
    miniPet("ITEM-RWD-029", "컬렉션창조 미니펫", "🐹", "창조", 1n, 1n)
  ]),
  pkg("186", "/펫탐험오픈1", "펫탐험패키지⛰️[1](/펫탐험오픈1)", [
    add("ITEM-RWD-030", "탐험확률UP🗻(50%)", "STACK", 20n),
    add("ITEM-RWD-031", "탐험확률UP🗻(40%)", "STACK", 35n),
    add("ITEM-RWD-032", "탐험확률UP🗻(30%)", "STACK", 50n),
    add("ITEM-RWD-033", "펫던전 입장권🌋", "STACK", 40n),
    add("ITEM-RWD-034", "보물지도🗺️", "STACK", 50n)
  ]),
  pkg("188", "/해피할로윈오픈시펫외형이바뀝니다안에는어마어마한상품이있습니다",
    "할로윈패키지🎃1(/해피할로윈오픈시펫외형이바뀝니다안에는어마어마한상품이있습니다)", [
      add("ITEM-RWD-035", "미니펫뽑기4🐹(/미니펫뽑기)", "STACK", 300n),
      add("ITEM-RWD-036", "혼자레이드리셋권😝", "STACK", 100n),
      add("ITEM-RWD-024", "펫먹이특식🥡(/특식오픈)", "STACK", 50n),
      add("ITEM-RWD-037", "슬롯코인🪙", "STACK", 1_000n),
      add("ITEM-RWD-038", "시탑 부스터🔮", "STACK", 200n),
      add("ITEM-RWD-039", "땅문서📜", "STACK", 1n)
    ], [{
      kind: "UNIFORM_ONE", ruleId: "halloween-pet-appearance", outputType: "PET_APPEARANCE",
      ownerScope: "TARGET_PET", targetSelector: "REQUESTED_PET", choices: halloweenChoices
    }]
  ),
  pkg("201", "/홈패키지오픈2", "펫스윗홈패키지🏡[2](/홈패키지오픈2)", [
    add("ITEM-RWD-001", "펫스윗홈인테리어샵🖼️(/샵오픈)", "STACK", 220n),
    add("ITEM-RWD-039", "땅문서📜", "STACK", 2n),
    add("ITEM-RWD-041", "돌멩이🪨", "STACK", 2_000n),
    add("ITEM-RWD-042", "캐슬코인🥇", "STACK", 50n),
    add("ITEM-RWD-043", "레이드타격대인장👑(+600👾)", "STACK", 1n), point(200_000_000n)
  ]),
  pkg("203", "/홈패키지오픈테스트", "펫스윗홈패키지🏡[1](/홈패키지오픈테스트)", [
    add("ITEM-RWD-001", "펫스윗홈인테리어샵🖼️(/샵오픈)", "STACK", 350n),
    add("ITEM-RWD-039", "땅문서📜", "STACK", 3n),
    add("ITEM-RWD-041", "돌멩이🪨", "STACK", 3_000n),
    add("ITEM-RWD-044", "🥕당근이세요?", "STACK", 60n),
    add("ITEM-RWD-016", "강화확률뽑기⚒️(/강화뽑기)", "STACK", 10n), point(100_000_000n),
    add("ITEM-RWD-045", "샤넬 컬렉션🎩", "FURNITURE", 1n, {
      name: "샤넬 컬렉션🎩", exp: "56050", rate: 0, grade: "시그니엘",
      displayName: "샤넬 컬렉션🎩(+56050💕)[시그니엘]"
    })
  ]),
  pkg("204", "/황제패키지오픈3", "황제패키지👑[3](/황제패키지오픈3)", [
    add("ITEM-PACKAGE-105", "미니펫뽑기🐹(/미니펫오픈)", "STACK", 50_000n),
    add("ITEM-RWD-001", "펫스윗홈인테리어샵🖼️(/샵오픈)", "STACK", 50_000n),
    add("ITEM-RWD-018", "미니펫 강화석💫", "STACK", 10_000n),
    add("ITEM-RWD-047", "경찰과 도둑🚨(/삐뽀삐뽀)", "STACK", 50n),
    add("ITEM-RWD-024", "펫먹이특식🥡(/특식오픈)", "STACK", 50n),
    add("ITEM-RWD-048", "주간상자🌼", "STACK", 10n),
    add("ITEM-RWD-049", "월간상자🌕", "STACK", 3n),
    add("ITEM-RWD-003", "길드공헌훈장🌟(/길드공헌 숫자)", "STACK", 200n),
    add("ITEM-RWD-039", "땅문서📜", "STACK", 100n),
    add("ITEM-RWD-042", "캐슬코인🥇", "STACK", 200n),
    add("ITEM-RWD-005", "확성기📢(/알림 내용 30자)", "STACK", 30n),
    add("ITEM-RWD-030", "탐험확률UP🗻(50%)", "STACK", 100n),
    add("ITEM-RWD-033", "펫던전 입장권🌋", "STACK", 100n),
    add("ITEM-RWD-044", "🥕당근이세요?", "STACK", 50n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 5_000n),
    add("ITEM-RWD-016", "강화확률뽑기⚒️(/강화뽑기)", "STACK", 50n),
    add("ITEM-RWD-023", "정령 강화석🥀", "STACK", 7_000n),
    add("ITEM-RWD-025", "펫먹이🍼", "STACK", 100_000n),
    add("ITEM-RWD-052", "전설의 돌맹이🗿", "STACK", 50n),
    add("ITEM-RWD-053", "다이아상자💎(/다이아상자오픈)", "STACK", 500n),
    point(3_000_000_000n),
    miniPet("ITEM-RWD-029", "컬렉션창조 미니펫", "🐹", "창조", 1n, 1n),
    add("ITEM-RWD-054", "응? 뭐라 하였느냐 아아..너무 바닥에 있어 들리지가 않는구나👑",
      "MEMBER_TITLE", 1n, {
        name: "응? 뭐라 하였느냐 아아..너무 바닥에 있어 들리지가 않는구나👑",
        price: "100000000"
      })
  ]),
  pkg("206", "/이랏싸이마쎄", "태초야키토리 10세트🥩(/이랏싸이마쎄)", [
    add("ITEM-PACKAGE-105", "미니펫뽑기🐹(/미니펫오픈)", "STACK", 2_500n),
    miniPet("ITEM-RWD-055", "태초꼬치", "🍢", "태초", 1n, 1n),
    miniPet("ITEM-RWD-056", "태초야키", "🔥", "태초", 1n, 1n),
    miniPet("ITEM-RWD-057", "태초숯불꼬치", "♨️", "태초", 1n, 1n),
    miniPet("ITEM-RWD-058", "태초한판꼬치", "🥢", "태초", 1n, 1n),
    miniPet("ITEM-RWD-059", "태초꼬치집", "🏮", "태초", 1n, 1n),
    miniPet("ITEM-RWD-060", "태초닭꼬치", "🐔", "태초", 1n, 1n),
    miniPet("ITEM-RWD-061", "태초불향꼬치", "🔥", "태초", 1n, 1n),
    miniPet("ITEM-RWD-062", "태초한잔꼬치", "🍶", "태초", 1n, 1n),
    miniPet("ITEM-RWD-063", "태초꼬치포차", "🍻", "태초", 1n, 1n),
    miniPet("ITEM-RWD-064", "태초직화꼬치", "🔥", "태초", 1n, 1n)
  ]),
  pkg("207", "/극락오픈", "극락상자👹", [], [{
    kind: "RANDOM_INTEGER", ruleId: "paradise-point-range", outputType: "POINT",
    min: 1_000_000n, max: 10_000_000n, step: 1_000_000n, signedResult: false,
    positiveOperation: "ADD", negativeOperation: "REMOVE"
  }], 10_000),
  pkg("208", "/나락오픈", "나락상자👹", [], [{
    kind: "RANDOM_INTEGER", ruleId: "hell-point-range", outputType: "POINT",
    min: -10_000_000n, max: 19_000_000n, step: 1_000_000n, signedResult: true,
    positiveOperation: "ADD", negativeOperation: "REMOVE"
  }], 10_000),
  pkg("209", "/루비오픈", "💠루비 상자(/루비오픈)", [
    add("ITEM-RWD-042", "캐슬코인🥇", "STACK", 120n),
    add("ITEM-RWD-065", "펫강화확률UP🌟(30%)", "STACK", 4n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 1_300n)
  ]),
  pkg("210", "/루키오픈", "👻루키 상자(/루키오픈)", [
    add("ITEM-RWD-042", "캐슬코인🥇", "STACK", 50n),
    add("ITEM-RWD-065", "펫강화확률UP🌟(30%)", "STACK", 2n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 500n)
  ]),
  pkg("211", "/마스터오픈", "🔮마스터 상자(/마스터오픈)", [
    add("ITEM-RWD-042", "캐슬코인🥇", "STACK", 250n),
    add("ITEM-RWD-065", "펫강화확률UP🌟(30%)", "STACK", 7n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 2_700n)
  ]),
  pkg("212", "/미니오픈테스트", "미니펫뽑기🐹[2](/미니오픈테스트)", [
    add("ITEM-PACKAGE-105", "미니펫뽑기🐹(/미니펫오픈)", "STACK", 25n),
    add("ITEM-RWD-066", "슬롯대용량상자🧳", "STACK", 5n),
    add("ITEM-RWD-044", "🥕당근이세요?", "STACK", 20n),
    add("ITEM-RWD-036", "혼자레이드리셋권😝", "STACK", 50n),
    point(100_000_000n),
    miniPet("ITEM-RWD-067", "샤넬 햄스터", "🐹", "전설", 30_000_000n, 999n)
  ]),
  pkg("213", "/다이아오픈", "💎다이아 상자(/다이아오픈)", [
    add("ITEM-RWD-042", "캐슬코인🥇", "STACK", 200n),
    add("ITEM-RWD-065", "펫강화확률UP🌟(30%)", "STACK", 6n),
    add("ITEM-RWD-026", "펫 강화석⭐", "STACK", 2_200n)
  ]),
  pkg("214", "/랜덤오픈", "랜덤박스💝", [], [{
    kind: "WEIGHTED_ONE", ruleId: "random-box-uniform-draw", outputType: "STACK",
    failureWeight: 0, successWeight: 1, legacySuccessWeightTotal: 1,
    normalizeSuccessWeights: true,
    choices: [
      { itemId: "ITEM-RWD-TRASH-BOX", name: "잡템상자☠", itemType: "STACK", legacyWeight: 1 / 6, quantity: 1n },
      { itemId: "ITEM-RWD-RANDOM-SPIRIT-BOX", name: "정령상자🥀", itemType: "STACK", legacyWeight: 1 / 6, quantity: 1n },
      { itemId: "ITEM-PACKAGE-CHICKEN-BOX", name: "치킨상자🐔", itemType: "STACK", legacyWeight: 1 / 6, quantity: 1n },
      { itemId: "ITEM-RWD-025", name: "펫먹이🍼", itemType: "STACK", legacyWeight: 1 / 6, quantity: 1n },
      { itemId: "ITEM-RWD-RANDOM-TERRITORY-DEFENSE-20", name: "영지절대방어권🛡(20%)", itemType: "STACK", legacyWeight: 1 / 6, quantity: 1n },
      { itemId: "ITEM-RWD-RANDOM-TERRITORY-ATTACK-10", name: "영지기습공격권🔥(10%)", itemType: "STACK", legacyWeight: 1 / 6, quantity: 1n }
    ]
  }], 10_000),
  pkg("215", "/상자오픈", "펫먹이상자📦(/상자오픈)", [], [{
    kind: "WEIGHTED_ONE", ruleId: "pet-food-box-draw", outputType: "STACK",
    failureWeight: 0, successWeight: 1, legacySuccessWeightTotal: 1,
    normalizeSuccessWeights: true,
    choices: [
      { itemId: "ITEM-RWD-025", name: "펫먹이🍼", itemType: "STACK", legacyWeight: 0.9815, quantity: 50n },
      { itemId: "ITEM-RWD-025", name: "펫먹이🍼", itemType: "STACK", legacyWeight: 0.015, quantity: 100n },
      { itemId: "ITEM-RWD-025", name: "펫먹이🍼", itemType: "STACK", legacyWeight: 0.003, quantity: 250n },
      { itemId: "ITEM-RWD-025", name: "펫먹이🍼", itemType: "STACK", legacyWeight: 0.0005, quantity: 500n }
    ]
  }], 10_000, "ITEM-RWD-PET-FOOD-BOX")
];

export const LEGACY_FIXED_REWARD_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(
  INDEPENDENT_PACKAGE_FIXTURES.map((entry) => [entry.legacyCommand, entry.fixedRewards.length])
);

export const LEGACY_DYNAMIC_RULE_KINDS: Readonly<Record<string, readonly DynamicRewardRuleFixture["kind"][]>> =
  Object.fromEntries(
    INDEPENDENT_PACKAGE_FIXTURES
      .filter((entry) => entry.dynamicRules.length > 0)
      .map((entry) => [entry.legacyCommand, entry.dynamicRules.map((rule) => rule.kind)])
  );
