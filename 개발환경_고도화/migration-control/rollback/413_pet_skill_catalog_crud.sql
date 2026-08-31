START TRANSACTION;

DELETE FROM configuration_change_log
WHERE configuration_set_id IN (
  SELECT id FROM configuration_sets
  WHERE set_code='asset.pet_skill.catalog'
);

DELETE FROM configuration_sets
WHERE set_code='asset.pet_skill.catalog';

DELETE member
FROM pet_skill_compatibility_members member
JOIN pet_skill_compatibility_groups compatibility_group ON compatibility_group.id=member.group_id
WHERE compatibility_group.code='musou_myth_ghost';

DELETE FROM pet_skill_compatibility_groups
WHERE code='musou_myth_ghost';

COMMIT;
