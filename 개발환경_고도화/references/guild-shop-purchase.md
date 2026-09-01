# 길드상점 구매 고도화

`/길드상점구매 [번호] [갯수]`는 `guild_shop_items.display_order` 순번을 사용합니다. 구매 시점에 상품, 포인트 계정, 재고, 일일 한도를 잠그고 하나의 operation으로 처리합니다.

세금은 `castle_state.tax_rate_basis_points`로 반올림 계산합니다. 성주 길드가 유효하면 세금의 15%를 `guild_resource_accounts.guild_fund`, 나머지 85%를 `foundation_states.happy`에 적립합니다.

상품은 활성 `item_definitions`에 연결된 stack item만 구매할 수 있습니다. 카탈로그 이름만 있고 `item_id`가 없는 상품은 안전하게 차단됩니다.

Gate8과 운영 전환은 별도 승인 전까지 수행하지 않습니다.
