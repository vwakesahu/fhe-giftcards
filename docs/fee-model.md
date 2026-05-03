# Fee Model

> **Status: not finalised.** This doc captures how we're thinking about it, what the constraints are, and a leading proposal. Numbers are placeholders. Comments / pushback welcome.

## Who needs to get paid, and for what

Three parties, three different cost structures.

### Observer (relay)

The relay is the active participant: every order costs them gas, capital, and time. Concretely, each fulfilment requires:

1. **Capital outlay.** They pay Reloadly in fiat (or stable rails) for the actual card *before* they receive the cUSDC escrow. That capital is locked from `placeOrder` to `claimUnwrap` — usually a few minutes, but they need a working float to handle concurrent orders.
2. **Gas.** `fulfillOrder` is an FHE-heavy tx (~700k gas observed on Base Sepolia). Plus `requestUnwrap` + `claimUnwrap` later when they cash out. On Base mainnet at typical gas prices that's roughly $0.30–$0.80 per order.
3. **Bond.** 0.01 ETH locked while registered. At ETH ≈ $4000 that's $40 of capital sitting idle, amortised across all orders the observer ever fulfils.
4. **Slashing risk.** Miss a deadline, lose 50% of bond. Today that's $20. Independent of order size.
5. **Infra.** Hosting (~$5–10/month for a small Railway instance), RPC quota, monitoring.
6. **Reloadly margin.** Reloadly itself charges a wholesale-vs-retail spread on every card. The observer absorbs that cost.

Observer needs revenue per order high enough to cover (1)+(2)+(3 amortised)+(5 amortised) and price in enough margin for (4) and (6).

### Protocol (Sigill)

Protocol-level costs are smaller but real:

- Frontend hosting (Vercel) and observability.
- Audits when contracts are mainnet-bound. One-time but expensive.
- Ongoing dev. New SDK migrations (like this wave's `cofhejs` → `@cofhe/sdk` forced move) cost engineering time.
- Liquidity for bootstrapping. In early days with few buyers, observers won't hit break-even on volume. Protocol may need to subsidise revenue to keep relays online.

### Buyer

Buyer wants the lowest total price subject to the privacy guarantee. They'll tolerate some markup over Reloadly retail, the same way people tolerate paying a 2–4% credit-card surcharge for convenience. They will not tolerate paying 30% — at that point the privacy isn't worth it.

## The proposed model (working draft)

Two fees stacked on top of the card price:

```
buyer pays (escrow) = card_price + observer_markup + protocol_fee
```

### `protocol_fee` — fixed

Charged in cUSDC at `placeOrder`. Two parts:

- A **fixed component** (e.g., $0.10) to cover gas-amortised infra regardless of order size.
- A **percentage component** (e.g., 0.25%) so revenue scales with throughput.

Effective rate: $0.10 + 0.25% × order. On a $25 card that's $0.16. On a $100 card it's $0.35.

Routes to a protocol-controlled treasury contract. Used for audits, observer subsidies during bootstrap, and protocol-side ops.

### `observer_markup` — set by the observer, visible at registration

Each observer publishes their fee on-chain when they register or update their slot. Buyers see it in the picker before placing an order, alongside success rate and slot capacity. Like the existing roster but with a price column.

A buyer picks based on `markup × success_rate × slot_left`, the same way you pick a delivery service. The market sets the floor: an observer with a high success rate can charge more; a new observer must price low to win volume.

Reasonable starting range: $0.50 + 4% on small orders, sliding down to $0.50 + 1.5% on larger orders.

The fixed `$0.50` component covers the per-order gas cost regardless of size. The percentage covers capital, slashing risk, and Reloadly margin.

## Slashing as the backstop

Today: 50% of bond slashed on missed deadline. The slashed half just decrements the observer's bond — no destination, effectively burned in-contract.

Two changes we're considering:

1. **Slashed funds compensate the buyer.** If the observer misses a deadline, the refund returns the buyer's escrow *plus* the slashed amount. This makes the buyer whole for the wasted time and the loss-of-privacy of having to retry on a different relay.
2. **Bond scales with max order size.** Today the bond is fixed at 0.01 ETH regardless of how big an order the observer accepts. That's fine for $25 cards but breaks for $1000 cards: a malicious observer could grief a $1000 escrow and only lose $20 in bond. Per-observer max-order-size cap, with `bond ≥ ratio × max_order_size`, fixes this.

## Worked examples

Numbers below assume ETH ≈ $4000 and Base mainnet gas ≈ 1 gwei.

### Buyer wants a $5 Amazon US gift card

| Line item | Amount |
|---|---|
| Card price (paid by observer to Reloadly) | $5.00 |
| Observer markup (assume $0.50 + 4%) | $0.70 |
| Protocol fee ($0.10 + 0.25%) | $0.11 |
| **Buyer pays (escrow)** | **$5.81** |

Observer P&L:
- Receives $5.81 - $0.11 protocol = $5.70 in cUSDC.
- Pays Reloadly $5.00.
- Pays gas roughly $0.50 (fulfill + claim).
- Net per order: ~$0.20.

Tight at small order sizes. The fixed $0.50 markup dominates the percentage and is mostly going to gas. Observer breakeven sits around the $3–4 card range; below that they should refuse via `rejectOrder`.

### Buyer wants a $100 Amazon US gift card

| Line item | Amount |
|---|---|
| Card price | $100.00 |
| Observer markup ($0.50 + 1.5%) | $2.00 |
| Protocol fee ($0.10 + 0.25%) | $0.35 |
| **Buyer pays (escrow)** | **$102.35** |

Observer P&L:
- Receives $102.35 - $0.35 = $102.00 in cUSDC.
- Pays Reloadly $100.00.
- Pays gas ~$0.50.
- Net per order: ~$1.50.

Better margin in absolute terms. Protocol takes 0.34% of the order. Buyer pays a 2.35% premium over retail for full privacy. Comparable to credit-card surcharges for context.

### Buyer wants a $25 card and the observer disappears

- Buyer locks $26 escrow + relay's $20 bond stake.
- Deadline passes, buyer calls `refund`.
- Buyer receives $26 escrow + $10 slashed (50% of bond) = $36 cUSDC.
- Observer keeps $10 (residual half of bond) and is now under-bonded for future orders unless they top up.
- Net to buyer: $36 - $26 = $10 surplus on a $26 lock that wasted ~10 minutes. Probably fair.

## Why we think this works

**Buyers self-select on price.** With visible per-observer markup + reputation, buyers route to whoever's cheapest at acceptable reliability. Bad-pricing observers don't get orders. New observers compete in by underpricing.

**Observers can't race to the bottom.** The fixed $0.50 component creates a floor: below that you're losing money on every fulfilment. So the equilibrium markup is `gas_cost + capital_premium + slashing_premium`, set by the cheapest competent observer.

**Protocol revenue is predictable but small.** $0.10 + 0.25% across all orders gives runway for ops without distorting buyer behaviour. At 1000 orders/day average $40, that's roughly $200/day in protocol revenue. Enough to fund hosting + ongoing engineering.

**Slashing actually backs the privacy guarantee.** A buyer trades plaintext for "I trust this relay won't grief me". The slash-to-buyer payout is the dollar value of that trust assumption. If we make it scale with order size, buyers can confidently route bigger orders.

## Open questions

- **Where does the protocol fee actually go?** Treasury contract owned by a multisig is the obvious answer for now. Eventually a DAO or a permanent burn sink (deflationary) — undecided.
- **Subsidies in the bootstrap phase.** Sigill probably wants to fund observer revenue out of treasury for the first N orders to bootstrap the relay market. Mechanism: rebate to the observer's bond on successful fulfilment, paid from treasury, capped per observer.
- **How does the observer publish their fee?** Two options. Inline in `Observer` struct (cheap to read, expensive to update). Off-chain signed message indexed by the app (cheap to update, requires app to verify signature on display). We'll start with inline since the gas cost is one-time at registration.
- **Disputes.** Today the buyer has no recourse if the observer delivers an invalid code. The redemption code is unsealable only by the buyer, so observer can't be challenged on-chain. Possible future: optional buyer attestation that releases the bond gradually rather than immediately on `claimUnwrap`. Not in scope for the initial fee model.
- **Reloadly margin volatility.** Reloadly pricing isn't fixed; some products carry a 5–8% wholesale spread, others 2–3%. Observer needs to either price per-product or run with a buffer. Probably the latter is simpler.

## What ships first

When we put this on-chain, the first version will be the simplest possible:

1. Add a `feeBps` field to the observer registration struct, public on-chain.
2. Add a `protocolFeeBps` constant (0.25%) and `protocolFeeFlat` (cUSDC equivalent of $0.10) on Sigill, with a treasury address.
3. Update `placeOrder` to deduct both fees from the escrow before it lands on the order. Observer receives `escrow - protocolFee` on `claimUnwrap`.
4. App reads each observer's `feeBps` in the roster and shows estimated total to the buyer at confirm time.

That gets us a working market with two paid relays. Reputation-weighted ranking and slashing-to-buyer compensation come in the next iteration.
