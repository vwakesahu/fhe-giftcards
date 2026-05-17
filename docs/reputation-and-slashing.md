# Reputation, Slashing & Bond Sizing

> **Status: planning, not implemented in Wave 4.** This doc captures the design for the relay-trust pieces that were declared for Wave 4 but did not ship. Numbers are placeholders. Comments / pushback welcome.

## What we still owe

Wave 4 declared five build goals. The fee model shipped (per-observer fees, 0.25% platform fee, treasury split, app-side total at confirm). The other four did not, and they're the relay-trust scaffolding the market needs to actually be safe at scale:

1. Success-rate math fix
2. Reputation-weighted ranking
3. Slashing-to-buyer compensation
4. Bond-to-max-order-size scaling

These are coupled. Ranking depends on the math fix. The slash redirect is only meaningful if the bond is sized appropriately for the order being protected. They ship as one stack, in roughly the order above.

## 1. Success-rate math fix

`Observer._fulfillOrder` keeps a `sucessRate` accumulator:

```solidity
completeness = (orderCompleted * 1e6) / (orderIndex * 1e6 - orderReject)
```

The 1e6 multiplier on both sides almost cancels, so the result collapses to ~1 for any observer with at least one fulfilment, regardless of actual reliability. The dApp currently sidesteps this by reading `getOrderCompleted(addr)` and showing the raw count instead of a ratio. Fine for two relays. Doesn't scale.

Fix is a one-line change: scale only the numerator (or only the denominator), not both. Ships first because everything else depends on a working success rate.

## 2. Reputation-weighted ranking

Once the rate is real, the picker's default order becomes a composite score:

```
score =  w_rate    * success_rate
       + w_volume  * log(orderCompleted)
       + w_fee     * (1 - fee / fee_max)
       - w_stale   * stale_minutes
```

The liveness signal is off-chain. An observer is "stale" if it hasn't responded within a heartbeat window. The dApp publishes the heartbeat status alongside the on-chain roster, so a relay can't game the ranking by silently dropping slow orders, refusing to claim them, or going dark between fulfilments.

**Open: where the liveness signal lives.** Options:

- A small indexer Sigill runs that probes observers and signs the result. Simplest, but introduces a trusted off-chain party.
- Each buyer's dApp probes observers directly at picker render time. No central trust, but every buyer pays the latency.
- Observers self-report by submitting signed heartbeats on-chain. Most decentralised; most expensive.

Leaning toward the first for the initial ship.

## 3. Slashing-to-buyer compensation

Today `_refund` slashes 50% of the observer bond on a missed deadline:

```solidity
uint256 slash = this.getObserverBondAmount(order.observer) / 2;
_setObserverBondAmount(order.observer, slash);
```

The slashed half just decrements the observer's bond, no destination. Effectively burned in-contract. The buyer gets their cUSDC escrow back, nothing else, despite having locked capital for ten minutes and lost the privacy guarantee of not having to retry on a different relay.

Change: route the slashed half to the buyer in the same `_refund` call. A missed deadline returns escrow plus half the bond. Puts a real dollar number on the reputation backstop, which is otherwise an internal protocol accounting line with no benefit to the wronged buyer.

**Open: contention.** If the bond is 0.01 ETH and three buyers all miss-deadline against the same observer, only the first collects under a naive implementation. Options: prorate, queue, accept first-come-first-served. First-come-first-served is simplest and most realistic given how rare back-to-back misses should be in practice.

## 4. Bond-to-max-order-size scaling

Today the bond is a flat 0.01 ETH regardless of how big an order the observer is willing to accept. Fine for $25 cards. Breaks for $1000 cards: a malicious observer could grief a $1000 escrow and only lose ~$40 in bond.

Proposed: each observer declares a `maxOrderUsdc` at registration, and the contract enforces

```
bond >= ratio * maxOrderUsdc * eth_price
```

Observers who want to handle bigger orders post bigger bonds. `quoteOrder` rejects when `amountUsdc > observer.maxOrderUsdc`. The picker filters out observers who can't honour the buyer's requested amount, so the buyer never picks one who can't be made whole on a miss.

**Open: the eth_price oracle.** For the initial ship the simplest acceptable answer is a hard-coded constant the admin updates periodically. Long term it wants a Chainlink feed or equivalent. Worth shipping the oracle slot as `address oracle` from day one so the constant can be swapped without a redeploy.

## What ships first

In order:

1. Success-rate math fix and redeploy. Low risk, unblocks 2.
2. Slashing-to-buyer compensation. Small `_refund` patch, independent of ranking.
3. Reputation-weighted ranking in the picker. App work plus the indexer for liveness.
4. Bond-to-max-order-size scaling. Contract surface change plus the admin oracle.

Item 1 is one line. Item 2 is one branch in `_refund`. Items 3 and 4 are the real engineering.

## Why now

Wave 4 made the relay market exist. Wave 5 makes it trustworthy at scale. With two paid relays and visible fees, the next failure mode the system hits is buyers picking the cheapest relay regardless of reliability, then refunding when it misses deadlines. Reputation-weighted ranking is what prevents that race, and the slashing redirect is what makes the refund actually painful enough to discipline relay behaviour.

## Related

- [docs/fee-model.md](fee-model.md) — fee design that informed the Wave 4 ship
- [docs/Decentralized Observer System.md](Decentralized%20Observer%20System.md) — original multi-observer design
- [docs/wave4.md](wave4.md) — what actually shipped in Wave 4
