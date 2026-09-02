export interface PetDefinitionCatalogRow {
  petId: string;
  baseCharm: bigint;
  charmPerEnhancement: bigint;
  active: boolean;
}

export interface OwnedPetCatalogRow {
  ownedPetId: string;
  petId: string;
  enhancementLevel: bigint;
}

export interface EquipmentDefinitionCatalogRow {
  equipmentId: string;
  baseCharm: bigint;
  charmPerEnhancement: bigint;
  active: boolean;
}

export interface OwnedEquipmentCatalogRow {
  ownedEquipmentId: string;
  equipmentId: string;
  enhancementLevel: bigint;
  durability: bigint | null;
}

export interface OwnedPetEquipmentCatalogRow {
  ownedPetId: string;
  ownedEquipmentId: string;
  slotName: string;
}

export interface PetEquipmentCharmResult {
  petCharm: bigint;
  equipmentCharm: bigint;
  totalCharm: bigint;
}

function nonNegative(value: bigint, field: string): void {
  if (value < 0n) throw new Error(`PET_EQUIPMENT_${field}_NEGATIVE`);
}

// 정의 수치와 사용자 상태만으로 펫·장비 최종 매력을 계산하며 계산 결과는 저장하지 않습니다.
export function calculatePetEquipmentCharm(
  pet: OwnedPetCatalogRow,
  petDefinition: PetDefinitionCatalogRow,
  equipment: readonly OwnedEquipmentCatalogRow[],
  equipmentDefinitions: readonly EquipmentDefinitionCatalogRow[],
  assignments: readonly OwnedPetEquipmentCatalogRow[],
): PetEquipmentCharmResult {
  if (pet.petId !== petDefinition.petId) throw new Error("PET_EQUIPMENT_PET_DEFINITION_MISMATCH");
  if (!petDefinition.active) throw new Error("PET_EQUIPMENT_PET_INACTIVE");
  nonNegative(pet.enhancementLevel, "PET_ENHANCEMENT");
  nonNegative(petDefinition.baseCharm, "PET_BASE_CHARM");
  nonNegative(petDefinition.charmPerEnhancement, "PET_CHARM_PER_ENHANCEMENT");
  const petCharm = petDefinition.baseCharm + pet.enhancementLevel * petDefinition.charmPerEnhancement;
  const assignedIds = new Set<string>();
  let equipmentCharm = 0n;
  for (const assignment of assignments) {
    if (assignment.ownedPetId !== pet.ownedPetId) continue;
    if (assignment.slotName.trim() === "") throw new Error("PET_EQUIPMENT_SLOT_EMPTY");
    if (assignedIds.has(assignment.ownedEquipmentId)) throw new Error("PET_EQUIPMENT_ASSIGNMENT_DUPLICATE");
    assignedIds.add(assignment.ownedEquipmentId);
    const owned = equipment.find((row) => row.ownedEquipmentId === assignment.ownedEquipmentId);
    if (!owned) throw new Error("PET_EQUIPMENT_OWNED_EQUIPMENT_NOT_FOUND");
    const definition = equipmentDefinitions.find((row) => row.equipmentId === owned.equipmentId);
    if (!definition) throw new Error("PET_EQUIPMENT_DEFINITION_NOT_FOUND");
    if (!definition.active) throw new Error("PET_EQUIPMENT_DEFINITION_INACTIVE");
    nonNegative(owned.enhancementLevel, "EQUIPMENT_ENHANCEMENT");
    nonNegative(definition.charmPerEnhancement, "EQUIPMENT_CHARM_PER_ENHANCEMENT");
    nonNegative(definition.baseCharm, "EQUIPMENT_BASE_CHARM");
    equipmentCharm += definition.baseCharm + owned.enhancementLevel * definition.charmPerEnhancement;
  }
  return { petCharm, equipmentCharm, totalCharm: petCharm + equipmentCharm };
}
