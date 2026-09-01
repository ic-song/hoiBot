SET NAMES utf8mb4;
START TRANSACTION;
SET @pet_explore_notice_set_id_430=(SELECT configuration_set_id FROM pet_explore_notice_catalog_versions WHERE catalog_version='ASSET-FREEZE-v2.438-pet-explore-notice-01' LIMIT 1);
DELETE FROM pet_explore_notice_catalog_versions WHERE catalog_version='ASSET-FREEZE-v2.438-pet-explore-notice-01';
DELETE FROM configuration_values WHERE configuration_set_id=@pet_explore_notice_set_id_430 AND config_key='notice.pet_explore';
COMMIT;
