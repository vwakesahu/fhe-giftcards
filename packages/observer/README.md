# @sigill/observer

Always-on observer daemon for Sigill. Polls `OrderInProccessed` (sic — typo
preserved on-chain) and `OrderInQueued` events targeting the configured
observer EOA, decrypts product + payment via `@cofhe/sdk/node`, purchases the
gift card from Reloadly (or stubs one), hybrid-encrypts the code, and calls
`fulfillOrder` on Sigill.

Sigill supports multiple observer wallets in parallel; you run one daemon
process per observer wallet. The two slots `make all` orchestrates use
`OBSERVER_PRIVATE_KEY` (#1) and `OBSERVER_PRIVATE_KEY_2` (#2).

## One-time setup

```bash
cp .env.example .env.local
# Fill in OBSERVER_PRIVATE_KEY, BASE_SEPOLIA_RPC_URL, SIGILL_ADDRESS,
# CUSDC_ADDRESS, USDC_ADDRESS, RELOADLY_CLIENT_ID/_SECRET, PINATA_JWT.
# `make deploy` from the repo root populates the address fields for you.
pnpm install
```

Make sure the observer wallet is bonded on the current Sigill deployment.
From the repo root:

```bash
make register        # idempotent: bonds OBSERVER_PRIVATE_KEY + _2 if not yet bonded
```

## Run

```bash
# from repo root
make run-obs1        # daemon, uses OBSERVER_PRIVATE_KEY
make run-obs2        # daemon, uses OBSERVER_PRIVATE_KEY_2

# or directly from this package:
pnpm start           # daemon loop, single-observer
pnpm dev             # auto-restart on source change (tsx watch)
```

Log lines are prefixed `[observer]` for the loop and `[order #N]` /
`[unwrap #N]` for per-order work. Ctrl-C stops cleanly.

## Cash out earnings (cUSDC → USDC)

Same wallet, two-step: `requestUnwrap` debits the encrypted balance and
emits the debit handle; `claimUnwrap(id, plain)` finalises after the
unwrapper decrypts it. Only `msg.sender == cUSDC.unwrapper()` can finalise.

```bash
pnpm unwrap          # unwrap the entire sealed balance
pnpm unwrap 10       # unwrap a specific amount (human USDC units)
pnpm unwrap claim 7  # finalise an existing pending unwrap by id
```

## Required credentials

Both are mandatory. The daemon refuses to start / fulfil without them.

| Env                                    | Purpose                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `RELOADLY_CLIENT_ID` / `_SECRET`       | Reloadly sandbox auth — where the real Amazon code comes from.     |
| `PINATA_JWT`                           | IPFS pinning for the AES-encrypted payload. Without it buyers can't fetch the ciphertext after a restart. |

## What the daemon does each loop

1. `provider.getBlockNumber()` — find head.
2. `sigill.queryFilter(OrderInProccessed, …)` and `sigill.queryFilter(OrderInQueued, …)` in parallel, both filtered client-side by this observer's address.
3. For each event whose order is `status == Pending`:
   1. `client.decryptForView(encProductId, Uint64).withPermit().execute()` then the same for `encPaid` — retries up to 10× while the threshold network catches up.
   2. Validate the product is known and `paid ≥ unitPrice`. Otherwise `rejectOrder`.
   3. `purchaseGiftCard(productId, unitPrice)` — Reloadly sandbox or stub.
   4. AES-128-GCM the code locally, upload payload to IPFS, `client.encryptInputs([Encryptable.uint128(aesKey)])` for the AES key.
   5. `fulfillOrder(id, encAesKey, cid)`.
4. `Queued` orders are skipped this iteration; they auto-promote to `Pending` once the head clears.
5. If this wallet is the registered cUSDC unwrapper, also pull `UnwrapRequested` events and finalise each via `claimUnwrap`.
6. Advance `fromBlock` to `latest + 1`, sleep `POLL_INTERVAL_MS`.

Orders whose FHE decryption is still pending on a given round are retried on the next round (no state is written on-chain).
