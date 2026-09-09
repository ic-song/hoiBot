START TRANSACTION;

CREATE TABLE tier_definition_versions(
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
 version_code VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_ref VARCHAR(255) NOT NULL,
 source_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 definition_count SMALLINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 published_at DATETIME(3) NULL,
 retired_at DATETIME(3) NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_tier_definition_version_code(version_code),
 CONSTRAINT chk_tier_definition_version_status CHECK(status IN('DRAFT','PUBLISHED','RETIRED')),
 CONSTRAINT chk_tier_definition_version_count CHECK(definition_count>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tier_definitions(
 version_id BIGINT UNSIGNED NOT NULL,
 tier_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 display_name VARCHAR(64) NOT NULL,
 tier_order SMALLINT UNSIGNED NOT NULL,
 regular_ticket_threshold BIGINT UNSIGNED NOT NULL,
 advanced_ticket_threshold BIGINT UNSIGNED NOT NULL,
 rank_emoji VARCHAR(32) NOT NULL,
 pet_experience_delta BIGINT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(version_id,tier_code),
 UNIQUE KEY uq_tier_definition_version_name(version_id,display_name),
 UNIQUE KEY uq_tier_definition_version_order(version_id,tier_order),
 CONSTRAINT fk_tier_definition_version FOREIGN KEY(version_id) REFERENCES tier_definition_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tier_definition_publications(
 publication_key VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version_id BIGINT UNSIGNED NOT NULL,
 published_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
 PRIMARY KEY(publication_key),
 UNIQUE KEY uq_tier_definition_publication_version(version_id),
 CONSTRAINT fk_tier_definition_publication_version FOREIGN KEY(version_id) REFERENCES tier_definition_versions(id) ON DELETE RESTRICT,
 CONSTRAINT chk_tier_definition_publication_key CHECK(publication_key='ACTIVE')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tier_definition_versions(version_code,source_ref,source_fingerprint,status,definition_count,published_at)
VALUES('TIER-MAIN-v2.435-20260831','main.js:213-583',SHA2('TIER-MAIN-v2.435-20260831:ticketTierData:41',256),'PUBLISHED',41,UTC_TIMESTAMP(3));

SET @tier_version_id=(SELECT id FROM tier_definition_versions WHERE version_code='TIER-MAIN-v2.435-20260831');

INSERT INTO tier_definitions(version_id,tier_code,display_name,tier_order,regular_ticket_threshold,advanced_ticket_threshold,rank_emoji,pet_experience_delta,active) VALUES
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('새싹',256),16)),'새싹',0,0,0,'🌱',0,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('브론즈',256),16)),'브론즈',1,1,0,'🥉',50,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('실버',256),16)),'실버',2,10,0,'🥈',50,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('골드',256),16)),'골드',3,30,0,'🥇',50,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('플레티넘',256),16)),'플레티넘',4,70,0,'🔰',50,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('에메랄드',256),16)),'에메랄드',5,150,0,'💠',50,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('다이아',256),16)),'다이아',6,300,0,'💎',100,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('마스터',256),16)),'마스터',7,700,0,'🔮',300,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('그랜드마스터',256),16)),'그랜드마스터',8,1200,0,'⚜️',900,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('챌린저',256),16)),'챌린저',9,2500,0,'🏆',1500,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('킹',256),16)),'킹',10,6000,50,'👑',3000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('엠퍼러',256),16)),'엠퍼러',11,11000,100,'🪽',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('올마이티',256),16)),'올마이티',12,15000,200,'🪬',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('하얀하트',256),16)),'하얀하트',13,20000,300,'🤍',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('하늘하트',256),16)),'하늘하트',14,25000,400,'🩵',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('노랑하트',256),16)),'노랑하트',15,30000,500,'💛',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('보라하트',256),16)),'보라하트',16,35000,600,'💜',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('빨강하트',256),16)),'빨강하트',17,40000,750,'❤️',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('블랙하트',256),16)),'블랙하트',18,45000,850,'🖤',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('반짝하트',256),16)),'반짝하트',19,50000,950,'💖',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('열정하트',256),16)),'열정하트',20,60000,1050,'❤️‍🔥',10000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('화살하트',256),16)),'화살하트',21,75000,1170,'💘',20000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('두근하트',256),16)),'두근하트',22,85000,1270,'💗',20000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('심장하트',256),16)),'심장하트',23,95000,1370,'❤️‍🩹',20000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('보라보라하트',256),16)),'보라보라하트',24,110000,1470,'💟',21000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('손하트',256),16)),'손하트',25,130000,1570,'🫶',22000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('스페이드',256),16)),'스페이드',26,150000,1680,'♠️',23000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('하트',256),16)),'하트',27,170000,1780,'♥️',24000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('다이아몬드',256),16)),'다이아몬드',28,200000,1890,'♦️',25000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('클로바',256),16)),'클로바',29,230000,1990,'♣️',250000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('풀하우스',256),16)),'풀하우스',30,260000,2190,'🃏',250000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('곰찌',256),16)),'곰찌',31,300000,2390,'🧸',250000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('초심',256),16)),'초심',32,350000,2550,'🌱',500000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('벛꽃',256),16)),'벛꽃',33,400000,2750,'🌸',500000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('해피왕',256),16)),'해피왕',34,500000,3000,'🎲',500000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('마왕',256),16)),'마왕',35,600000,3250,'😈',750000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('페가수스',256),16)),'페가수스',36,700000,3600,'🦄',750000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('유령왕',256),16)),'유령왕',37,800000,4000,'👻',750000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('왕왕왕',256),16)),'왕왕왕',38,900000,4400,'🐶',750000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('용용용',256),16)),'용용용',39,1000000,4800,'🐉',750000,TRUE),
(@tier_version_id,CONCAT('tier_',LEFT(SHA2('피닉스',256),16)),'피닉스',40,2000000,5500,'🐦‍🔥',1000000,TRUE);

INSERT INTO tier_definition_publications(publication_key,version_id)
VALUES('ACTIVE',@tier_version_id);

COMMIT;
