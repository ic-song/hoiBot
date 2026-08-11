# Slice evidence schema

Keep one UTF-8 JSON document per functional slice. Snapshot-specific counts and results belong here.

```json
{
  "schemaVersion": 1,
  "sliceId": "player-profile-read",
  "status": "investigating",
  "commands": {
    "names": ["/내정보"],
    "sourceFiles": ["main.js"],
    "guards": ["exact command guard or verified dispatch description"],
    "helpers": ["helperName"],
    "automaticFlows": []
  },
  "legacyData": {
    "files": ["data/member.json"],
    "readPaths": ["member.<user>.level"],
    "writePaths": [],
    "devProdRoutingVerified": true
  },
  "database": {
    "migrations": ["005_player_profile.sql"],
    "tables": ["player_profiles"],
    "constraints": ["players.id -> player_profiles.player_id"],
    "transactionBoundary": "read-only profile projection"
  },
  "trialMigration": {
    "sourceSnapshot": "artifact name plus checksum reference",
    "targetDatabase": "disposable database identifier",
    "sourceReadOnly": true,
    "replayPolicy": "idempotent or single-use with reason",
    "checks": ["derived count and total reconciliation"],
    "result": "pending"
  },
  "logicPort": {
    "services": ["service or formatter path"],
    "repositories": ["repository path"],
    "tests": ["test or fixture path"]
  },
  "parity": {
    "fixtures": ["anonymized fixture identifier"],
    "comparisonMode": "exact text",
    "result": "pending"
  },
  "cutover": {
    "freezePlan": "pending",
    "finalImportPlan": "pending",
    "smokePlan": "pending",
    "rollbackPlan": "pending"
  },
  "risks": ["known unverified behavior or blocker"]
}
```

Allowed `status` values are `investigating`, `rehearsal`, `ported`, `verified`, and `cutover_ready`. Trial and parity results are `pending`, `passed`, or `failed`.

Do not put tokens, account credentials, raw KakaoTalk content, or personal identifiers in evidence.
