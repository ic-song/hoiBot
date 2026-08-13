# 관계형 합성 임시데이터

`functional-v1.sql`은 DB 설계와 기능 이관 검증에만 사용하는 비식별 fixture다.

- 실제 운영 `data/*`를 읽거나 수정하지 않는다.
- ID는 개발 전용 `900000xxx`, code와 외부 식별자는 `synthetic-*` namespace를 사용한다.
- 실제 KakaoTalk ID, 사용자명, 메시지 원문, 운영 콘텐츠를 포함하지 않는다.
- `hoibot_schema_design` 또는 `hoibot_rehearsal_*` DB에서만 loader가 실행된다.
- SQL은 같은 결과로 반복 적용할 수 있도록 고정 PK와 upsert를 사용한다.
- 가입 전 경량 출석을 검증하기 위한 candidate identity와 `pre_signup_attendance` 1건을 포함한다.
- 펫 생성 관계를 검증하기 위한 펫 성격·가입일, 정령, 스킬 가방 projection을 포함한다.
- `/펫정보` 조회를 검증하기 위한 펜던트, 친밀도, 홈뱃지 큐브, KST 일일 기록 projection을 포함한다.
- `/펫이름` 변경을 검증하기 위한 `펫 이름변경권🎫` item definition과 2개 stack을 포함한다.
- 운영 오픈 전 합성 DB를 폐기·재생성하며 이 데이터는 최종 import·reconciliation 증거로 인정하지 않는다.

실행:

```powershell
cd 개발환경_고도화/runtime
node --env-file-if-exists=.env --import tsx scripts/load-synthetic-relational.ts
node --env-file-if-exists=.env --import tsx scripts/load-synthetic-relational.ts --apply
node --env-file-if-exists=.env --import tsx scripts/load-synthetic-relational.ts --verify-only
```
