# SL-GUILD-BOARD-READ-WRITE checkpoint

- Baseline: legacy v2.400 / source contract `a286279b`
- Catalog: `FROZEN-20260820`
- Lease: 2322, one implementation Lease
- Scope: `/길메`, `/길드게시판`, `/길드게시판공지`, `/길드게시판초기화`
- Preserved contract: 30-character body, every guild member may post, master/sub-master notice and clear, newest-first read, maximum 20 posts, clear preserves notice
- Safety: stable player/guild IDs, guild row lock, event idempotency, one transaction, audit, outbox, rollback and restart replay
- Legacy: `main.js`, `Info.js`, production DB/data and `feature/prod` remain unchanged
- Gate8: not started
