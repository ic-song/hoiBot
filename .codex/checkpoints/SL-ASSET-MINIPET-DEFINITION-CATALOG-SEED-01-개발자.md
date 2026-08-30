# SL-ASSET-MINIPET-DEFINITION-CATALOG-SEED-01

- catalog_version: ASSET-FREEZE-v2.400-a286279b-01
- baseline: 7f8ecb51b6280762e78cccf813bbcce9591f1585
- WBS: 614
- DB mapping: 1892
- Lease: 2360
- execution: 개발자-SL-ASSET-MINIPET-DEFINITION-CATALOG-SEED-01-20260830T2143
- migration: 392_minipet_definition_catalog_normalization.sql
- provenance: 같은 Lease2360 선행 작업자가 만든 미추적 generate-minipet-definition-normalization.mjs 초안을 승인된 인계물로 검토·수정
- source: data/miniPetData.json 1078 / unique 1078 / source hash 7fd91bacee010ec3c4623ca34ddb92f647e7f30fa1d71a764eb38e320b79f644
- mapping: source 1..1066 -> ITEM-MINIPET-CATALOG-0001..1066 / source 1067..1078 -> elite-combine-01..12
- identity: source-row-0001..1078 / reuse 1078 / new 0 / final 1106 / extra 28 보존
- grade: exact grade_display_name / plus grade 전설+·신화+·초월+만 별도 code로 정규화 / 희귀·영웅 semantic alias와 master 비갱신
- object catalog: MINI_PET type 부재 / PET 오분류 금지 / object alias·source binding 0 / 전용 mini_pet_definition_source_bindings 1078
- preserved: draw membership 1066와 weight, elite combine, owned_mini_pets/ledger/upgrade/equip, package compatibility, legacy main.js
- validation: focused 6/6 / typecheck·build PASS / full 1196(total)·1189(pass)·0(fail)·7(skip)
- MariaDB: migration count 382 재실행 2회 동일 / probe 7/7 / rollback·reconnect PASS / Shadow 1078/1078
- status: Gate1~7 검증 완료, commit·push·WBS 마감 대기
- excluded: Gate 8, feature/prod, 운영 DB, Google Sheets, legacy command behavior 변경
