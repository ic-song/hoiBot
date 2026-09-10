# WEB-WBS-011B 재화·상단 잔액 작업반장 시각 검증

- 검증 일시: 2026-09-10 KST
- 대상 커밋: `91440b47`, `04297e5c`
- 검증 포함 HEAD: `50b5f176`
- 대상 source SHA-256: `c881cf1633c324c73bdeab322dfc4757d9099d32b1dab81cdcfbc4c1d68f3d3e`
- 미리보기: `http://127.0.0.1:3310/account/currencies`

작업반장은 임시 Fastify 미리보기에 `point`, `diamond`, fallback 재화와 64-bit 범위를 넘는 잔액 문자열을 주입하고 실제 브라우저에서 로그인했다. `/account/currencies` 직접 진입 후 재화 내비게이션이 현재 페이지로 표시됐고, 헤더에는 포인트 `184467440737095516151234567890`과 다이아 `98765432109876543210.75`가 원문 그대로 나타났다. 상세 목록에는 두 기본 재화와 `event_token` fallback이 모두 표시됐다.

데스크톱 화면에서 상단 잔액 pill, 왼쪽 내비게이션, 상세 잔액 카드의 계층과 정렬을 확인했고 가로 넘침이나 잘림은 관찰되지 않았다. 자동 harness는 375px 규칙에서 header wrap, 잔액 `overflow-wrap:anywhere`, 46px 내비게이션 높이와 세션 종료 시 숨김·텍스트 제거를 검증한다. 이전 4개 viewport 검증에서 유지된 셸 breakpoint와 이번 source 규칙을 독립 Gate 7 검토자가 다시 확인해야 한다.
