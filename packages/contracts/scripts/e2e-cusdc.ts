/**
 * End-to-end test of the Sigill confidential-checkout flow with cUSDC payment.
 *
 * Flow:
 *   1. Deploy MockUSDC (local) or use USDC_ADDRESS (testnet)
 *   2. Deploy ConfidentialERC20 (cUSDC) and Sigill
 *   3. Buyer wraps USDC → cUSDC, approves Sigill for an encrypted amount
 *   4. Buyer places order (encrypted productId + encrypted payment amount)
 *   5. Observer decrypts productId + paid amount, calls Reloadly for the code,
 *      hybrid-encrypts it (AES + IPFS + FHE AES key), fulfils order
 *   6. Sigill transfers the escrowed cUSDC to observer
 *   7. Buyer decrypts AES key via FHE, pulls ciphertext from IPFS, recovers code
 */
import hre from "hardhat";
import {
  cofhejs,
  Encryptable,
  FheTypes,
  type AbstractProvider,
  type AbstractSigner,
} from "cofhejs/node";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TypedDataField } from "ethers";
import { purchaseGiftCard, PRODUCT_MAP } from "./giftcard";
import {
  generateAesKey,
  aesKeyToBigInt,
  bigIntToAesKey,
  aesEncrypt,
  aesDecrypt,
} from "./crypto";
import { uploadToIpfs, fetchFromIpfs } from "./ipfs";

function wrapSigner(signer: HardhatEthersSigner): {
  provider: AbstractProvider;
  signer: AbstractSigner;
} {
  const provider: AbstractProvider = {
    call: async (...args) => signer.provider.call(...args),
    getChainId: async () =>
      (await signer.provider.getNetwork()).chainId.toString(),
    send: async (...args) => signer.provider.send(...args),
  };
  const abstractSigner: AbstractSigner = {
    signTypedData: async (domain, types, value) =>
      signer.signTypedData(
        domain,
        types as Record<string, TypedDataField[]>,
        value,
      ),
    getAddress: async () => signer.getAddress(),
    provider,
    sendTransaction: async (...args) => {
      const tx = await signer.sendTransaction(...args);
      return tx.hash;
    },
  };
  return { provider, signer: abstractSigner };
}

async function initCofhe(signer: HardhatEthersSigner) {
  const wrapped = wrapSigner(signer);
  const result = await cofhejs.initialize({
    provider: wrapped.provider,
    signer: wrapped.signer,
    environment: "TESTNET",
  });
  if (result.error) throw new Error(`cofhejs init failed: ${result.error}`);
  return result.data;
}

async function tryUnseal<T extends bigint>(
  handle: bigint,
  type: FheTypes,
  tries = 10,
  delayMs = 5000,
): Promise<T | null> {
  for (let i = 1; i <= tries; i++) {
    const res = await cofhejs.unseal(handle, type);
    if (res.data !== undefined && res.data !== null) return res.data as T;
    if (i < tries) {
      console.log(`  FHE network processing... (${i}/${tries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function main() {
  const { ethers, network } = hre;
  if (network.name !== "base-sepolia") {
    throw new Error(
      `This script runs on base-sepolia only (got: ${network.name})`,
    );
  }

  const signers = await ethers.getSigners();
  if (signers.length < 2) {
    throw new Error(
      "Need both PRIVATE_KEY (buyer) and OBSERVER_PRIVATE_KEY set in .env",
    );
  }
  const buyer = signers[0];
  const observer = signers[1];

  const explorer = "https://sepolia.basescan.org";
  const txLink = (hash: string) => `  ${explorer}/tx/${hash}`;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Sigill — cUSDC E2E Flow                ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`Network : ${network.name}`);
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
      await (usdc.connect(buyer) as any).mint(buyer.address, 1000_000_000n)
    ).wait();
    buyerUsdcBalance = await usdc.balanceOf(buyer.address);
  }
  console.log(`  Buyer USDC: ${Number(buyerUsdcBalance) / 1e6}\n`);

  // ── 2. Deploy cUSDC + Sigill ──────────────────────────
  console.log("② Deploying ConfidentialERC20 (cUSDC)...");
  const CFactory = await ethers.getContractFactory("ConfidentialERC20");
  // Observer doubles as the trusted unwrapper — it already holds an FHE ACL
  // on the unwrap-debit handle and is the natural off-chain unsealer for
  // claimUnwrap.
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
  if (explorer) console.log(txLink(regTx.hash));
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
  await initCofhe(buyer);
  const [encApprove] = await hre.cofhe.expectResultSuccess(
    cofhejs.encrypt([Encryptable.uint64(PAY_AMOUNT)] as const),
  );
  await (
    await (cUSDC.connect(buyer) as any).approve(sigillAddress, encApprove)
  ).wait();
  console.log(`  Approved ${PAY_AMOUNT / 1_000_000n} USDC (encrypted)\n`);

  console.log("⑥ Buyer places order...");
  console.log("  productId=1 (test gift card)");

  const [encProductId] = await hre.cofhe.expectResultSuccess(
    cofhejs.encrypt([Encryptable.uint64(1n)] as const),
  );

  const placeTx = await (sigill.connect(buyer) as any).placeOrder(
    encProductId,
    observer.address,
  );
  const placeReceipt = await placeTx.wait();

  const placeLog = placeReceipt!.logs.find((log: any) => {
    try {
      return (
        sigill.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        })?.name === "OrderPlaced"
      );
    } catch {
      return false;
    }
  });
  const orderId = sigill.interface.parseLog({
    topics: placeLog!.topics as string[],
    data: placeLog!.data,
  })!.args.orderId;
  console.log(`  Order #${orderId} placed — Tx: ${placeTx.hash}`);
  if (explorer) console.log(txLink(placeTx.hash));

  // Base Sepolia public RPC has replica lag after a tx — retry the order
  // read until it reflects the newly placed order.
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
  await initCofhe(observer);

  const pid = await tryUnseal<bigint>(orderData.encProductId, FheTypes.Uint64);
  const paid = await tryUnseal<bigint>(orderData.encPaid, FheTypes.Uint64);

  if (pid === null || paid === null) {
    throw new Error("Failed to unseal product/paid — FHE network delay?");
  }
  console.log(`  Decrypted productId: ${pid}`);
  console.log(`  Decrypted payment  : ${Number(paid) / 1e6} USDC`);

  const product = PRODUCT_MAP[Number(pid)];
  if (!product) throw new Error(`Unknown product ID: ${pid}`);
  console.log(`  Product: ${product.label}`);

  // Verify payment covers price (simplified: 1:1 with unitPrice in USD)
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
    if (explorer) console.log(txLink(rejectTx.hash));
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
  const [encAesKey] = await hre.cofhe.expectResultSuccess(
    cofhejs.encrypt([Encryptable.uint128(aesKeyBigInt)] as const),
  );

  console.log("\n⑨ Fulfilling order (releases escrowed cUSDC to observer)...");
  const fulfillTx = await (sigill.connect(observer) as any).fulfillOrder(
    orderId,
    encAesKey,
    ipfsCid,
  );
  await fulfillTx.wait();
  console.log(`  Fulfilled! Tx: ${fulfillTx.hash}`);
  if (explorer) console.log(txLink(fulfillTx.hash));

  // ── 10. Buyer decrypts ─────────────────────────────────
  console.log("\n⑩ Buyer decrypting gift card code...");
  await initCofhe(buyer);
  const finalOrder = await sigill.getOrder(orderId);

  const aesKeyValue = await tryUnseal<bigint>(
    finalOrder.encAesKey,
    FheTypes.Uint128,
  );
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
  await initCofhe(observer);

  const observerUsdcBefore = await usdc.balanceOf(observer.address);
  console.log(`  Observer USDC before: ${Number(observerUsdcBefore) / 1e6}`);

  const [encUnwrapAmount] = await hre.cofhe.expectResultSuccess(
    cofhejs.encrypt([Encryptable.uint64(PAY_AMOUNT)] as const),
  );

  const requestTx = await (cUSDC.connect(observer) as any).requestUnwrap(
    encUnwrapAmount,
  );
  const requestReceipt = await requestTx.wait();
  console.log(`  requestUnwrap tx: ${requestTx.hash}`);
  if (explorer) console.log(txLink(requestTx.hash));

  // Parse UnwrapRequested event to get the unwrapId
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
  console.log(`  Unwrap #${unwrapId} requested, unsealing debit handle...`);

  // New contract flow: the trusted unwrapper (= observer) unseals the debit
  // handle off-chain via cofhejs and submits the plaintext to claimUnwrap.
  // The previous on-chain FHE.decrypt trigger was sunset on Base Sepolia.
  const debitPlain = await tryUnseal<bigint>(debitHandle, FheTypes.Uint64);
  if (debitPlain === null) {
    console.log(
      "\n  FHE network still processing — retry claimUnwrap later with the unsealed value.",
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
  if (explorer) console.log(txLink(claimTx.hash));

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
      `  ordersCompleted         : ${await sigill.getOrderCompleted(observer.address)}`,
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
