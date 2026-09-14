# Live execution boundary

## Architecture

Live execution uses a dedicated Alchemy Modular Account v2 on Robinhood Chain. The connected Phantom EVM account is the owner, but its seed phrase and private key never leave Phantom. The backend stores only a generated session key whose permissions, expiry and total spend are bounded.

`ShadowDesk` remains `SHADOW / PAPER_ONLY`. A paper fill is never treated as an executable fill. The live runtime may consume a fresh `ENTRY` decision only as a trigger, then independently resolves the exact contract, refreshes market and safety evidence, obtains a new on-chain quote, simulates the buy and rechecks every live gate.

## Pilot limits

- Dedicated bankroll target: `0.005 ETH`.
- First mainnet round trip: `0.0001 ETH`, bought and sold immediately.
- Maximum later entry: `0.001 ETH`.
- Maximum concurrent live positions: `1`.
- Realized daily-loss stop: `-0.0015 ETH`.
- Slippage floor: `3%`; stop-loss reference: `12%`; trailing stop arms after `+35%` with `18%` giveback.
- Session expiry: `7 days`.
- Session native/WETH transfer allowance: `0.004 ETH` total.
- Chain: exactly Robinhood Chain `4663`.

Environment policy can only make these limits stricter. `LIVE_EXECUTION_ALLOWED` defaults to false and the production owner can be locked with `LIVE_OWNER_ADDRESS`.

## Activation state machine

1. `UNCONFIGURED`
   - Phantom connects through its injected EVM provider.
   - The browser verifies chain `4663`, address and native balance.

2. `ACCOUNT_CREATED`
   - Phantom signs a single-use ownership challenge.
   - The Wallet API derives a deterministically salted, app-dedicated `sma-b` smart account.
   - The user sends only the missing amount needed to reach the pilot bankroll.

3. `SESSION_AUTHORIZED`
   - Phantom signs Alchemy's EIP-712 session authorization.
   - No root permission is granted.
   - The session permits only the verified Uniswap router swap selector, WETH approval/withdrawal, bounded native/WETH transfer and token approval calls needed to exit an exact live position.

4. `SESSION_TESTED`
   - The server submits `approve(router, 0)` through the session key.
   - A successful mainnet receipt is required before arming.

5. `ARMED_FOR_ROUND_TRIP`
   - The runtime waits for a qualifying signal; absence of a valid signal produces no order.
   - The first qualifying signal uses `0.0001 ETH` and exits immediately.
   - Buy and sell receipts plus actual balance deltas must reconcile.

6. `AUTONOMOUS_LIMITED`
   - Only after the real round trip reconciles.
   - Each later entry still requires fresh Safety PASS, Exitability PASS, non-chase timing, all deterministic gates and fresh router calldata validation.

7. `STOPPING / STOPPED`
   - A Phantom-signed kill switch blocks new entries before asking the exit loop to liquidate positions.
   - Unknown submission state, reconciliation mismatch, expired session or daily loss fails closed.

8. `RECLAIMED`
   - Phantom can sign a root owner operation that transfers any remaining live-position tokens, unwraps WETH and sends the recoverable native balance back to the owner.
   - An emergency ETH/WETH-only reclaim is available if a hostile or broken ERC-20 would make the combined owner operation revert; those tokens remain identified in the isolated account for later recovery (which may require refilling gas first).
   - A small dynamically estimated gas reserve remains in the operational account.
   - Local session context is erased after the reclaim confirms.

## Transaction invariants

- Never request, log, store or transmit a Phantom recovery phrase or master private key.
- Never use the Phantom owner balance as the autonomous bankroll.
- Never submit on a chain other than `4663`.
- Before activation, verify bytecode plus the official WETH/factory bindings of Router and Quoter on-chain.
- Never trade a ticker; an exact token contract is mandatory.
- Never convert `UNKNOWN` Safety or Exitability into `PASS`.
- Never use an unverified router, quoter, spender, selector or decoded calldata argument; the market-price pair must also be the exact canonical pool.
- ERC-20 approvals are exact-position amounts, never unlimited.
- Submission is not execution. Only a successful receipt plus the expected token movement and a reconciled (possibly negative after gas) liquid-balance delta can open or close a live position.
- Price, canonical market pair, market timestamp, safety timestamp and measured chase multiple are mandatory; freshness is checked independently so a new safety result cannot mask stale or missing market data.
- A server restart after broadcast reconciles by call ID. A restart in the indeterminate pre-ID submission window stops autonomy and requires manual review; it never retries blindly.
- Confirmed orders rebuild or close position state idempotently after a restart.
- Confirmed operations carry an application marker, so historical receipts cannot reactivate a later session or lifecycle.
- Owner reclaim also checks exact token balances from indeterminate buys, even if a position was never committed locally.
- A database failure, stale quote, unexpected balance delta, receipt revert or kill switch blocks new entries.

## Residual risks

The pilot can lose money and has no profit guarantee. The isolated account bounds exposure but does not remove smart-contract, market, infrastructure or key-compromise risk.

The `12%` stop and the daily-loss threshold are blocking triggers, not guaranteed execution prices or a guarantee that losses cannot exceed those percentages. Gaps, liquidity changes, slippage, gas, reverts and infrastructure delay can produce a worse realized result, up to the isolated pilot balance.

Alchemy's remote session has a seven-day expiry. The application kill switch stops this runtime, and a confirmed reclaim deletes its stored permission context; neither action should be described as an on-chain revocation of an already leaked session credential.

Because future token addresses are unknown when the session is created, the session includes the ERC-20 `approve` selector across contracts. The executor compensates by decoding every call and requiring the exact live token, exact verified router and exact position amount. A compromised session credential could bypass application checks, so the dedicated `0.005 ETH` account and `0.004 ETH` session allowance are the final exposure boundary.

Mainnet activation is not complete merely because the code is deployed. It becomes operational only after the owner creates and funds the dedicated account, signs the limited session, confirms the zero-value session test and explicitly arms it. It becomes `AUTONOMOUS_LIMITED` only after the first real buy/sell validation round trip reconciles.
