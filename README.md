# Sigill

Private checkout using FHE on Base Sepolia. You buy a gift card, and nobody on-chain can see what you bought, how much you paid, or the code you got back.

Live at **[sigill.store](https://www.sigill.store/)**. App at **[app.sigill.store](https://app.sigill.store/)**. Walkthrough video: **[https://youtu.be/g_jdN4tMQio](https://youtu.be/g_jdN4tMQio)**.

**Deployed on Base Sepolia**

- Sigill: [`0x23A0…0324`](https://sepolia.basescan.org/address/0x23A0EB16E5bb10c46D9653B5D6688cE965e30324)
- cUSDC (ConfidentialERC20): [`0xaFA9…3A2E`](https://sepolia.basescan.org/address/0xaFA944F1B5f929693f92Ee4445B441FA70953A2E)
- USDC (Circle): [`0xE29D…424F`](https://sepolia.basescan.org/address/0xE29D70400026d77a790a8E483168B94D6E36424F)

<p>
  Powered by
  <a href="https://fhenix.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="packages/landing/public/fhenix.svg">
      <img alt="Fhenix" src="packages/landing/public/fhenix-dark.svg" height="22">
    </picture>
  </a>
</p>

## Why Sigill?

> **si · gill** *(noun)*, a seal pressed in wax to keep private correspondence private.

Kings pressed sigills onto letters so couriers couldn't read them. Monks pressed them onto ledgers so the wrong eyes couldn't skim. A sigill was a promise: this is sealed, and opening it without permission means you broke the seal.

That promise mostly vanished from money. Every transaction is a postcard now. The amount, the counterparty, every downstream address, all of it public forever. So we went and made a new seal, pressed in ciphertext instead of wax. It still means the same thing. What you bought is yours, and nobody opens the envelope but you.

## The idea

On-chain payments leak everything. The amount, the counterparty, and every address it touches afterwards. Sigill hides all of that.

Your browser seals the inputs with FHE. You wrap some USDC into a confidential token (cUSDC), approve the checkout contract for an encrypted allowance, and place an order. A bonded observer fulfils that order without ever learning a wallet-visible secret, and the gift card code gets delivered through a side-channel only you can open.

**The flow**

1. Buyer wraps USDC into cUSDC (a confidential ERC-20) and `approve`s Sigill for an encrypted allowance.
2. Buyer calls `placeOrder(encProductId, observer)`. Sigill consumes the allowance as encrypted escrow. The actual amount never appears in plaintext on-chain.
3. A bonded observer has FHE decryption permission on just the product ID and the paid amount. They confirm the payment covers the price, then buy the card from Reloadly.
4. Observer AES-encrypts the code, pins the ciphertext to IPFS, and FHE-wraps the AES key so only the buyer can open it. The escrowed cUSDC is released to the observer in the same tx.
5. Buyer unseals the AES key through FHE, fetches the ciphertext from IPFS, AES-decrypts, reads the code locally. Observer later `unwrap`s their cUSDC back to plain USDC whenever they want.

Explorer only ever sees opaque handles. IPFS only ever sees gibberish. The amount that moved between buyer and observer is an encrypted balance update, so nobody watching the chain can tell how much changed hands.

## What's in the monorepo

```
packages/
  contracts/   Hardhat + Solidity + Fhenix CoFHE (multi-observer Sigill,
               ConfidentialERC20)
  landing/     Next.js marketing site
  app/         Next.js dApp (wagmi + RainbowKit + @cofhe/sdk/web)
  observer/    Node daemon that watches OrderInProccessed / OrderInQueued
               + UnwrapRequested, decrypts off-chain via @cofhe/sdk/node,
               buys from Reloadly, fulfils on-chain
```

pnpm workspace. Node 20+, pnpm 9+.

## Setup

```bash
pnpm install
cp packages/contracts/.env.example   packages/contracts/.env
cp packages/app/.env.local.example   packages/app/.env.local
```

What you'll need to fill in:

| File | Keys | Where to get them |
|---|---|---|
| `packages/contracts/.env` | `PRIVATE_KEY`, `OBSERVER_PRIVATE_KEY`, `OBSERVER_PRIVATE_KEY_2` | any Base Sepolia wallets funded with test ETH (one deployer + one or two observers) |
| " | `USDC_ADDRESS` | prefilled, Circle's Base Sepolia USDC. Faucet at [faucet.circle.com](https://faucet.circle.com) |
| " | `RELOADLY_CLIENT_ID` + `_SECRET` | [reloadly.com](https://reloadly.com), switch to Test mode, Developers section |
| " | `PINATA_JWT`, `PINATA_GATEWAY` | [pinata.cloud](https://pinata.cloud), API Keys |
| " | `BASE_SEPOLIA_RPC_URL` | the public endpoint is flaky, prefer Alchemy or Infura or QuickNode |
| `packages/app/.env.local` | `NEXT_PUBLIC_SIGILL_ADDRESS`, `NEXT_PUBLIC_CUSDC_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS` | populated automatically by `make deploy` (via `scripts/sync-env.mjs` reading `cUSDC.underlying()` as truth for USDC) |

Buyer wallet needs at least 50 USDC (Circle faucet hands out 10 at a time, so run it a few times). Each observer wallet needs at least 0.02 ETH (0.01 bond + gas). The second observer is optional; leave `OBSERVER_PRIVATE_KEY_2` unset to skip it.

## Running stuff

Everything runs from the repo root via `make`. See `make help` for the full list.

```bash
# One-shot: install deps, deploy contracts, register both observers, then
# launch dApp + 2 observers in parallel (Ctrl-C stops everything).
make all

# Or piecemeal:
make setup        # install + deploy + register
make run          # dApp on :3000 plus observer #1 + #2 in parallel
make run-app      # just the dApp
make run-obs1     # just observer #1
make run-obs2     # just observer #2 (uses OBSERVER_PRIVATE_KEY_2)
make register     # idempotent: bond observers that aren't bonded yet
make deploy       # fresh deploy + sync addresses into per-package .env.local
```

`make deploy` runs `hardhat deploy-sigill` (deploys `ConfidentialERC20` + `Sigill`) then `scripts/sync-env.mjs`, which writes the new addresses into `packages/{app,observer}/.env.local`. `cUSDC.underlying()` is queried directly to pick the right USDC address rather than trusting the deployments JSON, which can drift if you deployed against a different USDC than the one currently wrapped.

`make register` runs `packages/contracts/scripts/register-observers.mjs`, which reads both observer private keys from `packages/contracts/.env` and bonds whichever aren't already at ≥ 0.01 ETH. Safe to re-run.

If you only want the marketing site:

```bash
pnpm landing:dev
```

## What actually stays private

| | Where | Leaks? |
|---|---|---|
| Transaction happened | on-chain | yes |
| Buyer / observer addresses | on-chain | yes |
| Observer bond (0.01 ETH, fixed) | on-chain | yes |
| USDC wrap amount | on-chain | yes (pre-order, unavoidable) |
| **cUSDC payment amount** | on-chain | **no, encrypted balance update** |
| **Product ID** | on-chain | **no, FHE, observer-only** |
| **AES key** | on-chain | **no, FHE, buyer-only** |
| **Gift card code** | IPFS | **no, AES, needs the FHE-unsealed key** |
| IPFS CID | on-chain | yes, but useless without the key |

The wrap step is the only place the buyer touches plaintext USDC. After that, everything flows as encrypted `euint64` balances and allowances.

## Architecture

![Architecture](docs/architecture.svg)

## The contracts

Two contracts do the work.

**[ConfidentialERC20.sol](packages/contracts/contracts/ConfidentialERC20.sol)** is a minimal ERC-7984-like wrapper over plaintext USDC.

- `wrap(uint64)` pulls plaintext USDC and credits an encrypted `euint64` balance.
- `requestUnwrap(InEuint64)` then `claimUnwrap(id)` is a two-step async burn. Debits the encrypted balance immediately, and later transfers plaintext USDC once the FHE decryption completes.
- `transfer` / `approve` / `transferFrom` operate on encrypted amounts. Insufficient funds silently clamp to 0 rather than revert, which is the standard ERC-7984 semantic and preserves privacy (reverts leak information).
- `transferFromAllowance(from, to)` is the primitive Sigill uses. It pulls the entire encrypted allowance without needing a fresh `InEuint64` passed through an intermediary, which avoids the zkv signature-binding mismatch that happens under nested `msg.sender`. The allowance zeroes on use, so escrow is replay-safe.

**[Sigill.sol](packages/contracts/contracts/Sigill.sol)** is the checkout. Most of the logic lives in [Observer.sol](packages/contracts/contracts/Observer.sol), the abstract base it inherits from — observer registry, per-observer slot capacity, the order queue.

```solidity
struct Order {
  address buyer;
  address observer;
  euint64 encProductId;   // what to buy, observer decrypts
  euint64 encPaid;        // cUSDC escrowed, observer decrypts to verify
  euint128 encAesKey;     // AES-128 key for the code, buyer decrypts
  string ipfsCid;         // pointer to AES-encrypted code
  uint256 deadline;
  Status status;          // Pending | Processing | Fulfilled | Refunded | Rejected | Queued
}
```

`placeOrder` emits **`OrderInProccessed`** when the picked observer had a free slot (status `Pending`) or **`OrderInQueued`** when waitlisted behind an earlier order on the same observer (status `Queued`). Once the head order clears, the next queued one auto-promotes to `Pending` with a fresh deadline.

Three settlement paths. `fulfillOrder` means the observer delivered, escrow goes to observer (status `Fulfilled`). `rejectOrder` is the honest-decline path, escrow returns to the buyer and the bond stays intact (status `Rejected`). `refund` is what the buyer calls after the 10-minute deadline passes; it works on both `Pending` and `Queued` orders and slashes 50% of the observer's bond (status `Refunded`).

Access control uses `FHE.allow(handle, address)` per value. The observer gets ACL on `encProductId` and `encPaid`. The buyer gets ACL on `encAesKey`. That's it.

## The observer

The observer is the off-chain execution layer. It watches the chain, decrypts what it's been granted ACL on via `@cofhe/sdk/node`, and settles gift-card orders. It also acts as the trusted unwrapper for cUSDC (the recipient can self-claim too; the observer is a fallback).

It's a stateless Node process. Each poll iteration it re-checks on-chain status, so dedupe across restarts is free and there is no database.

Sigill supports multiple observers in parallel. Each has a configurable slot count (capacity for active orders); buyers pick which observer fulfils their order at `placeOrder`. If the picked observer is at capacity, the order is `Queued` and starts the moment the head order clears. The `make all` target runs two observers side-by-side using `OBSERVER_PRIVATE_KEY` and `OBSERVER_PRIVATE_KEY_2`.

**What the daemon does each loop**

1. `provider.getBlockNumber()` to find head.
2. `sigill.queryFilter(OrderInProccessed, …)` and `sigill.queryFilter(OrderInQueued, …)` in parallel, both filtered by this observer's address.
3. `cUSDC.queryFilter(UnwrapRequested, …)` if this wallet is the registered unwrapper.
4. For each `Pending` order: decrypt `encProductId` + `encPaid` via `client.decryptForView(...).withPermit()`, validate `paid ≥ unitPrice` (otherwise `rejectOrder`), buy the card from Reloadly, AES-128-GCM the code, pin the ciphertext to IPFS, FHE-encrypt the AES key, call `fulfillOrder(id, encAesKey, cid)`. `Queued` orders are skipped on this iteration; they'll show up as `Pending` once the head clears.
5. For each pending unwrap: decrypt the debit handle, call `claimUnwrap(id, plain)`.

**Run it**

```bash
# from repo root, after make setup
make run-obs1                  # daemon, uses OBSERVER_PRIVATE_KEY
make run-obs2                  # daemon, uses OBSERVER_PRIVATE_KEY_2
# or both in parallel along with the dApp:
make run

# manual cash-out (unwrap entire sealed cUSDC balance):
pnpm --filter @sigill/observer run unwrap
```

Reloadly and Pinata creds are both mandatory. The daemon refuses to start without them.

**Observer docs**

- Package README with run instructions and credential requirements: [packages/observer/README.md](packages/observer/README.md).
- Full multi-observer network design (bond / slash / reputation / dispute layer): [docs/Decentralized Observer System.md](docs/Decentralized%20Observer%20System.md).

## Stack

- **Contracts**: Solidity + [Fhenix CoFHE](https://github.com/FhenixProtocol), Hardhat
- **Gift cards**: [Reloadly](https://reloadly.com) sandbox
- **Storage**: IPFS via [Pinata](https://pinata.cloud)
- **Network**: Base Sepolia
- **Frontend**: Next.js, Tailwind v4, shadcn, wagmi + RainbowKit, @cofhe/sdk/web
- **Observer**: Node (tsx), ethers v6, @cofhe/sdk/node
