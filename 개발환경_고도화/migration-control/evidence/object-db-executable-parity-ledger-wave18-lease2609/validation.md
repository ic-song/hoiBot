# WBS781 Wave18 검증

- 기반 focused: 9/9 PASS
- actual provider + child restart: 20개 binding PASS
- ledger Wave18 승격 검증: 1/1 PASS
- 독립 ledger validator: AJV 2020 strict PASS, receipt schema PASS, evidence commit ancestor PASS
- 정적 검증: typecheck PASS, build PASS, object-data 119 PASS, `main.js`/`Info.js` syntax PASS, diff-check PASS
- Wave17 compact prefix: 182건, 795,793 bytes, SHA-256 `ce5c0c207b9bb28f83553f776851b0d87d8e87f58aa9ba2cfca9c8d3f68663b6`
- Wave18 receipts: 신규 20, 전체 202, receipt ID 중복 0
- ledger: missing/duplicate/unknown 0, DIRECT_PASS 37, STATIC_ONLY 1,014, BLOCKED_DYNAMIC 82
- provider source 변경 0; 합성 fixture만 사용
- 운영 자산과 Gate8은 검증·변경 범위에서 제외
