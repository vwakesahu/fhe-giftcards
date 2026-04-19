# FHE Confidentiality Model

> **Note:** Sigill's privacy guarantees come from **Fully Homomorphic Encryption** on Fhenix CoFHE. Every sensitive value that touches the chain — payment amounts, product identifiers, and gift-card keys — lives as a ciphertext handle. Only the parties explicitly granted access can ever read the plaintext.

## What is FHE in Sigill?

FHE lets a smart contract **operate on encrypted values without decrypting them**. A buyer encrypts `productId` and `amount` in the browser, submits the ciphertext on-chain, and the contract adds, subtracts, and compares those values as encrypted `euint` handles.

Plaintext never appears on-chain. The explorer sees an opaque 32-byte handle (`uint256`); the FHE network holds the actual ciphertext; a small **per-value ACL** decides who can ever decrypt it.

This model underpins three guarantees in Sigill:

- **Amounts are private.** cUSDC balances and allowances are encrypted `euint64`. The chain only sees handle updates.
- **Orders are private.** `encProductId` and `encPaid` in an order are decryptable only by the assigned observer.
- **Delivery is private.** The AES key that unlocks the gift-card code is encrypted as `euint128` and decryptable only by the buyer.

***

## Key Features

### 1. Encrypted balances and allowances

cUSDC (`ConfidentialERC20`) stores every balance and allowance as an `euint64` handle. Arithmetic (`FHE.add`, `FHE.sub`) runs directly on ciphertexts:

```solidity
function _credit(address owner, euint64 amount) internal {
    euint64 next = FHE.add(_balances[owner], amount);
    _balances[owner] = next;
    FHE.allowThis(next);
    FHE.allow(next, owner);
}
```

Nobody except the balance owner (and the contract itself) can ever decrypt `_balances[owner]`.

### 2. Encrypted order inputs

When the buyer calls `placeOrder(encProductId, observer)`, the product ID enters the contract as an `InEuint64` (a zk-verified input ciphertext) and is re-wrapped as an `euint64`. The contract never sees the plaintext product ID or the amount that gets escrowed.

```solidity
euint64 productId = FHE.asEuint64(encProductId);
FHE.allowThis(productId);
FHE.allow(productId, observerAddress);
```

### 3. Per-value access control

Fhenix's ACL is **not** role-based — it's **handle-based**. Every ciphertext handle has its own list of addresses allowed to decrypt it. Sigill uses three ACL primitives:

- `FHE.allowThis(handle)` — the contract itself can operate on and pass around the handle.
- `FHE.allow(handle, address)` — persistent permission for `address` to decrypt.
- `FHE.allowTransient(handle, address)` — one-call permission, cleared after the transaction. Used when passing encrypted payment into cUSDC's `transferEncrypted`.

### 4. Silent clamping, not reverts

Reverts leak information. If `transferFrom` reverted on insufficient balance, an observer could binary-search a buyer's balance by trying amounts. Instead, cUSDC **silently clamps** to `min(amount, allowance, balance)`:

```solidity
ebool ok = FHE.gte(bal, amount);
return FHE.select(ok, amount, FHE.asEuint64(0));
```

This is the ERC-7984 convention, and it keeps the encrypted-balance abstraction leak-free.

### 5. Hybrid delivery for large payloads

FHE is costly for large data. Sigill encrypts the **gift-card code** with AES-128 off-chain, pins the ciphertext to IPFS, and FHE-wraps only the 128-bit AES key as an `euint128` that the buyer alone can decrypt. Small secret on-chain, big secret off-chain — both private end-to-end.

***

## Encrypted Types in Sigill

| Type | Where | Purpose |
| --- | --- | --- |
| `euint64` | cUSDC balances, allowances, `encPaid` | Token amounts (64-bit is enough for USDC with 6 decimals). |
| `euint64` | `Order.encProductId` | Reloadly product identifier the observer must fulfil. |
| `euint128` | `Order.encAesKey` | 128-bit AES key that unlocks the gift-card ciphertext on IPFS. |
| `ebool` | internal clamps | Branch-free comparison results (`FHE.gte`, `FHE.select`). |
| `InEuint64` / `InEuint128` | user-signed inputs | Ciphertext + zk proof produced in the browser via cofhejs. |

***

## Access Control Model

Every encrypted handle in Sigill is accessible by a deliberately narrow set of parties. The rule of thumb: **whoever needs to act on a value gets ACL, nobody else.**

| Handle | Buyer | Observer | Contract | Notes |
| --- | :---: | :---: | :---: | --- |
| `cUSDC.balanceOf(buyer)` | ✅ | ❌ | ✅ | Only the holder can decrypt their own balance. |
| `cUSDC.allowance(buyer, Sigill)` | ✅ | ❌ | ✅ | Granted to Sigill so it can pull escrow. |
| `Order.encPaid` | ❌ | ✅ | ✅ | Observer verifies payment covers price. |
| `Order.encProductId` | ❌ | ✅ | ✅ | Observer decrypts to know which card to buy. |
| `Order.encAesKey` | ✅ | ❌ | ✅ | Only buyer can unseal the gift-card code. |

The **observer never sees the buyer's identity-linked balance**, and the **buyer never learns the encrypted `encPaid` handle** of their own order — only the AES key that's needed to read the delivered code.

***

## What stays private vs. what leaks

| | Where it lives | Leaks? |
| --- | --- | --- |
| Transaction happened | on-chain | **Yes.** Public tx, public caller. |
| Buyer / observer addresses | on-chain | **Yes.** Standard EOA visibility. |
| Observer bond (fixed 0.01 ETH) | on-chain | **Yes.** Flat-rate, so no info. |
| USDC wrap amount | on-chain | **Yes.** Pre-order, unavoidable. |
| cUSDC payment amount | on-chain | **No.** Encrypted `euint64` handle. |
| Product ID | on-chain | **No.** FHE, observer-only ACL. |
| AES key for the code | on-chain | **No.** FHE, buyer-only ACL. |
| Gift-card code | IPFS | **No.** AES-128, needs FHE-unsealed key. |
| IPFS CID | on-chain | **Yes, but useless** without the AES key. |

The only plaintext touchpoint on-chain is the **wrap step** — the buyer tops up cUSDC from public USDC before placing an order. Everything downstream flows as encrypted balance updates.

***

## Quick Example

A minimal buyer-side flow, grounded in the actual contracts:

```typescript
// 1. Wrap plaintext USDC into encrypted cUSDC (amount is public here).
await cUSDC.wrap(50_000_000n); // 50 USDC, 6 decimals

// 2. Encrypt the allowance for Sigill. Amount never appears on-chain.
const encAllowance = await cofhe.encrypt(10_000_000n); // 10 USDC
await cUSDC.approve(sigillAddress, encAllowance);

// 3. Encrypt the Reloadly product ID and place the order.
const encProductId = await cofhe.encrypt(PRODUCT_ID_AMAZON_10USD);
await sigill.placeOrder(encProductId, observerAddress);
```

Under the hood, `placeOrder` consumes the encrypted allowance as escrow, grants the observer ACL on `encPaid` and `encProductId`, and emits handle references in `OrderPlaced`. No plaintext amount ever crosses the wire.

***

## Comparison with a Public Checkout

| Feature | Public ERC-20 checkout | Sigill (FHE) |
| --- | --- | --- |
| Payment amount visible | Yes | No (encrypted `euint64`) |
| Product purchased visible | Yes | No (encrypted `euint64`) |
| Balance visible | Yes | No (encrypted `euint64`) |
| Delivered secret on-chain | In clear or unused | Hybrid (AES on IPFS + FHE key) |
| Insufficient-fund behaviour | Revert (leaks info) | Silent clamp to zero |
| Counterparty learns payer's balance | Yes | No |

***

## Next Steps

- **[Decentralized Observer System](Decentralized%20Observer%20System.md)** — how observers fulfil orders using the ACL permissions described above.
- **Sigill Checkout Contract** *(coming soon)* — deep dive on `placeOrder`, `fulfillOrder`, `rejectOrder`, and `refund`.
- **Confidential Token (cUSDC)** *(coming soon)* — wrap/unwrap flow and the `transferFromAllowance` primitive.
- **Hybrid Encryption Delivery** *(coming soon)* — how AES-128, IPFS, and FHE combine to deliver gift-card codes.

***

## Related Topics

- [Fhenix CoFHE docs](https://cofhe-docs.fhenix.zone)
- [FHE Solidity API reference](https://cofhe-docs.fhenix.zone/fhe-library/reference/fhe-sol/overview)
- [ACL deep dive](https://cofhe-docs.fhenix.zone/fhe-library/core-concepts/access-control)
- [cofhejs (client SDK)](https://cofhe-docs.fhenix.zone/client-sdk/introduction/overview)
