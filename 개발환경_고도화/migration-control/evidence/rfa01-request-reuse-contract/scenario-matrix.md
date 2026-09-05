# RFA-01 scenario matrix

| scenario | expected | level |
| --- | --- | --- |
| same request key + exact same envelope/payload | persisted terminal result replay, effect count and receipt writes remain 1 | focused |
| same key + different scope/source event/actor type/actor id/player | `REQUEST_REUSE_IDENTITY_CONFLICT`, effect/DML 0 | focused |
| same key + different item/quantity/operation/target/reason payload | `REQUEST_REUSE_PAYLOAD_CONFLICT`, effect/DML 0 | focused |
| two distinct source events/request keys with same command text | each executes once | focused |
| concurrent same request | atomic adapter serializes; one effect and one terminal receipt | focused |
| provider restart after terminal persistence | new coordinator instance replays stored receipt; effect 0 | focused |
| effect failure before terminal persistence | no terminal receipt; error preserved; adapter owns rollback | focused |
| stored result fingerprint drift | `REQUEST_REUSE_RESULT_CONFLICT` | focused |
| input/actor/target/player/result/receipt accessor changes value between reads | accessor is never invoked; `REQUEST_REUSE_VALUE_NOT_CANONICAL`, effect/receipt 0 | focused |
| nested accessor, symbol, unexpected fixed-boundary field or Proxy | `REQUEST_REUSE_VALUE_NOT_CANONICAL`, trap/read count 0 | focused |
| approved input/result | one detached data-only snapshot is reused for fingerprint, comparison, persistence and return | focused |
| exact legacy currency fingerprint | compatibility verifier accepts | focused |
| exact legacy furniture fingerprint | compatibility verifier accepts | focused |
| exact legacy app-wiring identity/payload fingerprint | compatibility verifier accepts | focused |
| altered legacy fingerprint/profile | fail closed | focused |
| fingerprint-less item/operations receipt | not accepted as V1 or legacy proof | source audit |
| actual MariaDB transaction/outbox adoption | deferred to RFA-02/consumer Lease | not applicable in Lease2558 |
| production DB/rooms/JSON | forbidden | not run |
