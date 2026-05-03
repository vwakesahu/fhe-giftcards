import type { Abi, Account, Address, PublicClient } from "viem";

/**
 * Estimate gas for a contract write and apply a 30% safety buffer. Falls back
 * to a fixed ceiling when `estimateContractGas` reverts — Base Sepolia's
 * public RPC returns CALL_EXCEPTION on FHE-heavy txs even when the call would
 * succeed on-chain. The observer daemon hits the same issue and hardcodes a
 * ceiling there too (see packages/observer/src/fulfill.ts).
 */
const BUFFER_NUM = 130n;
const BUFFER_DEN = 100n;

export async function estimateGasWithBuffer<
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const estimated = await publicClient.estimateContractGas(call as any);
    const buffered = (estimated * BUFFER_NUM) / BUFFER_DEN;
    // Never go below the fallback — protects against estimates that come back
    // suspiciously low (rare, but observed on cold replicas).
    return buffered > fallback ? buffered : fallback;
  } catch {
    return fallback;
  }
}

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
