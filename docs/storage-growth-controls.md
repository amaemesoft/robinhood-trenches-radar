# Storage growth controls

## Incident 2026-09-09

The 500 MB PostgreSQL volume filled after Shadow Desk production launch. Railway logs show two independent write paths failing with `No space left on device`: the legacy `radar_state` writer and ShadowStore. Before failure, Shadow Desk archived roughly 205-211 decisions every 120 seconds while the portfolio had zero trades, and Cycle Radar rebuilt roughly 687 candidates every worker cycle. This is write amplification, not useful dataset growth.

## Guardrails

- Shadow decisions are deduplicated in policy state and now also receive a database-side deterministic fingerprint. Identical WAIT/BLOCK evidence cannot create another journal row even after a restart or overlapping runtime.
- `position_mark` telemetry is retained for 14 days; trades, setups, decisions and audits remain durable.
- Cycle score history is sampled no faster than every 15 minutes and bounded to 400 points per token by default.
- Token state alone no longer keeps a token permanently in Cycle Universe. Seeds, recent events, or measured holder/market history inside the Cycle window are required.
- `radar_state` skips updatedAt-only rewrites.
- Startup logs now print PostgreSQL database size, WAL size when permitted, and the largest user relations. `/api/autopilot` persistence evidence includes Shadow relation byte sizes.
- `scripts/auditStorage.js` is a read-only diagnostic for database, WAL, relation, dead-tuple and Shadow-journal composition.

## Recovery rule

Do not delete WAL files or database files manually to make a full volume boot. Recover by creating safe headroom first, then run the read-only storage audit, deploy the growth guards, verify persistence hashes/portfolio continuity, and only then decide whether table cleanup, VACUUM, or additional retention is justified by measured relation sizes.

## Long-term review

The remaining `radar_state` design is a single JSONB document and therefore can still create write amplification as the state grows. After recovery, measure `radar_state`, WAL and per-map growth before deciding whether to normalize market/event/history state into separate tables. Do not assume a larger volume is a substitute for this measurement.
