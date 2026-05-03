import type { Abi, Account, Address, PublicClient } from "viem";

/**
 * Per-function fallback ceilings. Sized from observed gasUsed in real txs
 * plus a comfortable margin. FHE calls live in the 400k-1.5M range; plain
 * ERC20 calls are ~50-100k.
 */
export const GAS_CEILING = {
  // plain ERC20
  usdcMint: 120_000n,
  usdcApprove: 80_000n,

  // FHE on cUSDC
  cusdcWrap: 700_000n,
  cusdcApprove: 500_000n, // encrypted allowance, FHE-heavy
  cusdcRequestUnwrap: 800_000n,

  // Sigill checkout
  sigillPlaceOrder: 1_500_000n,
} as const;

const BUFFER_NUM = 130n;
const BUFFER_DEN = 100n;

/**
 * Simulate a contract write, then return a gas limit for the actual send.
 *
 * 1. `simulateContract` runs the call as `eth_call`. This catches reverts
 *    before the user is asked to sign — "Observers queue is full",
 *    "Observer not bonded", etc. surface immediately as a thrown error that
 *    the call site's try/catch can toast. Always works for FHE txs because
 *    `eth_call` is unaffected by the public RPC's flaky `eth_estimateGas`.
 * 2. `estimateContractGas` (`eth_estimateGas`) gives a tight number for
 *    non-FHE txs. Returns estimate × 1.30 floored to the per-function
 *    ceiling. On Base Sepolia public RPC, FHE-heavy calls reject this RPC
 *    even when they would succeed (observer daemon hits the same issue);
 *    when that happens we fall back to the ceiling.
 *
 * Throws if step 1 fails — let the call site report the revert reason.
 */
export async function simulateAndGetGas<
  TAbi extends Abi,
  TFn extends string,
>(
  publicClient: PublicClient,
  call: {
    address: Address;
    abi: TAbi;
    functionName: TFn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any;
    account: Account | Address;
    value?: bigint;
  },
  fallback: bigint,
): Promise<bigint> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await publicClient.simulateContract(call as any);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const estimated = await publicClient.estimateContractGas(call as any);
    const buffered = (estimated * BUFFER_NUM) / BUFFER_DEN;
    return buffered > fallback ? buffered : fallback;
  } catch {
    return fallback;
  }
}
