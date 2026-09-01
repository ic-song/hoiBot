START TRANSACTION;

INSERT INTO pet_skill_compatibility_groups(code,display_order,active)
VALUES ('musou_myth_ghost',4,TRUE)
ON DUPLICATE KEY UPDATE
  display_order=VALUES(display_order),
  active=TRUE;

INSERT INTO pet_skill_compatibility_members(group_id,skill_id,display_order)
SELECT compatibility_group.id,definition.id,seed_row.member_order
FROM (
  SELECT 'pet_skill_musou_myth' skill_code,1 member_order
  UNION ALL
  SELECT 'pet_skill_musou_ghost',2
) seed_row
JOIN pet_skill_compatibility_groups compatibility_group ON compatibility_group.code='musou_myth_ghost'
JOIN skill_definitions definition ON definition.code=seed_row.skill_code
ON DUPLICATE KEY UPDATE display_order=VALUES(display_order);

INSERT INTO configuration_sets(set_code,version,status,effective_from,effective_to,approved_by)
VALUES ('asset.pet_skill.catalog',1,'active',UTC_TIMESTAMP(3),NULL,NULL);

INSERT INTO configuration_values
  (configuration_set_id,config_key,value_type,string_value,decimal_value,integer_value,boolean_value,json_value,validation_json)
SELECT id,'catalog_version','string','ASSET-FREEZE-v2.435-8f075b4e-02',NULL,NULL,NULL,NULL,
       JSON_OBJECT(
         'validation',JSON_OBJECT('minLength',1,'maxLength',191),
         'source',JSON_OBJECT(
           'file','coverage-manifest.json',
           'path','$.catalogVersion',
           'hash','07d3658624168a11e14d0616f648dd4c039fc7d0991c5be9eef997d2482b0288'
         )
       )
FROM configuration_sets WHERE set_code='asset.pet_skill.catalog' AND version=1;

INSERT INTO configuration_values
  (configuration_set_id,config_key,value_type,string_value,decimal_value,integer_value,boolean_value,json_value,validation_json)
SELECT id,'compatibility_groups','json',NULL,NULL,NULL,NULL,
       JSON_EXTRACT('[
         {"code":"ten_won_salvation","displayOrder":1,"active":true,"members":["pet_skill_ten_won","pet_skill_salvation"]},
         {"code":"hunter_max_level_hunter","displayOrder":2,"active":true,"members":["pet_skill_hunter","pet_skill_max_level_hunter"]},
         {"code":"building_owner_god","displayOrder":3,"active":true,"members":["pet_skill_building_owner","pet_skill_god_building_owner"]},
         {"code":"musou_myth_ghost","displayOrder":4,"active":true,"members":["pet_skill_musou_myth","pet_skill_musou_ghost"]}
       ]','$'),
       JSON_OBJECT(
         'validation',JSON_OBJECT(),
         'source',JSON_OBJECT(
           'file','main.js',
           'path','PET_SKILL_COMPAT_GROUPS',
           'hash','511611a83b964de78e76a9f454e6dbb22a55b5c2d2c42629485b520cca3e3398'
         )
       )
FROM configuration_sets WHERE set_code='asset.pet_skill.catalog' AND version=1;

INSERT INTO configuration_values
  (configuration_set_id,config_key,value_type,string_value,decimal_value,integer_value,boolean_value,json_value,validation_json)
SELECT id,'draw_policy','json',NULL,NULL,NULL,NULL,
       JSON_EXTRACT('{"gradeWeightTotals":{"S":10.5,"A":18.1,"B":20,"C":47.7}}','$'),
       JSON_OBJECT(
         'validation',JSON_OBJECT(),
         'source',JSON_OBJECT(
           'file','main.js',
           'path','PET_SKILL_EQUAL_GRADE_WEIGHT_TOTALS',
           'hash','87e4cb357b2d14ae9f2dbd5a756ff3bc0869ccbca744a2746482d6f31a2fb2a2'
         )
       )
FROM configuration_sets WHERE set_code='asset.pet_skill.catalog' AND version=1;

INSERT INTO configuration_values
  (configuration_set_id,config_key,value_type,string_value,decimal_value,integer_value,boolean_value,json_value,validation_json)
SELECT configuration_set.id,'definitions','json',NULL,NULL,NULL,NULL,
       IF(
         COUNT(*)=93,
         JSON_ARRAYAGG(
           JSON_MERGE_PATCH(
             JSON_EXTRACT(definition.rules_json,'$.catalog'),
             JSON_OBJECT('code',definition.code),
             JSON_EXTRACT(IF(definition.active=TRUE,'{"active":true}','{"active":false}'),'$')
           )
           ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(definition.rules_json,'$.catalog.sourceIndex')) AS UNSIGNED),definition.code
         ),
         NULL
       ),
       JSON_OBJECT(
         'validation',JSON_OBJECT(),
         'source',JSON_OBJECT(
           'file','main.js',
           'path','PET_SKILL_LIST',
           'hash','435a49512498b33295734e7dc864628792a47409b1e818c047d0051b2f15d176'
         )
       )
FROM configuration_sets configuration_set
JOIN skill_definitions definition ON JSON_EXTRACT(definition.rules_json,'$.catalog.sourceKey') IS NOT NULL
WHERE configuration_set.set_code='asset.pet_skill.catalog' AND configuration_set.version=1
GROUP BY configuration_set.id;

INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json)
SELECT id,NULL,'seed',JSON_OBJECT(
  'catalogVersion','ASSET-FREEZE-v2.435-8f075b4e-02',
  'definitionCount',93,
  'compatibilityGroupCount',4,
  'source','WBS611+WBS684+WBS552+WBS556'
)
FROM configuration_sets WHERE set_code='asset.pet_skill.catalog' AND version=1;

COMMIT;
