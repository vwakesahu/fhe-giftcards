# @sigill/observer

Always-on observer daemon for Sigill. Polls `OrderPlaced` events targeting
the configured observer EOA, decrypts product + payment via cofhejs, purchases
the gift card from Reloadly (or stubs one), hybrid-encrypts the code, and
calls `fulfillOrder` on Sigill.

## One-time setup

```bash
cp .env.example .env
# Fill in OBSERVER_PRIVATE_KEY, RPC, and contract addresses.
pnpm install
```

Make sure the observer is bonded on the current Sigill deployment. From the
contracts package:

```bash
cd ../contracts
OBSERVER_PRIVATE_KEY=... pnpm hardhat register-observer
```

## Run

```bash
pnpm start          # daemon loop
pnpm dev            # auto-restart on source change (tsx watch)
```

Log lines are prefixed `[observer]` for the loop and `[order #N]` for
per-order work. Ctrl-C stops cleanly.

## Cash out earnings (cUSDC → USDC)

Same wallet, two-step: `requestUnwrap` fires an async FHE decrypt;
`claimUnwrap` finalises. The script polls the claim until it lands.

```bash
pnpm unwrap          # unwrap the entire sealed balance
pnpm unwrap 10       # unwrap a specific amount (human USDC units)
```

## Required credentials

Both are mandatory. The daemon refuses to start / fulfil without them.

| Env                                    | Purpose                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `RELOADLY_CLIENT_ID` / `_SECRET`       | Reloadly sandbox auth — where the real Amazon code comes from.     |
| `PINATA_JWT`                           | IPFS pinning for the AES-encrypted payload. Without it buyers can't fetch the ciphertext after a restart. |

## What the daemon does each loop

1. `provider.getBlockNumber()` — find head.
2. `sigill.queryFilter(OrderPlaced, fromBlock, latest)` — filtered client-side by observer address.
3. For each event with `status == Pending`:
   a. `cofhejs.unseal(encProductId | encPaid, Uint64)` — retries up to 10×.
   b. Validate product + paid ≥ unitPrice. Otherwise `rejectOrder`.
   c. `purchaseGiftCard(productId, unitPrice)` — Reloadly sandbox or stub.
   d. AES-128-GCM the code locally; upload payload to IPFS; `cofhejs.encrypt` the AES key as `euint128`.
   e. `fulfillOrder(id, encAesKey, cid)`.
4. Advance `fromBlock` to `latest + 1`, sleep `POLL_INTERVAL_MS`.

Orders that FHE-decrypt-pending on a given round are retried on the next
round (no state is written on-chain).
