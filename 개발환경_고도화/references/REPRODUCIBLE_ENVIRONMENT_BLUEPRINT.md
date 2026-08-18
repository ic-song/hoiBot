# Reproducible Environment Blueprint

Updated: 2026-08-06

## Objective

Build the same hoiBot modernization environment on a home PC and later on the operation PC with minimal manual differences.

The repository must describe the environment. Machine-specific secrets, addresses, room IDs, account identifiers, and production data must remain outside Git.

## Confirmed Baseline

```text
Windows PC
-> Hyper-V
-> Ubuntu/Linux VM
-> Docker
-> redroid
-> KakaoTalk + Iris
-> hoiBot Server: TypeScript + Node.js 24 LTS + Fastify 5
-> hoiBot database: MariaDB
```

The target placement is fixed: run hoiBot Server and MariaDB as Docker Compose services in the same Ubuntu/Linux VM while keeping redroid as a separate service boundary. The current development server still runs as a Windows scheduled `node.exe` process; this is an interim validation arrangement, not the final deployment shape.

## Selected setup reference

- Video: `Iris를 이용한 봇 만들기`
- URL: <https://www.youtube.com/watch?v=H43VTOsKDXY>
- Relevant flow: Hyper-V/Linux from `7:46`, followed by Docker/redroid, and Iris installation around `21:20`

The video is an installation reference only. `../DECISIONS.md` remains authoritative for architecture and implementation choices.

## Development port allocation

| Service | Bind | Port | Rule |
| --- | --- | ---: | --- |
| hoiBot API | `0.0.0.0` | `3002` | Existing local `3000` + 2; fail if occupied |
| hoiWorld Vite server | `127.0.0.1` | `5175` | Default `5173` + 2 with `strictPort` |
| hoiBot MariaDB mapping | `127.0.0.1` | `3308` | Existing local `3306` + 2; fail if occupied |
| redroid Iris API | redroid/VM address | `3000` | Remote dependency; no collision with PC loopback port |

Do not silently select another port. When an allocation changes, update runtime environment files, Compose, frontend proxy, Iris callback configuration, and this document together.

## Target Runtime Shape

```text
Windows host
└─ Hyper-V Ubuntu/Linux VM
   └─ Docker
      ├─ redroid
      │  └─ KakaoTalk + Iris
      ├─ hoibot-server
      └─ mariadb
         └─ named persistent volume
```

Network flow:

```text
Iris -> hoibot-server HTTP/WS
hoibot-server -> Iris /reply and read-only /query
hoibot-server -> MariaDB
```

MariaDB must not be exposed to the Windows LAN unless an explicit operational need is approved. Prefer a private Docker network with only the server able to reach the database service.

## Repository-Owned Artifacts To Build

All modernization artifacts stay under `개발환경_고도화/`.

```text
개발환경_고도화/
├─ runtime/
│  ├─ src/
│  ├─ test/
│  ├─ migrations/
│  ├─ Dockerfile
│  └─ .env.example
├─ infra/
│  ├─ compose.yaml
│  ├─ mariadb/
│  │  └─ conf.d/
│  └─ scripts/
│     ├─ bootstrap.ps1
│     ├─ verify.ps1
│     ├─ backup.ps1
│     └─ restore-verify.ps1
└─ references/
```

This is the intended structure, not proof that each artifact already exists.

## Configuration Contract

Commit only `.env.example` with placeholders and comments. Each PC keeps a local ignored `.env`.

Required configuration groups:

- Server: host, port, log level, body limits, runtime mode.
- Iris: base URL, shared token, endpoint/public server address.
- MariaDB: host/service name, port, database name, application user, password, connection-pool limits.
- Operations: backup directory, retention count, timezone, health-check timeout.
- Optional test-only identifiers: test room ID and feature switches.

Rules:

1. Never commit passwords, tokens, Kakao identifiers, room IDs, database dumps, or production `.env` files.
2. Home and operation PCs use the same variable names and Compose file.
3. Only values differ between machines.
4. Production data must not be copied to the home PC unless it is explicitly sanitized.
5. Fail startup when required variables are missing; do not silently use unsafe defaults.

## Version Reproducibility

- Pin the runtime major versions confirmed in `DECISIONS.md`.
- Pin container image versions or digests after compatibility validation.
- Commit the npm lockfile.
- Run database migrations automatically as a separate controlled step, not concurrently from every server replica.
- Record the application version and migration version in health/diagnostic output without exposing secrets.

## One-Machine Bootstrap Flow

The future bootstrap script should:

1. Verify Windows virtualization and Hyper-V prerequisites.
2. Verify the Ubuntu/Linux VM and required CPU, memory, disk, and network configuration.
3. Verify Docker Engine and Compose availability.
4. Copy `.env.example` to a local `.env` only when `.env` does not exist.
5. Refuse to continue while placeholder secrets remain.
6. Pull/build pinned images.
7. Start MariaDB and wait for its health check.
8. Apply pending schema migrations.
9. Start hoiBot Server and verify `/health/live` and `/health/ready`.
10. Verify redroid/Iris reachability and the configured Iris event endpoint.
11. Run a test-room `/ping` round trip.

The script must not install or modify KakaoTalk account state without explicit operator approval.

## Verification Checklist

An environment is equivalent only when all checks pass:

- Docker services use the expected pinned versions.
- MariaDB is healthy on the private network.
- The server can run `SELECT 1` against its own MariaDB.
- The schema migration version matches the repository.
- Server live/ready endpoints pass.
- Iris can deliver an event to the server.
- Exact `/ping` returns `sender pong` in the test room.
- A MariaDB test transaction can insert and roll back without leaving a row.
- Restarting the server preserves MariaDB data.
- Restarting MariaDB preserves data in the named volume.
- A backup can be restored into a disposable validation database.
- Image auto-forwarding remains OFF unless explicitly enabled.

## Home PC Versus Operation PC

| Concern | Home PC | Operation PC |
| --- | --- | --- |
| Purpose | Development and migration rehearsal | Live operation |
| Kakao room/account | Dedicated test context | Approved production context after validation |
| MariaDB data | Synthetic or sanitized | Production data |
| Logs | Debug allowed with redaction | Minimum necessary, structured and redacted |
| Backups | Restore rehearsal | Scheduled, retained and copied off-host |
| Feature flags | Test features allowed | Only validated features enabled |

## Backup and Recovery Baseline

- Use a named MariaDB volume for persistence, but do not treat the volume as a backup.
- Produce regular logical dumps with a consistent transaction option where supported.
- Encrypt backups that contain production data.
- Keep at least one copy outside the VM/host disk.
- Apply a documented retention policy.
- Test restore into a disposable database before calling backup automation complete.
- Record backup time, schema version, application version, file size, and verification result without recording credentials.

## Build Order

1. Confirm server/MariaDB placement in the Ubuntu VM.
2. Add Compose, Dockerfile, private network, volume, and health checks.
3. Add server MariaDB configuration and a pooled connection.
4. Add migrations and a migration status check.
5. Add backup and restore-verification scripts.
6. Implement the first JSON-to-MariaDB vertical slice from `MARIADB_IMPLEMENTATION_BLUEPRINT.md`.
7. Rehearse the entire bootstrap on the home PC.
8. Record measured CPU, memory, disk, startup time, and backup/restore time.
9. Repeat the same flow on the operation PC using only a different local `.env` and production data procedure.

## Completion Criteria

The environment work is complete when a clean PC can follow one documented bootstrap path, pass the verification checklist, restore a test backup, and run the same server commit and database migration version without manual source edits.
