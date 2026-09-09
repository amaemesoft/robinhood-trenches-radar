# Trenches Shadow Desk — production policy v2

The product V1 uses a deterministic role pipeline and an independent post-decision AUDITOR. It is permanently SHADOW / PAPER_ONLY: there is no signer, private key, transaction submission, live toggle or order API.

`node scripts/startProduction.js` supervises one API process plus the social/on-chain worker and the existing 20-wallet Alchemy fallback. A dead child restarts the service. Shadow runs explicitly inside the API every 120 seconds, never in a competing HTTP wrapper.

## Required entry gates

ORBIT discovers observations. SIGNAL independently requires two verified/strong money identities, distinct economic BUY/ADD/REENTRY transaction evidence available at decision time, and an active tactical entry state. Social SCOUT, ACQUIRE, TRANSFER_OUT, provisional identities and Cycle Potential do not authorize entry. ATLAS rejects missing, stale or future prices and unconfirmed contracts. SENTINEL requires all critical safety fields PASS, a fresh exit quote and known nonnegative sell impact <=10%. VECTOR defines an expiring setup; PULSE requires a later 3–18% pullback and keeps no-chase active. ANCHOR requires known liquidity/quote size and caps size to cash, 8% equity, 0.75% stop risk, quote target and 0.1% liquidity. Daily loss >=4% and five positions block new entries. FUSE uses conjunction; COMMANDER records and cannot override any gate.

Paper fills use market price plus the measured exit-impact proxy on entry (minimum 0.5%); this is an explicitly labeled approximation, not an executable buy quote. Exit fills use the available measured sell impact without artificially capping losses. Missing/stale/unavailable exit quotes leave EXIT_PENDING; they do not fabricate a liquid exit. P&L is paper mark-to-market and excludes gas, fees and intrabar paths.

## Persistence and audit

`shadow_portfolio` stores the bankroll, open positions, active setups, counters and working caches. A PostgreSQL transaction advisory lock serializes portfolio reads/writes across overlapping deployments. `shadow_journal` retains immutable decisions, setup creation, position marks and trades; `shadow_audits` retains evolving post-decision observations. The bounded working caches do not delete the durable journal. Rollbacks propagate errors; success is logged only after COMMIT. The old `radar_state.shadowDesk` is migrated only when no portfolio exists. No startup balance reset occurs.

Each decision archives exact chain/contract, timestamp, policy, agent conclusions, available source events/identity snapshots and market/safety evidence. Trades link decision/setup/position IDs and record fills, slippage model, size, stops, invalidation and exit reason. Health exposes runtime commit/deployment. GET `/api/autopilot` reads persisted state and returns revision, timestamp and ledger hash; all non-GET autopilot routes return 405. GET `/api/autopilot/history?limit=50&offset=0` pages the full journal; `kind=audit` selects audits.

AUDITOR observes subsequent available prices only; it never feeds back into gates. It records sampled MFE/MAE, +5m/+15m/+1h/+6h/+24h returns, actual observation delays, entry adverse excursion and exit giveback, false positives, blocked-then-rose and avoided-loss cohorts. Marks beyond the horizon tolerance remain missing. Refreshing audit-only candidates rotates a bounded batch; open risk and active setups have priority. Intrabar extremes are not claimed. Cohorts are one token/outcome/day plus setups/trades, and are correlated; per-agent status return associations do not establish causal edge or statistically independent samples. Results require a real prospective dataset, not forced entries.

## Verification

Run `npm ci --omit=dev` and `npm test`; Docker also runs the suite. In production verify health, dashboard, cycle, autopilot, journal and runtime logs. Capture `createdAt`, initial bankroll, counters, ledger hash and journal rows; redeploy the confirmed latest commit and compare. An unchanged cash-only ledger is a valid persistence test when the market has produced no valid trades; do not insert test trades into production.
