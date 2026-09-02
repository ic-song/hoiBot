# WBS734 canonical furniture/home validation

- Migration `445_object_furniture_home_canonical_model.sql` is additive; legacy `furniture_definitions`, `owned_furniture`, and `furniture_inventory_instances` are not changed.
- New canonical definition rows keep exact UTF-8 display names and common `purchase_price`, `base_charm`, and `charm_per_enhancement` values only once.
- Each owned copy has its own `owned_furniture_id`; `enhancement_level` and `ownership_status` are the only business state stored on the instance.
- Home reads join the current definition and calculate `base_charm + enhancement_level * charm_per_enhancement`; no `final_charm` or snapshot column exists in migration 445.
- `object_furniture_operation_replays` protects grant replay through `(player_id, idempotency_scope, idempotency_key)` in the same transaction as instance creation.
- Local MariaDB execution is intentionally not attempted: no development `.env` / database target is provisioned in this isolated worktree. Contract, typecheck, build, and static SQL checks are required before an isolated MariaDB probe.
