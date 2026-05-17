/**
 * End-to-end script for the Sigill confidential-checkout flow — v3.
 *
 * What changed from v2:
 *   • placeOrder removed — replaced by quoteOrder + confirmOrder two-step.
 *   • Admin seeds the product catalog via setProductPrice before quoting.
 *   • registerObserver(fees) now takes an explicit flat-fee param (plaintext).
 *   • Quote flow:
 *       1. quoteOrder(productId, observer)  → OrderQuoted event
 *       2. Buyer unseals expectedTotalHandle (price + observerFee + 2.5% platform fee)
 *       3. Buyer approves cUSDC for exactly that plaintext amount (re-encrypted)
 *       4. confirmOrder(pendingId)          → orderId
 *   • fulfillOrder auto-splits: observer gets (paid - platformFee), vault gets platformFee.
 *   • Uses @cofhe/sdk v0.5+ (HardhatSignerAdapter / decryptForView) — same as v2.
 *
 * Usage:
 *   npx hardhat run scripts/e2e-cusdc-v3.ts --network base-sepolia
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

// Product #1 — $10 gift card, 6-decimal USDC base units.
const PRODUCT_ID = 1n;
const PRODUCT_PRICE_USDC = 10_000_000n; // 10 USDC
const OBSERVER_FEE = 0n; // flat fee observer charges on top of product price
const PLATFORM_FEE_BIPS = 25n; // 25/1000 = 2.5%
const EXPECTED_PLATFORM_FEE = (PRODUCT_PRICE_USDC * PLATFORM_FEE_BIPS) / 1000n; // 250_000
const EXPECTED_TOTAL = PRODUCT_PRICE_USDC + OBSERVER_FEE + EXPECTED_PLATFORM_FEE; // 10_250_000

let client: CofheClient;

async function connect(signer: HardhatEthersSigner) {
  const { publicClient, walletClient } = await HardhatSignerAdapter(signer);
  await client.connect(publicClient, walletClient);
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
      `This script runs on a CoFHE testnet (${Object.keys(NETWORK_TO_CHAIN).join(", ")}); got: ${network.name}`,
    );
  }

  const explorer = NETWORK_TO_EXPLORER[network.name];
  const txLink = (hash: string) => `  ${explorer}/tx/${hash}`;

  const config = createCofheConfig({ supportedChains: [cofheChain] });
  client = createCofheClient(config);

  const signers = await ethers.getSigners();
  if (signers.length < 2) {
    throw new Error(
      "Need both PRIVATE_KEY (buyer/admin) and OBSERVER_PRIVATE_KEY set in .env",
    );
  }
  const buyer = signers[0]; // also acts as admin (deployer)
  const observer = signers[1];

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Sigill — cUSDC E2E Flow v3 (quote-confirm)  ║");
  console.log("╚══════════════════════════════════════════════╝");
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
      `  Buyer has ${Number(buyerUsdcBalance) / 1e6} USDC, minting 1000 from the mock...`,
    );
    await (
      await (usdc.connect(buyer) as any).mint(buyer.address, 1_000_000_000n)
    ).wait();
    buyerUsdcBalance = await usdc.balanceOf(buyer.address);
  }
  console.log(`  Buyer USDC: ${Number(buyerUsdcBalance) / 1e6}\n`);

  // ── 2. Deploy cUSDC + Sigill ──────────────────────────
  console.log("② Deploying ConfidentialERC20 (cUSDC)...");
  const CFactory = await ethers.getContractFactory("ConfidentialERC20");
  const cUSDC = await CFactory.connect(buyer).deploy(
    usdcAddress,
    observer.address, // observer doubles as trusted unwrapper
    "Confidential USDC",
    "cUSDC",
  );
  await cUSDC.waitForDeployment();
  const cUSDCAddress = await cUSDC.getAddress();
  console.log(`  cUSDC: ${cUSDCAddress}`);

  console.log("  Deploying Sigill...");
  const SigillFactory = await ethers.getContractFactory("Sigill");
  const sigill = await SigillFactory.connect(buyer).deploy(cUSDCAddress);
  await sigill.waitForDeployment();
  const sigillAddress = await sigill.getAddress();
  console.log(`  Sigill: ${sigillAddress}\n`);

  // ── 3. Admin seeds product catalog ───────────────────
  //      Buyer is the deployer (admin). setProductPrice enables quoteOrder.
  console.log(`③ Admin seeds product catalog (product #${PRODUCT_ID} = $${Number(PRODUCT_PRICE_USDC) / 1e6})...`);
  const seedTx = await (sigill.connect(buyer) as any).setProductPrice(
    PRODUCT_ID,
    PRODUCT_PRICE_USDC,
  );
  await seedTx.wait();
  console.log(`  Set product #${PRODUCT_ID} → ${Number(PRODUCT_PRICE_USDC) / 1e6} USDC`);
  console.log(txLink(seedTx.hash));
  console.log();

  // ── 4. Register observer ──────────────────────────────
  //      New: registerObserver(fees) takes a plaintext flat fee in USDC base units.
  console.log(`④ Observer registers (bond=0.01 ETH, flat fee=${Number(OBSERVER_FEE) / 1e6} USDC)...`);
  const regTx = await (sigill.connect(observer) as any).registerObserver(
    OBSERVER_FEE,
    { value: ethers.parseEther("0.01") },
  );
  await regTx.wait();
  console.log(`  Tx: ${regTx.hash}`);
  console.log(txLink(regTx.hash));
  console.log();

  // ── 5. Buyer wraps USDC → cUSDC ───────────────────────
  const WRAP_AMOUNT = 50_000_000n; // 50 USDC
  console.log(`⑤ Buyer wraps ${Number(WRAP_AMOUNT) / 1e6} USDC → cUSDC...`);
  await (
    await (usdc.connect(buyer) as any).approve(cUSDCAddress, WRAP_AMOUNT)
  ).wait();
  await (await (cUSDC.connect(buyer) as any).wrap(WRAP_AMOUNT)).wait();
  console.log("  Wrapped\n");

  // ── 6. Quote order — contract computes encrypted total ─
  //      New two-step: quoteOrder returns a pendingId and emits OrderQuoted
  //      with the handle for (price + observerFee + 2.5% platformFee).
  console.log(`⑥ Buyer requests quote for product #${PRODUCT_ID} via observer ${observer.address}...`);
  const quoteTx = await (sigill.connect(buyer) as any).quoteOrder(
    PRODUCT_ID,
    observer.address,
  );
  const quoteReceipt = await quoteTx.wait();
  console.log(`  quoteOrder tx: ${quoteTx.hash}`);
  console.log(txLink(quoteTx.hash));

  let pendingId: bigint | undefined;
  let expectedTotalHandle: bigint | undefined;
  for (const log of quoteReceipt!.logs) {
    try {
      const parsed = sigill.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "OrderQuoted") {
        pendingId = parsed.args.pendingId;
        expectedTotalHandle = BigInt(parsed.args.expectedTotalHandle);
        break;
      }
    } catch {
      /* not a Sigill event */
    }
  }
  if (pendingId === undefined || expectedTotalHandle === undefined) {
    throw new Error("quoteOrder tx emitted no OrderQuoted event");
  }
  console.log(`  pendingId: ${pendingId}`);
  console.log(`  expectedTotalHandle: ${expectedTotalHandle} (opaque FHE handle)\n`);

  // ── 7. Buyer unseals the quoted total ─────────────────
  //      Buyer has ACL on the total handle (set in _quoteOrder).
  //      Off-chain unseal gives them the plaintext amount to approve.
  console.log("⑦ Buyer unsealing quoted total...");
  await connect(buyer);

  const quotedTotal = (await tryDecrypt(
    expectedTotalHandle,
    FheTypes.Uint64,
  )) as bigint | null;
  if (quotedTotal === null) {
    throw new Error("Failed to unseal quoted total — FHE network delay?");
  }
  console.log(`  Quoted total: ${Number(quotedTotal) / 1e6} USDC`);
  console.log(`  Expected    : ${Number(EXPECTED_TOTAL) / 1e6} USDC`);
  if (quotedTotal !== EXPECTED_TOTAL) {
    console.warn(
      `  ⚠ Mismatch! Contract computed ${quotedTotal}, expected ${EXPECTED_TOTAL}`,
    );
  }
  console.log();

  // ── 8. Buyer approves cUSDC for exactly the quoted total ─
  //      The buyer re-encrypts the unsealed plaintext as an InEuint64 so
  //      the contract can verify via FHE.eq in confirmOrder. The buyer
  //      cannot tamper — any deviance results in a silent refund.
  console.log("⑧ Buyer approves cUSDC for exactly the quoted total (encrypted)...");
  const [encApprove] = await client
    .encryptInputs([Encryptable.uint64(quotedTotal)])
    .execute();

  // Must use selector for the InEuint64 overload (not the euint64 overload).
  const approveTx = await (
    await (cUSDC.connect(buyer) as any)[
      "approve(address,(uint256,uint8,uint8,bytes))"
    ](sigillAddress, encApprove)
  ).wait();
  console.log(`  Approved ${Number(quotedTotal) / 1e6} USDC (encrypted)`);
  console.log(txLink(approveTx.hash));
  console.log();

  // ── 9. Confirm order — contract pulls allowance + verifies ─
  //      confirmOrder reads the buyer's allowance via transferFromAllowance,
  //      FHE.eq checks it against the stored expectedTotal, refunds inline if
  //      wrong. Buyer only gets an orderId; they cannot see whether the check
  //      passed (both branches are indistinguishable from outside).
  console.log(`⑨ Buyer confirms order (pendingId=${pendingId})...`);
  const confirmTx = await (sigill.connect(buyer) as any).confirmOrder(
    pendingId,
  );
  const confirmReceipt = await confirmTx.wait();
  console.log(`  confirmOrder tx: ${confirmTx.hash}`);
  console.log(txLink(confirmTx.hash));

  const ORDER_EVENTS = new Set(["OrderInProccessed", "OrderInQueued"]);
  let orderId: bigint | undefined;
  for (const log of confirmReceipt!.logs) {
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
    throw new Error(
      "confirmOrder tx emitted no OrderInProccessed/OrderInQueued",
    );
  }
  console.log(`  Order #${orderId} created\n`);

  // Retry in case of RPC replica lag.
  let orderData: any;
  for (let i = 1; i <= 10; i++) {
    orderData = await sigill.getOrder(orderId);
    if (orderData.buyer !== "0x0000000000000000000000000000000000000000") break;
    console.log(`  RPC replica catching up... (${i}/10)`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (orderData.buyer === "0x0000000000000000000000000000000000000000") {
    throw new Error("getOrder still empty after 20s — tx may have reverted silently");
  }

  console.log("  On-chain state (everyone sees):");
  console.log(`    buyer       : ${orderData.buyer}`);
  console.log(`    observer    : ${orderData.observer}`);
  console.log(`    encProductId: ${orderData.encProductId} (opaque)`);
  console.log(`    encPaid     : ${orderData.encPaid} (opaque — amount hidden)`);
  console.log(`    platformFee : ${orderData.platformFee} (opaque — split at fulfillment)`);
  console.log(`    status      : Pending\n`);

  // ── 10. Observer decrypts productId + encPaid ─────────
  console.log("⑩ Observer decrypting order details...");
  await connect(observer);

  const pid = (await tryDecrypt(
    orderData.encProductId,
    FheTypes.Uint64,
  )) as bigint | null;
  const paid = (await tryDecrypt(
    orderData.encPaid,
    FheTypes.Uint64,
  )) as bigint | null;

  if (pid === null || paid === null) {
    throw new Error("Failed to decrypt product/paid — FHE network delay?");
  }
  console.log(`  Decrypted productId: ${pid}`);
  console.log(`  Decrypted payment  : ${Number(paid) / 1e6} USDC`);

  const product = PRODUCT_MAP[Number(pid)];
  if (!product) throw new Error(`Unknown product ID: ${pid}`);
  console.log(`  Product: ${product.label}`);

  // Observer checks that encPaid > 0 (means FHE.eq verified OK at confirmOrder).
  // If encPaid is 0, the buyer tampered — reject and refund the 0-escrow.
  if (paid === 0n) {
    console.log(
      "  encPaid=0 — buyer's approved amount didn't match the quoted total.",
    );
    console.log("  Rejecting order (buyer has already been refunded in-tx).");
    const rejectTx = await (sigill.connect(observer) as any).rejectOrder(
      orderId,
      "payment verification failed",
    );
    await rejectTx.wait();
    console.log(`  Rejected. Tx: ${rejectTx.hash}`);
    console.log(txLink(rejectTx.hash));
    return;
  }

  // Verify payment covers the product price (ignoring fees, which are automatic).
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

  // ── 11. Purchase gift card + hybrid-encrypt ────────────
  console.log("\n⑪ Purchasing from Reloadly (sandbox)...");
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

  // ── 12. Observer fulfills — fee split happens here ─────
  //      fulfillOrder: observer gets (encPaid - platformFee) transferred;
  //      platformFee goes to PROTOCOL_VALUT. Both happen FHE-silently.
  console.log("\n⑫ Observer fulfills order (fee split to observer + protocol vault)...");
  const fulfillTx = await (sigill.connect(observer) as any).fulfillOrder(
    orderId,
    encAesKey,
    ipfsCid,
  );
  await fulfillTx.wait();
  console.log(`  Fulfilled! Tx: ${fulfillTx.hash}`);
  console.log(txLink(fulfillTx.hash));
  console.log(
    `  Observer receives: ~${Number(paid - EXPECTED_PLATFORM_FEE) / 1e6} USDC (cUSDC, encrypted)`,
  );
  console.log(
    `  Vault receives   : ~${Number(EXPECTED_PLATFORM_FEE) / 1e6} USDC (cUSDC, encrypted)\n`,
  );

  // ── 13. Buyer decrypts gift-card code ─────────────────
  console.log("⑬ Buyer decrypting gift card code...");
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

  // ── 14. Observer unwraps cUSDC → plaintext USDC ───────
  console.log("\n⑭ Observer unwrapping cUSDC payment → USDC...");
  await connect(observer);

  const observerUsdcBefore = await usdc.balanceOf(observer.address);
  console.log(`  Observer USDC before: ${Number(observerUsdcBefore) / 1e6}`);

  // Observer's cUSDC balance = paid - platformFee; request unwrap of that.
  const observerCut = paid - EXPECTED_PLATFORM_FEE;
  const [encUnwrapAmount] = await client
    .encryptInputs([Encryptable.uint64(observerCut)])
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

  // ── 15. Observer reputation summary ──────────────────────
  console.log("\n⑮ Observer reputation:");
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
      `  ordersCompleted         : ${await sigill.getOrderCompleted(observer.address)}`,
    );
  }

  console.log("\n── Privacy + tamper-resistance summary ──");
  console.log("✓ productId   — FHE-encrypted, only observer could decrypt");
  console.log("✓ payment     — cUSDC (encrypted balance); amount hidden on-chain");
  console.log("✓ fee split   — FHE.sub inside fulfillOrder; no plaintext on-chain");
  console.log("✓ AES key     — FHE-encrypted, only buyer can decrypt");
  console.log("✓ gift card   — AES-encrypted on IPFS");
  console.log("✓ tamper-proof— buyer approved contract-computed total; FHE.eq verifies");
  console.log("✓ ETH movement— only 0.01 bond visible; all USDC flow is cUSDC-encrypted");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
