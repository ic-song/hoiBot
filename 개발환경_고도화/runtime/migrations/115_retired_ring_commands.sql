START TRANSACTION;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('RING_UPGRADE_RETIRED','ring_upgrade_retired','VERIFIED_USER','SHADOW',1,1),
  ('RING_NAME_CRAFT_RETIRED','ring_name_craft_retired','VERIFIED_USER','SHADOW',1,1),
  ('RING_NAME_RETIRED','ring_name_retired','VERIFIED_USER','SHADOW',1,1),
  ('RING_ATTRIBUTE_RETIRED','ring_attribute_retired','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/반지강화','RING_UPGRADE_RETIRED',1),
  ('/반지이름조합','RING_NAME_CRAFT_RETIRED',1),
  ('/반지이름','RING_NAME_RETIRED',1),
  ('/반지속성','RING_ATTRIBUTE_RETIRED',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
