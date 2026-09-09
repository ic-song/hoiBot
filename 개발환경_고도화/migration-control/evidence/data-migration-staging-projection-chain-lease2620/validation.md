# Lease2620 staging → projection chain 검증

- 기준 SHA: `a652751a1bb6fd6a8217eaf5ab43064352ad6e9f`
- 격리 DB: `127.0.0.1:3348/hoibot_rehearsal_lease2620_chain`
- 실제 호출: `MariaCommonStagingRepository.extractAndStage` → `MariaCatalogProjectionRepository.project`
- focused 결과: 3 passed, 0 failed
- typecheck: passed

검증 범위는 동일 `commonStagingRunId`, RAW/staging upstream envelope, payload fingerprint 3건, PROJECT 1·QUARANTINE 1·IGNORE 1, 동일 프로세스 replay DML 0, child-process 재시작 replay DML 0, projection record 중간 실패 전체 rollback입니다.

운영 DB(3306), 운영 snapshot, 외부 network/reply는 사용하지 않았습니다. 기존 provider, WBS742 원본 테이블 65·disposition 90·표준 119·직접 대상 45/47 계약은 수정하지 않았습니다.

검증 명령:

```text
npm run typecheck
node --import tsx --test test/data-migration-staging-projection-chain-mariadb.integration.test.ts
```

참고: 새 격리 DB에 전체 migration을 적용할 때 기존 baseline의 `490_item_bag_import_baseline_ordering.sql`이 MariaDB 드라이버에서 `DELIMITER` 구문 오류로 중단되었습니다. 이 슬라이스가 요구하는 migration 442·457·458·459는 그 전에 정상 적용되었고 focused chain 검증은 통과했습니다. migration 490 파일은 이 lease 범위에서 수정하지 않았습니다.
