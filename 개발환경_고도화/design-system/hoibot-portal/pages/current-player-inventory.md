# 현재 사용자 분류 가방 화면

`/account/inventory`는 인증된 현재 게임 계정의 일반 가방과 가구가방을 구분해 조회하는 읽기 전용 화면이다.

## 화면 계약

- 상단에는 기존 포인트·다이아 잔액을 유지한다. 가방 탭 전환은 프로필 또는 잔액을 다시 계산하거나 지우지 않는다.
- `일반 가방`과 `가구가방`은 명시적인 탭이며, 현재 탭은 시각 강조와 `aria-selected`로 함께 표시한다.
- 일반 가방은 `category=general`, 가구가방은 `category=furniture`를 API에 명시한다. 탭 전환 시 해당 분류의 첫 페이지부터 조회한다.
- 일반 가방 행은 기존 이름과 수량 표시를 유지한다.
- 가구가방 행은 이름, 등급, 매력도, 수량 1을 표시한다. player, instance, definition 등 내부 식별자는 표시하지 않는다.
- 선택한 분류와 응답의 category가 다르면 빈 목록으로 처리하지 않고 복구 가능한 오류로 표시한다. 이름이나 이모지로 분류를 추정하지 않는다.

## 상태와 페이지 이동

- 두 분류 모두 조회 중, 빈 가방, 오류와 다시 시도, 이전·다음 페이지 상태를 독립적으로 이해할 수 있는 문구로 표시한다.
- 페이지 이동은 provider의 `pagination.offset`, `limit`, `hasMore`만 따른다.
- `401`은 일반·가구 목록과 페이지 상태, 상단 잔액, 세션 데이터를 지운 뒤 로그인 만료 안내로 포커스를 이동한다.

## 접근성과 반응형

- 탭은 native button과 tab semantics를 사용하고 최소 높이 44px, visible focus outline을 유지한다. 좌우 방향키와 Home/End로 탭을 이동할 수 있다.
- 상태 변화는 polite live region으로 분류 이름과 함께 알린다. 결과 문자열은 `textContent`로만 렌더링한다.
- 375px에서는 행과 페이지 버튼이 좁은 폭에 맞게 재배치된다. 768/1024/1440px에서는 기존 shell grid를 유지한다.
- 이름은 줄바꿈하고 가구 세부 값은 wrap하며, 모든 content column은 축소 가능해 가로 overflow가 0이어야 한다.

## API 계약

`GET /api/v1/inventory/current?category=general|furniture&limit=20&offset=<offset>`를 사용한다. 일반 응답의 기존 `ownerLabel`, `items[{displayName, quantity}]`, `pagination` 계약을 보존한다. 가구 응답은 `category: "furniture"`와 `items[{displayName, gradeDisplayName, charm, quantity: "1"}]`만 UI에 사용한다.
