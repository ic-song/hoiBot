# SL-CRAFT-BOUTIQUE 체크포인트

- 슬라이스 ID: `SL-CRAFT-BOUTIQUE`
- 도메인: `상점·패키지·제작`
- 작업 레인: `통합`
- 작업자: `하린`
- 실행 ID: `하린-SL-CRAFT-BOUTIQUE-20260817T164332Z-6qxylk`
- 선점 행: `슬라이스_선점!10행`
- Heartbeat: `2026-08-18 01:47:00 +09:00`
- Lease 만료: `2026-08-18 02:47:00 +09:00`
- Worktree: `C:\Users\obbad\OneDrive\바탕 화면\hoiBot-modernization-craft-boutique`
- Branch: `feature/modernization-craft-boutique`
- 기준: `feature/modernization-craft-random@e645e09`
- 구현 커밋: `77f03ca`, `4dd020b`
- Push 상태: `origin/feature/modernization-craft-boutique` 반영 완료
- 상태: `HANDOFF_READY`

## Gate

- [x] 현행 조사
- [x] DB 매핑
- [x] 합성데이터
- [x] 구현 — 보존 커밋 `f0746af`
- [x] 통합 — Iris dispatch·합성 probe 명령·전체 회귀
- [x] parity — 명령 guard·0수량·재료 부족·공성 차단·응답 검증
- [ ] Shadow
- [ ] 운영 준비

현재 `6/8 = 75.0%`이다. 타입 검사, 44 suites·172 tests, 빌드가 통과했다. Docker·MariaDB 환경 준비 후 Shadow·DB probe·운영 준비를 진행한다.
