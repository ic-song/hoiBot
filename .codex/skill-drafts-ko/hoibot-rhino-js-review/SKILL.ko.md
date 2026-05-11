---
name: hoibot-rhino-js-review
description: hoiBot Rhino JavaScript 호환성 검토, syntax check, Android MessengerBot 런타임 제약 확인, Node/browser 전용 API 방지에 사용한다.
---

# hoiBot Rhino JS 검토 스킬

Android MessengerBot Rhino 환경에서 실행되는 JavaScript를 검토하거나 수정할 때 사용한다.

## 런타임 가정

- 런타임은 Android MessengerBot Rhino JavaScript다.
- 최신 Node.js 또는 browser 런타임이 아니다.
- 메인 callback은 `response(room, msg, sender, isGroupChat, replier, imageDB, packageName)`이다.

## 피할 것

- ESM `import` / `export`
- `fs/promises`
- npm package runtime assumptions
- `fetch`에 의존하는 런타임 로직
- worker threads
- browser 또는 React APIs
- Rhino가 지원하지 않을 수 있는 modern-only syntax

## 검증

JavaScript 변경 시 syntax check를 실행한다.

```bash
node --check main.js
node --check Info.js
```

Node syntax check는 Rhino 런타임 호환성을 증명하지는 않지만 syntax error를 잡는다.

## 참고 문서

- `references/Rhino_호환성.md`: 호환성 검토 포인트
- `references/검증_체크리스트.md`: 최종 검증 전 확인
