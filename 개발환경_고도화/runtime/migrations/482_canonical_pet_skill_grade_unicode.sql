-- Legacy pet-skill grades include Korean values such as 한정; preserve them losslessly.
ALTER TABLE canonical_pet_skill_definitions
  MODIFY COLUMN pet_skill_grade VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
