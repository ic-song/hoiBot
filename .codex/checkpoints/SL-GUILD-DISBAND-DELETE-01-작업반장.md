# SL-GUILD-DISBAND-DELETE-01 checkpoint

- phase: COMPLETE
- execution: 작업반장-SL-GUILD-DISBAND-DELETE-01-RECOVERY-202609011742
- lease: 2478
- baseline: 15e7e554f2a652b2e4a6d6cc36f39561ee0d0ad4
- branch: codex/modernization-guild-disband-delete-v2438-20260901
- migration: 431_guild_disband_delete.sql
- gates: Gate1~7 TRUE, Gate8 FALSE
- contract: 이름은 입력에만 사용하고 잠긴 stable guild_id로 해산한다. 물리 삭제 대신 disbanded tombstone을 남긴다.
- cleanup: 현재 회원, 이름 registry, 가입 대기, 활성 영지·균열·성주 projection을 동일 transaction에서 정리한다.
- evidence: focused 2/2, typecheck/build PASS, fresh MariaDB 1/1, full 1372/pass1365/fail0/skip7
- safety: legacy main.js/data, feature/prod, 운영 DB 변경 없음
