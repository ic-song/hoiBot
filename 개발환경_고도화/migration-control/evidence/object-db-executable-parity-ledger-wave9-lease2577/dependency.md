# Wave9 의존성

```text
Iris event callback branch
→ exact command guard
→ MariaCommandRouteReader
→ CommandDispatcher.resolveReadOnly
→ production rank read service
→ isolated DatabaseClient transaction
→ processing.replies projection
→ STOP (external sender/network 전)
```

- 공용 스키마·migration·provider 변경 없음
- Wave9 전용 allowlist harness와 target만 신규 사용
- 기존 Wave8 receipt 94개를 hash/count/ID uniqueness/exact prefix로 fail-close 보존
