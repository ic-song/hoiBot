# 가방 화면

## 목적

연결된 게임 계정의 가방을 `/account/inventory`에서 안전하게 조회한다. 아이템을 수정하거나 이동시키지 않는다.

## 화면과 상태

- 좌측 이용자 메뉴의 `가방`은 현재 위치에서 활성 표시와 `aria-current="page"`를 사용한다.
- 초기 조회는 진행 상태와 `aria-busy`를 표시한다. 비어 있으면 획득 안내를, 실패하면 원인과 다시 시도 동작을 표시한다.
- `401` 응답은 렌더링된 가방과 세션 데이터를 지우고 로그인 화면의 만료 안내로 이동한다.
- 각 아이템 이름과 수량은 `textContent`로 렌더링한다. 이름은 좁은 화면에서도 줄바꿈한다.
- 이전/다음은 `pagination.offset`, `pagination.limit`, `pagination.hasMore`를 따르며 비활성 상태를 명확히 표시한다.

## API 계약

`GET /api/v1/inventory/current?limit=20&offset=<offset>`의 mock 소비자다. 응답은 `ownerLabel`, `items[{displayName, quantity}]`, `pagination{limit, offset, total, hasMore}`를 사용한다. API 등록과 provider 연결은 별도 shared-integration Lease의 범위다.

## 접근성과 반응형

- 제목은 deep link 진입 시 포커스를 받으며, 결과·페이지 상태는 한 개의 polite live region으로 알린다.
- 키보드 포커스는 3px visible outline을 유지한다.
- 375px에서는 아이템과 페이지 컨트롤을 세로로 재배치하고, 768/1024/1440px에서는 셸의 기존 grid를 사용한다. 모든 텍스트 영역은 축소·줄바꿈 가능하게 하여 가로 넘침을 막는다.
