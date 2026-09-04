# WBS732 Gate 5 격리 MariaDB 검증

- 실행일: 2026-09-05 KST
- MariaDB: 12.2, 로컬 임시 datadir
- 포트: 3325
- DB: `hoibot_rehearsal_wbs732_crosswalk`
- 운영 3306: 전후 listener 소유자 동일
- 임시 datadir과 3325 listener: 종료 후 제거 확인

## 검증 범위

- JavaScript 안전 정수 범위를 넘는 legacy BIGINT `9007199254740993`의 문자열 기반 정확 조회
- `(object_type, alias_type, alias_value)`와 `(source_system, source_table, source_key)` DB 유일성
- 미매핑·타입 불일치·비정규 BIGINT 입력의 fail-closed 결과
- `다이아상자💎(/다이아상자오픈)` alias/source key 보존
- resolver 실행 전후 관련 4개 테이블 행 수 동일
- MariaDB 프로세스 재시작 후 같은 canonical CUID 연결 유지

## 실행 결과

```text
WBS732_GATE5_MARIADB_PASS port=3325 bigintExact=true aliasSourceUnique=true failClosed=true readOnly=true restart=true production3306Unchanged=true
```

실행기는 `runtime/scripts/rehearse-object-crosswalk-gate5.ps1`, 검증 코드는 `runtime/test/object-catalog-compatibility-resolver-mariadb.integration.test.ts`이다. 실제 DB 제약으로 동일 type/alias 및 동일 source locator의 중복 행 자체가 거부되므로, `AMBIGUOUS`는 손상·비표준 저장소에 대한 방어 분기로 유지한다. 운영 이관·cutover·Gate 8은 이 증거 범위가 아니다.
