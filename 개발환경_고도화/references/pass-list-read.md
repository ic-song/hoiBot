# `/패스목록` modernization reference

`SL-PASS-LIST-READ` reads active pass entitlements from both the legacy compatibility table and the versioned support-pass table. It deduplicates each player/pass identity in favor of the versioned row, then preserves dated-before-permanent ordering and the existing operator-facing sections.

Expired dated rows are processed on the first KST day after their displayed end date. Premium expiry reuses the migration 196 policy and evidence tables to revoke S13, lock excess equipped skills, release excess furniture placements, and remove the auto-explore ticket only when no qualifying pass remains.

The command also reports current reward-run status and performs read-only consistency scans for invalid auto-explore tickets and free support-package totals. The command is registered as `PASS_LIST_READ` with handler `pass_list_read`; rollout remains outside Gate 8.
