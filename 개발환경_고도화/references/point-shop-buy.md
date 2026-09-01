# Point shop buy modernization

`/구매` now consumes the database point-shop catalog instead of a static reward switch in the modern runtime.

The catalog keeps the nine verified v2.400 products. Each row declares a stable effect type, optional canonical reward item, effect configuration, request limit, and daily limit. The service resolves the linked player, locks the point balance and affected ownership rows, applies the product effect, and writes all ledgers and audit records in one transaction.

The legacy Rhino implementation remains unchanged. The command registry starts in `SHADOW`, and Gate 8 remains false until the separate operational-readiness wave.

