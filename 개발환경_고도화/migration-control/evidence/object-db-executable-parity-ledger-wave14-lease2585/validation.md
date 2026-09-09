# Wave14 검증

- Wave14 focused: 3/3 PASS. required 5종을 실제 `buildApp.inject`로 실행했다.
- 독립 레거시 oracle: `8f075b4e...:main.js` 고정 span, 표시 92개, UTF-16 2,630자, UTF-8 5,494바이트, reply SHA-256 `4b1c023c26f0481d849044790b42d38a79d611b8971ee243af947ea0b2a9536a`와 dev/prod 전체 바이트가 일치했다.
- risk cohort: 회원 거부, 잘못된 방, 5자 닉네임, 동일 이벤트 replay, 동시성 single outbox, 환경·메시지·actor·channel·destination 양방향 drift, provider/outbox rollback 후 재시도, 정확한 1213/1205 제한 재시도, code-only/errno-only 비재시도, 3회 소진을 실행했다.
- receipt generation: prior 155건 compact 693,449 bytes/SHA-256 `c2774106e73fe7f4793958eeb2047c27b20f12c0cab0c97c83efa603ef8d8b60`을 변경하지 않고 5건을 append해 총 160건이다. 신규 compact receipt 배열은 740,925 bytes/SHA-256 `7e38dafffbceb20e8ffba2982bcc7607fc3b15927e2484e3ab38cbf003f7f71b`다.
- strict160: AJV 2020-12 ledger/receipt schema, deterministic build, Git blob provenance PASS. entrySetSha256 `8bc76d0391af7b090c0bf260bc1d444a27ca0577f6d2a6ce3397a626aa965b79`.
- ledger negative: 기존 전체 10/10 PASS, Wave14 recomputed output/import-chain tamper 1/1 PASS.
- object data model contract 24/24, TypeScript typecheck/build, diff check PASS.
- 과거 155건은 고정 bundle/root/개별 receipt로 진위를 인증하며 현재 이동된 source span으로 재해석하지 않았다. Wave14 5건만 현재 실행 대상으로 replay했다.
- 이 slice는 MariaDB를 시작하지 않았고 외부 네트워크·운영 DB·운영 데이터·feature/prod·Gate8·full suite·T3를 실행하지 않았다.
