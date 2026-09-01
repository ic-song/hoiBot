SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS pet_explore_notice_catalog_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_version VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_revision CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_path VARCHAR(191) NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  configuration_set_id BIGINT UNSIGNED NOT NULL,
  config_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notice_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  utf16_length INT UNSIGNED NOT NULL,
  utf8_bytes INT UNSIGNED NOT NULL,
  line_count INT UNSIGNED NOT NULL,
  mutation_scope VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  binding_mode VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  publication_status ENUM('SHADOW','PUBLISHED','RETIRED') NOT NULL DEFAULT 'SHADOW',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pet_explore_notice_catalog_version (catalog_version),
  UNIQUE KEY uq_pet_explore_notice_config_binding (configuration_set_id,config_key),
  CONSTRAINT fk_pet_explore_notice_configuration_set FOREIGN KEY (configuration_set_id) REFERENCES configuration_sets(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_notice_lengths CHECK (utf16_length=66 AND utf8_bytes=108 AND line_count=3),
  CONSTRAINT chk_pet_explore_notice_binding CHECK (config_key='notice.pet_explore' AND mutation_scope='operation.notice.mutate' AND binding_mode='EXISTING_PROVIDER_DEPENDENCY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @pet_explore_notice_set_id_430=(SELECT active_configuration_set_id FROM operation_notice_heads WHERE set_code='operation_notices' LIMIT 1);
INSERT INTO configuration_values(configuration_set_id,config_key,value_type,string_value,validation_json)
SELECT @pet_explore_notice_set_id_430,'notice.pet_explore','string','[🎇이벤트 진행중🎇]
👾 길드레이드던전 이벤트 안내
https://hoiland123.tistory.com/679',JSON_OBJECT('domain','pet_explore','catalogVersion','ASSET-FREEZE-v2.438-pet-explore-notice-01','sha256','502c02bb0a67cee3b81a29ea939f069ef5b7e2527f5c7a925ec9461917fbfeb0','maxLength',1000)
WHERE @pet_explore_notice_set_id_430 IS NOT NULL
ON DUPLICATE KEY UPDATE config_key=VALUES(config_key);

INSERT INTO pet_explore_notice_catalog_versions(catalog_version,source_revision,source_path,source_sha256,configuration_set_id,config_key,notice_sha256,utf16_length,utf8_bytes,line_count,mutation_scope,binding_mode,publication_status,active)
SELECT 'ASSET-FREEZE-v2.438-pet-explore-notice-01','5925b83b1dbfb78ef583354604e112b9430003f3','data/petExploreData.json','5fd232c3840eb2a6b9628e703f505a9a1f98becd265c70b0914d524a3e4ba7f7',@pet_explore_notice_set_id_430,'notice.pet_explore','502c02bb0a67cee3b81a29ea939f069ef5b7e2527f5c7a925ec9461917fbfeb0',66,108,3,'operation.notice.mutate','EXISTING_PROVIDER_DEPENDENCY','SHADOW',TRUE
FROM configuration_values value_row
WHERE value_row.configuration_set_id=@pet_explore_notice_set_id_430 AND value_row.config_key='notice.pet_explore' AND value_row.value_type='string' AND BINARY value_row.string_value=BINARY '[🎇이벤트 진행중🎇]
👾 길드레이드던전 이벤트 안내
https://hoiland123.tistory.com/679'
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

SET @pet_explore_notice_catalog_id_430=(SELECT id FROM pet_explore_notice_catalog_versions WHERE catalog_version='ASSET-FREEZE-v2.438-pet-explore-notice-01' LIMIT 1);
UPDATE pet_explore_notice_catalog_versions SET active=(id=@pet_explore_notice_catalog_id_430) WHERE active=TRUE OR id=@pet_explore_notice_catalog_id_430;
COMMIT;
