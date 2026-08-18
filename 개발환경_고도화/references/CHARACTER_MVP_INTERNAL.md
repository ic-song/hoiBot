# 원이 콘셉트 캐릭터 MVP — 이관 기록

> 상태: `SUPERSEDED`
> 대체 결정: `DEC-063`
> 갱신일: 2026-08-11

이 문서는 hoiBot 안에서 캐릭터 MVP를 실행하려던 초기 구현 기록이다. 현재 실행 사양으로 사용하지 않는다.

캐릭터챗 코드는 `C:\Users\user\Desktop\Kernote\프로젝트\character-chat-mvp`로 이관한다. hoiBot과 공유하는 것은 현재 PC의 Hyper-V·redroid·KakaoTalk/Iris 실행 환경과 Iris HTTP 계약뿐이며, hoiBot Server·MariaDB·웹·outbox·브랜치에는 의존하지 않는다.

Character MVP Service, migration `028`, `/character/woni` 화면과 통합 hunk는 독립 프로젝트 검증 후 이 작업트리에서 제거했다. 다른 미커밋 작업은 보존했다.

OpenAI 키는 hoiBot의 `.env` 또는 `.env.local`에 저장하지 않는다. Kernote의 `kernote.secrets.age`에서 `node scripts/kernote-secrets.mjs run -- <command>`로 독립 프로세스에만 메모리 주입한다.

실 API 호출, DB migration과 Iris 실전 송수신은 별도 승인 전 수행하지 않는다.
