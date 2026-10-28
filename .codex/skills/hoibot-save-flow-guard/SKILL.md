---
name: hoibot-save-flow-guard
description: Review actual hoiBot persistence, save/load, DEV/PROD path or data-mutation changes. Use when storage behavior changes; command discovery and argument matching belong to hoibot-command-navigator.
---

# hoiBot Save Flow Guard

Keep storage-specific checks here; development workflow, approvals and completion follow the target repository's current rules. Do not repeat command discovery when the relevant handler and guard are already known.

- For save/load changes, use [save/load review](references/save-load-flow.md) to trace each changed object's load → mutation → matching save and failure path. Do not rerun unchanged persistence paths.
- For path selection changes, use [DEV/PROD paths](references/dev-prod-paths.md).
- Before testing snapshot/data-file changes, use [snapshot safety](references/data-snapshot-safety.md). Preserve original data and use synthetic or explicitly authorized DEV inputs.
- For actual JSON→DB migration or transactional mutation, reuse existing table/key/ledger mappings and identify the affected transaction boundary. Verify the relevant normal, failure, rollback, duplicate and restart behavior without imposing unrelated Gate suites. Reuse valid parity/Shadow evidence; regrouping commands does not invalidate it.

Legacy JSON examples do not define new storage contracts for DB-backed services.
