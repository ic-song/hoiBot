# Lease2618 migration delimiter runner 검증

## 범위

- 기준: `d99832c5`
- 구현 커밋: `38b266e3d511f471a1bece9c31d131b79da57acd`
- 격리 DB: `127.0.0.1:3349/hoibot_rehearsal_migration_delimiter_evidence`
- DB engine: `11.8.8-MariaDB-ubu2404`
- 운영 DB, host 3306, 외부 network, `feature/prod`: 사용하지 않음

## 실제 명령 결과

```text
listener-start hoibot-migration-delimiter-evidence 127.0.0.1:3349->3306/tcp Up 20 seconds
applied 484_pet_skill_info_shadow_ingress.sql
applied 485_pet_skill_info_admin_bag_projection.sql
applied 486_private_chat_denial_notice.sql
applied 487_pet_skill_info_direct_reply_canary.sql
applied 488_item_bag_import_completeness.sql
applied 489_legacy_rank_label_side_effect_certificate.sql
applied 490_item_bag_import_baseline_ordering.sql
migration-count 478
```

재실행 출력에는 `applied` 행이 없었고 `migration-count 478`만 존재했습니다. 재실행 전후 원장 행 수와 마지막 적용 시각도 모두 `478`, `2026-09-09 03:34:44.933`으로 동일했습니다.

```text
migration490|0550358c66a406dd2ab40e697a23e475a3950243c28bdfeaa8a028f6291a3e88|2026-09-09 03:34:44.933
trigger|1
preflight-routine|0
listener-before-removal hoibot-migration-delimiter-evidence 127.0.0.1:3349->3306/tcp
listener-after-removal|none
```

`preflight-routine=0`은 migration 안에서 procedure 생성·호출 후 `DROP PROCEDURE`까지 완료됐음을 뜻합니다. `SHOW CREATE TRIGGER`로 `trg_item_inventory_ledger_order_after_insert`의 전체 `BEGIN ... END` 본문이 한 trigger로 저장된 것도 확인했습니다.

## 검증 명령

```text
node --import tsx --test test/migration-sql-batches.test.ts
npm run typecheck
npm run db:migrate
npm run db:migrate
```

결과 요약 canonical JSON의 SHA-256은 `08560bab02bdb385b302dc6e55fde68ee7109187f31128c366e890d7f951a095`입니다. migration 490 파일 SHA-256과 `schema_migrations.checksum`은 모두 `0550358c66a406dd2ab40e697a23e475a3950243c28bdfeaa8a028f6291a3e88`로 일치했습니다.
