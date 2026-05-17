/**
 * Addresses + minimal ABIs for Sigill, the confidential USDC wrapper,
 * and the test USDC token. Addresses come from env; ABIs are hand-written
 * so wagmi can type inline without loading the full artifact JSON.
 */

const getEnvAddress = (key: string): `0x${string}` => {
  const v = process.env[key];
  if (!v) throw new Error(`${key} env var required`);
  return v as `0x${string}`;
};

export const addresses = {
  sigill: (process.env.NEXT_PUBLIC_SIGILL_ADDRESS ?? "") as `0x${string}`,
  cUSDC: (process.env.NEXT_PUBLIC_CUSDC_ADDRESS ?? "") as `0x${string}`,
  USDC: (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "") as `0x${string}`,
  observer: (process.env.NEXT_PUBLIC_OBSERVER_ADDRESS ?? "") as `0x${string}`,
};

export const assertAddresses = () => {
  getEnvAddress("NEXT_PUBLIC_SIGILL_ADDRESS");
  getEnvAddress("NEXT_PUBLIC_CUSDC_ADDRESS");
  getEnvAddress("NEXT_PUBLIC_USDC_ADDRESS");
  getEnvAddress("NEXT_PUBLIC_OBSERVER_ADDRESS");
};

// Shared InEuintXX tuple shape used by @cofhe/sdk encrypted inputs.
const InEncStruct = [
  { name: "ctHash", type: "uint256" },
  { name: "securityZone", type: "uint8" },
  { name: "utype", type: "uint8" },
  { name: "signature", type: "bytes" },
] as const;

// ─── USDC / MockUSDC ─────────────────────────────────────
export const usdcAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  // MockUSDC extension
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// ─── ConfidentialERC20 ───────────────────────────────────
export const cUSDCAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }], // euint64 handle
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "wrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint64" }],
    outputs: [],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      {
        name: "encAmount",
        type: "tuple",
        components: InEncStruct,
      },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "requestUnwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "encAmount",
        type: "tuple",
        components: InEncStruct,
      },
    ],
    outputs: [{ name: "unwrapId", type: "uint256" }],
  },
  {
    name: "claimUnwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "unwrapId", type: "uint256" },
      { name: "plain", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "UnwrapRequested",
    inputs: [
      { name: "unwrapId", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "encAmountHandle", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UnwrapClaimed",
    inputs: [
      { name: "unwrapId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

// ─── Sigill ──────────────────────────────────────────────
export const sigillAbi = [
  // Step 1 of the new two-step checkout. Returns `pendingId` and emits
  // OrderQuoted carrying the encrypted total handle the buyer must approve
  // before calling confirmOrder. `amountUsdc` is the gift-card price in
  // cUSDC base units (6 decimals); the contract adds observerFee + 0.25%
  // platformFee inside the encrypted domain.
  {
    name: "quoteOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "productId", type: "uint256" },
      { name: "observerAddress", type: "address" },
      { name: "amountUsdc", type: "uint64" },
    ],
    outputs: [{ name: "pendingId", type: "uint256" }],
  },
  // Step 2. Reads the buyer's pre-approved cUSDC allowance, FHE.eq-verifies
  // it against the stored expectedTotal, refunds in-place on mismatch.
  {
    name: "confirmOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "pendingId", type: "uint256" }],
    outputs: [],
  },
  // 9-tuple now — `platformFee` was inserted at index 4 in the new
  // contract so the observer's cut (encPaid - platformFee) can be split
  // off at fulfillment without leaking the breakdown.
  {
    name: "getOrder",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "observer", type: "address" },
      { name: "encProductId", type: "uint256" },
      { name: "encPaid", type: "uint256" },
      { name: "platformFee", type: "uint256" },
      { name: "encAesKey", type: "uint256" },
      { name: "ipfsCid", type: "string" },
      { name: "deadline", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    name: "getPendingOrder",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "pendingId", type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "observer", type: "address" },
      { name: "productId", type: "uint256" },
      { name: "expectedTotal", type: "uint256" },
      { name: "platformFee", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
    ],
  },
  {
    name: "nextOrderId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getObserverBondAmount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "observer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "MIN_BOND",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "PRICISION",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint32" }],
  },
  // Roster — replaces the static OBSERVERS placeholder list. Returns one
  // ObserverDetails per registered observer. Field names mirror the contract
  // (`sucessRate`, `soltSize` typos kept intentionally so the ABI matches).
  // `observerFees` is the encrypted euint64 handle for the relay's flat fee.
  {
    name: "getObserverDetail",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "observerAddress", type: "address" },
          { name: "sucessRate", type: "uint256" },
          { name: "slotLeft", type: "uint256" },
          { name: "soltSize", type: "uint256" },
          { name: "observerFees", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getObservers",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    name: "getObserversCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getCompleteness",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "observer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getOrderCompleted",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "observer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  // Despite the name, this returns pending count (queue length minus orders
  // already processed) — not failed count. Useful as a queue-depth indicator.
  {
    name: "getOrderFailed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "observer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getQueueLength",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "observer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "observersQueue",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "observer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [],
  },
  // Emitted by quoteOrder (step 1). `expectedTotalHandle` is the euint64
  // handle for (amount + observerFee + platformFee) that the buyer must
  // unseal, then re-encrypt + approve before calling confirmOrder.
  {
    type: "event",
    name: "OrderQuoted",
    inputs: [
      { name: "pendingId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "observer", type: "address", indexed: true },
      { name: "productId", type: "uint256" },
      { name: "expectedTotalHandle", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
    ],
  },
  // confirmOrder emits one of two events depending on whether the picked
  // observer has slot capacity at the time of the call:
  //   • OrderInProccessed (sic — typo preserved on-chain) when slotted active
  //   • OrderInQueued                                     when waitlisted
  // Both carry `orderId` as the first indexed arg, which is all the buy
  // wizard needs to navigate to the order page.
  {
    type: "event",
    name: "OrderInProccessed",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "productIdHandle", type: "uint256" },
      { name: "paidHandle", type: "uint256" },
      { name: "observer", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "OrderInQueued",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "productIdHandle", type: "uint256" },
      { name: "paidHandle", type: "uint256" },
      { name: "observer", type: "address" },
    ],
  },
  {
    type: "event",
    name: "OrderFulfilled",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "ipfsCid", type: "string" },
    ],
  },
  {
    type: "event",
    name: "OrderRejected",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "reason", type: "string" },
    ],
  },
] as const;

// Mirrors `enum Status` in packages/contracts/contracts/Observer.sol — the
// indices are what `getOrder().status` returns. Keep these in lockstep.
export const ORDER_STATUS = [
  "Pending",    // 0
  "Processing", // 1 — observer pulled it out of the queue, fulfillOrder in flight
  "Fulfilled",  // 2
  "Refunded",   // 3 — buyer reclaimed escrow after deadline
  "Rejected",   // 4 — observer marked invalid (e.g. unknown product)
  "Queued",     // 5 — waitlisted behind an active order on the same observer
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

// Product catalogue mirrors packages/contracts/scripts/giftcard.ts
export const PRODUCTS = [
  { id: 1, label: "Amazon US", face: 5, priceUsdc: 10 },
  { id: 2, label: "Amazon US", face: 10, priceUsdc: 15 },
  { id: 3, label: "Amazon US", face: 25, priceUsdc: 30 },
] as const;

export type Product = (typeof PRODUCTS)[number];

// Live observer roster — fetched from `getObserverDetail()` at runtime. The
// previous static OBSERVERS array (1 active + 3 "Coming soon" placeholders)
// is replaced by this view-derived shape.
//
// We deliberately do NOT use the contract's `sucessRate` field. The on-chain
// math in `_fulfillOrder` cancels out the precision multiplier:
//   completeness = (orderCompleted * 1e6) / (orderIndex * 1e6 - orderReject)
// which collapses to ~1 for any observer with ≥1 fulfillment. Until that's
// fixed and redeployed, the app reads `getOrderCompleted(addr)` directly and
// shows the absolute count instead of a percentage.
export type ObserverEntry = {
  id: string; // checksummed address — stable for keying React lists
  address: `0x${string}`;
  ordersCompleted: bigint; // from getOrderCompleted(addr)
  slotLeft: bigint;
  slotSize: bigint;
  status: "online" | "full";
};

export function toObserverEntry(raw: {
  observerAddress: `0x${string}`;
  slotLeft: bigint;
  soltSize: bigint;
  ordersCompleted: bigint;
}): ObserverEntry {
  const slotLeft = raw.slotLeft;
  return {
    id: raw.observerAddress,
    address: raw.observerAddress,
    ordersCompleted: raw.ordersCompleted,
    slotLeft,
    slotSize: raw.soltSize,
    status: slotLeft > 0n ? "online" : "full",
  };
}
