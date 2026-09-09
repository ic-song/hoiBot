START TRANSACTION;

INSERT INTO item_definitions
  (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('legacy-spirit-name-change-ticket', '정령 이름변경권📝(/정령이름)', 'ITEM', TRUE,
   JSON_OBJECT('source', 'data/itemList.json', 'legacyName', '정령 이름변경권📝(/정령이름)'), TRUE, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), asset_type_code = VALUES(asset_type_code),
  stackable = TRUE, metadata_json = VALUES(metadata_json), active = TRUE;

INSERT INTO command_registry(command_code, handler_key, auth_scope, rollout_state, enabled, version)
VALUES ('SPIRIT_NAME_MUTATE', 'spirit_name_mutate', 'VERIFIED_USER', 'SHADOW', TRUE, 1)
ON DUPLICATE KEY UPDATE
  handler_key = VALUES(handler_key), auth_scope = VALUES(auth_scope), enabled = TRUE, version = VALUES(version);

INSERT INTO command_aliases(command_text, command_code, active)
VALUES ('/정령이름', 'SPIRIT_NAME_MUTATE', TRUE)
ON DUPLICATE KEY UPDATE command_code = VALUES(command_code), active = TRUE;

COMMIT;
