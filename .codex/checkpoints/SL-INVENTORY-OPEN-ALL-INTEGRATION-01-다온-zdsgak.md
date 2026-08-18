# SL-INVENTORY-OPEN-ALL-INTEGRATION-01

- 작업자: 다온
- 실행 ID: 다온-SL-INVENTORY-OPEN-ALL-INTEGRATION-01-20260818T073142Z-zdsgak
- 기준: origin/feature/prod d9b36ae9e2f1ffe950e3a24d6b1aaf55ec24ed14
- 원본: c8f064ae423d3ea86857e5da3ed464a0078a0b65
- 선별 승계: 2655a93, 3661f84, b8a71ee, dc6ab13, c8f064a
- 통합 커밋: c4e6322, cbcdf7d, bba5433, 33bb766, 489b5a2
- 충돌: package.json/app.ts에서 범위 밖 spirit/combine 항목 제외, /전체오픈만 유지
- migration: 037 1개, SHA256 5d5bc2327689122b678ca4b066a5fe3ef5f7d3bba38b5702b9ab0435091f72fa
- fixture: functional-v1 checksum 200032ce470479cd8b1040c1df52a92c1583ec794899f8b75690c0966a71d17e, 35 tables
- 검증: typecheck/build, runtime 168/168, Rhino node --check, migration fresh/reapply 34, fixture apply/verify-only, 정상·길드공헌·창고패키지·중복·rollback·restart replay
- Gate: 1~7 TRUE, 8 FALSE
- 운영 자산·feature/prod: 변경 없음
