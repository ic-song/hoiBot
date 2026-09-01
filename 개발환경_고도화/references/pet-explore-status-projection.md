# 펫탐험 상태 projection

`SL-PET-EXPLORE-STATUS-PROJECTION`은 레거시 `/지도`, `/탐험유저확인`, `/탐험유저확인 [0-10]`을 기존 현대화 탐험 데이터에 연결한다.

- 현재 탐험: `pet_explore_rounds`, `pet_explore_participations`
- 성공률 구성: `pet_explore_settlement_participant_source_projections`
- 자동 고정: `pet_explore_auto_fixed_configs`
- 이벤트 노출: `pet_explore_runtime_config`
- 다음 실행: `pet_explore_scheduler_state`
- 전적: `player_pet_explore_rank_stats`
- 사용자 표시명: `players`, `player_profiles`, `external_identities`

신규 공용 provider나 소유권 테이블을 만들지 않는다. 삭제 계정 정리는 기존 row를 같은 transaction에서 취소·삭제하고 감사 근거를 남긴다. Gate 8과 운영 전환은 별도 승인 전까지 수행하지 않는다.
