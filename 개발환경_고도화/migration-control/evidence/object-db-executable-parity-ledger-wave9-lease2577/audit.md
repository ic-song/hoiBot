# Wave9 현행 감사

- Lease: `2577`
- base: `f6a72d935a885bbb435dd89cbb61bb88ee4aae63`
- source provenance: `e22cfdf87f24f3e41b1ce3584749b4a99438adc3`
- 대상 consumer: 5개 (`누렙순위`, `누좋순위`, `종합순위/ㅈㅈㅈ`, `펫홈순위`, `가구순위`)
- catalog의 app sourceSpan은 v14 현재 app.ts 위치와 달라 `STALE_RELOCATED_AT_WAVE9`로 기록하고, 각 실제 분기 경계를 다시 찾아 hash로 고정했다. 기존 manifest는 수정하지 않았다.
- 각 서비스는 조회 명령이지만 동일 transaction에서 `operations`, `outbox_messages`, `command_executions`, `command_audit`, `operations UPDATE` 5개 운영 증거 DML을 수행한다.
- 실제 게임/source domain DML은 0이다.
- provider, migration, `main.js`, `Info.js`, `data/*`, 운영 DB/데이터는 변경하지 않았다.

## 남은 위험

- 재시도 정책이 없고 순위 집합에 광범위 `FOR UPDATE`를 사용한다.
- eventId만 멱등성 키이므로 destination 변경은 기존 결과를 재사용할 수 있다.
- 가구순위는 `charm_snapshot`, `grade_display_name` legacy projection을 사용한다.
- 종합순위는 다수 legacy projection과 스킬 표시명 연결을 사용한다.
- 실제 MariaDB lock timeout/deadlock과 운영 부하는 Gate8 전 별도 검증 대상이다.
