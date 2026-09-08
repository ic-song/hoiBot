# WBS782 / Lease2610 Gate 5 V4 격리 MariaDB 검증

- 기준: SC-20260902-1
- 기준 commit/tree: 7f38cf28488e5ce313b94f1509a4e6d48c018ea5 / 2aa75b28597cd16e5670f8d5892a78e8d314f776
- 실행 범위: 비운영 disposable MariaDB와 합성 fixture
- 이미지: mariadb@sha256:67873d30a17f6a9c331f06363b2fa15f38abca415529966d67c84f87f82439fe
- 네트워크: loopback 동적 포트만 사용, image pull과 외부 네트워크 없음

## 결과

- 전체 migration 파일 478개를 exact filename/checksum으로 fresh 적용했습니다. migration 490은 기존 Node runner가 client-side DELIMITER를 해석하지 못하므로 동일 원본 파일을 MariaDB CLI로 적용하고 동일 SHA-256을 schema_migrations에 기록했습니다.
- 두 번째 migration 실행은 migration-count 478, 신규 applied 출력 0건이었습니다.
- 표준 등록 migration 39개와 등록 테이블 119개가 실제 DB에 모두 존재했습니다.
- V4 유효 컬럼 263개의 이름·MariaDB 정규화 타입·NULL 허용 여부가 정확히 일치했습니다. 정규화는 BOOLEAN → tinyint(1), JSON → longtext, integer display width 제거만 허용했습니다.
- V4 direct target 47개와 Shadow 비교 target 45개를 서로 다른 집합으로 검산했습니다.
- wbs782_admin과 wbs782_shadow의 CURRENT_USER(), USER(), DATABASE(), 서버 포트를 검사했습니다. Shadow 계정은 대상 DB의 SELECT만 가지며 deliberate UPDATE가 거부됐습니다.
- 같은 process 반복과 컨테이너 restart 후 projection/schema/row/checksum/부수효과 fingerprint가 정확히 같았습니다.
- SELECT-only 구간 전후 schema, 전체 base-table row count, CHECKSUM TABLE, outbox/receipt/audit/import/quarantine/ledger 행수가 같아 DML 0으로 판정했습니다.
- receipt payload 변조와 재봉인된 계약 수치 변조를 모두 fail closed 했습니다.
- 호스트 3306 listener 소유자 집합은 전후 동일했고, 종료 후 전용 컨테이너·DB·사용자·동적 listener 잔존은 0입니다.

WBS782_GATE5_V4_MARIADB_PASS image=mariadb@sha256:67873d30a17f6a9c331f06363b2fa15f38abca415529966d67c84f87f82439fe port=63999 migrations=478 replayApplied=0 registeredMigrations=39 registeredTables=119 effectiveColumns=263 directTargets=47 shadowTargets=45 selectOnly=true restartExact=true schemaFingerprint=b029d42bc19e3d7e65e51fb6d17e19f0ff1ca99dcc6a16360757dce96c30ea6b rowFingerprint=a145b1893b1f2cb87a686b361ebd167914f2f144023e72e27078d774fae2856e projectionFingerprint=8f2984f17e4a1a08dbb98c3d4434e5652130c439f38fb5a816991e12e4744452 sideEffectFingerprint=9b85d47f3f4dc8494d13e2b63abe9d48ec3df9d9452f1346813c20af60a71b22 receiptSha256=b59601b67ab1fb0c90f957855244386eb7ea9c3d1bd2fd6334c7867a85ee3884 host3306Unchanged=true cleanupNoResidue=true

## 정적 검증

- npm.cmd run typecheck: PASS
- npm.cmd run build: PASS
- npm.cmd run object-data:validate: PASS (119)
- node --check main.js: PASS
- node --check Info.js: PASS
- git diff --check: PASS

## 불변 범위

| 파일 | Git blob |
| --- | --- |
| main.js | 451730e955e1ed47fc2ec6ce24845ea511bc0f21 |
| Info.js | 3d19ca07b08f31d4534c9dd2273fb5e3a984ff25 |
| object-data-model-standard.v1.json | 683cbc32ade289216598dd80c972fb6a02bf5549 |
| data-migration-object-domain-import.v4.json | 82f4d69cd5ba80a4220b869dcb6b88cdc6c09b19 |
| 기존 Shadow 합성 fixture | 442d43474f9b91cdaf1844d2b3913ba0cdd78b42 |
| 과거 WBS744 Gate5 증거 | 5e8a74388bfa6b0c331655686731fc9183b31fbb |

전체 filename:sha256 migration set SHA-256은 15f94b8f0f0a78b640b1030dd356097e2bae713f8d7743c3a89e51139d983a18입니다.

## 판정과 경계

- Gate 5 V4: PASS
- P0/P1/P2: 0/0/0
- 운영 데이터·운영 DB·실운영방·외부 network·Google Sheets·feature/prod: 접근 또는 변경 없음
- Gate 6·7·8 또는 운영 전환 승인을 의미하지 않습니다.
