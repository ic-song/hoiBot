INSERT INTO item_definitions
  (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('legacy-territory-surprise-attack-ticket', '영지기습공격권🔥(40%)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '영지기습공격권🔥(40%)'), TRUE, 1),
  ('legacy-territory-absolute-defense-ticket', '영지절대방어권🛡(50%)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '영지절대방어권🛡(50%)'), TRUE, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), asset_type_code = VALUES(asset_type_code),
  stackable = VALUES(stackable), metadata_json = VALUES(metadata_json), active = VALUES(active);

INSERT INTO admin_permissions(code, display_name)
VALUES ('territory.protection.grant', '영지 공방권 지급')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT id, 'territory.protection.grant' FROM admin_roles WHERE code = 'super_admin'
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
