# Wave7 source audit

- Lease/WBS/execution: `2575` / `751 Wave7` / `실행패리티하네스DB-SL-OBJECT-DB-EXECUTABLE-PARITY-HARNESS-01-WAVE7-202609061342`; baseline `e8a5a42eb670ebeb5f2f9395c4a5254f69272c93`.
- Before: frozen `1111`, proven/unproven `11/1100`, `DIRECT_PASS=11`, `STATIC_ONLY=548`, dynamic `552/790`, mismatch `8` unattributed, receipts `55`.
- Direct `SQL_REPOSITORY` cohort was exhausted by Wave6. The remaining static source audit found runtime dispatch `199`, admin command `78`, and automatic callback `1`; only deterministic, committed TypeScript chains whose handler and reply-queue transaction can be executed without external reply/network were eligible.
- Selected non-overlapping runtime READ consumers: `runtime-dispatch-f53934feccdd6d39` (`POINT_SHOP_CATALOG_READ`), `runtime-dispatch-f024a0ae45b58a2a` (`PACKAGE_BAG`), and `runtime-dispatch-e45c1c15e08c165a` (`PACKAGE_CATALOG_WIZARD_GUIDE`).
- Frozen dispatch spans are attested at ancestor `3e5cbd48ba94f23277adbb2327fab6c93c6a25b9`; the same span content is preserved at current shifted locations. Handler, service, repository/provider and `ProcessIrisEventService.queueCommandReply` source spans are separately hash-bound at the evidence commit.
- Integration review identified that the first Wave7 evidence stopped after the handler and incorrectly claimed READ_ONLY/DML0. The corrected chain executes the source-visible reply queue: operations → command_executions → outbox_messages, with UUID-v4 matcher and linked insert IDs.
- Excluded candidates include fresh paths with broader clocks/random IDs, domain transaction matrices, external delivery, or dynamic interpretation. The single reply-queue UUID is explicitly matcher-bound; no excluded consumer was promoted.
