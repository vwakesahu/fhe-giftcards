/**
 * Smoke test for a freshly deployed Sigill against a live CoFHE chain.
 *
 * Confirms cofhe-contracts@0.1.4 bytecode + @cofhe/sdk@0.6.0 client interop
 * end-to-end: encrypt InEuint64 inputs locally, send quoteOrder, decode the
 * OrderQuoted event, unseal expectedTotalHandle, verify the math.
 *
 *   npx hardhat run scripts/smoke-quote.ts --network base-sepolia
 *
 * Requires Sigill + cUSDC already deployed (deployments/<network>.json) and an
 * observer registered. No on-chain spend beyond gas.
 */
import hre from "hardhat";
import { Encryptable, FheTypes, type CofheClient } from "@cofhe/sdk";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { HardhatSignerAdapter } from "@cofhe/sdk/adapters";
import { chains } from "@cofhe/sdk/chains";
import { getDeployment } from "../tasks/utils";

const NETWORK_TO_CHAIN: Record<string, (typeof chains)[keyof typeof chains]> = {
  "eth-sepolia": chains.sepolia,
  "arb-sepolia": chains.arbSepolia,
  "base-sepolia": chains.baseSepolia,
};

const PRODUCT_ID = 1n;
const AMOUNT_USDC = 10_000_000n; // 10 USDC

async function main() {
  const { ethers, network } = hre;
  const cofheChain = NETWORK_TO_CHAIN[network.name];
  if (!cofheChain) throw new Error(`unsupported network ${network.name}`);

  const sigillAddr = getDeployment(network.name, "Sigill");
  if (!sigillAddr) throw new Error(`no Sigill deployment for ${network.name}`);

  const signers = await ethers.getSigners();
  const buyer = signers[0];
  const observer = signers[1] ?? signers[0]; // works if PRIVATE_KEY == OBSERVER_PRIVATE_KEY
  console.log(`Buyer:    ${buyer.address}`);
  console.log(`Observer: ${observer.address}`);
  console.log(`Sigill:   ${sigillAddr}\n`);

  const config = createCofheConfig({ supportedChains: [cofheChain] });
  const client: CofheClient = createCofheClient(config);
  const { publicClient, walletClient } = await HardhatSignerAdapter(buyer);
  await client.connect(publicClient, walletClient);
  await client.permits.getOrCreateSelfPermit();

  console.log("encrypting inputs (productId + amount)...");
  const [encProductId, encAmount] = await client
    .encryptInputs([
      Encryptable.uint64(PRODUCT_ID),
      Encryptable.uint64(AMOUNT_USDC),
    ])
    .execute();
  console.log("  done\n");

  const sigill = await ethers.getContractAt("Sigill", sigillAddr, buyer);

  console.log("submitting quoteOrder...");
  const tx = await (sigill as any).quoteOrder(
    encProductId,
    observer.address,
    encAmount,
  );
  const receipt = await tx.wait();
  console.log(`  tx: ${receipt.hash}`);
  console.log(`  block ${receipt.blockNumber}, gas ${receipt.gasUsed}\n`);

  const log = receipt.logs.find((l: any) => {
    try {
      return sigill.interface.parseLog(l)?.name === "OrderQuoted";
    } catch {
      return false;
    }
  });
  if (!log) throw new Error("OrderQuoted event not in receipt");
  const ev = sigill.interface.parseLog(log)!;
  const pendingId = ev.args.pendingId as bigint;
  const productIdHandle = ev.args.productIdHandle as bigint;
  const expectedTotalHandle = ev.args.expectedTotalHandle as bigint;
  const expiresAt = ev.args.expiresAt as bigint;
  console.log(`OrderQuoted:`);
  console.log(`  pendingId=${pendingId}`);
  console.log(`  productIdHandle=${productIdHandle}`);
  console.log(`  expectedTotalHandle=${expectedTotalHandle}`);
  console.log(`  expiresAt=${expiresAt}\n`);

  if (productIdHandle === 0n)
    throw new Error("productIdHandle = 0 (encryption didn't land)");
  if (expectedTotalHandle === 0n)
    throw new Error("expectedTotalHandle = 0 (FHE compute didn't land)");

  console.log("unsealing expectedTotalHandle via decryptForView...");
  let unsealed: bigint | null = null;
  for (let i = 1; i <= 12 && unsealed === null; i++) {
    try {
      const r = await client
        .decryptForView(expectedTotalHandle, FheTypes.Uint64)
        .withPermit()
        .execute();
      if (r !== undefined && r !== null) unsealed = r as bigint;
    } catch (err) {
      if (i === 12) console.log(`  failed after 12 tries:`, err);
    }
    if (unsealed === null) {
      console.log(`  waiting for FHE network (${i}/12)...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (unsealed === null) throw new Error("decryptForView never resolved");

  // total = price + observerFee + 0.25% platform fee
  const platformFee = (AMOUNT_USDC * 25n) / 10000n;
  // observer fee is whatever they registered with — we'll just print + sanity check
  const minExpected = AMOUNT_USDC + platformFee;
  console.log(`  unsealed total = ${unsealed} (${Number(unsealed) / 1e6} USDC)`);
  console.log(
    `  minimum if observerFee=0 → ${minExpected} (${Number(minExpected) / 1e6} USDC)`,
  );
  if (unsealed < minExpected)
    throw new Error(
      `unsealed total ${unsealed} < amount+platformFee ${minExpected}`,
    );

  console.log("\nSMOKE TEST PASSED — cofhe-contracts@0.1.4 ↔ @cofhe/sdk@0.6.0 OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
