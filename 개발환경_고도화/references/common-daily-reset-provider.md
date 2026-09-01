# 공용 일일 리셋 provider

- Slice: `SL-COMMON-DAILY-RESET-PROVIDER-01`
- Baseline: `ee934c78e6503504ac35ce2aca6417605595e11e`
- Migration: `433_common_daily_reset_provider.sql`
- 운영 기준일: KST `YYYY-MM-DD`
- 원자 경계: 전역 잠금, reset run, 단계별 mutation, operation, audit, internal outbox
- 대상 projection: 당근 게시판, 출석, 일일 counter, 펫 일일 기록, 탐험 scheduler
- 제외: `/리셋` guard·권한·사용자 응답·방송, legacy `main.js`/`data`, 운영 DB, Gate 8
- 다음 소비자: `SL-OPERATION-DAILY-RESET`가 명령 경계와 응답/방송을 소유하며 이 provider를 호출한다.
