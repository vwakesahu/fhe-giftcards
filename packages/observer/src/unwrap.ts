import { ethers } from "ethers";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";

import { config } from "./config";
import { CUsdcAbi } from "./abi";
import { ensureCofheInit } from "./cofhe";

/**
 * Observer cash-out utility.
 *
 *   pnpm tsx src/unwrap.ts                # whole cUSDC balance
 *   pnpm tsx src/unwrap.ts 10             # specific amount (human units)
 *
 * Unwrap is two-step on cUSDC: requestUnwrap(encAmount) fires an async
 * FHE-decrypt; claimUnwrap(id) finalises and pays USDC out once the network
 * has produced a plaintext. We poll until it lands.
 */

const CLAIM_RETRIES = 20;
const CLAIM_DELAY_MS = 5_000;

async function main() {
  const [rawAmount] = process.argv.slice(2);
  const wholeBalance = rawAmount === undefined;

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const cUSDC = new ethers.Contract(config.cUSDCAddress, CUsdcAbi, wallet);
  const usdcAddress = process.env.USDC_ADDRESS as `0x${string}` | undefined;
  const usdc = usdcAddress
    ? new ethers.Contract(
        usdcAddress,
        ["function balanceOf(address) view returns (uint256)"],
        wallet,
      )
    : null;

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Sigill — observer unwrap cUSDC → USDC       ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`  signer : ${wallet.address}`);
  console.log(`  cUSDC  : ${config.cUSDCAddress}`);

  // ── init cofhejs ──
  await ensureCofheInit(wallet);

  // ── figure out amount ──
  let amountRaw: bigint;
  if (wholeBalance) {
    console.log("\n① Decrypting sealed balance to compute unwrap amount…");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle: bigint = await (cUSDC as any).balanceOf(wallet.address);
    if (handle === 0n) {
      console.log("  nothing to unwrap — sealed balance is empty");
      return;
    }
    amountRaw = await unseal(handle);
    console.log(`  sealed balance : ${Number(amountRaw) / 1e6} USDC\n`);
  } else {
    const human = Number(rawAmount);
    if (!Number.isFinite(human) || human <= 0) {
      throw new Error(`Invalid amount: ${rawAmount}`);
    }
    amountRaw = BigInt(Math.floor(human * 1_000_000));
    console.log(`  amount : ${human} USDC (${amountRaw} raw)\n`);
  }

  const usdcBefore = usdc ? await usdc.balanceOf(wallet.address) : 0n;
  if (usdc) console.log(`  USDC before : ${Number(usdcBefore) / 1e6}\n`);

  // ── encrypt amount ──
  console.log("② Encrypting unwrap amount…");
  const encRes = await cofhejs.encrypt([Encryptable.uint64(amountRaw)] as const);
  if (encRes.error || !encRes.data) throw new Error(`encrypt failed: ${String(encRes.error)}`);
  const [encAmount] = encRes.data;

  // ── requestUnwrap ──
  console.log("③ Calling requestUnwrap…");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reqTx = await (cUSDC as any).requestUnwrap(encAmount);
  const reqReceipt: ethers.TransactionReceipt = await reqTx.wait();
  console.log(`  tx: ${reqTx.hash}`);
  console.log(`  ${config.explorer}/tx/${reqTx.hash}`);

  // Parse UnwrapRequested to get the unwrapId
  const iface = cUSDC.interface;
  const unwrapLog = reqReceipt.logs.find((log) => {
    try {
      return iface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "UnwrapRequested";
    } catch {
      return false;
    }
  });
  if (!unwrapLog) throw new Error("UnwrapRequested event missing from receipt");
  const parsed = iface.parseLog({
    topics: unwrapLog.topics as string[],
    data: unwrapLog.data,
  })!;
  const unwrapId: bigint = parsed.args.unwrapId;
  console.log(`  unwrapId: ${unwrapId}\n`);

  // ── poll claimUnwrap ──
  console.log("④ Polling claimUnwrap (FHE network decrypt)…");
  let claimed = false;
  for (let i = 1; i <= CLAIM_RETRIES; i++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claimTx = await (cUSDC as any).claimUnwrap(unwrapId);
      await claimTx.wait();
      console.log(`  claimed! tx: ${claimTx.hash}`);
      console.log(`  ${config.explorer}/tx/${claimTx.hash}`);
      claimed = true;
      break;
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg: string = (err as any)?.shortMessage || (err as Error)?.message || String(err);
      if (msg.includes("decrypt pending") || msg.includes("execution reverted")) {
        console.log(`  decrypt still pending… (${i}/${CLAIM_RETRIES})`);
        await new Promise((r) => setTimeout(r, CLAIM_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
  if (!claimed) {
    console.log(`\n  ✗ unwrap still pending after ${CLAIM_RETRIES * CLAIM_DELAY_MS / 1_000}s`);
    console.log(`    re-run to retry claimUnwrap with id=${unwrapId}`);
    return;
  }

  if (usdc) {
    const after = await usdc.balanceOf(wallet.address);
    console.log(`\n  USDC after  : ${Number(after) / 1e6}`);
    console.log(`  delta       : +${Number(after - usdcBefore) / 1e6} USDC`);
  }
}

async function unseal(handle: bigint): Promise<bigint> {
  for (let i = 1; i <= 10; i++) {
    const res = await cofhejs.unseal(handle, FheTypes.Uint64);
    if (res.data !== undefined && res.data !== null) return res.data as bigint;
    if (i < 10) await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("FHE decrypt still pending after 30s — try again in a moment");
}

main().catch((err) => {
  console.error("[unwrap] fatal:", err);
  process.exit(1);
});
