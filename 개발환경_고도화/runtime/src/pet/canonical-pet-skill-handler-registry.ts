export type CanonicalPetSkillHandlerKey = "passive_modifier" | "command_unlock" | "presentation_only";

export type PassiveModifierOptions = {
  raidCharm?: number;
  castleCharm?: number;
  chancePercent?: number;
  countBonus?: number;
  pointAmount?: number;
  slotBonus?: number;
  heartBonus?: number;
};

export type CommandUnlockOptions = {
  commandIdentifier: CanonicalPetSkillCommandIdentifier;
  chancePercent?: number;
  quantity?: number;
};

export type CanonicalPetSkillCommandIdentifier = "pet_skill_boast" | "pet_skill_duel" | "pet_skill_prayer" | "attendance_first";

// 현행 main.js에서 실제 펫스킬 보유를 확인하는 명령만 의미 식별자로 등록합니다.
export const CANONICAL_PET_SKILL_COMMAND_REGISTRY: Readonly<Record<CanonicalPetSkillCommandIdentifier, { trigger: string }>> = {
  pet_skill_boast: { trigger: "/자랑" },
  pet_skill_duel: { trigger: "/결투" },
  pet_skill_prayer: { trigger: "/기도" },
  attendance_first: { trigger: "ㅊㅊ" },
};

export function resolveCanonicalPetSkillCommand(commandIdentifier: string): { trigger: string } {
  const command = CANONICAL_PET_SKILL_COMMAND_REGISTRY[commandIdentifier as CanonicalPetSkillCommandIdentifier];
  if (command === undefined) throw new Error("CANONICAL_PET_SKILL_COMMAND_NOT_ALLOWED");
  return command;
}

export type CanonicalPetSkillOptions = PassiveModifierOptions | CommandUnlockOptions | Record<string, never>;

export interface CanonicalPetSkillHandlerDescriptor {
  key: CanonicalPetSkillHandlerKey;
  validate: (options: unknown) => CanonicalPetSkillOptions;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("CANONICAL_PET_SKILL_OPTIONS_INVALID");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("CANONICAL_PET_SKILL_OPTION_KEY_NOT_ALLOWED");
}

function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > Number.MAX_SAFE_INTEGER) throw new Error("CANONICAL_PET_SKILL_OPTION_NUMBER_INVALID");
  return candidate;
}

function passive(options: unknown): PassiveModifierOptions {
  const value = record(options);
  const keys = ["raidCharm", "castleCharm", "chancePercent", "countBonus", "pointAmount", "slotBonus", "heartBonus"] as const;
  exactKeys(value, keys);
  const result: PassiveModifierOptions = {};
  for (const key of keys) {
    const normalized = optionalNumber(value, key);
    if (normalized !== undefined) result[key] = normalized;
  }
  if (Object.keys(result).length === 0) throw new Error("CANONICAL_PET_SKILL_PASSIVE_OPTIONS_REQUIRED");
  if (result.chancePercent !== undefined && result.chancePercent > 100) throw new Error("CANONICAL_PET_SKILL_CHANCE_INVALID");
  return result;
}

function command(options: unknown): CommandUnlockOptions {
  const value = record(options);
  exactKeys(value, ["commandIdentifier", "chancePercent", "quantity"]);
  if (typeof value.commandIdentifier !== "string") throw new Error("CANONICAL_PET_SKILL_COMMAND_NOT_ALLOWED");
  resolveCanonicalPetSkillCommand(value.commandIdentifier);
  const result: CommandUnlockOptions = { commandIdentifier: value.commandIdentifier as CanonicalPetSkillCommandIdentifier };
  const chancePercent = optionalNumber(value, "chancePercent");
  const quantity = optionalNumber(value, "quantity");
  if (chancePercent !== undefined) {
    if (chancePercent > 100) throw new Error("CANONICAL_PET_SKILL_CHANCE_INVALID");
    result.chancePercent = chancePercent;
  }
  if (quantity !== undefined) result.quantity = quantity;
  return result;
}

function presentation(options: unknown): Record<string, never> {
  const value = record(options);
  exactKeys(value, []);
  return {};
}

// DB의 handler_key는 이 registry의 안전한 처리기만 선택하며 실행 코드나 SQL을 저장하지 않습니다.
export const CANONICAL_PET_SKILL_HANDLER_REGISTRY: Readonly<Record<CanonicalPetSkillHandlerKey, CanonicalPetSkillHandlerDescriptor>> = {
  passive_modifier: { key: "passive_modifier", validate: passive },
  command_unlock: { key: "command_unlock", validate: command },
  presentation_only: { key: "presentation_only", validate: presentation },
};

export function resolveCanonicalPetSkillHandler(handlerKey: string): CanonicalPetSkillHandlerDescriptor {
  const descriptor = CANONICAL_PET_SKILL_HANDLER_REGISTRY[handlerKey as CanonicalPetSkillHandlerKey];
  if (descriptor === undefined) throw new Error("CANONICAL_PET_SKILL_HANDLER_NOT_ALLOWED");
  return descriptor;
}

export function normalizeCanonicalPetSkillOptions(handlerKey: string, options: unknown): CanonicalPetSkillOptions {
  return resolveCanonicalPetSkillHandler(handlerKey).validate(options);
}
