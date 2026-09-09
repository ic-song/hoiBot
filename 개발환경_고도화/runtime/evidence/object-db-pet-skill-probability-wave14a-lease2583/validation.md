# Wave14A `/펫스킬확률` actual ingress 검증

- 기존 `source-provenance.json`과 `source-provenance-amendment.json`은 역사 보존을 위해 수정하지 않았다. 혼합 working-tree/줄바꿈 상태에서 계산된 기존 source hash는 `source-provenance-git-blob-amendment.json`이 명시적으로 supersede한다.
- 현행 source hash는 고정 커밋 `3232b907edad21b78e2303f778e8e7eff32fbb02`의 Git blob 원바이트를 기준으로 한다. 회귀 테스트가 tree, 경로 정렬, byte count, SHA-256 재현과 변조 거부를 검증한다.
- 실제 진입: `buildApp().inject()` → exact candidate → `CommandDispatcher` → `PetSkillProbabilityService` → canonical read-only snapshot → `queueCommandReply`.
- 레거시 오라클: source ref `8f075b4e`, 표시 92개, UTF-16 2630자, UTF-8 5494바이트, SHA-256 `4b1c023c26f0481d849044790b42d38a79d611b8971ee243af947ea0b2a9536a`.
- 경계: 미가입 silent, 정지 exact 안내, 5자 이상 닉네임 silent, 비지정방 ignored, `/펫스킬`·`/펫스킬정보` 미활성.
- 재실행: inbox duplicate, 동시 same-event, fresh app/client replay, 환경·메시지·actor·channel drift는 추가 답변과 추가 command execution 없이 fail closed.
- 저장: canonical definition/alias/policy의 row count와 의미 hash가 전후 동일하다. 외부 네트워크는 주입 callback으로 0회다.
- 보안 차이: 레거시는 활성 HoiPass 개인방을 허용하지만 현대 공통 Iris 정책은 `open_direct`를 거부한다. 이 slice는 더 넓게 열지 않았다.
- 기본 rollout: migration 483은 `SHADOW`; isolated 검증에서 해당 command만 `ACTIVE`로 전환했다.

## 검증 명령

- `node --import tsx --test test/pet-skill-probability-service.test.ts test/pet-skill-probability-migration.test.ts test/canonical-pet-skill-read-provider.test.ts` — 12/12 PASS
- `WAVE14A_ISOLATED_MARIADB_TEST=true node --import tsx --test test/pet-skill-probability-http-mariadb.integration.test.ts` — 1/1 PASS
- isolated MariaDB `127.0.0.1:3330` fresh all migrations — 471/471, canonical seed 93/93 + aliases 30 + policies 4
- migration 483 rollback → forward — 기존 routing FK가 있을 때 registry를 `LEGACY_ONLY`/disabled로 보존하고 alias 복구 후, forward에서 전용 alias `SHADOW` 재구성 PASS
- `node --import tsx --test test/object-data-model-contract.test.ts` — 24/24 PASS
- `npm run typecheck` — PASS
- `npm run build` — PASS
- `git diff --check` — PASS

Full suite, T3, Gate8, 운영 DB/데이터, feature/prod는 실행하거나 변경하지 않았다.
