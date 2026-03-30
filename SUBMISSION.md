# Confidential Coupons: Buy anything on-chain. Nobody knows what.

## What it does

Confidential Coupons lets you buy gift cards on-chain where nobody — not the block explorer, not other users, not bots — can see what you bought, how much you paid, or the gift card code you received. The buyer encrypts their order using Fhenix's CoFHE (Fully Homomorphic Encryption), an observer fulfills it by purchasing from Reloadly's API, and the gift card code is protected through hybrid encryption: AES-encrypted and stored on IPFS, with only the AES key FHE-encrypted on-chain so only the buyer can decrypt it. Everything runs on Base Sepolia with real on-chain transactions.

## The problem it solves

On-chain commerce today has zero privacy. If you buy a gift card through a smart contract, anyone can look up your transaction and see the product, the amount, and the redemption code in plaintext. Bots can front-run your transaction and steal the code before you use it. Your wallet builds a permanent, public purchase history. Confidential Coupons eliminates all of this — the blockchain stores only encrypted handles that are meaningless to anyone without the right decryption permission, and the gift card code lives as AES ciphertext on IPFS, useless without the FHE-protected key.

## Challenges I ran into

- The cofhe-hardhat-plugin uses `hardhat_impersonateAccount` internally, which doesn't work on real testnets. Had to write a custom `wrapSigner` function to initialize cofhejs directly with an abstract signer for Base Sepolia.
- The CoFHE testnet threshold network returns "Internal server error" for `euint256` operations — `u256` is unsupported on the current TaskManager. Solved with hybrid encryption: AES-128 encrypts the gift card code (unlimited length), the ciphertext goes to IPFS, and only the 128-bit AES key is FHE-encrypted on-chain as `euint128`.
- Initializing encrypted default values like `FHE.asEuint256(0)` in struct creation caused reverts on testnet. Solved by using Solidity's default zero value instead of explicit FHE initialization.
- Bitrefill's Personal API doesn't support test products — switched to Reloadly which has a proper sandbox with $1000 test balance and fake redemption codes.

## Technologies I used

- **Solidity** — smart contract with FHE-encrypted order storage
- **Fhenix CoFHE** — on-chain Fully Homomorphic Encryption (euint64 for product/amount, euint128 for AES key, FHE.allow access control)
- **cofhejs SDK** — client-side encryption and decryption of FHE values
- **AES-128-GCM** — symmetric encryption for gift card codes (unlimited length)
- **IPFS via Pinata** — decentralized storage for AES-encrypted payloads
- **Hardhat** + cofhe-hardhat-plugin — development, testing, deployment
- **Base Sepolia** — testnet deployment
- **Reloadly API** — gift card purchasing (sandbox mode with test balance)

## How we built it

The smart contract (`PrivateCheckout.sol`) stores orders with `euint64` encrypted product IDs and amounts. When the observer fulfills an order, they AES-encrypt the gift card code with a random 128-bit key, upload the ciphertext to IPFS via Pinata, then FHE-encrypt the AES key on-chain as `euint128`. FHE access control (`FHE.allow()`) grants the observer permission to decrypt only the product details, and grants the buyer permission to decrypt only the AES key — which they use to fetch and decrypt the gift card code from IPFS.

The observer runs a TypeScript script that listens for `OrderPlaced` events, decrypts the order, calls the Reloadly sandbox API to purchase a gift card, performs the hybrid encryption flow, and calls `fulfillOrder(encAesKey, ipfsCid)` on-chain.

Observers post a 0.01 ETH bond when registering. If they don't fulfill an order within the 10-minute deadline, 50% of their bond gets slashed and the buyer gets a full refund.

We wrote 16 tests covering fulfillment, refunds, bond slashing, access control, double-fulfill prevention, and deadline enforcement. The full flow runs end-to-end on Base Sepolia with a single `pnpm e2e` command.

## What we learned

FHE access control is the real unlock — it's not just about encrypting data, it's about granular per-address permissions on who can decrypt what. The `FHE.allow(handle, address)` pattern lets you build multi-party workflows where each participant only sees the data they need. We also learned that hybrid encryption (FHE + AES + IPFS) is the practical pattern for real-world FHE applications — FHE handles the key management and access control, while symmetric encryption handles the actual data at any size. FHE on real testnets behaves differently from local mocks — signer initialization, gas costs, type support, and handle formats all required adjustments.

## Decentralizing the observer

Right now the observer is a single trusted script. To decentralize it, the existing bond/slash mechanism serves as the foundation. This can be expanded by requiring larger bonds, introducing reputation scores based on successful fulfillments over total attempts, and allowing buyers to filter observers by reputation. Penalties for failures can be increased to strengthen reliability, and a dispute resolution window can be added so buyers can challenge invalid codes. This approach builds directly on the current design and already covers most of the required components.

## What's next for Confidential Coupons

Two additions to complete the privacy story:

1. **Confidential token wrapper contract** — so the payment amount itself is encrypted. Right now the locked ETH is visible on-chain. With FHERC20, even the payment is hidden.

2. **Stealth safe contracts** — so the buyer interacts through a one-time stealth address instead of their real wallet. Right now `msg.sender` is still visible.

Combined: encrypted product, encrypted amount, encrypted code, encrypted payment, anonymous buyer. Full private commerce on Base Sepolia.
