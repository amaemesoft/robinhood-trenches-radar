# Live execution boundary

## Current state

Phantom connection is `CONNECTED_READ_ONLY`. It proves that the browser wallet exposes an EVM account on Robinhood Chain and reads only the public address, current chain ID and native gas balance. No signer exists in the server and the browser code contains no signing or transaction-submission method.

`ShadowDesk` remains `SHADOW / PAPER_ONLY`. Its fills are evidence-preserving estimates, not executable quotes. No code path may reinterpret a paper fill as a live fill.

## Allowed progression

1. `CONNECTED_READ_ONLY`
   - User-initiated Phantom connection.
   - Chain ID, address and gas-balance verification.
   - No server session derived from wallet ownership.

2. `MANUAL_CONFIRM`
   - A fresh executable buy or sell quote is built for one exact contract.
   - The transaction is simulated immediately before display.
   - The user sees token, direction, input, minimum output, expected impact, gas, deadline and invalidation.
   - Phantom prompts for every signature and transaction.
   - The backend reconciles the receipt and actual balance deltas before recording a live position.

3. `SESSION_KEY_LIMITED`
   - Enabled only through an explicit, revocable wallet authorization.
   - The Phantom master key and recovery phrase never leave Phantom.
   - A session key is restricted by chain, approved router, method selectors, spend asset, maximum per transaction, rolling daily spend, expiry and emergency revocation.
   - Arbitrary calls, transfers, contract deployment, unlimited approvals and cross-chain actions are denied.

4. `AUTONOMOUS_LIMITED`
   - Requires healthy persistence, deterministic reconciliation and a kill switch independent from the decision loop.
   - Requires observed evidence that the strategy is suitable for a micro-capital pilot after realistic gas, price impact, failed transactions and quote deterioration.
   - Every submitted transaction links to the originating decision and stores quote, simulation, authorization policy, transaction hash, receipt and actual token deltas.

## Non-negotiable invariants

- Never request, log, store or transmit a Phantom recovery phrase or master private key.
- Never use the user's primary savings wallet as the autonomous execution account.
- Never submit a transaction when chain ID is not exactly `4663`.
- Never trade a ticker; exact token contract is mandatory.
- Never convert `UNKNOWN` Safety or Exitability to `PASS`.
- Never use an unverified router, spender or calldata target.
- Never grant an unlimited ERC-20 allowance.
- Never count transaction submission as execution; only a successful receipt plus reconciled balance deltas can create or close a live position.
- A stale quote, database outage, reconciliation mismatch or kill-switch failure blocks new entries.
- Live execution must remain disabled by default after every deploy and configuration reset.

## Production gates before MANUAL_CONFIRM

- PostgreSQL resolves and persists successfully.
- The storage growth audit completes with adequate headroom.
- The deployed commit matches the intended GitHub revision.
- `/api/health`, `/api/dashboard`, `/api/cycle` and `/api/autopilot` are healthy.
- Shadow state survives a controlled redeploy without resets or duplicate decisions.
- The canonical router, quoter, WETH and pool path are verified on-chain.
- Buy and sell transaction building have deterministic unit tests and fork/test transactions.

## Production gates before SESSION_KEY_LIMITED

- Manual-confirm transactions reconcile reliably.
- Policy enforcement is outside the model/decision prompt and cannot be overridden by a signal.
- Session authorization has an expiry and one-action revocation from the UI.
- Maximum bankroll, transaction size, concurrent positions and daily loss are enforced at submission time, not only in Shadow policy.
- Alerts fire on submission failure, receipt revert, unexpected allowance, balance mismatch and loss-limit activation.
