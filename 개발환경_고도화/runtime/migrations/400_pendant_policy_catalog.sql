SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS pendant_upgrade_policy_versions(
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  policy_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  policy_version INT UNSIGNED NOT NULL,
  publish_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  level_count INT UNSIGNED NOT NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(id),
  UNIQUE KEY uq_pendant_policy_code_version(policy_code,policy_version),
  UNIQUE KEY uq_pendant_policy_source_hash(source_hash),
  CONSTRAINT chk_pendant_policy_publish_state CHECK(publish_state IN ('DRAFT','PUBLISHED','RETIRED')),
  CONSTRAINT chk_pendant_policy_level_count CHECK(level_count=30)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pendant_upgrade_policy_levels(
  policy_id BIGINT UNSIGNED NOT NULL,
  target_level TINYINT UNSIGNED NOT NULL,
  success_rate DECIMAL(8,4) NOT NULL,
  charm_increment BIGINT UNSIGNED NOT NULL,
  explore_increment DECIMAL(8,3) NOT NULL,
  point_cost BIGINT UNSIGNED NOT NULL,
  stone_cost BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(policy_id,target_level),
  CONSTRAINT chk_pendant_policy_target_level CHECK(target_level BETWEEN 1 AND 30),
  CONSTRAINT fk_pendant_policy_level_version FOREIGN KEY(policy_id) REFERENCES pendant_upgrade_policy_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pendant_upgrade_policy_versions(policy_code,policy_version,publish_state,source_hash,level_count,published_at)
VALUES('PENDANT_ENHANCE_LEGACY',1,'PUBLISHED','36216a87775f725b7e5b8bb0b8f0f148c4648e6bcb7b5fb76259c61869d90a18',30,UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE publish_state=VALUES(publish_state),source_hash=VALUES(source_hash),level_count=VALUES(level_count);

SET @pendant_policy_id=(SELECT id FROM pendant_upgrade_policy_versions WHERE policy_code='PENDANT_ENHANCE_LEGACY' AND policy_version=1 LIMIT 1);

INSERT INTO pendant_upgrade_policy_levels(policy_id,target_level,success_rate,charm_increment,explore_increment,point_cost,stone_cost) VALUES
(@pendant_policy_id,1,100,5000,0.1,1000000000,1),
(@pendant_policy_id,2,100,10000,0.2,1000000000,2),
(@pendant_policy_id,3,100,15000,0.3,1000000000,3),
(@pendant_policy_id,4,100,20000,0.4,1000000000,4),
(@pendant_policy_id,5,100,25000,0.5,1000000000,5),
(@pendant_policy_id,6,100,30000,0.6,1000000000,6),
(@pendant_policy_id,7,33,250000,0.7,3000000000,7),
(@pendant_policy_id,8,33,375000,0.8,3000000000,8),
(@pendant_policy_id,9,33,500000,0.9,3000000000,9),
(@pendant_policy_id,10,33,750000,1.0,3000000000,10),
(@pendant_policy_id,11,10,1000000,1.1,10000000000,11),
(@pendant_policy_id,12,10,1250000,1.2,10000000000,12),
(@pendant_policy_id,13,10,1500000,1.3,10000000000,13),
(@pendant_policy_id,14,10,2000000,1.4,10000000000,14),
(@pendant_policy_id,15,5,2500000,1.5,15000000000,15),
(@pendant_policy_id,16,5,3000000,1.6,15000000000,16),
(@pendant_policy_id,17,5,3500000,1.7,15000000000,17),
(@pendant_policy_id,18,5,4000000,1.8,15000000000,18),
(@pendant_policy_id,19,5,4500000,1.9,15000000000,19),
(@pendant_policy_id,20,5,5000000,2.0,15000000000,20),
(@pendant_policy_id,21,3,6000000,2.1,20000000000,21),
(@pendant_policy_id,22,3,7000000,2.2,20000000000,22),
(@pendant_policy_id,23,3,8000000,2.3,20000000000,23),
(@pendant_policy_id,24,2,9000000,2.4,30000000000,24),
(@pendant_policy_id,25,2,10000000,2.5,30000000000,25),
(@pendant_policy_id,26,1,12500000,2.6,100000000000,26),
(@pendant_policy_id,27,1,15000000,2.7,100000000000,27),
(@pendant_policy_id,28,1,17500000,2.8,100000000000,28),
(@pendant_policy_id,29,1,25000000,2.9,100000000000,29),
(@pendant_policy_id,30,1,30000000,3.0,100000000000,30)
ON DUPLICATE KEY UPDATE success_rate=VALUES(success_rate),charm_increment=VALUES(charm_increment),explore_increment=VALUES(explore_increment),point_cost=VALUES(point_cost),stone_cost=VALUES(stone_cost);

COMMIT;
