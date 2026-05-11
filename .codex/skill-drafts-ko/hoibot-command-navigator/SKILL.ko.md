---
name: hoibot-command-navigator
description: hoiBot 명령어 탐색, 유사 명령어 충돌 확인, startsWith/indexOf 명령어 가드 수정, helper/save-flow 추적, COMMAND_INDEX.md 동기화, COMMAND_REGISTRY.md 검증에 사용한다.
---

# hoiBot 명령어 탐색 스킬

hoiBot 명령어를 찾거나 수정할 때 사용한다.

## 핵심 원칙

- 현재 소스 코드가 항상 진실의 원본이다.
- `COMMAND_INDEX.md`는 탐색 보조 문서이며 진실의 원본이 아니다.
- `COMMAND_REGISTRY.md`는 사람이 보는 명령어 체크리스트이며 삭제 승인 문서가 아니다.
- 검색 실패는 없음이 아니라 미확인으로 본다.
- 새 로직을 만들기 전에 기존 helper와 기존 명령 흐름을 우선 재사용한다.
- `main.js`의 광범위한 재작성이나 대량 치환을 피한다.
- 사용자에게 보이는 줄바꿈, 이모지, `allsee` 형식을 보존한다.

## 필수 흐름

1. 명령어/helper/data-flow 탐색 작업이고 `COMMAND_INDEX.md`가 있으면 먼저 확인한다.
2. 모든 발견 내용은 `main.js`, `Info.js`, 관련 helper 정의에서 다시 검증한다.
3. 관련 명령어 alias, 출력 메시지, helper 호출, 데이터 사용, 저장 흐름을 함께 검색한다.
4. 수정이 필요하면 기존 동작을 보존하는 최소 변경을 적용한다.
5. 명령어/helper/save-flow 정보가 바뀌고 현재 브랜치에 `COMMAND_INDEX.md`가 있으면 검증된 코드 기준으로 갱신한다.
6. `COMMAND_REGISTRY.md`는 명령어 목록, `미사용`, `삭제유무`, `비고`가 실제로 바뀔 때만 갱신한다.

## 명령어 가드 규칙

데이터를 변경하거나 실행 효과가 있는 명령어는 넓은 prefix 조건보다 정확한 조건 또는 전체 패턴 조건을 사용한다.

위험한 예:

```js
if (msg.startsWith("/집청소")) {
```

안전한 예:

```js
if (msg === "/집청소" || /^\/집청소\s+\d+$/.test(msg)) {
```

숫자 인자 뒤에 설명 문장이 붙은 메시지는 실행되면 안 된다.

실행되면 안 되는 예:

```text
/집청소 1 해볼래
/고급티켓조합방법
/마정석조합 3 알려줘
```

## 참고 문서

- `references/명령어_탐색_흐름.md`: 명령어 탐색 체크리스트
- `references/명령어_등록부_규칙.md`: `COMMAND_REGISTRY.md` 수정 시 규칙
- `references/위험한_명령어_가드.md`: accidental command execution 수정 시 규칙
