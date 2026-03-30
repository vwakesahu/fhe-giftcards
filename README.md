# Private Checkout — FHE Gift Cards

Private gift card purchases using Fully Homomorphic Encryption on Base Sepolia. Nobody on-chain can see what you bought or the gift card code — only the buyer can decrypt it.

## How It Works

1. **Buyer** encrypts their order (product + amount) and locks ETH on-chain
2. **Observer** decrypts what to buy, purchases a gift card via Reloadly API, encrypts the code back for the buyer only
3. **Buyer** decrypts the gift card code — it never appears in plaintext on-chain

Block explorer shows opaque encrypted handles. The actual values are only visible to permitted parties.

## Stack

- **Contract**: Solidity + [Fhenix CoFHE](https://github.com/FhenixProtocol) for FHE operations
- **Gift Cards**: [Reloadly](https://reloadly.com) sandbox API (free $1000 test balance)
- **Network**: Base Sepolia testnet
- **Framework**: Hardhat + cofhe-hardhat-plugin

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in PRIVATE_KEY, OBSERVER_PRIVATE_KEY, RELOADLY_CLIENT_ID, RELOADLY_CLIENT_SECRET
```

### Get Reloadly Keys (free, 2 minutes)

1. Sign up at [reloadly.com](https://reloadly.com)
2. Toggle to **Test mode** in the dashboard sidebar
3. Go to **Developers → API Settings**
4. Copy sandbox `client_id` and `client_secret` into `.env`

## Run

### Full E2E Demo (single command)

Deploys contract, registers observer, places encrypted order, buys gift card, fulfills, decrypts — all in one script:

```bash
pnpm e2e          # Base Sepolia
pnpm e2e:local    # Local hardhat (mock FHE)
```

### Step-by-Step (separate terminals)

```bash
# 1. Deploy
pnpm deploy

# 2. Register observer
pnpm register

# 3. Start observer (Terminal 2)
pnpm observer

# 4. Run buyer demo (Terminal 1)
pnpm demo
```

## Test

```bash
pnpm test    # 16 tests — mock FHE environment
```

## What's Private On-Chain

| Data | Visible? |
|------|----------|
| That a transaction happened | Yes |
| Buyer address | Yes (msg.sender) |
| Observer address | Yes |
| ETH locked | Yes |
| **What was bought (product ID)** | **No** — encrypted, only observer can decrypt |
| **Amount / denomination** | **No** — encrypted, only observer can decrypt |
| **Gift card code** | **No** — encrypted, only buyer can decrypt |

## Contract

`PrivateCheckout.sol` — uses `euint64` for product/amount and `euint256` for gift card codes. FHE permissions control who can decrypt what:

- `FHE.allow(productId, observer)` — observer decrypts to know what to buy
- `FHE.allow(code, buyer)` — only buyer can decrypt the gift card code
- Nobody else (including the contract itself) can read the plaintext values

## Project Structure

```
contracts/
  PrivateCheckout.sol     — Main contract with FHE-encrypted orders
scripts/
  e2e.ts                  — Full end-to-end demo script
  demo.ts                 — Buyer-side demo
  observer.ts             — Observer fulfillment service
  giftcard.ts             — Reloadly API integration
tasks/
  deploy-checkout.ts      — Deploy task
  register-observer.ts    — Observer registration task
test/
  PrivateCheckout.test.ts — 16 tests covering all flows
```
