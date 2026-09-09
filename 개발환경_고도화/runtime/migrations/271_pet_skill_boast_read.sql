START TRANSACTION;

CREATE TABLE pet_skill_boast_phrases (
  phrase_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_order INT UNSIGNED NOT NULL,
  template_text VARCHAR(500) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (phrase_code),
  UNIQUE KEY uq_pet_skill_boast_order (display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO skill_definitions(code,display_name,rules_json,active)
VALUES('SKILL-ROLEX','롤렉스',JSON_OBJECT('source','legacy-pet-skill','effect','boast'),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),rules_json=VALUES(rules_json),active=VALUES(active);

INSERT INTO pet_skill_boast_phrases(phrase_code,display_order,template_text,active) VALUES
('BOAST-01',1,'{rank} {name}님의 롤렉스가 시간을 지배합니다.',TRUE),
('BOAST-02',2,'{name}님의 롤렉스는 {rank}의 품격을 보여줍니다.',TRUE),
('BOAST-03',3,'모두 주목하세요. {rank} {name}님의 롤렉스입니다.',TRUE),
('BOAST-04',4,'{name}님이 롤렉스로 {rank}의 존재감을 증명했습니다.',TRUE),
('BOAST-05',5,'시간도 {rank} {name}님 앞에서는 잠시 멈춥니다.',TRUE),
('BOAST-06',6,'{name}님의 롤렉스가 오늘도 가장 빛납니다.',TRUE),
('BOAST-07',7,'{rank}의 선택, {name}님의 롤렉스를 확인하세요.',TRUE),
('BOAST-08',8,'{name}님이 롤렉스와 함께 {rank}의 길을 걷습니다.',TRUE),
('BOAST-09',9,'롤렉스가 알려줍니다. 지금은 {name}님의 시간입니다.',TRUE),
('BOAST-10',10,'{rank} {name}님의 롤렉스는 설명이 필요 없습니다.',TRUE),
('BOAST-11',11,'{name}님의 롤렉스가 서버의 시선을 모았습니다.',TRUE),
('BOAST-12',12,'오늘의 주인공은 롤렉스를 장착한 {rank} {name}님입니다.',TRUE),
('BOAST-13',13,'{name}님의 롤렉스가 {rank}의 자부심을 완성합니다.',TRUE),
('BOAST-14',14,'이 순간은 {rank} {name}님의 롤렉스가 기록합니다.',TRUE)
ON DUPLICATE KEY UPDATE display_order=VALUES(display_order),template_text=VALUES(template_text),active=VALUES(active);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('PET_SKILL_BOAST_READ','pet_skill_boast_read','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/자랑','PET_SKILL_BOAST_READ',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
