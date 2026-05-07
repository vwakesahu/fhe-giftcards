/**
 * One-shot manual fulfilment for a single order. Use when the hosted observer
 * skipped or errored on an order and the deadline is still in the future.
 *
 *   pnpm tsx src/manual-fulfill.ts <orderId>
 *
 * Reads OBSERVER_PRIVATE_KEY / SIGILL_ADDRESS / CUSDC_ADDRESS / Reloadly +
 * Pinata creds from packages/observer/.env.local (same env the daemon uses).
 */
import { ethers } from "ethers";

import { config } from "./config";
import { CUsdcAbi, SigillAbi } from "./abi";
import { ensureCofheInit } from "./cofhe";
import { fulfillOne } from "./fulfill";

const STATUS = ["Pending", "Processing", "Fulfilled", "Refunded", "Rejected", "Queued"];

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error("usage: pnpm tsx src/manual-fulfill.ts <orderId>");
  const orderId = BigInt(arg);

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const sigill = new ethers.Contract(config.sigillAddress, SigillAbi, wallet) as unknown as ethers.Contract;
  // cUSDC isn't strictly needed for fulfillOne, but the import keeps the
  // surface identical to index.ts in case we extend this later.
  void (new ethers.Contract(config.cUSDCAddress, CUsdcAbi, wallet) as unknown as ethers.Contract);

  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║   Sigill — manual fulfil order #${orderId}`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`  observer : ${wallet.address}`);
  console.log(`  sigill   : ${config.sigillAddress}`);

  const order = await sigill.getOrder(orderId);
  const status = Number(order.status);
  const deadline = Number(order.deadline);
  const now = Math.floor(Date.now() / 1000);

  console.log(`  buyer    : ${order.buyer}`);
  console.log(`  observer : ${order.observer}`);
  console.log(`  status   : ${status} (${STATUS[status] ?? "?"})`);
  console.log(`  deadline : ${deadline} (${deadline > now ? `${deadline - now}s left` : "PAST"})`);

  if (order.observer.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`order ${orderId} is assigned to ${order.observer}, not this wallet`);
  }
  if (status !== 0) {
    throw new Error(`order ${orderId} is not Pending (got ${STATUS[status] ?? status})`);
  }
  if (deadline <= now) {
    throw new Error(`order ${orderId} deadline already passed; reject it instead`);
  }

  console.log(`  cofhe    : initialising…`);
  const client = await ensureCofheInit(wallet);
  console.log(`  cofhe    : ready\n`);

  const result = await fulfillOne(
    orderId,
    {
      buyer: order.buyer,
      observer: order.observer,
      encProductId: BigInt(order.encProductId),
      encPaid: BigInt(order.encPaid),
      status,
    },
    sigill,
    client,
  );

  if (result === null) {
    console.log("\n[manual-fulfill] FHE decryption still pending — re-run in a few seconds.");
    process.exit(2);
  }
  if (result === false) {
    console.log("\n[manual-fulfill] order was rejected (validation failed inside fulfillOne).");
    return;
  }
  console.log("\n[manual-fulfill] fulfilled ✓");
}

main().catch((err) => {
  console.error("[manual-fulfill] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
