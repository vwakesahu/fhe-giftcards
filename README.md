# Sigill

Private checkout using FHE on Base Sepolia. Buy a gift card — nobody on-chain can see what you bought, how much you paid, or the code you got back.

Live at **[sigill.store](https://sigill.store)**.

## Why Sigill?

A sigill is a seal — the kind kings pressed in wax onto private correspondence so couriers couldn&rsquo;t read what they carried. The promise was simple: this is sealed, and opening it without permission means you broke the seal.

That promise mostly vanished from money. Every transaction is a postcard now — the amount, the counterparty, every downstream address, all public forever. So we made a new kind of seal, pressed in ciphertext instead of wax. It still means the same thing: what you bought is yours, and nobody opens the envelope but you.

## The idea

On-chain payments leak everything: the amount, the counterparty, and every address it touches afterward. Sigill hides all of that. Your browser seals the inputs with FHE, a bonded observer fulfils the order without ever learning a wallet-visible secret, and the gift card code gets delivered through an encrypted side-channel only you can open.

**How it flows**

1. Buyer encrypts `productId` + `amount` in the browser and locks ETH on Base.
2. A bonded observer gets FHE access to just those two values, decrypts privately, and buys the card from Reloadly.
3. Observer AES-encrypts the code, pins the ciphertext to IPFS, and FHE-wraps the AES key so only the buyer can open it.
4. Buyer unseals the AES key through FHE, fetches the ciphertext, AES-decrypts, reads the code locally.

Explorer only ever sees opaque handles. IPFS only ever sees gibberish.

## What's in the monorepo

```
packages/
  contracts/   Hardhat + Solidity + Fhenix CoFHE
  landing/     Next.js 16 marketing site
  app/         Next.js 16 dApp (wagmi + RainbowKit + CoFHE client)
```

pnpm workspace. Node 20+, pnpm 9+.

## Setup

```bash
pnpm install
cp packages/contracts/.env.example   packages/contracts/.env
cp packages/app/.env.local.example   packages/app/.env.local
```

Things you'll need to fill in:

| File | Keys | Where to get them |
|---|---|---|
| `packages/contracts/.env` | `PRIVATE_KEY`, `OBSERVER_PRIVATE_KEY` | any Base Sepolia wallets with a bit of test ETH |
| " | `RELOADLY_CLIENT_ID` + `_SECRET` | [reloadly.com](https://reloadly.com) → Test mode → Developers |
| " | `PINATA_JWT`, `PINATA_GATEWAY` | [pinata.cloud](https://pinata.cloud) → API Keys |
| `packages/app/.env.local` | `NEXT_PUBLIC_CHECKOUT_ADDRESS` | output of `pnpm contracts:deploy` |
| " | `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | public RPC works; Alchemy/Infura for less pain |

## Running stuff

Everything runs from the repo root.

```bash
# Marketing site
pnpm landing:dev            # http://localhost:3000

# dApp
pnpm app:dev                # http://localhost:3000 — run one at a time,
                            # or: pnpm --filter @sigill/app dev --port 3001

# Contracts
pnpm contracts:compile      # compile Solidity
pnpm contracts:test         # 16 tests, mock FHE
pnpm contracts:deploy       # deploy PrivateCheckout to Base Sepolia
pnpm contracts:observer     # run the observer fulfilment loop
```

### End-to-end demo

The whole flow — deploy, register, order, observe, fulfil, decrypt — in one command:

```bash
cd packages/contracts
pnpm e2e          # Base Sepolia
pnpm e2e:local    # local hardhat with mock FHE
```

### Step-by-step (two terminals)

```bash
cd packages/contracts

# Terminal 1
pnpm deploy       # 1. deploy the contract
pnpm register     # 2. register observer with 0.01 ETH bond
pnpm observer     # 3. start the observer — leave running

# Terminal 2
pnpm demo         # 4. place an order as the buyer
```

## What actually stays private

| | Where | Leaks? |
|---|---|---|
| Transaction happened | on-chain | yes |
| Buyer / observer addresses | on-chain | yes |
| ETH locked | on-chain | yes |
| **Product ID** | on-chain | **no — FHE, observer-only** |
| **Amount** | on-chain | **no — FHE, observer-only** |
| **AES key** | on-chain | **no — FHE, buyer-only** |
| **Gift card code** | IPFS | **no — AES, needs the FHE-unsealed key** |
| IPFS CID | on-chain | yes, but useless without the key |

## Architecture

```
Buyer                        PrivateCheckout (Base)            Observer
  |                                 |                              |
  |-- encrypt(product, amount) -->  |                              |
  |-- placeOrder() + lock ETH  -->  |                              |
  |                                 |-- OrderPlaced -------------> |
  |                                 |                              |
  |                                 |    unseal(product, amount)   |
  |                                 |    buy via Reloadly          |
  |                                 |    AES-encrypt code          |
  |                                 |    pin to IPFS               |
  |                                 |    FHE-wrap AES key          |
  |                                 |                              |
  |                                 | <-- fulfillOrder(key, cid)   |
  |                                 |     ETH -> observer          |
  |                                 |                              |
  |  unseal AES key (FHE)           |                              |
  |  fetch ciphertext (IPFS)        |                              |
  |  AES-decrypt -> code            |                              |
```

## The contract

[PrivateCheckout.sol](packages/contracts/contracts/PrivateCheckout.sol) stores each order as:

- `euint64 encProductId` — what to buy (observer decrypts)
- `euint64 encAmount` — denomination (observer decrypts)
- `euint128 encAesKey` — AES-128 key for the code (buyer decrypts)
- `string ipfsCid` — pointer to the AES-encrypted code

Access control is per-address through `FHE.allow(handle, address)`. Observers bond 0.01 ETH; miss the 10-minute deadline and half the bond is slashed, escrow refunds to the buyer.

## Stack

- **Contracts** — Solidity + [Fhenix CoFHE](https://github.com/FhenixProtocol), Hardhat
- **Gift cards** — [Reloadly](https://reloadly.com) sandbox
- **Storage** — IPFS via [Pinata](https://pinata.cloud)
- **Network** — Base Sepolia
- **Frontend** — Next.js 16, Tailwind v4, shadcn, wagmi + RainbowKit, cofhejs
