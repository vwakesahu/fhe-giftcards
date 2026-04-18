# Sigill

Private checkout using FHE on Base Sepolia. Buy a gift card — nobody on-chain can see what you bought, how much you paid, or the code you got back.

Live at **[sigill.store](https://sigill.store)**.

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

> **si · gill** *(noun)* — a seal pressed in wax to keep private correspondence private.

Kings pressed sigills onto letters so couriers couldn't read them. Monks pressed them onto ledgers so the wrong eyes couldn't skim. A sigill was a promise: this is sealed, and opening it without permission means you broke the seal.

That promise mostly vanished from money. Every transaction is a postcard now — the amount, the counterparty, every downstream address, all public forever. So we went and made a new seal — pressed in ciphertext instead of wax. It still means the same thing: what you bought is yours, and nobody opens the envelope but you.

## The idea

On-chain payments leak everything: the amount, the counterparty, and every address it touches afterward. Sigill hides all of that. The buyer wraps plain USDC into a confidential cUSDC token, the payment amount flows as an encrypted balance update, a bonded observer fulfils the order without ever learning anything others can read, and the gift card code lands through a side-channel only the buyer can open.

**How it flows**

1. Buyer wraps USDC → cUSDC (confidential ERC-20) and `approve`s Sigill for an FHE-encrypted allowance.
2. Buyer calls `placeOrder(encProductId, observer)`. Sigill consumes the allowance as encrypted escrow; the actual amount is never in plaintext on-chain.
3. A bonded observer has FHE decryption permission on just the product ID and paid amount, confirms the payment covers the price, and buys the card from Reloadly.
4. Observer AES-encrypts the code, pins the ciphertext to IPFS, and FHE-wraps the AES key so only the buyer can open it. Escrowed cUSDC is released to the observer in the same tx.
5. Buyer unseals the AES key through FHE, fetches the ciphertext, AES-decrypts, reads the code locally. Observer later `unwrap`s their cUSDC back to plain USDC.

Explorer only ever sees opaque handles. IPFS only ever sees gibberish. The amount moved between buyer and observer is an encrypted balance update — nobody watching the chain can tell how much changed hands.

## What's in the monorepo

```
packages/
  contracts/   Hardhat + Solidity + Fhenix CoFHE
  landing/     Next.js marketing site
  app/         Next.js dApp (wagmi + RainbowKit + cofhejs)
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
| `packages/contracts/.env` | `PRIVATE_KEY`, `OBSERVER_PRIVATE_KEY` | any Base Sepolia wallets funded with test ETH |
| " | `USDC_ADDRESS` | prefilled — Circle's Base Sepolia USDC, faucet at [faucet.circle.com](https://faucet.circle.com) |
| " | `RELOADLY_CLIENT_ID` + `_SECRET` | [reloadly.com](https://reloadly.com) → Test mode → Developers |
| " | `PINATA_JWT`, `PINATA_GATEWAY` | [pinata.cloud](https://pinata.cloud) → API Keys |
| " | `BASE_SEPOLIA_RPC_URL` | the public endpoint is flaky; prefer Alchemy/Infura/QuickNode |
| `packages/app/.env.local` | `NEXT_PUBLIC_SIGILL_ADDRESS`, `NEXT_PUBLIC_CUSDC_ADDRESS` | output of `pnpm contracts:deploy` |

Buyer wallet needs ≥ 50 USDC (Circle faucet does 10 at a time). Observer wallet needs ≥ 0.02 ETH (0.01 bond + gas).

## Running stuff

Everything runs from the repo root.

```bash
# Marketing site
pnpm landing:dev            # http://localhost:3000

# dApp
pnpm app:dev                # http://localhost:3000

# Contracts (all commands run against Base Sepolia — no local testing)
pnpm contracts:compile      # compile Solidity
pnpm contracts:deploy       # deploy ConfidentialERC20 (cUSDC) + Sigill
pnpm contracts:register     # register the observer wallet with a 0.01 ETH bond
pnpm contracts:e2e          # full flow: deploy → register → order → fulfil → unwrap
```

### End-to-end demo

`pnpm contracts:e2e` drives the whole flow in one script against Base Sepolia:

1. Reads `USDC_ADDRESS` from env, checks the buyer holds ≥ 50 USDC
2. Deploys fresh `ConfidentialERC20` + `Sigill`
3. Registers the observer with a 0.01 ETH bond
4. Wraps 50 USDC → cUSDC, approves Sigill for an encrypted 10 USDC allowance
5. `placeOrder(encProductId=1, observer)` — escrows cUSDC
6. Observer decrypts the order, buys from Reloadly sandbox, hybrid-encrypts the code (AES + IPFS + FHE key), fulfils
7. Buyer decrypts the AES key via FHE, pulls ciphertext from IPFS, recovers the code
8. Observer `requestUnwrap` + `claimUnwrap` to pull plaintext USDC out of cUSDC

Each run takes ~2-3 minutes depending on how busy the CoFHE network is.

## What actually stays private

| | Where | Leaks? |
|---|---|---|
| Transaction happened | on-chain | yes |
| Buyer / observer addresses | on-chain | yes |
| Observer bond (0.01 ETH, fixed) | on-chain | yes |
| USDC wrap amount | on-chain | yes (pre-order) |
| **cUSDC payment amount** | on-chain | **no — encrypted balance update** |
| **Product ID** | on-chain | **no — FHE, observer-only** |
| **AES key** | on-chain | **no — FHE, buyer-only** |
| **Gift card code** | IPFS | **no — AES, needs the FHE-unsealed key** |
| IPFS CID | on-chain | yes, but useless without the key |

The wrap step is the only place the buyer touches plaintext USDC — after that, everything flows as encrypted `euint64` balances and allowances.

## Architecture

```
Buyer                cUSDC (conf. ERC20)       Sigill                 Observer
  |                       |                      |                       |
  |-- wrap(50 USDC) --->  |                      |                       |
  |-- approve(enc 10) ->  |                      |                       |
  |                       |                      |                       |
  |-- placeOrder(encPid, obs) ----------------->  |                       |
  |                       | <-- transferFromAllowance(buyer) -- |        |
  |                       |                      |-- OrderPlaced ----->  |
  |                       |                      |                       |
  |                       |                      |         unseal(pid, paid)
  |                       |                      |         buy via Reloadly
  |                       |                      |         AES-enc code, pin to IPFS
  |                       |                      |         FHE-wrap AES key
  |                       |                      |                       |
  |                       |                      | <-- fulfillOrder(key, cid) --
  |                       | <-- transferEncrypted(observer) --- |        |
  |                                              |                       |
  |  unseal AES key (FHE)                        |                       |
  |  fetch ciphertext (IPFS)                     |                       |
  |  AES-decrypt → code                          |                       |
  |                                              |       requestUnwrap → claim → plain USDC
```

## The contracts

Two contracts do the work:

**[ConfidentialERC20.sol](packages/contracts/contracts/ConfidentialERC20.sol)** — minimal ERC-7984-like wrapper over plaintext USDC.

- `wrap(uint64)` — pulls plaintext USDC, credits an encrypted `euint64` balance.
- `requestUnwrap(InEuint64)` + `claimUnwrap(id)` — two-step async burn, debits encrypted balance and later transfers plaintext USDC after FHE decryption completes.
- `transfer` / `approve` / `transferFrom` — operate on encrypted amounts; insufficient funds silently clamp to 0 rather than revert (standard ERC-7984 semantics, preserves privacy).
- `transferFromAllowance(from, to)` — the primitive Sigill uses: pulls the entire encrypted allowance without needing a fresh `InEuint64` passed through an intermediary (avoids the zkv signature-binding mismatch under nested `msg.sender`). The allowance zeroes on use, which makes escrow replay-safe.

**[Sigill.sol](packages/contracts/contracts/Sigill.sol)** — the checkout.

```solidity
struct Order {
  address buyer;
  address observer;
  euint64 encProductId;   // what to buy — observer decrypts
  euint64 encPaid;        // cUSDC escrowed — observer decrypts to verify
  euint128 encAesKey;     // AES-128 key for the code — buyer decrypts
  string ipfsCid;         // pointer to AES-encrypted code
  uint256 deadline;
  Status status;          // Pending | Fulfilled | Refunded | Rejected
}
```

Three settlement paths: `fulfillOrder` (observer delivers, escrow goes to observer), `rejectOrder` (honest observer declines; escrow returns to buyer, bond intact), `refund` (buyer reclaims after the 10-minute deadline; 50% of observer bond slashed).

Access control uses `FHE.allow(handle, address)` per value — the observer gets ACL on `encProductId` + `encPaid`, the buyer gets ACL on `encAesKey`.

## Stack

- **Contracts** — Solidity + [Fhenix CoFHE](https://github.com/FhenixProtocol), Hardhat
- **Gift cards** — [Reloadly](https://reloadly.com) sandbox
- **Storage** — IPFS via [Pinata](https://pinata.cloud)
- **Network** — Base Sepolia
- **Frontend** — Next.js, Tailwind v4, shadcn, wagmi + RainbowKit, cofhejs
