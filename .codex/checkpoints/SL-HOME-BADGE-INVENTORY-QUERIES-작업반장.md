# SL-HOME-BADGE-INVENTORY-QUERIES checkpoint

- 기준: v2.400 / a286279b
- baseline: 717a32c9ef5dcb44ae31063ec200ee1e0ebd5c57
- source branch: codex/modernization-home-badge-inventory-parity-v2400-20260830
- 기존 Gate: G1~G5 TRUE, G6~G8 FALSE
- 차단 원인: migration322의 HB57·MBTI20·LOVE50 표시값 placeholder
- 해결: 신규 migration374에서 204개 불변 definition version 930000002 seed
- 정확 표시 fixture: 204개(achievement64, special13, gacha57, mbti20, love50)
- source content hash: 70d6731d0c5e2f72832fe70042ab1e0a7ba16d38af106b71617a31c33ed7932b
- 불변: 기존 migration322, main.js, Info.js, feature/prod, main, 운영 DB
- 다음 검증: fixture hash, migration 최초/재적용, 204/204·127/127 DB parity, duplicate-name order, SHADOW, rollback, restart
- 완료 검증: focused 4/4, full 1,110 PASS/0 FAIL/7 SKIP, typecheck/build PASS
- DB 검증: migration374 최초 적용·재적용 count 364, definition 204/204, exact display 127/127, version 930000002
- 재시작 검증: hash 70d6731d0c5e2f72832fe70042ab1e0a7ba16d38af106b71617a31c33ed7932b 및 조회 replay 유지
- 운영 데이터 접촉: 없음
