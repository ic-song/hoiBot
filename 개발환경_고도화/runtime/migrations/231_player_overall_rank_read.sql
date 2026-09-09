START TRANSACTION;

CREATE TABLE player_overall_charm_skill_rules (
  rule_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  raid_charm BIGINT UNSIGNED NOT NULL DEFAULT 0,
  castle_charm BIGINT UNSIGNED NOT NULL DEFAULT 0,
  condition_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  condition_threshold BIGINT UNSIGNED NOT NULL DEFAULT 0,
  home_charm_percent DECIMAL(6,3) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(rule_code),
  UNIQUE KEY uq_overall_charm_skill_display(display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE guild_overall_charm_cube_options (
  guild_id BIGINT UNSIGNED NOT NULL,
  castle_units BIGINT UNSIGNED NOT NULL DEFAULT 0,
  raid_units BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(guild_id),
  CONSTRAINT fk_overall_charm_cube_guild FOREIGN KEY(guild_id) REFERENCES guilds(id) ON DELETE RESTRICT,
  CONSTRAINT ck_overall_charm_castle_units CHECK(castle_units<=500),
  CONSTRAINT ck_overall_charm_raid_units CHECK(raid_units<=500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO player_overall_charm_skill_rules(rule_code,display_name,raid_charm,castle_charm,condition_code,condition_threshold,home_charm_percent,active) VALUES
('overall-blue-dragon-blade','청룡언월도',1000000,1000000,NULL,0,0,TRUE),
('overall-elite-doctor','엘리트 박사',1500000,1500000,'ELITE_MINI_PET',1,0,TRUE),
('overall-odin-hammer','오딘의 뿅망치',2000000,2000000,NULL,0,0,TRUE),
('overall-rose-knife','장미칼',500000,500000,NULL,0,0,TRUE),
('overall-excalibur','엑스칼리버',1000000,1000000,NULL,0,0,TRUE),
('overall-death-scythe','사신의 낫',500000,500000,NULL,0,0,TRUE),
('overall-arcana-house','아르카나 하우스',500000,500000,'ARCANA_FURNITURE',5,0,TRUE),
('overall-cupid-bow','큐피드의 활',250000,250000,NULL,0,0,TRUE),
('overall-goblin-club','도깨비 방망이',100000,100000,NULL,0,0,TRUE),
('overall-old-wood-sword','낡은 목검',50000,50000,NULL,0,0,TRUE),
('overall-creation-forest','창조림',500000,500000,'CREATION_MINI_PET',1,0,TRUE),
('overall-royal-house','로열 하우스',150000,150000,'ROYAL_PLACED_FURNITURE',10,0,TRUE),
('overall-interior-master','인테리어 장인',0,0,NULL,0,10,TRUE),
('overall-tier-emperor','🪽 엠퍼러의 천공 날개',100000,100000,NULL,0,0,TRUE),
('overall-tier-almighty','🪬 올마이티의 전능 부적',150000,150000,NULL,0,0,TRUE),
('overall-tier-white-heart','🤍 하얀하트의 순백 반지',200000,200000,NULL,0,0,TRUE),
('overall-tier-sky-heart','🩵 하늘하트의 창공 목걸이',300000,300000,NULL,0,0,TRUE),
('overall-tier-yellow-heart','💛 노랑하트의 황금 팔찌',400000,400000,NULL,0,0,TRUE),
('overall-tier-purple-heart','💜 보라하트의 환상 보주',500000,500000,NULL,0,0,TRUE),
('overall-tier-red-heart','❤️ 빨강하트의 맹세검',650000,650000,NULL,0,0,TRUE),
('overall-tier-black-heart','🖤 블랙하트의 칠흑 대낫',800000,800000,NULL,0,0,TRUE),
('overall-tier-sparkle-heart','💖 반짝하트의 별빛 왕관',1000000,1000000,NULL,0,0,TRUE),
('overall-tier-passion-heart','❤️‍🔥 열정하트의 화염 건틀릿',1250000,1250000,NULL,0,0,TRUE),
('overall-tier-arrow-heart','💘 화살하트의 운명 활',1500000,1500000,NULL,0,0,TRUE),
('overall-tier-beating-heart','💗 두근하트의 설렘 마법봉',1800000,1800000,NULL,0,0,TRUE),
('overall-tier-guard-heart','❤️‍🩹 심장하트의 수호 방패',2200000,2200000,NULL,0,0,TRUE),
('overall-tier-violet-heart','💟 보라보라하트의 자수정 귀걸이',2600000,2600000,NULL,0,0,TRUE),
('overall-tier-hand-heart','🫶 손하트의 인연 반지',3000000,3000000,NULL,0,0,TRUE),
('overall-tier-spade','♠️ 스페이드의 사신 흑창',3500000,3500000,NULL,0,0,TRUE),
('overall-tier-heart','♥️ 하트의 생명 목걸이',4000000,4000000,NULL,0,0,TRUE),
('overall-tier-diamond','♦️ 다이아몬드의 불멸검',4600000,4600000,NULL,0,0,TRUE),
('overall-tier-clover','♣️ 클로바의 행운 지팡이',5200000,5200000,NULL,0,0,TRUE),
('overall-tier-full-house','🃏 풀하우스의 승부 카드',6000000,6000000,NULL,0,0,TRUE),
('overall-tier-bear','🧸 곰찌의 수호 인형',7000000,7000000,NULL,0,0,TRUE),
('overall-tier-beginner','🌱 초심의 모험가 단검',8000000,8000000,NULL,0,0,TRUE),
('overall-tier-cherry','🌸 벚꽃의 천화앵검',9000000,9000000,NULL,0,0,TRUE),
('overall-tier-happy-king','🎲 해피왕의 운명 주사위',10000000,10000000,NULL,0,0,TRUE),
('overall-tier-demon-king','😈 마왕의 멸망검',12000000,12000000,NULL,0,0,TRUE),
('overall-tier-pegasus','🦄 페가수스의 성운 신창',14000000,14000000,NULL,0,0,TRUE),
('overall-tier-ghost-king','👻 유령왕의 망령낫',16000000,16000000,NULL,0,0,TRUE),
('overall-tier-dog-king','🐶 왕왕왕의 수호왕 갑주',18000000,18000000,NULL,0,0,TRUE),
('overall-tier-dragon','🐉 용용용의 용신 여의주',21000000,21000000,NULL,0,0,TRUE),
('overall-tier-phoenix','🐦‍🔥 피닉스의 불멸 성검',25000000,25000000,NULL,0,0,TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),raid_charm=VALUES(raid_charm),castle_charm=VALUES(castle_charm),condition_code=VALUES(condition_code),condition_threshold=VALUES(condition_threshold),home_charm_percent=VALUES(home_charm_percent),active=TRUE;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PLAYER_OVERALL_RANK_READ','player_overall_rank_read','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
('/종합순위','PLAYER_OVERALL_RANK_READ',TRUE),('ㅈㅈㅈ','PLAYER_OVERALL_RANK_READ',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
