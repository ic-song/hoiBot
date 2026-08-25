INSERT INTO item_definitions
  (code, display_name, asset_type_code, stackable, metadata_json, active, version)
VALUES
  ('guild_contribution_medal', '길드공헌훈장🌟(/길드공헌 숫자)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '길드공헌훈장🌟(/길드공헌 숫자)'), TRUE, 1),
  ('mini_pet_unbind_ticket', '미니펫귀속해제권🐰(/귀속해제)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '미니펫귀속해제권🐰(/귀속해제)'), TRUE, 1),
  ('legacy_carrot_item', '🥕당근이세요?', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '🥕당근이세요?'), TRUE, 1),
  ('land_document', '땅문서📜', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '땅문서📜'), TRUE, 1),
  ('package_mini_pet_elite_guaranteed', '미니펫🐹엘리트확정패키지(/미니펫엘리트오픈)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '미니펫🐹엘리트확정패키지(/미니펫엘리트오픈)', 'packageCatalogCode', 'package_mini_pet_elite_guaranteed'), TRUE, 1),
  ('hoi_baseball_package', '호이베이스볼⚾️(/투수던집니다)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '호이베이스볼⚾️(/투수던집니다)'), TRUE, 1),
  ('weekly_box', '주간상자🌼', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '주간상자🌼'), TRUE, 1),
  ('hoi_wallet', '호이지갑👛(/지갑털기)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '호이지갑👛(/지갑털기)'), TRUE, 1),
  ('bag_yakitori_package_10', '태초야키토리 10세트🥩(/이랏싸이마쎄)', 'legacy_bag_item', TRUE,
    JSON_OBJECT('legacyName', '태초야키토리 10세트🥩(/이랏싸이마쎄)', 'packageCatalogCode', 'bag_yakitori_package_10'), TRUE, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), asset_type_code = VALUES(asset_type_code), stackable = VALUES(stackable),
  metadata_json = VALUES(metadata_json), active = VALUES(active);

INSERT INTO package_definitions
  (code, display_name, price_currency_code, price_amount, purchase_limit, starts_at, ends_at, active)
VALUES
  ('package_mini_pet_elite_guaranteed', '미니펫🐹엘리트확정패키지', NULL, NULL, NULL, NULL, NULL, FALSE),
  ('bag_yakitori_package_10', '태초야키토리 10세트🥩', NULL, NULL, NULL, NULL, NULL, FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_permissions(code, display_name)
VALUES ('inventory.fixed-item.grant', '고정 아이템 지급')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO admin_role_permissions(role_id, permission_code)
SELECT id, 'inventory.fixed-item.grant' FROM admin_roles WHERE code = 'super_admin'
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);
