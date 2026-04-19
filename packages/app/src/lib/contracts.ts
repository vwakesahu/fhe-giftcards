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

// Shared InEuintXX tuple shape used by cofhejs encrypted inputs.
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
  {
    name: "placeOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "encProductId", type: "tuple", components: InEncStruct },
      { name: "observerAddress", type: "address" },
    ],
    outputs: [],
  },
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
      { name: "encAesKey", type: "uint256" },
      { name: "ipfsCid", type: "string" },
      { name: "deadline", type: "uint256" },
      { name: "status", type: "uint8" },
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
    name: "observerBond",
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
  {
    type: "event",
    name: "OrderPlaced",
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

export const ORDER_STATUS = ["Pending", "Fulfilled", "Refunded", "Rejected"] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

// Product catalogue mirrors packages/contracts/scripts/giftcard.ts
export const PRODUCTS = [
  { id: 1, label: "Amazon US", face: 5, priceUsdc: 10 },
  { id: 2, label: "Amazon US", face: 10, priceUsdc: 15 },
  { id: 3, label: "Amazon US", face: 25, priceUsdc: 30 },
] as const;

export type Product = (typeof PRODUCTS)[number];

// The single active observer, plus placeholders that render as "Coming soon".
export const OBSERVERS = [
  {
    id: "sigill-primary",
    name: "Sigill · Relay 01",
    region: "US East",
    status: "online" as const,
    address: addresses.observer,
  },
  {
    id: "placeholder-2",
    name: "Relay 02",
    region: "EU West",
    status: "unavailable" as const,
    address: null,
  },
  {
    id: "placeholder-3",
    name: "Relay 03",
    region: "Asia Pacific",
    status: "unavailable" as const,
    address: null,
  },
  {
    id: "placeholder-4",
    name: "Relay 04",
    region: "SA",
    status: "unavailable" as const,
    address: null,
  },
];
