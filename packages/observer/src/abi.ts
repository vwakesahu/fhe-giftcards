// Hand-written minimal ABIs — we only need what the observer actually calls.

const InEncStruct = [
  { name: "ctHash", type: "uint256" },
  { name: "securityZone", type: "uint8" },
  { name: "utype", type: "uint8" },
  { name: "signature", type: "bytes" },
] as const;

export const SigillAbi = [
  {
    name: "registerObserver",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "observerBond",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
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
    name: "fulfillOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "encAesKey", type: "tuple", components: InEncStruct },
      { name: "ipfsCid", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "rejectOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "OrderPlaced",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "productIdHandle", type: "uint256", indexed: false },
      { name: "paidHandle", type: "uint256", indexed: false },
      { name: "observer", type: "address", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
  },
] as const;

export const CUsdcAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "requestUnwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "encAmount", type: "tuple", components: InEncStruct }],
    outputs: [{ name: "unwrapId", type: "uint256" }],
  },
  {
    name: "claimUnwrap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "unwrapId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "UnwrapRequested",
    inputs: [
      { name: "unwrapId", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: true },
    ],
  },
] as const;
