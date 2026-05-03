import { ethers } from "ethers";
import { FheTypes, type CofheClient, type CofheConfig } from "@cofhe/sdk";

import { config } from "./config";
import { CUsdcAbi, SigillAbi } from "./abi";
import { ensureCofheInit } from "./cofhe";
import { fulfillOne } from "./fulfill";

const MIN_BOND = ethers.parseEther("0.01");
const STATUS_PENDING = 0;

async function main() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const sigill = new ethers.Contract(config.sigillAddress, SigillAbi, wallet) as unknown as ethers.Contract;
  const cUSDC = new ethers.Contract(config.cUSDCAddress, CUsdcAbi, wallet) as unknown as ethers.Contract;

  console.log("╔═════════════════════════════════════════════════╗");
  console.log("║   Sigill observer daemon                         ║");
  console.log("╚═════════════════════════════════════════════════╝");
  console.log(`  network  : base-sepolia`);
  console.log(`  observer : ${wallet.address}`);
  console.log(`  sigill   : ${config.sigillAddress}`);
  console.log(`  cUSDC    : ${config.cUSDCAddress}`);

  // Sanity: are we bonded on this Sigill? If not, fail fast so the operator
  // registers before the loop starts wasting RPC calls.
  const bond: bigint = await sigill.getObserverBondAmount(wallet.address);
  if (bond < MIN_BOND) {
    console.error(
      `\n  ✗ observer not bonded on this Sigill (bond=${ethers.formatEther(bond)} ETH, need ≥ 0.01)\n` +
        `    register first: cd packages/contracts && OBSERVER_PRIVATE_KEY=… pnpm hardhat register-observer`,
    );
    process.exit(1);
  }
  console.log(`  bond     : ${ethers.formatEther(bond)} ETH ✓`);

  // Sanity: are we the cUSDC unwrapper? If so, we also finalise unwrap
  // requests from buyers as they come in. If not, we only process orders.
  const unwrapperOnChain: string = await cUSDC.unwrapper();
  const isUnwrapper = unwrapperOnChain.toLowerCase() === wallet.address.toLowerCase();
  console.log(
    `  unwrapper: ${isUnwrapper ? "this wallet ✓" : `${unwrapperOnChain} (not us — skipping unwrap watch)`}`,
  );

  // Init cofhe client once — subsequent calls are no-ops for the same wallet.
  console.log("  cofhe    : initialising…");
  const client = await ensureCofheInit(wallet);
  console.log("  cofhe    : ready\n");

  // Start at the current head — only new orders placed after boot are picked
  // up. Orders placed during downtime stay Pending until their deadline and
  // the buyer can `refund()`.
  let fromBlock = BigInt(await provider.getBlockNumber());

  console.log(`[observer] watching from block ${fromBlock}, polling every ${config.pollIntervalMs}ms\n`);

  // Track orders we've already *attempted* to fulfill this session — avoids
  // firing a duplicate tx while the first is still mining. We still re-check
  // on-chain status inside processEvent so restarts work correctly.
  const inflight = new Set<string>();

  let stopping = false;
  process.on("SIGINT", () => {
    console.log("\n[observer] SIGINT — will exit after current iteration");
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  while (!stopping) {
    try {
      const latest = BigInt(await provider.getBlockNumber());
      if (latest >= fromBlock) {
        // ── OrderPlaced → fulfil gift-card order ─────────────────────
        const orderFilter = sigill.filters.OrderPlaced!();
        const orderEvents = await sigill.queryFilter(orderFilter, Number(fromBlock), Number(latest));
        for (const ev of orderEvents) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = (ev as any).args as {
            orderId: bigint;
            buyer: string;
            observer: string;
          } | undefined;
          if (!args) continue;
          if (args.observer.toLowerCase() !== wallet.address.toLowerCase()) continue;

          const key = `order:${args.orderId}`;
          if (inflight.has(key)) continue;
          inflight.add(key);

          try {
            await processEvent(args.orderId, sigill, client);
          } catch (err) {
            console.error(`[order #${args.orderId}] failed:`, err instanceof Error ? err.message : err);
            inflight.delete(key);
          }
        }

        // ── UnwrapRequested → finalise pending unwrap ────────────────
        if (isUnwrapper) {
          const unwrapFilter = cUSDC.filters.UnwrapRequested!();
          const unwrapEvents = await cUSDC.queryFilter(unwrapFilter, Number(fromBlock), Number(latest));
          for (const ev of unwrapEvents) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const args = (ev as any).args as
              | { unwrapId: bigint; from: string; encAmountHandle: bigint }
              | undefined;
            if (!args) continue;

            const key = `unwrap:${args.unwrapId}`;
            if (inflight.has(key)) continue;
            inflight.add(key);

            try {
              await processUnwrap(args.unwrapId, BigInt(args.encAmountHandle), args.from, cUSDC, client);
            } catch (err) {
              console.error(`[unwrap #${args.unwrapId}] failed:`, err instanceof Error ? err.message : err);
              inflight.delete(key);
            }
          }
        }

        fromBlock = latest + 1n;
      }
    } catch (err) {
      console.error("[observer] loop error:", err instanceof Error ? err.message : err);
    }

    if (!stopping) await sleep(config.pollIntervalMs);
  }

  console.log("[observer] stopped");
}

async function processEvent(
  orderId: bigint,
  sigill: ethers.Contract,
  client: CofheClient<CofheConfig>,
) {
  const order = await sigill.getOrder(orderId);
  const status = Number(order.status);
  if (status !== STATUS_PENDING) return; // already handled (fulfilled / rejected / refunded)

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
    // FHE network hasn't produced plaintexts yet. Drop from inflight so the
    // next loop iteration retries this order.
    throw new Error("FHE decrypt pending — retry");
  }
}

async function processUnwrap(
  unwrapId: bigint,
  handle: bigint,
  recipient: string,
  cUSDC: ethers.Contract,
  client: CofheClient<CofheConfig>,
) {
  const prefix = `[unwrap #${unwrapId}]`;
  console.log(`${prefix} requested by ${recipient} — decrypting handle…`);

  let plain: bigint | null = null;
  for (let i = 1; i <= 10; i++) {
    try {
      const result = await client
        .decryptForView(handle, FheTypes.Uint64)
        .withPermit()
        .execute();
      if (result !== undefined && result !== null) {
        plain = result as bigint;
        break;
      }
    } catch {
      // CoFHE returns "not yet decrypted" while threshold network is processing
    }
    if (i < 10) await new Promise((r) => setTimeout(r, 3_000));
  }
  if (plain === null) throw new Error("decryption pending — retry next loop");

  console.log(`${prefix} plain = ${Number(plain) / 1e6} USDC, submitting claim…`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = await (cUSDC as any).claimUnwrap(unwrapId, plain, { gasLimit: 400_000n });
  const rc = await tx.wait();
  console.log(`${prefix} claimed · tx=${tx.hash} · gasUsed=${rc?.gasUsed}`);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("[observer] fatal:", err);
  process.exit(1);
});
