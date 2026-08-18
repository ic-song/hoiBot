export interface RandomSource { next(): number; }

export interface OpenAllState {
  rankLabel: string;
  point: bigint;
  quantities: Record<string, bigint>;
  guild: OpenAllGuildState | null;
}

export interface OpenAllGuildState {
  guildId: string;
  displayName: string;
  mark: string;
  level: number;
  experience: bigint;
  maxMembers: number;
  memberPlayerIds: string[];
}

export interface OpenAllGuildMutation {
  guildId: string;
  contributionDelta: bigint;
  contributionUseCountDelta: bigint;
  experienceDelta: bigint;
  levelAfter: number;
  maxMembersDelta: number;
  resourceDeltas: Record<string, bigint>;
  warehouseDeltas: Record<string, bigint>;
  memberPetFoodDelta: bigint;
}

export interface OpenAllPlan {
  reply: string;
  pointDelta: bigint;
  quantities: Record<string, bigint>;
  deltas: Record<string, bigint>;
  randomTrace: number[];
  openedBoxes: string[];
  deferredGuildItems: string[];
  guildMutation: OpenAllGuildMutation | null;
}

export const OPEN_ALL_COMMAND = "/전체오픈";

export function isOpenAllCommand(message: string | undefined): boolean {
  return message === OPEN_ALL_COMMAND;
}

type Item = { code: string; name: string };
type RangeBox = { box: Item; reward: Item; min: number; max: number; unit: string };

const item = (code: string, name: string): Item => ({ code, name });

const I = {
  trashBox: item("trash_box", "잡템상자☠"), trash: item("trash", "잡템☠️"),
  spiritBox: item("spirit_box", "정령상자🥀"), spiritFragment: item("spirit_fragment", "정령조각🥀"),
  chickenBox: item("chicken_box", "치킨상자🐔"), chicken: item("seasoned_chicken", "양념치킨🐔"),
  petEnhanceBox: item("pet_enhance_box", "펫강화상자⭐"), petEnhanceStone: item("pet_enhance_stone", "펫 강화석⭐"),
  slotBox: item("slot_box", "슬롯상자🧳"), bulkSlotBox: item("bulk_slot_box", "슬롯대용량상자🧳"), slotCoin: item("slot_coin", "슬롯코인🪙"),
  goldBox: item("gold_bar_box", "금괴상자💰"), gold: item("gold_bar", "금괴💰"),
  randomBox: item("random_box", "랜덤박스💝"), territoryDefense: item("territory_defense_ticket", "영지절대방어권🛡(20%)"), territoryAttack: item("territory_attack_ticket", "영지기습공격권🔥(10%)"),
  miniBox: item("mini_point_box", "미니상자🎁"), giftBox: item("gift_point_box", "선물상자🎁"), paradiseBox: item("paradise_point_box", "극락상자👹"), abyssBox: item("abyss_point_box", "나락상자👹"),
  petFoodBox: item("pet_food_box", "펫먹이상자📦(/상자오픈)"), petFood: item("pet_food", "펫먹이🍼"), specialFood: item("pet_food_special", "펫먹이특식🥡(/특식오픈)"),
  guildMedal: item("guild_contribution_medal", "길드공헌훈장🌟(/길드공헌 숫자)"), guildPackage: item("guild_warehouse_package", "길드창고패키지🧳(/길드창고패키지오픈)"),
  spiritDungeon: item("spirit_dungeon_box", "정령박스🥀(/정령박스오픈)"), spiritStone: item("spirit_stone", "정령 강화석🥀"),
  enhanceDungeon: item("enhance_dungeon_box", "강화박스⭐(/강화박스오픈)"), eventDungeon: item("event_dungeon_box", "이벤트박스✡️(/이벤박스오픈)"),
  petFoodDungeon: item("pet_food_dungeon_box", "펫먹이던전박스🍼(/펫먹이박스오픈)"), jeondorDungeon: item("jeondor_dungeon_box", "전도르던전박스🗿(/전도르박스오픈)"),
  chickenDungeon: item("chicken_dungeon_box", "양계장던전박스🐓(/양계장박스오픈)"), luckyDungeon: item("lucky_dungeon_box", "행운의박스🍀(/행운의박스오픈)"),
  landDungeon: item("land_document_dungeon_box", "땅문서던전박스📜(/땅문서박스오픈)"), shopDungeon: item("shop_open_dungeon_box", "샵오픈던전박스🏡(/샵오픈박스오픈)"),
  diamondDungeon: item("diamond_mine_box", "다이아광산박스💎(/다이아박스오픈)"), raidDungeon: item("guild_raid_dungeon_box", "길드레이드던전박스👾(/레이드박스오픈)"),
  pendantDungeon: item("pendant_maze_box", "펜던트미궁박스💎(/펜던트미궁박스오픈)"), archmageDungeon: item("archmage_ruins_box", "대마법사의 유적박스📜(/대마법박스오픈)"),
  shopOpen: item("pet_home_shop_open", "펫스윗홈인테리어샵🖼️(/샵오픈)"), dungeonTicket: item("pet_dungeon_ticket", "펫던전 입장권🌋"),
  legendaryStone: item("legendary_stone", "전설의 돌맹이🗿"), luckyBox: item("lucky_box", "럭키박스🍀(/럭키오픈)"), landDocument: item("land_document", "땅문서📜"),
  diamondBox: item("diamond_box", "다이아상자💎(/다이아상자오픈)"), weeklyBox: item("weekly_box", "주간상자🌼"), miniEnhancePackage: item("mini_pet_enhance_package", "미니펫강화석패키지💫"),
  miniPetTicket: item("mini_pet_ticket", "미니펫뽑기🐹(/미니펫오픈)"), petSkillBook: item("pet_skill_book", "펫스킬북📙(/펫스킬오픈)"),
  guildPendant: item("guild_warehouse_pendant", "길드창고 펜던트📿"), guildPetEnhance: item("guild_warehouse_pet_enhance", "길드창고 펫 강화⭐️"),
  guildMiniPetEnhance: item("guild_warehouse_mini_pet_enhance", "길드창고 미니펫 강화💫"),
  pendantEnhance: item("pendant_enhance_stone", "펜던트 강화석📿"), pendantRestore: item("pendant_restore_stone", "펜던트 복구석💎"), petSkillFragment: item("pet_skill_book_fragment", "펫스킬북 조각📙")
};

export const OPEN_ALL_ITEMS: readonly Item[] = Object.values(I);
export const OPEN_ALL_GUILD_WAREHOUSE_ITEM_CODES = {
  petSkillBook: I.petSkillBook.code,
  pendant: I.guildPendant.code,
  pet: I.guildPetEnhance.code,
  miniPet: I.guildMiniPetEnhance.code
} as const;

const GUILD_LEVELS: Readonly<Record<number, { need: bigint; reward: { maxMembers?: number; fund?: bigint; petSkillBook?: bigint; pet?: bigint; petFoodAll?: bigint } }>> = {
  1: { need: 1000n, reward: { maxMembers: 1 } }, 2: { need: 2000n, reward: { maxMembers: 1 } },
  3: { need: 4000n, reward: { maxMembers: 1 } }, 4: { need: 8000n, reward: { maxMembers: 1 } },
  5: { need: 12000n, reward: { maxMembers: 1 } }, 6: { need: 16000n, reward: { maxMembers: 1 } },
  7: { need: 20000n, reward: { maxMembers: 1 } }, 8: { need: 24000n, reward: { maxMembers: 1 } },
  9: { need: 28000n, reward: { maxMembers: 1 } }, 10: { need: 40000n, reward: { petFoodAll: 100000n } },
  11: { need: 50000n, reward: { fund: 300000000000n } }, 12: { need: 60000n, reward: { petSkillBook: 30000n } },
  13: { need: 70000n, reward: { petSkillBook: 35000n } }, 14: { need: 80000n, reward: { fund: 500000000000n } },
  15: { need: 90000n, reward: { pet: 100000n } }, 16: { need: 100000n, reward: { petFoodAll: 300000n } },
  17: { need: 120000n, reward: { fund: 700000000000n } }, 18: { need: 150000n, reward: { petSkillBook: 60000n } },
  19: { need: 180000n, reward: { petSkillBook: 70000n } }, 20: { need: 250000n, reward: { fund: 900000000000n } }
};

const RANGE_BOXES: readonly RangeBox[] = [
  { box: I.trashBox, reward: I.trash, min: 5, max: 10, unit: "개" },
  { box: I.spiritBox, reward: I.spiritFragment, min: 5, max: 10, unit: "개" },
  { box: I.chickenBox, reward: I.chicken, min: 5, max: 10, unit: "개" },
  { box: I.petEnhanceBox, reward: I.petEnhanceStone, min: 2, max: 3, unit: "개" },
  { box: I.slotBox, reward: I.slotCoin, min: 5, max: 10, unit: "개" },
  { box: I.bulkSlotBox, reward: I.slotCoin, min: 70, max: 100, unit: "개" },
  { box: I.goldBox, reward: I.gold, min: 5, max: 10, unit: "개" }
];

function comma(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function copyQuantities(value: Record<string, bigint>): Record<string, bigint> { return Object.fromEntries(Object.entries(value).map(([code, quantity]) => [code, BigInt(quantity)])); }
function quantity(map: Record<string, bigint>, code: string): bigint { return map[code] ?? 0n; }
function add(map: Record<string, bigint>, target: Item, amount: bigint): void { if (amount !== 0n) map[target.code] = quantity(map, target.code) + amount; }
function consumeAll(map: Record<string, bigint>, target: Item): bigint { const count = quantity(map, target.code); if (count > 0n) delete map[target.code]; return count; }

function roller(source: RandomSource, trace: number[]): number {
  const value = source.next();
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Random source must return a finite value between 0 and 1.");
  trace.push(value);
  return value === 1 ? 1 - Number.EPSILON : value;
}

function rollInt(source: RandomSource, trace: number[], min: number, max: number): bigint {
  return BigInt(Math.floor(roller(source, trace) * (max - min + 1)) + min);
}

function delta(before: Record<string, bigint>, after: Record<string, bigint>): Record<string, bigint> {
  const result: Record<string, bigint> = {};
  for (const code of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const change = quantity(after, code) - quantity(before, code);
    if (change !== 0n) result[code] = change;
  }
  return result;
}

export function planOpenAll(state: OpenAllState, source: RandomSource): OpenAllPlan {
  const before = copyQuantities(state.quantities);
  const bag = copyQuantities(state.quantities);
  const trace: number[] = [];
  const results1: string[] = [], results2: string[] = [], results3: string[] = [];
  const openedBoxes: string[] = [];
  let pointDelta = 0n;
  let guildMutation: OpenAllGuildMutation | null = null;

  function mutationForGuild(): OpenAllGuildMutation {
    const guild = state.guild!;
    if (guildMutation === null) guildMutation = { guildId: guild.guildId, contributionDelta: 0n, contributionUseCountDelta: 0n,
      experienceDelta: 0n, levelAfter: guild.level, maxMembersDelta: 0, resourceDeltas: {}, warehouseDeltas: {}, memberPetFoodDelta: 0n };
    return guildMutation;
  }

  function addResource(target: Record<string, bigint>, code: string, amount: bigint): void { target[code] = (target[code] ?? 0n) + amount; }

  for (const spec of RANGE_BOXES) {
    const count = consumeAll(bag, spec.box);
    if (count <= 0n) continue;
    let total = 0n;
    for (let n = 0n; n < count; n++) total += rollInt(source, trace, spec.min, spec.max);
    add(bag, spec.reward, total);
    openedBoxes.push(spec.box.code);
    results1.push(`${spec.box.name} ${count}개 오픈`);
    results2.push(`${spec.reward.name} ${total}${spec.unit} 획득`);
  }

  const randomCount = consumeAll(bag, I.randomBox);
  if (randomCount > 0n) {
    const rewards = [I.trashBox, I.spiritBox, I.chickenBox, I.petFood, I.territoryDefense, I.territoryAttack];
    const acquired = new Map<Item, bigint>();
    for (let n = 0n; n < randomCount; n++) {
      const reward = rewards[Math.floor(roller(source, trace) * rewards.length)]!;
      add(bag, reward, 1n); acquired.set(reward, (acquired.get(reward) ?? 0n) + 1n);
    }
    openedBoxes.push(I.randomBox.code); results1.push(`${I.randomBox.name} ${randomCount}개 오픈`);
    results2.push("랜덤💝\n" + [...acquired].map(([reward, count]) => `${reward.name} ${count}개`).join("\n") + "\n");
  }

  const medalCount = quantity(bag, I.guildMedal.code);
  if (medalCount > 0n) {
    if (state.guild === null) {
      results1.push(`길드공헌훈장🌟 ${medalCount}개 사용 실패`); results2.push("길드 미가입 또는 데이터 오류\n");
    } else {
      consumeAll(bag, I.guildMedal);
      const guild = state.guild; const mutation = mutationForGuild();
      mutation.contributionDelta += medalCount; mutation.contributionUseCountDelta += 1n; mutation.experienceDelta += medalCount;
      add(bag, I.petFood, medalCount * 5n); add(bag, I.miniPetTicket, medalCount * 3n); add(bag, I.shopOpen, medalCount * 2n);
      const oldLevel = guild.level; let level = oldLevel; const experience = guild.experience + mutation.experienceDelta;
      while (GUILD_LEVELS[level] !== undefined && experience >= GUILD_LEVELS[level]!.need) {
        const reward = GUILD_LEVELS[level]!.reward;
        mutation.maxMembersDelta += reward.maxMembers ?? 0;
        addResource(mutation.resourceDeltas, "point", reward.fund ?? 0n);
        addResource(mutation.warehouseDeltas, I.petSkillBook.code, reward.petSkillBook ?? 0n);
        addResource(mutation.warehouseDeltas, I.guildPetEnhance.code, reward.pet ?? 0n);
        mutation.memberPetFoodDelta += reward.petFoodAll ?? 0n;
        if ((reward.petFoodAll ?? 0n) > 0n) add(bag, I.petFood, reward.petFoodAll!);
        level++;
      }
      mutation.levelAfter = level;
      results1.push(`길드공헌훈장🌟 ${medalCount}개 사용`);
      results2.push(`[${guild.displayName}(${guild.mark})] 공헌 완료\n공헌도 +${comma(medalCount)}\n펫먹이🍼 +${comma(medalCount * 5n)}\n미니펫뽑기🐹 +${comma(medalCount * 3n)}\n펫홈샵🖼️ +${comma(medalCount * 2n)}\n`);
      if (level > oldLevel) results2.push(`🎉 길드 레벨업!\nLv.${oldLevel} → ${level}\n`);
    }
  }

  const guildPackageCount = quantity(bag, I.guildPackage.code);
  if (guildPackageCount > 0n) {
    if (state.guild === null) {
      results1.push(`길드창고패키지🧳 ${guildPackageCount}개 오픈 실패`); results2.push("길드 미가입 또는 길드 데이터 오류로 오픈하지 못했습니다.\n");
    } else {
      consumeAll(bag, I.guildPackage);
      const guild = state.guild; const mutation = mutationForGuild();
      const fund = 50000000n * guildPackageCount, books = guildPackageCount, pendants = guildPackageCount;
      const pet = 15n * guildPackageCount, miniPet = 5n * guildPackageCount;
      addResource(mutation.resourceDeltas, "point", fund); addResource(mutation.warehouseDeltas, I.petSkillBook.code, books);
      addResource(mutation.warehouseDeltas, I.guildPendant.code, pendants); addResource(mutation.warehouseDeltas, I.guildPetEnhance.code, pet);
      addResource(mutation.warehouseDeltas, I.guildMiniPetEnhance.code, miniPet);
      results1.push(`길드창고패키지🧳 ${guildPackageCount}개 오픈`);
      results2.push(`[${guild.displayName}(${guild.mark})] 길드창고 지급\n🅟 +${comma(fund)}\n📙 +${comma(books)}\n📿 +${comma(pendants)}\n⭐️ +${comma(pet)}\n💫 +${comma(miniPet)}\n`);
    }
  }

  const fixed: readonly [Item, bigint, string][] = [[I.miniBox, 250000n, "🎁"], [I.giftBox, 500000n, "🎁"], [I.paradiseBox, 1000000n, "👹"], [I.abyssBox, 1000000n, "👹"]];
  for (const [box, multiplier, emoji] of fixed) {
    const count = consumeAll(bag, box); if (count <= 0n) continue;
    let total = 0n; const messages: string[] = [];
    for (let n = 0n; n < count; n++) { const reward = rollInt(source, trace, 1, 8) * multiplier; total += reward; messages.push(`${n + 1n}. ${emoji} ${comma(reward)}`); }
    pointDelta += total; openedBoxes.push(box.code); results1.push(`${box.name} ${count}개 오픈`);
    results2.push(`${emoji}\n${messages.join("\n")}\n`); results3.push(`${emoji} 오픈 획득 포인트: 🅟${comma(total)}획득${emoji}`);
  }

  const foodBoxCount = consumeAll(bag, I.petFoodBox);
  if (foodBoxCount > 0n) {
    let total = 0n, c50 = 0n, c100 = 0n, c250 = 0n, c500 = 0n;
    for (let n = 0n; n < foodBoxCount; n++) {
      const r = roller(source, trace) * 100; const count = r < .05 ? 500n : r < .35 ? 250n : r < 1.85 ? 100n : 50n;
      total += count; if (count === 50n) c50++; else if (count === 100n) c100++; else if (count === 250n) c250++; else c500++;
    }
    add(bag, I.petFood, total); openedBoxes.push(I.petFoodBox.code); results1.push(`펫먹이상자📦 ${foodBoxCount}개 오픈`);
    const lines = [`펫먹이🍼 +${total}개`]; if (c50) lines.push(`50개  x ${c50}`); if (c100) lines.push(`100개 x ${c100}`); if (c250) lines.push(`250개 x ${c250}`); if (c500) lines.push(`500개 x ${c500}`);
    results2.push(lines.join("\n") + "\n");
  }

  const specialCount = consumeAll(bag, I.specialFood);
  if (specialCount > 0n) {
    let trashBoxes = 0n, foodBoxes = 0n, food = 0n;
    for (let n = 0n; n < specialCount; n++) {
      const r = roller(source, trace) * 100;
      if (r < 68.6) trashBoxes++; else if (r < 83.6) foodBoxes++; else if (r < 88.6) food += 3n; else if (r < 95.6) food += 100n; else if (r < 98.6) food += 150n; else if (r < 99.6) food += 200n; else if (r < 99.9) food += 250n; else if (r < 99.97) food += 500n; else food += 700n;
    }
    add(bag, I.trashBox, trashBoxes); add(bag, I.petFoodBox, foodBoxes); add(bag, I.petFood, food * 2n);
    openedBoxes.push(I.specialFood.code); results1.push(`펫먹이특식🥡 ${specialCount}개 오픈`);
    const lines: string[] = []; if (trashBoxes) lines.push(`잡템상자☠ x ${trashBoxes}`); if (foodBoxes) lines.push(`펫먹이상자📦 x ${foodBoxes}`); if (food) { lines.push(`펫먹이🍼 x ${food}`); lines.push(`펫먹이🍼 +${food}개`); }
    results2.push(lines.join("\n") + "\n");
  }

  type Explore = { command: string; box: Item; roll: () => readonly [Item, bigint][] };
  const explore: Explore[] = [
    { command: "/정령박스오픈", box: I.spiritDungeon, roll: () => [[I.spiritStone, 100n]] },
    { command: "/강화박스오픈", box: I.enhanceDungeon, roll: () => [[I.petEnhanceStone, rollInt(source, trace, 70, 100)]] },
    { command: "/이벤박스오픈", box: I.eventDungeon, roll: () => [[I.shopOpen, 100n], [I.dungeonTicket, 1n]] },
    { command: "/펫먹이박스오픈", box: I.petFoodDungeon, roll: () => [[I.petFood, rollInt(source, trace, 40, 50)]] },
    { command: "/전도르박스오픈", box: I.jeondorDungeon, roll: () => [[I.legendaryStone, 1n]] },
    { command: "/양계장박스오픈", box: I.chickenDungeon, roll: () => [[I.chickenBox, 10n]] },
    { command: "/행운의박스오픈", box: I.luckyDungeon, roll: () => [[I.luckyBox, 5n]] },
    { command: "/땅문서박스오픈", box: I.landDungeon, roll: () => [[I.landDocument, 1n]] },
    { command: "/샵오픈박스오픈", box: I.shopDungeon, roll: () => [[I.shopOpen, 70n]] },
    { command: "/다이아박스오픈", box: I.diamondDungeon, roll: () => [[I.diamondBox, 1n]] },
    { command: "/레이드박스오픈", box: I.raidDungeon, roll: () => { const r = roller(source, trace) * 100; return r < 80 ? [[I.petFood, 350n]] : r < 90 ? [[I.landDocument, 2n]] : r < 94 ? [[I.weeklyBox, 1n]] : r < 97 ? [[I.miniEnhancePackage, 1n]] : r < 99 ? [[I.miniPetTicket, 2000n]] : [[I.petSkillBook, 1n]]; } },
    { command: "/펜던트미궁박스오픈", box: I.pendantDungeon, roll: () => { const rewards: [Item, bigint][] = [[I.pendantEnhance, rollInt(source, trace, 3, 4)]]; if (roller(source, trace) < .01) rewards.push([I.pendantRestore, 1n]); return rewards; } },
    { command: "/대마법박스오픈", box: I.archmageDungeon, roll: () => { const rewards: [Item, bigint][] = [[I.petSkillFragment, rollInt(source, trace, 3, 5)]]; if (roller(source, trace) < .01) rewards.push([I.petSkillBook, 1n]); return rewards; } }
  ];
  const exploreLogs: string[] = [];
  for (const spec of explore) {
    const count = consumeAll(bag, spec.box); if (count <= 0n) continue;
    const aggregate = new Map<Item, bigint>();
    for (let n = 0n; n < count; n++) for (const [reward, amount] of spec.roll()) aggregate.set(reward, (aggregate.get(reward) ?? 0n) + amount);
    for (const [reward, amount] of aggregate) add(bag, reward, amount);
    openedBoxes.push(spec.box.code);
    exploreLogs.push(`${spec.command} (${spec.box.name}) x${count}\n${[...aggregate].map(([reward, amount]) => `- ${reward.name} x${comma(amount)}`).join("\n")}`);
  }
  if (exploreLogs.length) { results1.push("⛰️펫탐험 박스 전체 오픈"); results2.push(exploreLogs.join("\n\n")); }

  const reply = `[${state.rankLabel}]님의 전체 오픈!!!\n\n` + (results1.length
    ? `${results1.join("\n")}\n${"\u200b".repeat(500)}\n${results3.join("\n")}\n종합 획득 포인트 : 🅟${comma(pointDelta)}\n\n${results2.join("\n")}`
    : "오픈할 상자가 없습니다.");
  return { reply: reply.trim(), pointDelta, quantities: bag, deltas: delta(before, bag), randomTrace: trace, openedBoxes,
    deferredGuildItems: [], guildMutation };
}
