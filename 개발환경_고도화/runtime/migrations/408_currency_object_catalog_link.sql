SET NAMES utf8mb4;
START TRANSACTION;

CREATE TEMPORARY TABLE tmp_m408_currency_identity (
  currency_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_scope VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  definition_version INT UNSIGNED NOT NULL,
  object_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (currency_code),
  UNIQUE KEY uq_tmp_m408_object_key (object_key)
);

INSERT INTO tmp_m408_currency_identity
  (currency_code, owner_scope, definition_version, object_key)
VALUES
  ('point', 'PLAYER', 1, 'currency.player.point.v1'),
  ('diamond', 'PLAYER', 1, 'currency.player.diamond.v1'),
  ('guild_fund', 'GUILD', 1, 'currency.guild.guild_fund.v1');

INSERT INTO object_registry
  (object_key, object_type, display_name, version, active, metadata_json)
SELECT
  identity_row.object_key,
  'CURRENCY',
  definition_row.display_name,
  1,
  definition_row.active,
  JSON_OBJECT(
    'domain', 'currency_definition',
    'currencyCode', identity_row.currency_code,
    'ownerScope', identity_row.owner_scope,
    'definitionVersion', identity_row.definition_version,
    'scaleDigits', definition_row.scale_digits,
    'definitionBinding', CONCAT('RUNTIME_DB|currency_definitions|', identity_row.currency_code),
    'catalogVersion', 'ASSET-FREEZE-v2.400-currency-object-link-01',
    'sourceHash', '09e9be41c9106aa5faf1ad7686aa00f20071e951522a6071a0671a6cc93d8466'
  )
FROM tmp_m408_currency_identity identity_row
JOIN currency_definitions definition_row
  ON definition_row.code = identity_row.currency_code
ORDER BY FIELD(identity_row.currency_code, 'point', 'diamond', 'guild_fund')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  active = VALUES(active),
  metadata_json = VALUES(metadata_json);

INSERT INTO object_source_bindings
  (object_id, object_type, source_system, source_table, source_key)
SELECT
  object_row.id,
  'CURRENCY',
  'RUNTIME_DB',
  'currency_definitions',
  identity_row.currency_code
FROM tmp_m408_currency_identity identity_row
JOIN object_registry object_row
  ON object_row.object_key = identity_row.object_key
 AND object_row.object_type = 'CURRENCY'
ORDER BY FIELD(identity_row.currency_code, 'point', 'diamond', 'guild_fund')
ON DUPLICATE KEY UPDATE
  object_id = VALUES(object_id),
  object_type = VALUES(object_type);

DROP TEMPORARY TABLE tmp_m408_currency_identity;

COMMIT;
