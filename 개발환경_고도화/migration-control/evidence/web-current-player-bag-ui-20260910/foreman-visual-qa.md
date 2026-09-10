# WEB-WBS-011A 가방 UI 작업반장 시각 검증

- 검증자: `/root` (구현자와 분리된 작업반장 확인)
- 검증일: `2026-09-10`
- 대상: Lease2644 미커밋 변경, 로컬 preview 전용 mock API
- 운영 자원 변경: 없음

## 자동 검증

- `node --import tsx --test test/user-shell.test.ts test/site-web-app-wiring.test.ts`: 9/9 PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS

## 반응형 시각 검증

Chrome CDP에서 `deviceScaleFactor=1`, mobile viewport emulation을 사용해 375×812, 768×900, 1024×900, 1440×900을 순서대로 확인했다. 네 구간 모두 요청한 width/height와 실제 `innerWidth`/`innerHeight`가 일치했고, `documentElement.scrollWidth === innerWidth`여서 가로 넘침이 없었다. 모든 구간에서 가방 화면과 8개 mock 아이템이 유지됐다. 원시 측정값과 대상 source SHA-256은 `responsive-metrics.json`에 기록했다.

- 375px: 이용자 메뉴가 2열 버튼으로 재배치되고, 아이템명과 수량이 세로로 배치됐다.
- 768px 이상: 좌측 메뉴와 본문 카드가 기존 셸 grid에 맞춰 표시됐다.
- 1440px: 긴 unsigned 64-bit 수량과 긴 Unicode 아이템명이 카드 경계 안에서 표시됐다.
- deep link 진입 시 `가방` 제목 포커스, 활성 내비게이션, 항목 수, 조회 상태가 접근성 트리에 노출됐다. 최종 live region은 `가방 항목 8개를 표시합니다.`를 유지했다.

## 제한과 다음 Gate

이 검증은 preview mock 소비자까지의 T2 UI 검증이다. 실제 API 등록과 provider 연결, 동일 입력 Shadow가 없으므로 Gate 7 근거로 승격하지 않는다.
