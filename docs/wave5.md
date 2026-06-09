# Sigill, Wave 5

Sigill is a private checkout for gift cards. The buyer wraps USDC into a confidential ERC-20 (cUSDC), picks a brand from the catalog, pays an encrypted price, and gets back a redemption code that only their wallet can open. The chain only ever sees two addresses moving opaque sealed balances between them. The product, the amount, and the code stay invisible to the explorer, to any observer of the chain, and to anyone except the buyer.

The protocol is permissionless: any wallet can bond ETH and run a relay. Today we operate both relays ourselves on Base Sepolia to keep the demo path predictable, but the contract accepts any number of bonded relays and the buy wizard always lets the buyer pick which one fulfils their order.

## What ships in Wave 5

Wave 5 takes the pipeline fully through real-money commerce. The observer now delivers actual gift cards from Reloadly's production network, and the dApp surfaces a brand catalog that signals where Sigill is going without overpromising what is shipped.

Two things ship:

1. **Real-money commerce via Reloadly production.** The observer daemon gates Reloadly behind a `RELOADLY_ENV` switch. `live` routes auth + orders to `giftcards.reloadly.com` using a separate `RELOADLY_LIVE_CLIENT_ID` / `RELOADLY_LIVE_CLIENT_SECRET` pair; anything else falls back to sandbox. `PRODUCT_MAP_LIVE[1]` is wired to Reloadly product 21 (App Store & iTunes US, range $2–$100). The full path is proven end-to-end: on-chain `quoteOrder` → encrypted approve → `confirmOrder` → observer decrypts → Reloadly production order → real Apple card pinned to IPFS → buyer unseals the AES key.
2. **Multi-brand catalog with App Store live and seven coming-soon.** The picker now carries App Store & iTunes, Netflix, Spotify, Google Play, Xbox Live, PlayStation, Steam, Roblox. Only App Store routes to a real Reloadly product (id 21). The rest render with brand logos, a "Coming soon" pill in place of the price, lower opacity, and a defensive guard in the wizard that aborts before `quoteOrder` if a coming-soon product somehow gets selected. Catalog enforcement lives off-chain on the observer's `PRODUCT_MAP` — unknown productIds get rejected at fulfillment with the buyer's escrow refunded same-tx via the existing FHE.eq path. The landing carries a "We support" brand strip with the same eight pills, App Store carrying a green Live tag.
3. **Privacy hardening on `quoteOrder`.** Both productId and amount now enter the contract as `InEuint64` ciphertexts instead of plaintext function arguments. Calldata of a quote tx no longer carries `productId=N` or `amountUsdc=M` in the clear, so mempool watchers and archive nodes can't link a buyer wallet to a specific product + price the way they could before. The contract's `_quoteOrder` reads both via `FHE.asEuint64(input)`, ACL-grants the encrypted productId to the picked observer for fulfillment, and proceeds with the same encrypted total computation. `OrderQuoted` emits a `productIdHandle` (ciphertext) rather than the plaintext productId field it used to carry.

Plus two operational helpers shipped as observer-package scripts:

- `packages/observer/scripts/reloadly-live-test.mjs`: discovery + buy script for Reloadly production. Lists matching products with their min denominations, supports a `--products=a,b,c` sequence mode that stops at the first issued card (failed sourcing auto-refunds, so only a success costs money), and writes every order + cards response to `reloadly-receipts/live-test.log` so issued codes are never lost.
- `packages/contracts/scripts/query-vault-balance.mjs` and `unwrap-vault.mjs`: read-only and Safe-driven cash-out paths for the protocol vault. The vault is a 2-of-3 Gnosis Safe at `0x37DFfFfB73b4A7eE6584F1ea56bac618c29c6882`. `query-vault-balance.mjs` counts platform-fee deposits and nets out previously-claimed unwraps to estimate the sealed balance, `unwrap-vault.mjs` builds + signs the Safe transaction that pulls plaintext USDC back through the cUSDC unwrapper.

Live:

- Landing: https://www.sigill.store/
- App: https://app.sigill.store/
- Sigill: https://sepolia.basescan.org/address/0xb302566eA948f2039Cf6f8a30719F56a93e49Ab4
- cUSDC: https://sepolia.basescan.org/address/0x285b239fc9fE8B100d0Cb865cb44BdB166f81977
- USDC (Mock on Base Sepolia): https://sepolia.basescan.org/address/0xe29d70400026d77a790a8e483168b94d6e36424f
- Walkthrough video (Wave 5): https://youtu.be/Ucd8nTsQXkY

## The problem

The earlier ships proved the privacy guarantee held through a tamper-resistant checkout against a sandbox provider. Two things were still unanswered: would the full pipeline actually deliver a real gift card to the buyer's wallet, and would the catalog reflect a real product market instead of a single placeholder? Wave 5 closes both.

## Challenges

- **Reloadly production has a separate auth audience and IP whitelist.** Sandbox keys returned `INVALID_CREDENTIALS` against the production endpoint until we discovered the dashboard's Live mode exposes a different `client_id` + `client_secret` pair, and production orders require the source IP to be on the account's whitelist. Fix: env switch picks the right credential pair and audience based on `RELOADLY_ENV`; deploy notes call out the Railway egress IP whitelist gap operators need to handle separately.
- **Amazon US auto-refunds on sourcing failure.** The first attempted live order returned 500 from `POST /orders` while the payments report showed the $1 had been charged then immediately auto-refunded. Amazon US is a heavily supply-gated product on Reloadly. The discovery script identifies which brands the account can actually source, and the dApp catalog moved to App Store as the live brand instead.

## What's next

Sigill is product-ready today. Contracts, observer pipeline, picker UX, @cofhe/sdk flow, and the Reloadly production integration all run end-to-end on Base Sepolia, with real Apple cards landing in buyer wallets through the same encrypted checkout path that protects the payment amount and the product choice. What we're waiting for is the substrate: Fhenix CoFHE on a mainnet chain. The moment that ships, Sigill flips three env values (RPC, Sigill address, cUSDC address), redeploys the same contracts, and goes live for real-money commerce on the exact code paths the walkthrough demonstrates. Catalog expansion (Netflix, Spotify, and the rest of the coming-soon brands) lands the moment each one is supply-confirmed on Reloadly. The relay-trust improvements in [docs/reputation-and-slashing.md](reputation-and-slashing.md) ship in the same window.
