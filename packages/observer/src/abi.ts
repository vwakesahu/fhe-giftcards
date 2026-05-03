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
    name: "getObserverBondAmount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "observer", type: "address" }],
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
  // Sigill emits one of two events on placeOrder depending on whether the
  // picked observer had a free slot. Both carry orderId as the first indexed
  // arg, which is all the daemon needs to dispatch.
  {
    type: "event",
    name: "OrderInProccessed",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "productIdHandle", type: "uint256", indexed: false },
      { name: "paidHandle", type: "uint256", indexed: false },
      { name: "observer", type: "address", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderInQueued",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "productIdHandle", type: "uint256", indexed: false },
      { name: "paidHandle", type: "uint256", indexed: false },
      { name: "observer", type: "address", indexed: false },
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
    inputs: [
      { name: "unwrapId", type: "uint256" },
      { name: "plain", type: "uint64" },
    ],
    outputs: [],
  },
  {
    name: "pendingUnwraps",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "recipient", type: "address" },
      { name: "encAmount", type: "uint256" },
      { name: "claimed", type: "bool" },
    ],
  },
  {
    name: "unwrapper",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
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
] as const;
