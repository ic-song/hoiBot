import assert from "node:assert/strict";
import test from "node:test";
import { calculatePetEquipmentCharm } from "../src/pet/pet-equipment-catalog.js";

const pet = { ownedPetId: "ownedp01", playerId: "player01", petId: "petdef01", enhancementLevel: 3n };
const petDefinition = { petId: "petdef01", baseCharm: 100n, charmPerEnhancement: 15n, active: true };
const equipment = [{ ownedEquipmentId: "ownede01", playerId: "player01", equipmentId: "equip001", enhancementLevel: 2n, durability: 9n }];
const equipmentDefinitions = [{ equipmentId: "equip001", baseCharm: 50n, charmPerEnhancement: 7n, active: true }];

test("calculates pet and equipment charm from definitions plus owned state only", () => {
  assert.deepEqual(calculatePetEquipmentCharm(pet, petDefinition, equipment, equipmentDefinitions, [{ playerId: "player01", ownedPetId: "ownedp01", ownedEquipmentId: "ownede01", slotName: "pendant" }]), {
    petCharm: 145n, equipmentCharm: 64n, totalCharm: 209n,
  });
});

test("rejects inactive or invalid canonical rows rather than storing a derived value", () => {
  assert.throws(() => calculatePetEquipmentCharm(pet, { ...petDefinition, active: false }, equipment, equipmentDefinitions, []), /PET_INACTIVE/);
  assert.throws(() => calculatePetEquipmentCharm(pet, petDefinition, equipment, equipmentDefinitions, [{ playerId: "player01", ownedPetId: "ownedp01", ownedEquipmentId: "missing01", slotName: "pendant" }]), /OWNED_EQUIPMENT_NOT_FOUND/);
  assert.throws(() => calculatePetEquipmentCharm(pet, petDefinition, equipment, equipmentDefinitions, [{ playerId: "player01", ownedPetId: "ownedp01", ownedEquipmentId: "ownede01", slotName: "pendant" }, { playerId: "player01", ownedPetId: "ownedp01", ownedEquipmentId: "ownede01", slotName: "ring" }]), /ASSIGNMENT_DUPLICATE/);
  assert.throws(() => calculatePetEquipmentCharm(pet, petDefinition, equipment, equipmentDefinitions, [{ playerId: "player02", ownedPetId: "ownedp01", ownedEquipmentId: "ownede01", slotName: "pendant" }]), /ASSIGNMENT_OWNER_MISMATCH/);
});
