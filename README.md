# Private Checkout — Buy anything on-chain. Nobody knows what.

Private gift card purchases using Fully Homomorphic Encryption on Base Sepolia. Nobody on-chain can see what you bought or the gift card code — only the buyer can decrypt it.

## How It Works

**Hybrid encryption: FHE + AES + IPFS**

1. **Buyer** encrypts their order (product ID + amount) with FHE and locks ETH on-chain
2. **Observer** decrypts product details via FHE, purchases a gift card from Reloadly API
3. **Observer** encrypts the gift card code with a random AES-128 key, uploads the ciphertext to IPFS, then FHE-encrypts the AES key on-chain so only the buyer can decrypt it
4. **Buyer** FHE-unseals the AES key, fetches the ciphertext from IPFS, AES-decrypts to get the gift card code

The gift card code never appears in plaintext on-chain or on IPFS. Block explorer shows opaque handles. IPFS shows AES gibberish.

## Stack

- **Contract**: Solidity + [Fhenix CoFHE](https://github.com/FhenixProtocol) for FHE operations
- **Gift Cards**: [Reloadly](https://reloadly.com) sandbox API (free $1000 test balance)
- **Storage**: IPFS via [Pinata](https://pinata.cloud) for AES-encrypted payloads
- **Network**: Base Sepolia testnet
- **Framework**: Hardhat + cofhe-hardhat-plugin

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in all keys (see below)
```

### Keys You Need

| Key | Where to get it |
|-----|----------------|
| `PRIVATE_KEY` | Buyer wallet private key (Base Sepolia ETH) |
| `OBSERVER_PRIVATE_KEY` | Observer wallet private key (Base Sepolia ETH) |
| `RELOADLY_CLIENT_ID` | [reloadly.com](https://reloadly.com) → Test mode → Developers → API Settings |
| `RELOADLY_CLIENT_SECRET` | Same as above |
| `PINATA_JWT` | [pinata.cloud](https://pinata.cloud) → API Keys → New Key |
| `PINATA_GATEWAY` | Your Pinata gateway URL (or use `https://gateway.pinata.cloud`) |

## Run

### Full E2E Demo (single command)

Deploys contract, registers observer, places encrypted order, buys gift card via Reloadly, encrypts with AES, uploads to IPFS, FHE-encrypts AES key, buyer decrypts everything:

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

## What's Private

| Data | Where | Visible? |
|------|-------|----------|
| Transaction happened | On-chain | Yes |
| Buyer address | On-chain | Yes (msg.sender) |
| Observer address | On-chain | Yes |
| ETH locked | On-chain | Yes |
| **Product ID** | On-chain | **No** — FHE-encrypted, only observer can decrypt |
| **Amount** | On-chain | **No** — FHE-encrypted, only observer can decrypt |
| **AES key** | On-chain | **No** — FHE-encrypted, only buyer can decrypt |
| **Gift card code** | IPFS | **No** — AES-encrypted, needs FHE-unsealed key |
| IPFS CID | On-chain | Yes, but ciphertext is useless without the key |

## Architecture

```
Buyer                          Contract (Base Sepolia)              Observer
  |                                  |                                |
  |-- encrypt(productId, amount) --> |                                |
  |-- placeOrder() + lock ETH ----> |                                |
  |                                  |-- OrderPlaced event ---------> |
  |                                  |                                |
  |                                  |    unseal(productId, amount)   |
  |                                  |    buy gift card (Reloadly)    |
  |                                  |    AES-encrypt code            |
  |                                  |    upload to IPFS (Pinata)     |
  |                                  |    FHE-encrypt AES key         |
  |                                  |                                |
  |                                  | <-- fulfillOrder(encKey, cid)  |
  |                                  |     ETH paid to observer       |
  |                                  |                                |
  |  unseal AES key (FHE)           |                                |
  |  fetch ciphertext (IPFS)        |                                |
  |  AES-decrypt → gift card code   |                                |
```

## Contract

`PrivateCheckout.sol` — stores orders with FHE-encrypted fields:

- `euint64 encProductId` — what to buy (only observer decrypts)
- `euint64 encAmount` — denomination (only observer decrypts)
- `euint128 encAesKey` — AES-128 key for the gift card code (only buyer decrypts)
- `string ipfsCid` — IPFS CID pointing to AES-encrypted gift card code

Access control via `FHE.allow(handle, address)` — granular per-address permissions.

Observer posts a 0.01 ETH bond. If they don't fulfill within 10 minutes, 50% gets slashed and buyer gets refunded.

## Project Structure

```
contracts/
  PrivateCheckout.sol     — Main contract with FHE + AES key storage
scripts/
  e2e.ts                  — Full end-to-end demo script
  demo.ts                 — Buyer-side demo
  observer.ts             — Observer fulfillment service
  giftcard.ts             — Reloadly API integration
  crypto.ts               — AES-128-GCM encrypt/decrypt helpers
  ipfs.ts                 — Pinata IPFS upload/fetch
tasks/
  deploy-checkout.ts      — Deploy task
  register-observer.ts    — Observer registration task
test/
  PrivateCheckout.test.ts — 16 tests covering all flows
```
