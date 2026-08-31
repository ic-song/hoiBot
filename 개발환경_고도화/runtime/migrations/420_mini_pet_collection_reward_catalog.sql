SET NAMES utf8mb4;
START TRANSACTION;

CREATE TABLE IF NOT EXISTS mini_pet_collection_reward_catalogs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalog_version VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_system VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_path VARCHAR(191) NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_reward_count INT UNSIGNED NOT NULL,
  stage_reward_count INT UNSIGNED NOT NULL,
  title_definition_count INT UNSIGNED NOT NULL,
  reward_item_id BIGINT UNSIGNED NOT NULL,
  reward_item_object_id BIGINT UNSIGNED NOT NULL,
  reward_item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_item_object_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reward_item_display_name VARCHAR(191) NOT NULL,
  ownership_model ENUM('STACK') NOT NULL,
  publication_status ENUM('SHADOW','PUBLISHED','RETIRED') NOT NULL DEFAULT 'SHADOW',
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_collection_reward_catalog_version (catalog_version),
  CONSTRAINT fk_mini_pet_collection_reward_catalog_item FOREIGN KEY (reward_item_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_collection_reward_catalog_object FOREIGN KEY (reward_item_object_id) REFERENCES object_registry(id) ON DELETE RESTRICT,
  CONSTRAINT chk_mini_pet_collection_reward_catalog_counts CHECK (grade_reward_count=8 AND stage_reward_count=100 AND title_definition_count=100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mini_pet_collection_reward_occurrences (
  reward_catalog_id BIGINT UNSIGNED NOT NULL,
  global_source_order INT UNSIGNED NOT NULL,
  source_scope ENUM('GRADE','STAGE') NOT NULL,
  source_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  raw_item_display_name VARCHAR(191) NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  title_display_name VARCHAR(191) NULL,
  title_price BIGINT UNSIGNED NULL,
  canonical_title_id BIGINT UNSIGNED NULL,
  title_resolution ENUM('NOT_APPLICABLE','RESOLVED','UNRESOLVED','CONFLICT') NOT NULL,
  display_identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (reward_catalog_id,global_source_order),
  UNIQUE KEY uq_mini_pet_collection_reward_source_order (reward_catalog_id,source_scope,source_order),
  UNIQUE KEY uq_mini_pet_collection_reward_source_key (reward_catalog_id,source_scope,source_key),
  KEY ix_mini_pet_collection_reward_title (canonical_title_id),
  CONSTRAINT fk_mini_pet_collection_reward_occurrence_catalog FOREIGN KEY (reward_catalog_id) REFERENCES mini_pet_collection_reward_catalogs(id) ON DELETE CASCADE,
  CONSTRAINT fk_mini_pet_collection_reward_occurrence_title FOREIGN KEY (canonical_title_id) REFERENCES title_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT chk_mini_pet_collection_reward_quantity CHECK (quantity>0),
  CONSTRAINT chk_mini_pet_collection_reward_title_resolution CHECK (
    (source_scope='GRADE' AND title_display_name IS NULL AND title_price IS NULL AND canonical_title_id IS NULL AND title_resolution='NOT_APPLICABLE') OR
    (source_scope='STAGE' AND title_display_name IS NOT NULL AND title_price IS NOT NULL AND
      ((title_resolution='RESOLVED' AND canonical_title_id IS NOT NULL) OR (title_resolution IN ('UNRESOLVED','CONFLICT') AND canonical_title_id IS NULL)))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE tmp_mini_pet_collection_reward_binding_420 (
  reward_item_id BIGINT UNSIGNED NOT NULL,
  reward_item_object_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (reward_item_id,reward_item_object_id)
) ENGINE=InnoDB;

INSERT INTO tmp_mini_pet_collection_reward_binding_420(reward_item_id,reward_item_object_id)
SELECT definition_row.id,registry.id
FROM item_definitions definition_row
JOIN object_registry registry
  ON registry.object_key='item.direct_bag.3076ae479a9eb44e'
 AND registry.object_type='ITEM'
 AND registry.active=TRUE
 AND JSON_UNQUOTE(JSON_EXTRACT(registry.metadata_json,'$.definitionCode'))=definition_row.code
JOIN object_source_bindings binding
  ON binding.object_id=registry.id
 AND binding.object_type='ITEM'
 AND binding.source_system='LEGACY_JS'
 AND binding.source_table='member.bag'
 AND binding.source_key='펫먹이🍼'
WHERE definition_row.code='pet_food'
  AND definition_row.display_name='펫먹이🍼'
  AND definition_row.active=TRUE;

INSERT INTO mini_pet_collection_reward_catalogs
  (catalog_version,source_system,source_path,source_sha256,grade_reward_count,stage_reward_count,title_definition_count,reward_item_id,reward_item_object_id,reward_item_code,reward_item_object_key,reward_item_display_name,ownership_model,publication_status)
SELECT 'ASSET-FREEZE-v2.435-mini-pet-collection-reward-01','LEGACY_JSON','data/miniPetCollectionInfo.json','3dadafd107bb82480d6d5218f98af2a31d0037af7c15b5fecaf8d3c62b9a4e39',8,100,100,binding.reward_item_id,binding.reward_item_object_id,'pet_food','item.direct_bag.3076ae479a9eb44e','펫먹이🍼','STACK','SHADOW'
FROM tmp_mini_pet_collection_reward_binding_420 binding
ON DUPLICATE KEY UPDATE catalog_version=VALUES(catalog_version);

CREATE TEMPORARY TABLE tmp_mini_pet_collection_reward_occurrences_420 (
  source_scope ENUM('GRADE','STAGE') NOT NULL,
  source_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  global_source_order INT UNSIGNED NOT NULL,
  source_order INT UNSIGNED NOT NULL,
  raw_item_display_name VARCHAR(191) NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  title_display_name VARCHAR(191) NULL,
  title_price BIGINT UNSIGNED NULL,
  display_identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (global_source_order),
  UNIQUE KEY uq_tmp_mini_pet_collection_reward_key (source_scope,source_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_mini_pet_collection_reward_occurrences_420
  (source_scope,source_key,global_source_order,source_order,raw_item_display_name,quantity,title_display_name,title_price,display_identity_hash,source_row_hash) VALUES
('GRADE','신화',1,1,'펫먹이🍼',900,NULL,NULL,'4076635e772d9b6427d42a8755eba73d7cfdaea6c3f18626c304f3405358ca53','1bfd46d800b062f3586c47e7210bac0558818a1d160e9bd03070f432c350ebe8'),
('GRADE','신화+',2,2,'펫먹이🍼',1000,NULL,NULL,'e61f74687be36ea55321018825f9eb254f7abadf6965aecc33b2f1ca996d9e06','e69b2dcf9ece75210fb6acdf1101c57cab363fd40f0ee53db95e473aca7e7602'),
('GRADE','초월',3,3,'펫먹이🍼',1200,NULL,NULL,'d13f2af986bacc912b1a942289829dcabce681277387a4af594ff2c9f0f07632','53c83e6b8ac223b38e4833b13b1f5134957cace4a0dfe3359df18df8cf8a5e5f'),
('GRADE','초월+',4,4,'펫먹이🍼',1500,NULL,NULL,'b38f676af5a3f81692bb3412d43e7eed6a4123b72237c12f7356eb8cb76185ad','92a8b7c56e29e0b3edd7f39fdcdd7da4df52ee43aeac5673ebe6da1ff5685c95'),
('GRADE','태초',5,5,'펫먹이🍼',3000,NULL,NULL,'c0f2fdf762e41e92d58b626a14b5de210f7d16a5df2fe1e0f79631081fe32836','cc3f25704085f0642077d3fd0e7591f5d3fb707a68b53d3c4ed1d3c2a5b4959a'),
('GRADE','태초+',6,6,'펫먹이🍼',5000,NULL,NULL,'f3bd94e49d38e7f6c7f4ecd31ab54ab843907f95c19bafc0dc3eb243e05e78e1','c46842cfcf0d911029661c729bfd251c2b0544a20c3e8f53f5228d7fd604ac28'),
('GRADE','창세',7,7,'펫먹이🍼',7000,NULL,NULL,'674b5b7587ef56c14390fb49cbd59c259539541099d37fe20b74aed0b0e92caa','682a9fcdcc6692c08244be7c4e400b61279fa761462e71651725542fc7e67c62'),
('GRADE','창조',8,8,'펫먹이🍼',10000,NULL,NULL,'fee255d482a752448b61515bdc71d0e8df135b6ccf09a00cdf861ef40b1f4237','6776d0291ca08f2e2c73d00635c02b32c73a0f7fc12a291ef94df6db3779c6c9'),
('STAGE','1',9,1,'펫먹이🍼',50000,'미니펫 첫 수집가🐹',10000000000,'43366b2327f4b906e036543c9b6ae73058296a5d4f8d9f766f442fdd754969c7','94513f34b671fed871de6b1701c03843e8d9f4920a1ece45a830b3d6accefe79'),
('STAGE','2',10,2,'펫먹이🍼',60000,'미니펫 입문자👾',10000000000,'d1166c461958201725b70bbf1b505e8e6fed6d5c4032b68da6526a409a54c495','c5a4da4171ae076deef6fe06091b3b9f98b6ee81210f5cf113d7fc97f042b523'),
('STAGE','3',11,3,'펫먹이🍼',70000,'초보 수집가🌱',10000000000,'84d4351f35fb6eede141f9d7d30318f7f9addde0a2b8b3b11c7d51b071fd24b3','74173cf9ce6d73b2406694540cfe2b550fb07102a09a0e3dee72857327cb2009'),
('STAGE','4',12,4,'펫먹이🍼',80000,'작은 발걸음👣',10000000000,'11365969b0c46d69680e2b0710c4c687fb6ba79e08ea78fab7364307070d730d','b57627fec6d27c0580bad53f34317f202dfb68acf8ad444fb0fac66f1ae2bc7c'),
('STAGE','5',13,5,'펫먹이🍼',90000,'펫 수집 연습생🤸‍♂️',10000000000,'ac32ededa1fa2874f9acd0ce7ef8e1899e6b41fee1b65cd856d502f37d1bf8cc','0b7114d223187f6927b566a96a1568d2ab677ae2582c2c562e29c69e48eb2944'),
('STAGE','6',14,6,'펫먹이🍼',100000,'컬렉션 시작자👒',10000000000,'cd69f52ff892bc62d32973a658910d11cf1c3fe91e2ac469c5269ac1563dfa44','675559335db13e05226de90a1998ca60236fc1b1f76d6e4f361c3077195fa1f0'),
('STAGE','7',15,7,'펫먹이🍼',110000,'수집의 기초👶🏻',10000000000,'c5ccc88d27683d44d11ef5fddb506a3ad4920d318ada688333737a11bc5fc605','24cffd1b6a981dc3b2b7cd0f8df467294b1f809fe67cbc2483157281a5e4f8c1'),
('STAGE','8',16,8,'펫먹이🍼',120000,'미니펫 애호가💪',10000000000,'61f22e3d1808e4169b91d3c87f74dd8d0790b6ee6406c1bf75f1036e046473ff','c67379ee52eed3019448c625d1b52097c0f498bc360e7a6ba9c95a1bc62a7396'),
('STAGE','9',17,9,'펫먹이🍼',130000,'수집 초심자👨‍🌾',10000000000,'84c082552d694d8cc697db5a81273a25081dfe8bc86207bb0a32a2fdae915c46','f1b1225f235b0dfb3f1a87662ba7f3059201673eab3b2c17341b677d5f4e5bba'),
('STAGE','10',18,10,'펫먹이🍼',150000,'미니펫 관심자😉',10000000000,'3d530b34e79f047e8c0382aba6e27dfbd14d7d1a49af01ec871bced7124c6ae7','045aa7d5e71b9bfb6cb3d984291bedb2d260b88b452f33b5e6b8808f658809b7'),
('STAGE','11',19,11,'펫먹이🍼',170000,'미니펫 지망생🎤',10000000000,'9b9a3ac9689243bc4e81b58935531fdfd2c7e68853b26562da07d5e08099ceed','7be45abd40af008d367174c930fc1436e0b8126a2975e6d550e0c877fb2d8968'),
('STAGE','12',20,12,'펫먹이🍼',190000,'펫 모으는 자🧢',10000000000,'b77266b3c3510ea4648234597cfd33808c22a675727ebc5cef7dd18eabada80e','62822af5ad29eec597a2b28b375b0a00319b2f9993c5d8ff12bb2b51fdb59be4'),
('STAGE','13',21,13,'펫먹이🍼',210000,'수집 중독자👨‍🌾',10000000000,'0bede94e5f6facac05e2c6601fd638c2d32ea50d35480d99f2556e6886fa615c','de54ca3caf425f9c274f412b2ee051f06829898f7ed00960eb5935a1ed41c8dc'),
('STAGE','14',22,14,'펫먹이🍼',230000,'미니펫 탐색가🔎',10000000000,'f858f5022bd9fd7bdf0dc7bbccef0e4ffb62152c8aeeeee243449229feef1605','becc8e641068ce33275498cce69f3104527c97e8d4ef14566ba301d081121936'),
('STAGE','15',23,15,'펫먹이🍼',250000,'컬렉션 유망주✨️',10000000000,'b094b69497031226f740f82ba587180e60cf03331966c86cf5904dd364bea67e','61f0b40c2629cdfcd83e61d7a3f0d43eeb87f120cb7a94f664d4a6e2d764b05f'),
('STAGE','16',24,16,'펫먹이🍼',270000,'수집의 재미🥕',10000000000,'dd7e34527548ca734c371a0969fe626e2c8609e2e861378f1cc04188e5e9715b','20f514a48043351ffc0d95b23b176f919e694b7c7788fc879aff55a146687ac3'),
('STAGE','17',25,17,'펫먹이🍼',300000,'펫 수집 전문가👨‍⚕️',10000000000,'c97600954e5cfe325982ad2d9dd4d1e8d46ed064b992b750c7679d9ed8f8b416','929d9bedd7d86ab3c818b105cf31375c3e1170ec2691866e12dd3c5320e499f6'),
('STAGE','18',26,18,'펫먹이🍼',330000,'미니펫 애장가🤭',10000000000,'c0dfbf5e8eac8fff7e9e1637a9810c125f77008e9958be2721238b69c1c2863b','6e58528f9473ca390f4895d2d26bca2fa4ac41a92f07fb5620bd69f8e51e74d9'),
('STAGE','19',27,19,'펫먹이🍼',360000,'펫 수집 달인🤡',10000000000,'adb937983a0628850003abafa4ed61ccfda72f3dfbb0015daea24905f963ef45','69d1888abeda6c411218cc366ca03673104ef091e6f64dcc73a0e4b7e5f70fb1'),
('STAGE','20',28,20,'펫먹이🍼',400000,'컬렉션 마니아🤖',10000000000,'2c122f1c5e5502c89b607c7978fe33dd34678190abce37082d0773778f1494a5','d655a32efc86b8ba956827f25d7105c68e9bd472573b8dc04b43b2ecf58da8df'),
('STAGE','21',29,21,'펫먹이🍼',450000,'미니펫 헌터🔫',10000000000,'65f0064e9aa633b1bc16f8fdd12a36929636030aac41d6f4fcec4f206686ed13','621fba65bd95dd66d59917338089203f110b59758c445266412885fa0907dd03'),
('STAGE','22',30,22,'펫먹이🍼',500000,'펫 탐험가🎭',10000000000,'8301f7af7726296b79368af031ae9625de51ba7c641b05382c6b66ab4aa74374','4280d67c859954295224dc1d094bc4a0461af7bd590c64e3de9ea323e0bbe247'),
('STAGE','23',31,23,'펫먹이🍼',550000,'컬렉션 개척자🧳',10000000000,'1a5c75d9d6243d6bb5f0cc3e089e109afe79334872ab1e88e2a7e8ae0fdfc046','326ee65f947b020d53ac446e4a0c07de87f6b8cda52f7c627bb76d996043044e'),
('STAGE','24',32,24,'펫먹이🍼',600000,'미니펫 연구가🧪',10000000000,'3213f5cea5f117d7908c1e345b4d45941904ebdeb439f2b3a977508aa8e28d89','454fa6e1f68b3b0fd1e3159bbe4d70bea7d4be25f1fc9e1d58ba98427ad32bb0'),
('STAGE','25',33,25,'펫먹이🍼',650000,'수집 설계자👨‍🎨',10000000000,'f7a055a36f57afbccb46ab84a001a6b57ea0a1ac375d19493909e0778f067fcd','a98bb66ebb453fbf525f55cc8fee165efff50268d9a3685f01cf78b51705319f'),
('STAGE','26',34,26,'펫먹이🍼',700000,'펫 감정사🧙‍♂️',10000000000,'739e4004b79b695c491903bbbb9afbe7363a7712b53ab0e8dbb246fefa113c75','a308faba85f0965448e643f1a8f403e460e684bc291480b635afb4e07aa6aee9'),
('STAGE','27',35,27,'펫먹이🍼',750000,'미니펫 기록자✍️',10000000000,'33c612c2074c6105db8c91bef5fac25b0152eb52e6873948c32041d0bb9d8a8f','0750e681bff74e3eb8bfc1fefdbe30f2d12837f11bad7e31988a0f68644f65fc'),
('STAGE','28',36,28,'펫먹이🍼',800000,'수집 관리자✨️',10000000000,'d2c3bdb606f62cd71cdadc749119b8e830ac0059e91d8b2dbf744523d35506f3','23be7450beb246f1b8352a64c1d89e488819f5e2a6c65b22b274f3bf4cd043c8'),
('STAGE','29',37,29,'펫먹이🍼',850000,'컬렉션 관리자🌠',10000000000,'0f6bf38edbef003de1ed74eb1c5671e261d74642c79ba9deab7be680f69117f7','044605209dfd0e2bbb95de8ee0a94019e72d3b83b56085aa9127b858779145ae'),
('STAGE','30',38,30,'펫먹이🍼',1000000,'미니펫 관리자🥼',10000000000,'216c2a070c3a0627c18cd96d30a09dd378deb5fdd09e0b8129cf2740f7907e35','cb835e372658d313beed93133203d91c386221b029fcca57eb023a307223be37'),
('STAGE','31',39,31,'펫먹이🍼',1100000,'미니펫 전문가👨‍👧',10000000000,'ab4d2f2cf10ee45f121313f1087f916f7eeb79ec4d6042f8df0e8720ca471d19','89fd6430d8b7a6fb3bab4360dd691710d63a163da6620fc262a2655e0fb66ab6'),
('STAGE','32',40,32,'펫먹이🍼',1200000,'펫 마스터 후보🏅',10000000000,'367e5bd4a5c25ac32519a53de46a7133b32c45165698e51cb6af12f5aed90cb8','a3b6d03b493a675d4e5893c163c0ff395acdabc3b123d34aec212593ad9cc651'),
('STAGE','33',41,33,'펫먹이🍼',1300000,'컬렉션 전략가💌',10000000000,'1270a54d2a8ac5a29c4e27a579c92deddad809d853dd0553c91164c8189880dd','53384491572140449af396f88216f4b7f6622da0d16ec4f2a3c69de85cdec091'),
('STAGE','34',42,34,'펫먹이🍼',1400000,'수집 분석가📖',10000000000,'c806bc5f926e95e62da11b6bfe33e94e268bfa5049ad76c6ec4cda021e30bc50','ec96278ce032ac54372ad8c964454d970a25144ad033e435af2edeb78692ca16'),
('STAGE','35',43,35,'펫먹이🍼',1500000,'펫 트레이너🤠',10000000000,'318b657d4471f3556d3dc4f4d010044ee9149d8ecc5e3cb4df68506d4e30df07','70a8a098e7699584c0920d3c5c86eb4297f9e9d87463813258e02ca22b22fe98'),
('STAGE','36',44,36,'펫먹이🍼',1600000,'미니펫 조련사🤺',10000000000,'1711718e64787caf8a35662a06862ff244682b9456600547a2fa744e800d1a63','6a90587a1f027d96a1d31cd0d08daba92c2489083e1509d61f973ea1d1f387f3'),
('STAGE','37',45,37,'펫먹이🍼',1700000,'컬렉션 장비자👨‍🔧',10000000000,'f42511f50060f387081342f696c63d63962e0aa08b413fdaafab40420a786677','963c389f224229ad98e91b120d15b726f02f3848c12f95512c5938a0f5333c25'),
('STAGE','38',46,38,'펫먹이🍼',1800000,'수집 설계 마스터 📚',10000000000,'36d767ca7c3ca1e26cb4677d6e9fbe37a98ab187c6ac24e6db4fbf956a5b00ee','d0e9b348785b8e4091e6f39023cc7b2053dfbe86e1561f02ca6fed6d2a7b0f03'),
('STAGE','39',47,39,'펫먹이🍼',1900000,'미니펫 통제자🧐',10000000000,'d3fa6f58ef173f55d0996468de5b0fd05c93f6333c13ac1e761ceaacce650f30','62434256833ac78ada25041a59a18669ae8b18b909b5e48c0fb93730677a602c'),
('STAGE','40',48,40,'펫먹이🍼',2000000,'펫 수집 관리자👺',10000000000,'2d07455237f23ae5906ebde7d1bb3b91c39ae92504c2894ef3d7912de86e0a49','96599681a2fe0aa4b0362dc57db0ccb6726336d2309f8f4b2ea14accce9f30f4'),
('STAGE','41',49,41,'펫먹이🍼',2200000,'컬렉션 마스터🎒',10000000000,'cbbb8785929c04cab9abceb52aeca18a03a6a87c31c5d4fb4a44bb87e5ea57e0','93517f678e0ea3c456518c0cd4f1cac73766ab03d4b2c920eed665f3972f7f66'),
('STAGE','42',50,42,'펫먹이🍼',2400000,'미니펫 숙련자👨‍🏫',10000000000,'84e250cc4376a6ef9be24c5ac5e59374d8300c14bed9d4e32cc8c17b044e2852','cb2f0f300e64d214e334c787c699fec8a176377467b3cfd19531b17427d0dfb1'),
('STAGE','43',51,43,'펫먹이🍼',2600000,'펫 수집 장인 후보🧔‍♂️',10000000000,'b4b7bf30b1366cefef2ad10bcf51e3ba022df62d0ab6599624dd8f4e75568335','7d6717a9e0b7f699a14f354666e2f528ba63e78c1fdeb14f4d6ff8071f54dc01'),
('STAGE','44',52,44,'펫먹이🍼',2800000,'수집 통달자🔱',10000000000,'181b87ed235de23a9498fd741abd6a7327e8259214b75b4f7110785be22c9bd2','1740df65fed2cfba2162e8268424eb6f7dd10ee36058593bf067f094ac8ed106'),
('STAGE','45',53,45,'펫먹이🍼',3000000,'미니펫 지배자🍷',10000000000,'66c0b2a8f179312ba826448f41a457746b09be8b71ace94c04042fb857ba530b','580cf8f2387f35fc5f6f5882be1c73897f80c4c001d1ead544831addfa7d80f2'),
('STAGE','46',54,46,'펫먹이🍼',3200000,'컬렉션 설계자🏠',10000000000,'31fe6232b6d82bda17935ac0dec7a485cf54695bc4b7c4fd0dae56245b05fc88','6ad9f83812d0758bb34e60353d5522239e4f2a373e9cf05a6e7efbbf064bd5d4'),
('STAGE','47',55,47,'펫먹이🍼',3400000,'수집 총괄자🎠',10000000000,'af926859a7a957912c5a67fdbf5565fbbf68d91064840b1e93a29685b9ccf73d','a60d2d9daf48a79612f1935b91d196b9f6cfad34ac5c0d22be30b55874b44ada'),
('STAGE','48',56,48,'펫먹이🍼',3600000,'미니펫 상위권💒',10000000000,'850efe926cd10d30dd00902e8b5dfca63d349338f44a6f225546c5d2d954a25f','e81d5bb5ce825b0abe8e2072f5fabee0802f274533872d1755b3923396ac92f6'),
('STAGE','49',57,49,'펫먹이🍼',3800000,'미니펫 핵심 유저🏷',10000000000,'23540a5f7ca0d89701e762b54e3fcaf32efa2247a1a69f518284eb11b8a6db17','8f62ce380ba908c4e0ac9c2aa12e6f246a2df446406d6e0d3775c20535a0827b'),
('STAGE','50',58,50,'펫먹이🍼',4000000,'컬렉션 핵심 유저😎',10000000000,'c557867702e0717c4f939c006c064d332544cb690bb6e6484bc52956dabe0442','98964e9515aa70c468ffdbf115e72f7bf2c1132b9539c53f66a0a6a7c240497d'),
('STAGE','51',59,51,'펫먹이🍼',4300000,'펫 수집 지휘관🪽',10000000000,'38d1a8fe0784364aeed022caeadb9578baf9dc2948461cdd5e591e22f77354be','e1b551220d880f07670b0d782d5b5b9675620bebbc7ade0166241678f6874f92'),
('STAGE','52',60,52,'펫먹이🍼',4600000,'미니펫 전략가🗽',10000000000,'d1ca24574bdaee1d1d5541ab2c6ca0a67456460e9ef3588a02a97ca3b9b9f8a2','257dfb015008e4a3c81e70be372f535137ab83d6fe7516de3eb6b7167ba1e18f'),
('STAGE','53',61,53,'펫먹이🍼',4900000,'컬렉션 관리자장👓',10000000000,'420c0fff134ff4b3216020b6334bf437d5926d83615de14e2fd3e9a3d10338f4','24f83c932353f37cdf4a8e8e21ea1938f188c0e2a257fab3373d6f52f0ad6864'),
('STAGE','54',62,54,'펫먹이🍼',5200000,'미니펫 수집 고수📖',10000000000,'24b1e27f05f38cc35f30ec0714afc7cc7b11e2bdfa3b1e652ba864fd089d6dba','764a4b592b56178e2b27391c810bc86c8be4233c004caa43186b6bde9613dfc8'),
('STAGE','55',63,55,'펫먹이🍼',5500000,'미니펫 전문가장🔎',10000000000,'b441f98161da46f3b8af801c030935c4cc246016ab8aacbf7cda060d9397ab4a','477dba1bb29854823a0c31d1e7e8806ec7336568735257fe5de15f8400d1dce4'),
('STAGE','56',64,56,'펫먹이🍼',5800000,'펫 통제자🔑',10000000000,'51852edaf4a7befa30b1e6229e955d35ac2483d72d97b04b866407e106bbab39','e73ef86d9c27644632bac66ee00fda6d369d73d3d9efc835764675316baf55a2'),
('STAGE','57',65,57,'펫먹이🍼',6100000,'컬렉션 관리자👷',10000000000,'6558de0139223805d52c3b7f3510a5fc72f3775ddc7a6fb65387f32605666728','91c6e56c9e74665886e2c61d529f80727857c9136ca7c7ea6c7f3d515ff3a3f2'),
('STAGE','58',66,58,'펫먹이🍼',6400000,'수집 총괄자🧑‍🚀',10000000000,'e99c7ed8ae7ba831cbdd074afca5b0404e3cf3a139eaa5e0ce0e2e193c7357ce','5362b4e50d7387df640cb0104d0ad7bc8bb770b23acaf7361390acb90f3874cc'),
('STAGE','59',67,59,'펫먹이🍼',6700000,'미니펫 상위권💯',10000000000,'f56d2ed217365276beb0bb9c1456e6f315a929e9d50da33043254ad66d2811a3','0d2243ea4e5156832a6180b3283a30d67a3efe000c0db89c9a01d52c948ba010'),
('STAGE','60',68,60,'펫먹이🍼',7000000,'펫 수집 상위자👨‍💼',10000000000,'a4bd1a0996a3fe9a69f1ff9446d89cdf71d70c76289c028d2577f39bd267a844','c54cad962f4b55f80f5df7f30f1607d3b00f19e2f783edf2b055ea9bbddc2afd'),
('STAGE','61',69,61,'펫먹이🍼',7300000,'미니펫 장인👨‍✈️',10000000000,'bc70ac8ba39b2a7e8e3959bd90994079b5f7880b174ff785da7d058a3262ecec','1d8ebdacb05cd69cc126f1dc870d2dfd3eaee91da95f9d83a093e74566d3f175'),
('STAGE','62',70,62,'펫먹이🍼',7600000,'펫 수집 장인💘',10000000000,'96fbc7c68de3a9c70cca33e9c5332973b1ae3df3609f549633f786bf696286d5','206caf0b1d31c51d0b68af33c2fb263ee238e3e090de0b10e9974bd694d8ef20'),
('STAGE','63',71,63,'펫먹이🍼',7900000,'컬렉션 장인🎻',10000000000,'94100797bbaff1a3c0e15867515bada7df439007decc96b74a42284de9700cad','ef10813e5815ab3e5dd45802cbbc35a5639fc29519c95ff38bf80d3ece9f204e'),
('STAGE','64',72,64,'펫먹이🍼',8200000,'미니펫 숙련 장인👑',10000000000,'1a6d3a5348564ecea43747d970bee34505f89ad9cd4e197e11a15dc40a918c65','afbdf888d4d787d49fa7534d03bff4573bf60e14a848525d5a142ac2b9312042'),
('STAGE','65',73,65,'펫먹이🍼',8500000,'수집 완성 장인🤹',10000000000,'09f3cdeb077c665604c094066dcfa21c1bc4465c3f48bd9a244c6edf814d6f92','9e352a564261af4d93191c7ff07b321388411b2fa642d2866307363c241d5c5e'),
('STAGE','66',74,66,'펫먹이🍼',8800000,'펫 강화 장인🤾‍♀️',10000000000,'263adfca4abef16310299f21f3be8cc1477ca9b05333cea5252f443364293392','cd0f275dc135472eda4e4746f176272c73c1336c2a1ba4c3cd2747952d9bf668'),
('STAGE','67',75,67,'펫먹이🍼',9100000,'컬렉션 완성자👨‍🎓',10000000000,'82712c16db1dafca21cca71216cde6111983eb1df512d49215924b3521cc57e5','550399b37cc5ef1a3aad9a9223507f3d63b7e74a5cb711577b6ca85b979e0bfc'),
('STAGE','68',76,68,'펫먹이🍼',9400000,'미니펫 장인장👨‍🔧',10000000000,'8505251484a39d8b867297b7cb2b260803acbe2cf6e23d5e324431b71002ec53','3ad5a60bad13bb942a27d7faca4a02dd2e2ad404037167498982a8380f2d7de8'),
('STAGE','69',77,69,'펫먹이🍼',9700000,'펫 수집 통달자🧜‍♂️',10000000000,'158bc926eeb756945d859492b062deda948932d8f8f1c80851710db6aa2bf4a5','e92bbd0892affc6b236c6ca8aeb3e8cc71c1d50a9a4a2788bdeb195da7fa7b09'),
('STAGE','70',78,70,'펫먹이🍼',10000000,'컬렉션 절대자🤳',10000000000,'d31ed00214d0a730955d171bd0789539600cff2c8ed85dcadece11ff688f21bf','ca0a89d8dce325f984c6f3e51660800ec5cb30d46fac4123e57cc8fab91f0c29'),
('STAGE','71',79,71,'펫먹이🍼',10300000,'미니펫 고수🤵',10000000000,'ec22ac12493b15f50f4313643a3d7fff2bec7859eb4a7f3d22579e98f5680df6','e9c1b259503baa8f4374be05a7dce483236335d06779efbc2046b60ac61cd29d'),
('STAGE','72',80,72,'펫먹이🍼',10600000,'펫 수집 고수💂',10000000000,'a9628dbfbf4ed0333140651a85be02fe127361d832daf90d74d6196ba0ebebbd','4b399cec676bc450f543726c0f161da088429413b122168de665746e30727e61'),
('STAGE','73',81,73,'펫먹이🍼',10900000,'컬렉션 고수👔',10000000000,'d5500f05627fb9750f440fdcdf671c2c007bc4ad5116b4f8cebf6ad63d815269','4e070854f1eefe8342c410fc3903376f523387517a49ae735d965e4416b41f73'),
('STAGE','74',82,74,'펫먹이🍼',11200000,'미니펫 달인👨‍🏫',10000000000,'85358992089269b6746db8243d751ab133b7de229b2e32a18e62a33609ae3019','210b030dade70c19ced0dc569387193621e39e9f004c429a21ddc57144a88f11'),
('STAGE','75',83,75,'펫먹이🍼',11500000,'펫 수집 달인🧑‍🏫',10000000000,'8e56fa131a544ff0937f5665960910788c6bbcd6039e7cca3979acf3ba33ad92','eeba863008086586b417777581344a7096534beeee30a3a159229cfa4f6d521d'),
('STAGE','76',84,76,'펫먹이🍼',11800000,'컬렉션 달인👩‍🏫',10000000000,'bd122af2b49b7b6c2e4b37a74b8f56f514678b3751e64d87def96d36b9602e4f','d4ca6fbb4edddf618bd4617e74eb12242bb4e861062cf0c113882d68a0580f7d'),
('STAGE','77',85,77,'펫먹이🍼',12100000,'미니펫 상급자👨‍⚖️',10000000000,'0a406203fd30f830c9f4616864acf103fed2be9f3b9640c06105c2c311e5a655','a9048bdbc774c84f1e6256c332b57779d4dbbf82c2e9fa3bfb290493638efddd'),
('STAGE','78',86,78,'펫먹이🍼',12400000,'펫 수집 상급자👩‍⚖️',10000000000,'0e36cac69861b07b931e7fcf5413d6610772bcca8d79dd64f158db6cd7d447d9','671476e8ea04f42a4311db2941f4fa65a4459db804fee2090e002f7c679b5c7f'),
('STAGE','79',87,79,'펫먹이🍼',12700000,'컬렉션 상급자📒',10000000000,'2158092ce97298c6f29bdd4bae77979e2df0e1f96c5ca26deb9c876ee134aee6','3918597784cf34fef9609ca3067d33c9c98a8db789c96964e77605684a0a5dd4'),
('STAGE','80',88,80,'펫먹이🍼',13000000,'미니펫 최상위자🛍',10000000000,'eb760fd030c436aa49d9308e6585085e8e0c1c6fa2c7ccc8b00024e28c9315af','b4a8625af5f8e8dabfe2999adb22737858c44cb83894270cc3fbaf024c518f5d'),
('STAGE','81',89,81,'펫먹이🍼',13200000,'미니펫 초월자💎',10000000000,'c76c344918d99b980b1aff8c11eb0e7da8164480855dd3d666bc9759f8147e14','e3d6d21ba6b63f2ed5ac626f8e7c618461f8fa36a67eace0e53b40e317caecad'),
('STAGE','82',90,82,'펫먹이🍼',13400000,'컬렉션 초월자📕',10000000000,'61412989adb537492eb84bcb7848a3b94c0851e413dd213d900766eec11288c2','f3a379ae3c091fd22ff19282ec58bfb0485955efa9eafa518ff63a5701146393'),
('STAGE','83',91,83,'펫먹이🍼',13600000,'펫 수집 초월자👜',10000000000,'5132881d377a1f71e05ebfcc11e914337e10e880ff870ef671b273a751506a8f','e99c009597fe0eb82d83e583a5a33d9121e0fdc2ffd3763b2f54f64cce124a8b'),
('STAGE','84',92,84,'펫먹이🍼',13800000,'미니펫 각성자📍',10000000000,'0d220a6708d5c8a6af2de430359fd896084dab22b196203d4779935d5c8b06a4','4d8c030877aa006546f66b2aac9faf513650bea412cf2d3fc526db951c687d7e'),
('STAGE','85',93,85,'펫먹이🍼',14000000,'컬렉션 각성자📗',10000000000,'fad74e2a37501a06e36d331dc83a7ba499dd0135c8a922a1e2c681df40547573','d158e61a0f07ec3392c4e8de67d1b88b657777db22bc5a01e7c17084243c13cc'),
('STAGE','86',94,86,'펫먹이🍼',14200000,'펫 수집 각성자✏️',10000000000,'3b39809e9edda985a52af147866cfa87b50b75530c681bb133f566f994417639','6260e24cf655801a09cff8bab5be25c24f0011f15129c88f70eb31ce12dbd09f'),
('STAGE','87',95,87,'펫먹이🍼',14400000,'미니펫 지배자💡',10000000000,'f1b79e08a27351edbad341b5864d430e50bbaaecb9869da53164c996fc9e0b3d','3176bf44da285e21d801b76c380c1ac299d5fd56f4877eafdd74c0705954dbb2'),
('STAGE','88',96,88,'펫먹이🍼',14600000,'컬렉션 지배자🗿',10000000000,'e68d365057d2319642ad3da2deeb790bcb7c59d266f20e006e57cf6df87a0192','aec01a073441b8167ec5df2673efdd1512083955e7d3f19ef1ccee3759bc2128'),
('STAGE','89',97,89,'펫먹이🍼',14700000,'펫 수집 지배자📒',10000000000,'9481da8c85697beb45a713fc2862939466de0ff3dac527a3bfba5cacbcc9888c','74cbb16f789a8fe83ef310bf967cfd635f866408428723f79016ccd9908c8f76'),
('STAGE','90',98,90,'펫먹이🍼',14800000,'미니펫 군주🎺',10000000000,'7a2dfc78d21bd1dd0d5620542b759af0f8d036dd3b7daf70f267673b1b21b2ca','e8d206aff8d70e02da26cbdd4c11c9f66dfcbbc854af615af029bd4da17af2a2'),
('STAGE','91',99,91,'펫먹이🍼',14850000,'컬렉션 군주📣',10000000000,'c8152ccced2fbe63fcac5510756297d8108ded75ed23328094c6e3222507cae8','2370a9459cb23aac53029be68c4d1f2fac91c52f439c6ead259e22bfd4ab6aa5'),
('STAGE','92',100,92,'펫먹이🍼',14900000,'펫 수집 군주🪖',10000000000,'e743bb8f904270a444c9f562803d7aa8cebddc0f70b3a4651a08bed808675a20','1abd4e9da5948890623a187d3acf905e327b1032f135afb4f95817b9d1e2f0b2'),
('STAGE','93',101,93,'펫먹이🍼',14920000,'미니펫 절대자💳',10000000000,'b5ee2e6ed316777096e26148d05afa9405af0e5b0781cc9e6734dd62c7799c8d','4803fa04ddd4369cb2c945a23617dbf1e9d1bb6835381f5543b6bbd5c8b59293'),
('STAGE','94',102,94,'펫먹이🍼',14940000,'컬렉션 절대자🕶',10000000000,'1bd263420fb9f59c5359b509e1cd97424240b48f0c369a0e8509e9b350d04ff6','15952118505581a2a1567dce1f0afd76b752c09d8f46e5ce05f3814dffce8e4d'),
('STAGE','95',103,95,'펫먹이🍼',14960000,'펫 수집 절대자🌍',10000000000,'8fe6cb92e74e19f3641d7caed713534ed3f073f5be3b2753a68c782e7245c0e0','8e9e419575cb1867bd4beb83a1f1b11d27269445c525428466142f8d2c7cf9bc'),
('STAGE','96',104,96,'펫먹이🍼',14970000,'미니펫 신⚡️',10000000000,'558b94d8716c8313a9c95e34a40e7145e813912afe29cb1a5b591328b302a0c9','6234eb63cd521ffc5b61830481f472c16a5ec47e02bde9101a02f32a6caf5ac2'),
('STAGE','97',105,97,'펫먹이🍼',14980000,'컬렉션 신☀️',10000000000,'18a494a07411bc6a1a6fa6c4aba201a85b16efba3ebdf94d647665833bb57ab0','aa6d35c72c5cf16cc2e1fcdfdd3fa299b359753670f6f9e7017c7ea3a61a6ec9'),
('STAGE','98',106,98,'펫먹이🍼',14990000,'펫 수집의 신🌈',10000000000,'43ea452be367aaa27dff572a0e961acb90ed90623da5c25dfddb148b2cb72585','a96c8ed46607735c1daa21d5fff863869aa8f429c43d10cb79b4e9d64da09429'),
('STAGE','99',107,99,'펫먹이🍼',14995000,'미니펫 창조자🪐',10000000000,'62d7ab9ddaec762ff3c4c44779bf2239f8ada3bbf2a1f64d40c48f2a0ca7d1ee','2460e85b4921e0bfd6e98a71f640136c3f5d485ab56577f1d83f475d405b438a'),
('STAGE','100',108,100,'펫먹이🍼',15000000,'미니펫 궁극의 수집가💡',10000000000,'b99414e48deaccfe7bc8756bd10958a0cd6e56b64b45a5b77317c133a05244bd','5b227f0cc0efd61ab1e3f189c42dec96d38c744efa4f811d3e8af7d91a2bcb89');

INSERT INTO mini_pet_collection_reward_occurrences
  (reward_catalog_id,global_source_order,source_scope,source_key,source_order,raw_item_display_name,quantity,title_display_name,title_price,canonical_title_id,title_resolution,display_identity_hash,source_row_hash)
SELECT catalog.id,row_data.global_source_order,row_data.source_scope,row_data.source_key,row_data.source_order,row_data.raw_item_display_name,row_data.quantity,row_data.title_display_name,row_data.title_price,
       CASE WHEN row_data.source_scope='STAGE' AND source_binding.id IS NOT NULL AND title_object.object_type IN ('TITLE','PET_TITLE') AND title_object.display_name=row_data.title_display_name AND title_definition.id IS NOT NULL THEN title_definition.id ELSE NULL END,
       CASE WHEN row_data.source_scope='GRADE' THEN 'NOT_APPLICABLE'
            WHEN source_binding.id IS NULL THEN 'UNRESOLVED'
            WHEN title_object.object_type IN ('TITLE','PET_TITLE') AND title_object.display_name=row_data.title_display_name AND title_definition.id IS NOT NULL THEN 'RESOLVED'
            ELSE 'CONFLICT' END,
       row_data.display_identity_hash,row_data.source_row_hash
FROM tmp_mini_pet_collection_reward_occurrences_420 row_data
JOIN mini_pet_collection_reward_catalogs catalog ON catalog.catalog_version='ASSET-FREEZE-v2.435-mini-pet-collection-reward-01'
LEFT JOIN object_source_bindings source_binding
  ON row_data.source_scope='STAGE'
 AND source_binding.source_system='LEGACY_JSON'
 AND source_binding.source_table='data/miniPetCollectionInfo.json#titles'
 AND source_binding.source_key=row_data.source_key
LEFT JOIN object_registry title_object ON title_object.id=source_binding.object_id
LEFT JOIN title_definitions title_definition ON title_definition.code=JSON_UNQUOTE(JSON_EXTRACT(title_object.metadata_json,'$.definitionCode'))
ORDER BY row_data.global_source_order
ON DUPLICATE KEY UPDATE global_source_order=VALUES(global_source_order);

DROP TEMPORARY TABLE tmp_mini_pet_collection_reward_occurrences_420;
DROP TEMPORARY TABLE tmp_mini_pet_collection_reward_binding_420;
COMMIT;
