/**
 * End-to-end test of the Sigill confidential-checkout flow with cUSDC payment.
 *
 * Same flow as e2e-cusdc.ts, but rewritten on top of @cofhe/sdk v0.5+
 * (createCofheConfig / createCofheClient + HardhatSignerAdapter, decryptForView
 * + permit-based unsealing) instead of the legacy cofhejs API.
 */
import hre from "hardhat";
import { Encryptable, FheTypes, type CofheClient } from "@cofhe/sdk";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { HardhatSignerAdapter } from "@cofhe/sdk/adapters";
import { chains } from "@cofhe/sdk/chains";

import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { purchaseGiftCard, PRODUCT_MAP } from "./giftcard";
import {
  generateAesKey,
  aesKeyToBigInt,
  bigIntToAesKey,
  aesEncrypt,
  aesDecrypt,
} from "./crypto";
import { uploadToIpfs, fetchFromIpfs } from "./ipfs";

const NETWORK_TO_CHAIN: Record<string, (typeof chains)[keyof typeof chains]> = {
  "eth-sepolia": chains.sepolia,
  "arb-sepolia": chains.arbSepolia,
  "base-sepolia": chains.baseSepolia,
};

const NETWORK_TO_EXPLORER: Record<string, string> = {
  "eth-sepolia": "https://sepolia.etherscan.io",
  "arb-sepolia": "https://sepolia.arbiscan.io",
  "base-sepolia": "https://sepolia.basescan.org",
};

let client: CofheClient;

async function connect(signer: HardhatEthersSigner) {
  const { publicClient, walletClient } = await HardhatSignerAdapter(signer);
  await client.connect(publicClient, walletClient);
  // Ensure an active self-permit exists for this (chainId, account) so
  // decryptForView().withPermit() can resolve it later.
  await client.permits.getOrCreateSelfPermit();
}

async function tryDecrypt<U extends FheTypes>(
  handle: bigint,
  utype: U,
  tries = 10,
  delayMs = 5000,
): Promise<bigint | boolean | string | null> {
  for (let i = 1; i <= tries; i++) {
    try {
      const result = await client
        .decryptForView(handle, utype)
        .withPermit()
        .execute();
      if (result !== undefined && result !== null) return result as any;
    } catch (err) {
      // Swallow — likely "not yet decrypted" / 404 from CoFHE; retry.
      if (i === tries) {
        console.log(`  decryptForView failed after ${tries} tries:`, err);
      }
    }
    if (i < tries) {
      console.log(`  FHE network processing... (${i}/${tries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function main() {
  const { ethers, network } = hre;

  const cofheChain = NETWORK_TO_CHAIN[network.name];
  if (!cofheChain) {
    throw new Error(
      `This script runs on a CoFHE testnet (${Object.keys(NETWORK_TO_CHAIN).join(
        ", ",
      )}); got: ${network.name}`,
    );
  }

  const explorer = NETWORK_TO_EXPLORER[network.name];
  const txLink = (hash: string) => `  ${explorer}/tx/${hash}`;

  // Build the shared CoFHE client up front; we reconnect it per-signer below.
  const config = createCofheConfig({ supportedChains: [cofheChain] });
  client = createCofheClient(config);

  const signers = await ethers.getSigners();
  if (signers.length < 2) {
    throw new Error(
      "Need both PRIVATE_KEY (buyer) and OBSERVER_PRIVATE_KEY set in .env",
    );
  }
  const buyer = signers[0];
  const observer = signers[1];

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Sigill — cUSDC E2E Flow (cofhe SDK)    ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`Network : ${network.name} (${cofheChain.id})`);
  console.log(`Buyer   : ${buyer.address}`);
  console.log(`Observer: ${observer.address}\n`);

  // ── 1. Resolve USDC ───────────────────────────────────
  const usdcAddress = process.env.USDC_ADDRESS;
  if (!usdcAddress) {
    throw new Error(
      "USDC_ADDRESS env var required. Deploy MockUSDC first: npx hardhat deploy-usdc",
    );
  }
  console.log(`① Using USDC at ${usdcAddress}`);
  const usdc = await ethers.getContractAt(
    [
      "function balanceOf(address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
      "function mint(address,uint256)",
    ],
    usdcAddress,
  );
  let buyerUsdcBalance = await usdc.balanceOf(buyer.address);
  if (buyerUsdcBalance < 50_000_000n) {
    console.log(
      `  Buyer has ${
        Number(buyerUsdcBalance) / 1e6
      } USDC, minting 1000 from the mock...`,
    );
    await (
      await (usdc.connect(buyer) as any).mint(buyer.address, 1000_000_000n)
    ).wait();
    buyerUsdcBalance = await usdc.balanceOf(buyer.address);
  }
  console.log(`  Buyer USDC: ${Number(buyerUsdcBalance) / 1e6}\n`);

  // ── 2. Deploy cUSDC + Sigill ──────────────────────────
  console.log("② Deploying ConfidentialERC20 (cUSDC)...");
  const CFactory = await ethers.getContractFactory("ConfidentialERC20");
  const cUSDC = await CFactory.connect(buyer).deploy(
    usdcAddress,
    observer.address,
    "Confidential USDC",
    "cUSDC",
  );
  await cUSDC.waitForDeployment();
  console.log(`  cUSDC: ${await cUSDC.getAddress()}`);

  console.log("  Deploying Sigill...");
  const SigillFactory = await ethers.getContractFactory("Sigill");
  const sigill = await SigillFactory.connect(buyer).deploy(
    await cUSDC.getAddress(),
  );
  await sigill.waitForDeployment();
  const sigillAddress = await sigill.getAddress();
  console.log(`  Sigill: ${sigillAddress}\n`);

  // ── 3. Register observer ──────────────────────────────
  console.log("③ Registering observer (0.01 ETH bond)...");
  const regTx = await (sigill.connect(observer) as any).registerObserver({
    value: ethers.parseEther("0.01"),
  });
  await regTx.wait();
  console.log(`  Tx: ${regTx.hash}`);
  console.log(txLink(regTx.hash));
  console.log();

  // ── 4. Buyer wraps USDC → cUSDC ───────────────────────
  const WRAP_AMOUNT = 50_000_000n; // 50 USDC (6 decimals)
  const PAY_AMOUNT = 10_000_000n; // 10 USDC for the gift card

  console.log(`④ Buyer wraps ${WRAP_AMOUNT / 1_000_000n} USDC → cUSDC...`);
  await (
    await (usdc.connect(buyer) as any).approve(
      await cUSDC.getAddress(),
      WRAP_AMOUNT,
    )
  ).wait();
  await (await (cUSDC.connect(buyer) as any).wrap(WRAP_AMOUNT)).wait();
  console.log("  Wrapped\n");

  // ── 5. Buyer approves Sigill, then places order ───────
  console.log("⑤ Buyer approves Sigill to pull cUSDC (encrypted allowance)...");
  await connect(buyer);

  const [encApprove] = await client
    .encryptInputs([Encryptable.uint64(PAY_AMOUNT)])
    .execute();

  await (
    await (cUSDC.connect(buyer) as any).approve(sigillAddress, encApprove)
  ).wait();
  console.log(`  Approved ${PAY_AMOUNT / 1_000_000n} USDC (encrypted)\n`);

  console.log("⑥ Buyer places order...");
  console.log("  productId=1 (test gift card)");

  const [encProductId] = await client
    .encryptInputs([Encryptable.uint64(1n)])
    .execute();

  const placeTx = await (sigill.connect(buyer) as any).placeOrder(
    encProductId,
    observer.address,
  );
  const placeReceipt = await placeTx.wait();

  // Sigill emits OrderInProccessed (active) or OrderInQueued (queued behind
  // another order for the same observer). Either carries `orderId` as the
  // first indexed arg.
  const ORDER_EVENTS = new Set(["OrderInProccessed", "OrderInQueued"]);
  let orderId: bigint | undefined;
  for (const log of placeReceipt!.logs) {
    try {
      const parsed = sigill.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed && ORDER_EVENTS.has(parsed.name)) {
        orderId = parsed.args.orderId;
        break;
      }
    } catch {
      /* not a Sigill event */
    }
  }
  if (orderId === undefined) {
    throw new Error("placeOrder tx emitted no OrderInProccessed/OrderInQueued");
  }
  console.log(`  Order #${orderId} placed — Tx: ${placeTx.hash}`);
  console.log(txLink(placeTx.hash));

  // Public RPC may have replica lag — retry the order read.
  let orderData: any;
  for (let i = 1; i <= 10; i++) {
    orderData = await sigill.getOrder(orderId);
    if (orderData.buyer !== "0x0000000000000000000000000000000000000000") break;
    console.log(`  RPC replica catching up... (${i}/10)`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (orderData.buyer === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      "getOrder still empty after 20s — tx may have reverted silently",
    );
  }

  console.log("\n  On-chain state (everyone sees):");
  console.log(`    buyer       : ${orderData.buyer}`);
  console.log(`    observer    : ${orderData.observer}`);
  console.log(`    encProductId: ${orderData.encProductId} (opaque)`);
  console.log(
    `    encPaid     : ${orderData.encPaid} (opaque — amount hidden)`,
  );
  console.log(`    status      : Pending\n`);

  // ── 7. Observer decrypts product + payment ────────────
  console.log("⑦ Observer decrypting order details...");
  await connect(observer);

  const pid = (await tryDecrypt(orderData.encProductId, FheTypes.Uint64)) as
    | bigint
    | null;
  const paid = (await tryDecrypt(orderData.encPaid, FheTypes.Uint64)) as
    | bigint
    | null;

  if (pid === null || paid === null) {
    throw new Error("Failed to decrypt product/paid — FHE network delay?");
  }
  console.log(`  Decrypted productId: ${pid}`);
  console.log(`  Decrypted payment  : ${Number(paid) / 1e6} USDC`);

  const product = PRODUCT_MAP[Number(pid)];
  if (!product) throw new Error(`Unknown product ID: ${pid}`);
  console.log(`  Product: ${product.label}`);

  const expectedPrice = BigInt(product.unitPrice) * 1_000_000n;
  if (paid < expectedPrice) {
    console.log(
      `  Payment short (${paid} < ${expectedPrice}) — rejecting order`,
    );
    const rejectTx = await (sigill.connect(observer) as any).rejectOrder(
      orderId,
      "payment below product price",
    );
    await rejectTx.wait();
    console.log(`  Rejected — buyer refunded. Tx: ${rejectTx.hash}`);
    console.log(txLink(rejectTx.hash));
    return;
  }

  // ── 8. Purchase + hybrid-encrypt the code ─────────────
  console.log("\n⑧ Purchasing from Reloadly (sandbox)...");
  const giftCardCode = await purchaseGiftCard(
    product.productId,
    product.unitPrice,
  );
  console.log(`  Gift card code obtained: ${giftCardCode}`);

  console.log("\n  Hybrid encryption:");
  const aesKey = generateAesKey();
  const payload = aesEncrypt(giftCardCode, aesKey);
  const ipfsCid = await uploadToIpfs(payload);
  console.log(`  IPFS CID: ${ipfsCid}`);

  const aesKeyBigInt = aesKeyToBigInt(aesKey);
  const [encAesKey] = await client
    .encryptInputs([Encryptable.uint128(aesKeyBigInt)])
    .execute();

  console.log("\n⑨ Fulfilling order (releases escrowed cUSDC to observer)...");
  const fulfillTx = await (sigill.connect(observer) as any).fulfillOrder(
    orderId,
    encAesKey,
    ipfsCid,
  );
  await fulfillTx.wait();
  console.log(`  Fulfilled! Tx: ${fulfillTx.hash}`);
  console.log(txLink(fulfillTx.hash));

  // ── 10. Buyer decrypts ─────────────────────────────────
  console.log("\n⑩ Buyer decrypting gift card code...");
  await connect(buyer);
  const finalOrder = await sigill.getOrder(orderId);

  const aesKeyValue = (await tryDecrypt(
    finalOrder.encAesKey,
    FheTypes.Uint128,
  )) as bigint | null;
  if (aesKeyValue === null) {
    console.log("\n  FHE network still processing — retry later.");
    console.log(`  IPFS CID: ${finalOrder.ipfsCid}`);
    console.log(`  (For demo: original code was "${giftCardCode}")`);
    return;
  }

  const fetchedPayload = await fetchFromIpfs(finalOrder.ipfsCid);
  const recoveredKey = bigIntToAesKey(aesKeyValue);
  const decryptedCode = aesDecrypt(fetchedPayload, recoveredKey);

  console.log("\n╔══════════════════════════════════════════╗");
  console.log(`║  Gift card code: ${decryptedCode.padEnd(23)}║`);
  console.log("╚══════════════════════════════════════════╝");

  // ── 11. Observer unwraps cUSDC payment → plaintext USDC ──
  console.log("\n⑪ Observer unwrapping cUSDC payment → USDC...");
  await connect(observer);

  const observerUsdcBefore = await usdc.balanceOf(observer.address);
  console.log(`  Observer USDC before: ${Number(observerUsdcBefore) / 1e6}`);

  const [encUnwrapAmount] = await client
    .encryptInputs([Encryptable.uint64(PAY_AMOUNT)])
    .execute();

  const requestTx = await (cUSDC.connect(observer) as any).requestUnwrap(
    encUnwrapAmount,
  );
  const requestReceipt = await requestTx.wait();
  console.log(`  requestUnwrap tx: ${requestTx.hash}`);
  console.log(txLink(requestTx.hash));

  const unwrapLog = requestReceipt!.logs.find((log: any) => {
    try {
      return (
        cUSDC.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        })?.name === "UnwrapRequested"
      );
    } catch {
      return false;
    }
  });
  const unwrapArgs = cUSDC.interface.parseLog({
    topics: unwrapLog!.topics as string[],
    data: unwrapLog!.data,
  })!.args;
  const unwrapId = unwrapArgs.unwrapId;
  const debitHandle = BigInt(unwrapArgs.encAmountHandle);
  console.log(`  Unwrap #${unwrapId} requested, decrypting debit handle...`);

  const debitPlain = (await tryDecrypt(debitHandle, FheTypes.Uint64)) as
    | bigint
    | null;
  if (debitPlain === null) {
    console.log(
      "\n  FHE network still processing — retry claimUnwrap later with the decrypted value.",
    );
    return;
  }
  console.log(`  Debit plaintext: ${Number(debitPlain) / 1e6} USDC`);

  const claimTx = await (cUSDC.connect(observer) as any).claimUnwrap(
    unwrapId,
    debitPlain,
  );
  await claimTx.wait();
  console.log(`  Claimed! Tx: ${claimTx.hash}`);
  console.log(txLink(claimTx.hash));

  const observerUsdcAfter = await usdc.balanceOf(observer.address);
  console.log(`  Observer USDC after : ${Number(observerUsdcAfter) / 1e6}`);
  console.log(
    `  Delta: +${Number(observerUsdcAfter - observerUsdcBefore) / 1e6} USDC`,
  );

  // ── 12. Observer reputation summary ──────────────────────
  console.log("\n⑫ Observer reputation:");
  const details = await sigill.getObserverDetail();
  const me = details.find(
    (d: any) =>
      d.observerAddress.toLowerCase() === observer.address.toLowerCase(),
  );
  if (me) {
    console.log(`  successRate (1e6 scaled): ${me.sucessRate}`);
    console.log(`  slotLeft / soltSize     : ${me.slotLeft} / ${me.soltSize}`);
    console.log(
      `  bond                    : ${ethers.formatEther(
        await sigill.getObserverBondAmount(observer.address),
      )} ETH`,
    );
    console.log(
      `  ordersCompleted         : ${await sigill.getOrderCompleted(
        observer.address,
      )}`,
    );
  }

  console.log("\n── Privacy summary ──");
  console.log("✓ productId   — FHE-encrypted, only observer could decrypt");
  console.log(
    "✓ payment     — cUSDC (encrypted balance); amount hidden on-chain",
  );
  console.log("✓ AES key     — FHE-encrypted, only buyer can decrypt");
  console.log("✓ gift card   — AES-encrypted on IPFS");
  console.log(
    "✓ ETH movement — only 0.01 bond visible; payment is cUSDC-encrypted",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
