# WBS731 Gate 5 격리 MariaDB 검증

- 실행일: 2026-09-04 KST
- MariaDB: 12.2, 로컬 임시 datadir
- 포트: 3324
- DB: `hoibot_rehearsal_wbs731_identity`
- 운영 3306: 전후 listener 소유자 동일
- 임시 datadir과 3324 listener: 종료 후 제거 확인

## 검증 범위

- CUID2 8자 PK 충돌 후 제한 재시도
- 동일 source `(source_system, source_namespace, source_identifier)` 동시 등록의 단일 귀속 및 replay
- MariaDB deadlock 1213 / lock timeout 1205 제한 재시도
- `다이아상자💎(/다이아상자오픈)` Unicode 원문 보존
- `YYYY-MM-DD HH:MM:SS` KST 감사 컬럼과 DB CHECK 거부
- MariaDB 프로세스 재시작 후 동일 crosswalk replay 및 DML 증가 없음

## 실행 결과

```text
WBS731_GATE5_MARIADB_PASS port=3324 collision=true concurrentReplay=true kst=true unicode=true restart=true production3306Unchanged=true
```

실행기는 `runtime/scripts/rehearse-object-identity-gate5.ps1`, 검증 코드는 `runtime/test/object-identity-audit-provider-mariadb.integration.test.ts`이다. 이 결과는 WBS731 Gate 5의 격리 DB 검증이며 운영 데이터 이관·cutover·Gate 8을 의미하지 않는다.
