/**
 * Sigill / Observer / ConfidentialERC20 — quote-then-confirm flow.
 *
 * Run on the hardhat network so the cofhe-hardhat-plugin's mock task manager,
 * mock zk-verifier, and mock query-decrypter are available:
 *
 *   npx hardhat test --network hardhat
 *
 * Default network in hardhat.config.ts is base-sepolia, so the --network flag
 * is required.
 */

import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ConfidentialERC20, MockUSDC, Sigill } from "../typechain-types";

const BOND = ethers.parseEther("0.01");
const ORDER_TIMEOUT = 10 * 60;
const QUOTE_TTL = 5 * 60;
const WRAP_AMOUNT = 100_000_000n; // 100 cUSDC

// Catalog setup. With OBSERVER_FEE = 0 the total reduces to price * 1.025.
const PRODUCT_PRICE = 10_000_000n; // $10 cUSDC base units
const OBSERVER_FEE = 0n;
const PLATFORM_FEE_NUM = 25n; // 25 / 1000 = 2.5%
const PLATFORM_FEE_DENOM = 1000n;
const PLATFORM_FEE_AMOUNT =
  (PRODUCT_PRICE * PLATFORM_FEE_NUM) / PLATFORM_FEE_DENOM; // 250_000
const TOTAL_AMOUNT = PRODUCT_PRICE + OBSERVER_FEE + PLATFORM_FEE_AMOUNT; // 10_250_000
const PROTOCOL_VAULT = "0x37DFfFfB73b4A7eE6584F1ea56bac618c29c6882";

async function initCofhe(signer: HardhatEthersSigner) {
  await hre.cofhe.initializeWithHardhatSigner(signer, { environment: "MOCK" });
}

async function encryptUint64(signer: HardhatEthersSigner, value: bigint) {
  await initCofhe(signer);
  const [enc] = await hre.cofhe.expectResultSuccess(
    cofhejs.encrypt([Encryptable.uint64(value)] as const),
  );
  return enc;
}

async function encryptUint128(signer: HardhatEthersSigner, value: bigint) {
  await initCofhe(signer);
  const [enc] = await hre.cofhe.expectResultSuccess(
    cofhejs.encrypt([Encryptable.uint128(value)] as const),
  );
  return enc;
}

async function unsealUint64(
  signer: HardhatEthersSigner,
  handle: bigint,
): Promise<bigint> {
  await initCofhe(signer);
  const res = await cofhejs.unseal(handle, FheTypes.Uint64);
  if (res.error) throw new Error(`unseal failed: ${res.error}`);
  return res.data as bigint;
}

function parseLogByName<T extends { interface: { parseLog: (l: { topics: string[]; data: string }) => { name: string; args: Record<string, unknown> } | null } }>(
  contract: T,
  receipt: { logs: ReadonlyArray<{ topics: ReadonlyArray<string>; data: string }> },
  name: string,
) {
  const log = receipt.logs.find((l) => {
    try {
      return (
        contract.interface.parseLog({
          topics: l.topics as string[],
          data: l.data,
        })?.name === name
      );
    } catch {
      return false;
    }
  });
  if (!log) throw new Error(`event ${name} not in receipt`);
  return contract.interface.parseLog({
    topics: log.topics as string[],
    data: log.data,
  })!;
}

/**
 * Run the full quote → approve → confirm pipeline. The frontend pattern: the
 * buyer reads OrderQuoted, unseals the expected total (they have ACL via
 * FHE.allow in quoteOrder), then re-encrypts it locally via cofhejs and
 * approves with a fresh InEuint64. The contract verifies via FHE.eq.
 *
 * Pass `approveAmount` to override what gets approved (used by tamper tests).
 */
async function quoteAndConfirm(
  sigill: Sigill,
  cUSDC: ConfidentialERC20,
  buyer: HardhatEthersSigner,
  observer: HardhatEthersSigner,
  productId: bigint,
  approveAmount: bigint = TOTAL_AMOUNT,
): Promise<bigint> {
  const quoteReceipt = await (
    await sigill.connect(buyer).quoteOrder(productId, observer.address)
  ).wait();
  const quoted = parseLogByName(sigill, quoteReceipt!, "OrderQuoted");
  const pendingId = quoted.args.pendingId as bigint;

  const encApprove = await encryptUint64(buyer, approveAmount);
  await (
    await cUSDC
      .connect(buyer)
      ["approve(address,(uint256,uint8,uint8,bytes))"](
        await sigill.getAddress(),
        encApprove,
      )
  ).wait();

  const confirmReceipt = await (
    await sigill.connect(buyer).confirmOrder(pendingId)
  ).wait();

  const log = confirmReceipt!.logs.find((l) => {
    try {
      const name = sigill.interface.parseLog({
        topics: l.topics as string[],
        data: l.data,
      })?.name;
      return name === "OrderInProccessed" || name === "OrderInQueued";
    } catch {
      return false;
    }
  });
  const parsed = sigill.interface.parseLog({
    topics: log!.topics as string[],
    data: log!.data,
  })!;
  return parsed.args.orderId as bigint;
}

describe("Sigill — quote-then-confirm E2E", () => {
  let usdc: MockUSDC;
  let cUSDC: ConfidentialERC20;
  let sigill: Sigill;

  let deployer: HardhatEthersSigner;
  let buyer: HardhatEthersSigner;
  let buyer2: HardhatEthersSigner;
  let observer: HardhatEthersSigner;
  let observer2: HardhatEthersSigner;
  let observer3: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  beforeEach(async () => {
    [deployer, buyer, buyer2, observer, observer2, observer3, outsider] =
      await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockUSDC");
    usdc = (await Mock.connect(deployer).deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    const C = await ethers.getContractFactory("ConfidentialERC20");
    cUSDC = (await C.connect(deployer).deploy(
      await usdc.getAddress(),
      observer.address,
      "Confidential USDC",
      "cUSDC",
    )) as unknown as ConfidentialERC20;
    await cUSDC.waitForDeployment();

    const S = await ethers.getContractFactory("Sigill");
    sigill = (await S.connect(deployer).deploy(
      await cUSDC.getAddress(),
    )) as unknown as Sigill;
    await sigill.waitForDeployment();

    // Seed catalog: products 1..10 all priced at PRODUCT_PRICE.
    for (let i = 1; i <= 10; i++) {
      await (
        await sigill
          .connect(deployer)
          .setProductPrice(i, PRODUCT_PRICE)
      ).wait();
    }

    // Fund + wrap for both buyers.
    for (const b of [buyer, buyer2]) {
      await (await usdc.connect(b).mint(b.address, 1_000_000_000n)).wait();
      await (
        await usdc.connect(b).approve(await cUSDC.getAddress(), WRAP_AMOUNT)
      ).wait();
      await (await cUSDC.connect(b).wrap(WRAP_AMOUNT)).wait();
    }
  });

  // ─── Deployment / constants ─────────────────────────────────────────────

  describe("deployment", () => {
    it("wires cUSDC into Sigill", async () => {
      expect(await sigill.cUSDC()).to.equal(await cUSDC.getAddress());
    });

    it("sets admin = deployer", async () => {
      expect(await sigill.admin()).to.equal(deployer.address);
    });

    it("exposes the public constants", async () => {
      expect(await sigill.ORDER_TIMEOUT()).to.equal(ORDER_TIMEOUT);
      expect(await sigill.QUOTE_TTL()).to.equal(QUOTE_TTL);
      expect(await sigill.PRICISION()).to.equal(1_000_000);
      expect(await sigill.MIN_BOND()).to.equal(BOND);
      expect(await sigill.getBondAmount()).to.equal(BOND);
    });

    it("starts with zero observers and zero orders", async () => {
      expect(await sigill.getObserversCount()).to.equal(0);
      expect(await sigill.nextOrderId()).to.equal(0);
      expect(await sigill.nextPendingId()).to.equal(0);
      expect(await sigill.getObservers()).to.deep.equal([]);
    });
  });

  // ─── Product catalog ────────────────────────────────────────────────────

  describe("product catalog", () => {
    it("seeds prices via setProductPrice and flips productActive on", async () => {
      expect(await sigill.productPriceUsdc(1)).to.equal(PRODUCT_PRICE);
      expect(await sigill.productActive(1)).to.equal(true);
    });

    it("treats a price of 0 as inactive", async () => {
      await (
        await sigill.connect(deployer).setProductPrice(1, 0n)
      ).wait();
      expect(await sigill.productPriceUsdc(1)).to.equal(0n);
      expect(await sigill.productActive(1)).to.equal(false);
    });

    it("rejects setProductPrice from non-admin", async () => {
      await expect(
        sigill.connect(outsider).setProductPrice(99, 1_000_000n),
      ).to.be.revertedWith("Not admin");
    });

    it("returns 0/false for unset products", async () => {
      expect(await sigill.productPriceUsdc(999)).to.equal(0n);
      expect(await sigill.productActive(999)).to.equal(false);
    });
  });

  // ─── registerObserver ───────────────────────────────────────────────────

  describe("registerObserver", () => {
    it("registers when bond is sufficient and emits event", async () => {
      await expect(
        sigill.connect(observer).registerObserver(OBSERVER_FEE, { value: BOND }),
      )
        .to.emit(sigill, "ObserverRegistered")
        .withArgs(observer.address, BOND);

      expect(await sigill.getObserverBondAmount(observer.address)).to.equal(
        BOND,
      );
      expect(await sigill.getObserversCount()).to.equal(1);
      expect(await sigill.getObserverAt(0)).to.equal(observer.address);
      expect(await sigill.getObservers()).to.deep.equal([observer.address]);
    });

    it("reverts when bond is below the minimum", async () => {
      await expect(
        sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND - 1n }),
      ).to.be.revertedWith("Bond too low");
    });

    it("stores the encrypted observerFees with buyer-readable ACL", async () => {
      const fee = 500_000n;
      await (
        await sigill
          .connect(observer)
          .registerObserver(fee, { value: BOND })
      ).wait();

      const [details] = await sigill.getObserverDetail();
      expect(details.observerAddress).to.equal(observer.address);
      // Observer has ACL on its own fees handle (granted in registerObserver).
      expect(await unsealUint64(observer, BigInt(details.observerFees))).to.equal(
        fee,
      );
    });

    it("getObserverAt reverts on out-of-bounds index", async () => {
      await expect(sigill.getObserverAt(0)).to.be.revertedWith(
        "Index out of bounds",
      );
    });
  });

  // ─── quoteOrder ─────────────────────────────────────────────────────────

  describe("quoteOrder", () => {
    beforeEach(async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
    });

    it("emits OrderQuoted with the expected total handle the buyer can unseal", async () => {
      const tx = await sigill.connect(buyer).quoteOrder(1n, observer.address);
      const receipt = await tx.wait();
      const ev = parseLogByName(sigill, receipt!, "OrderQuoted");

      expect(ev.args.pendingId).to.equal(0n);
      expect(ev.args.buyer).to.equal(buyer.address);
      expect(ev.args.observer).to.equal(observer.address);
      expect(ev.args.productId).to.equal(1n);

      // Buyer has ACL on the expectedTotal handle and unseals to TOTAL_AMOUNT.
      const handle = ev.args.expectedTotalHandle as bigint;
      expect(await unsealUint64(buyer, handle)).to.equal(TOTAL_AMOUNT);

      // expiresAt = block.timestamp + QUOTE_TTL.
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      expect(ev.args.expiresAt).to.equal(BigInt(block!.timestamp) + BigInt(QUOTE_TTL));

      expect(await sigill.nextPendingId()).to.equal(1n);
    });

    it("stashes a PendingOrder addressable via getPendingOrder", async () => {
      await (
        await sigill.connect(buyer).quoteOrder(1n, observer.address)
      ).wait();

      const p = await sigill.getPendingOrder(0n);
      expect(p.buyer).to.equal(buyer.address);
      expect(p.observer).to.equal(observer.address);
      expect(p.productId).to.equal(1n);
      expect(await unsealUint64(buyer, BigInt(p.expectedTotal))).to.equal(
        TOTAL_AMOUNT,
      );
    });

    it("computes total = price + observerFee + 2.5% platform fee", async () => {
      const customFee = 750_000n;
      await (
        await sigill
          .connect(observer2)
          .registerObserver(customFee, { value: BOND })
      ).wait();

      const tx = await sigill.connect(buyer).quoteOrder(1n, observer2.address);
      const receipt = await tx.wait();
      const ev = parseLogByName(sigill, receipt!, "OrderQuoted");
      const handle = ev.args.expectedTotalHandle as bigint;

      const expected =
        PRODUCT_PRICE + customFee + (PRODUCT_PRICE * 25n) / 1000n;
      expect(await unsealUint64(buyer, handle)).to.equal(expected);
    });

    it("reverts on an unknown product", async () => {
      await expect(
        sigill.connect(buyer).quoteOrder(999n, observer.address),
      ).to.be.revertedWith("unknown product");
    });

    it("reverts when the chosen observer is not bonded", async () => {
      await expect(
        sigill.connect(buyer).quoteOrder(1n, outsider.address),
      ).to.be.revertedWith("Observer not bonded");
    });

    it("reverts when the observer queue is full", async () => {
      // Fill all 4 slots with confirmed orders.
      for (let i = 0; i < 4; i++) {
        await quoteAndConfirm(sigill, cUSDC, buyer, observer, BigInt(i + 1));
      }
      await expect(
        sigill.connect(buyer).quoteOrder(5n, observer.address),
      ).to.be.revertedWith("Observers queue is full");
    });
  });

  // ─── confirmOrder ───────────────────────────────────────────────────────

  describe("confirmOrder — happy path", () => {
    beforeEach(async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
    });

    it("escrows TOTAL_AMOUNT, sets order Pending, emits OrderInProccessed", async () => {
      const orderId = await quoteAndConfirm(
        sigill,
        cUSDC,
        buyer,
        observer,
        7n,
      );
      expect(orderId).to.equal(0n);
      expect(await sigill.nextOrderId()).to.equal(1n);

      const o = await sigill.getOrder(0n);
      expect(o.buyer).to.equal(buyer.address);
      expect(o.observer).to.equal(observer.address);
      expect(o.status).to.equal(0); // Pending

      await hre.cofhe.mocks.expectPlaintext(BigInt(o.encProductId), 7n);
      expect(await unsealUint64(buyer, BigInt(o.encPaid))).to.equal(
        TOTAL_AMOUNT,
      );
      // platformFee = 2.5% of price.
      await hre.cofhe.mocks.expectPlaintext(
        BigInt(o.platformFee),
        PLATFORM_FEE_AMOUNT,
      );

      // Sigill holds the full escrow.
      const sigillEnc = await cUSDC.balanceOf(await sigill.getAddress());
      await hre.cofhe.mocks.expectPlaintext(BigInt(sigillEnc), TOTAL_AMOUNT);

      // Buyer was debited the total.
      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT - TOTAL_AMOUNT);
    });

    it("deletes the pending entry after confirm", async () => {
      await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);
      // After delete, the stash is zeroed.
      const p = await sigill.getPendingOrder(0n);
      expect(p.buyer).to.equal(ethers.ZeroAddress);
      expect(p.productId).to.equal(0n);
    });
  });

  // ─── confirmOrder — tamper / preconditions ─────────────────────────────

  describe("confirmOrder — tamper detection", () => {
    beforeEach(async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
    });

    async function quote(b = buyer, productId = 1n, obs = observer) {
      const r = await (
        await sigill.connect(b).quoteOrder(productId, obs.address)
      ).wait();
      const ev = parseLogByName(sigill, r!, "OrderQuoted");
      return ev.args.pendingId as bigint;
    }

    it("zeroes the escrow and refunds in-tx if buyer approves a wrong handle", async () => {
      // Buyer fronts the buyer's own balance handle (WRAP_AMOUNT) as the
      // allowance — the value differs from TOTAL_AMOUNT so FHE.eq fails.
      const balanceHandle = BigInt(await cUSDC.balanceOf(buyer.address));
      const orderId = await quoteAndConfirm(
        sigill,
        cUSDC,
        buyer,
        observer,
        1n,
        balanceHandle,
      );

      // Order created but escrow zeroed.
      const o = await sigill.getOrder(orderId);
      expect(o.status).to.equal(0); // Pending
      await hre.cofhe.mocks.expectPlaintext(BigInt(o.encPaid), 0n);
      await hre.cofhe.mocks.expectPlaintext(BigInt(o.platformFee), 0n);

      // Buyer's cUSDC balance is unchanged — the bad pull was refunded.
      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT);

      // Sigill holds nothing for this order.
      const sigillBal = await cUSDC.balanceOf(await sigill.getAddress());
      await hre.cofhe.mocks.expectPlaintext(BigInt(sigillBal), 0n);
    });

    it("still decrements the observer slot when payment was tampered", async () => {
      const balanceHandle = BigInt(await cUSDC.balanceOf(buyer.address));
      await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n, balanceHandle);

      // FHE.eq result is opaque on-chain, so the order goes through and the
      // slot is consumed. The observer can reject the zero-escrow order to
      // free it up again.
      const [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(3);
    });

    it("reverts on an unknown pendingId", async () => {
      await expect(
        sigill.connect(buyer).confirmOrder(999n),
      ).to.be.revertedWith("Unknown quote");
    });

    it("reverts if a non-buyer tries to confirm someone else's quote", async () => {
      const pendingId = await quote(buyer);
      // No approve needed — confirmOrder reverts before transferFromAllowance.
      await expect(
        sigill.connect(buyer2).confirmOrder(pendingId),
      ).to.be.revertedWith("Not buyer");
    });

    it("reverts after the quote TTL has passed", async () => {
      const pendingId = await quote();
      await time.increase(QUOTE_TTL + 1);
      await expect(
        sigill.connect(buyer).confirmOrder(pendingId),
      ).to.be.revertedWith("Quote expired");
    });
  });

  // ─── fulfillOrder ───────────────────────────────────────────────────────

  describe("fulfillOrder", () => {
    const aesKey = 0x1234_5678_9abc_def0_1234_5678_9abc_def0n;
    let orderId: bigint;

    beforeEach(async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
      orderId = await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);
    });

    it("splits escrow between observer and PROTOCOL_VAULT, marks Fulfilled", async () => {
      const encAesKey = await encryptUint128(observer, aesKey);

      await expect(
        sigill.connect(observer).fulfillOrder(orderId, encAesKey, "ipfs://cid"),
      )
        .to.emit(sigill, "OrderFulfilled")
        .withArgs(orderId, "ipfs://cid");

      const o = await sigill.getOrder(orderId);
      expect(o.status).to.equal(2); // Fulfilled
      expect(o.ipfsCid).to.equal("ipfs://cid");

      // Observer received (TOTAL_AMOUNT - platformFee) = price + observerFee.
      expect(
        await unsealUint64(observer, await cUSDC.balanceOf(observer.address)),
      ).to.equal(PRODUCT_PRICE + OBSERVER_FEE);

      // Protocol vault received the platform fee.
      const vaultBal = await cUSDC.balanceOf(PROTOCOL_VAULT);
      await hre.cofhe.mocks.expectPlaintext(
        BigInt(vaultBal),
        PLATFORM_FEE_AMOUNT,
      );

      // Sigill is empty now — full escrow has been split out.
      const sigillBal = await cUSDC.balanceOf(await sigill.getAddress());
      await hre.cofhe.mocks.expectPlaintext(BigInt(sigillBal), 0n);

      expect(await sigill.getOrderCompleted(observer.address)).to.equal(1);
    });

    it("reverts if a non-observer tries to fulfill", async () => {
      const encAesKey = await encryptUint128(outsider, aesKey);
      await expect(
        sigill.connect(outsider).fulfillOrder(orderId, encAesKey, "cid"),
      ).to.be.revertedWith("Not observer");
    });

    it("reverts on the second fulfillment of the same order", async () => {
      const encAesKey1 = await encryptUint128(observer, aesKey);
      await (
        await sigill
          .connect(observer)
          .fulfillOrder(orderId, encAesKey1, "cid-1")
      ).wait();

      const encAesKey2 = await encryptUint128(observer, aesKey);
      await expect(
        sigill.connect(observer).fulfillOrder(orderId, encAesKey2, "cid-2"),
      ).to.be.revertedWith("Not pending");
    });

    it("reverts when fulfilling after the deadline", async () => {
      await time.increase(ORDER_TIMEOUT + 1);
      const encAesKey = await encryptUint128(observer, aesKey);
      await expect(
        sigill.connect(observer).fulfillOrder(orderId, encAesKey, "cid"),
      ).to.be.revertedWith("Deadline passed");
    });
  });

  // ─── rejectOrder ────────────────────────────────────────────────────────

  describe("rejectOrder", () => {
    let orderId: bigint;

    beforeEach(async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
      orderId = await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);
    });

    it("refunds the full TOTAL_AMOUNT to the buyer and emits OrderRejected", async () => {
      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT - TOTAL_AMOUNT);

      await expect(
        sigill.connect(observer).rejectOrder(orderId, "price too low"),
      )
        .to.emit(sigill, "OrderRejected")
        .withArgs(orderId, "price too low");

      const o = await sigill.getOrder(orderId);
      expect(o.status).to.equal(4); // Rejected

      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT);
    });

    it("reverts if a non-observer tries to reject", async () => {
      await expect(
        sigill.connect(outsider).rejectOrder(orderId, "reason"),
      ).to.be.revertedWith("Not observer");
    });

    it("reverts on rejecting an already-fulfilled order", async () => {
      const encAesKey = await encryptUint128(observer, 1n);
      await (
        await sigill
          .connect(observer)
          .fulfillOrder(orderId, encAesKey, "cid")
      ).wait();

      await expect(
        sigill.connect(observer).rejectOrder(orderId, "reason"),
      ).to.be.revertedWith("Not pending");
    });
  });

  // ─── refund (buyer reclaims after deadline) ─────────────────────────────

  describe("refund", () => {
    let orderId: bigint;

    beforeEach(async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
      orderId = await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);
    });

    it("reverts before the deadline", async () => {
      await expect(sigill.connect(buyer).refund(orderId)).to.be.revertedWith(
        "Deadline not passed",
      );
    });

    it("reverts if a non-buyer calls", async () => {
      await time.increase(ORDER_TIMEOUT + 1);
      await expect(
        sigill.connect(outsider).refund(orderId),
      ).to.be.revertedWith("Not buyer");
    });

    it("refunds the buyer, slashes observer bond 50%, emits OrderRefunded", async () => {
      await time.increase(ORDER_TIMEOUT + 1);

      expect(await sigill.getObserverBondAmount(observer.address)).to.equal(
        BOND,
      );

      await expect(sigill.connect(buyer).refund(orderId))
        .to.emit(sigill, "OrderRefunded")
        .withArgs(orderId);

      const o = await sigill.getOrder(orderId);
      expect(o.status).to.equal(3); // Refunded

      expect(await sigill.getObserverBondAmount(observer.address)).to.equal(
        BOND / 2n,
      );

      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT);
    });

    it("reverts on refunding an already-fulfilled order", async () => {
      const encAesKey = await encryptUint128(observer, 1n);
      await (
        await sigill
          .connect(observer)
          .fulfillOrder(orderId, encAesKey, "cid")
      ).wait();
      await time.increase(ORDER_TIMEOUT + 1);
      await expect(sigill.connect(buyer).refund(orderId)).to.be.revertedWith(
        "Not pending",
      );
    });
  });

  // ─── Observer queue / multi-order ───────────────────────────────────────

  describe("observer queue", () => {
    beforeEach(async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
    });

    it("tracks queue length and per-index order IDs across multiple orders", async () => {
      // Buyer needs enough cUSDC for 3 orders.
      await (
        await usdc.connect(buyer).mint(buyer.address, 1_000_000_000n)
      ).wait();
      await (
        await usdc
          .connect(buyer)
          .approve(await cUSDC.getAddress(), WRAP_AMOUNT)
      ).wait();
      await (await cUSDC.connect(buyer).wrap(WRAP_AMOUNT)).wait();

      for (let i = 0; i < 3; i++) {
        await quoteAndConfirm(sigill, cUSDC, buyer, observer, BigInt(i + 1));
      }

      expect(await sigill.getQueueLength(observer.address)).to.equal(3);
      expect(await sigill.getOrderQueue(observer.address)).to.deep.equal([
        0n,
        1n,
        2n,
      ]);
      expect(await sigill.getQueueAt(observer.address, 1)).to.equal(1);
      expect(await sigill.observersQueue(observer.address)).to.equal(3);
    });

    it("getQueueAt reverts on out-of-bounds index", async () => {
      await expect(
        sigill.getQueueAt(observer.address, 0),
      ).to.be.revertedWith("Index out of bounds");
    });
  });

  // ─── Observer slot system ───────────────────────────────────────────────

  describe("observer slot system", () => {
    beforeEach(async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
      // Buyer gets extra cUSDC to fund up to 5 orders.
      await (
        await usdc.connect(buyer).mint(buyer.address, 1_000_000_000n)
      ).wait();
      await (
        await usdc
          .connect(buyer)
          .approve(await cUSDC.getAddress(), 100_000_000n)
      ).wait();
      await (await cUSDC.connect(buyer).wrap(100_000_000n)).wait();
    });

    it("starts with slotLeft = soltSize = 4 after registration", async () => {
      const [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(4);
      expect(d.soltSize).to.equal(4);
      expect(d.sucessRate).to.equal(0);
    });

    it("decrements slotLeft on each confirmOrder", async () => {
      for (let i = 0; i < 3; i++) {
        await quoteAndConfirm(sigill, cUSDC, buyer, observer, BigInt(i + 1));
      }
      const [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(1);
      expect(d.soltSize).to.equal(4);
    });

    it("frees a slot on fulfillOrder and bumps sucessRate", async () => {
      const oid = await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);
      let [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(3);

      const k = await encryptUint128(observer, 7n);
      await (
        await sigill.connect(observer).fulfillOrder(oid, k, "cid")
      ).wait();
      [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(4);
      expect(d.sucessRate).to.be.greaterThan(0);
    });

    it("frees a slot on rejectOrder", async () => {
      const oid = await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);
      let [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(3);

      await (
        await sigill.connect(observer).rejectOrder(oid, "price too low")
      ).wait();
      [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(4);
      expect(d.sucessRate).to.equal(0);
    });

    it("does NOT free a slot on buyer refund (slot stays consumed)", async () => {
      const oid = await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);
      let [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(3);

      await time.increase(ORDER_TIMEOUT + 1);
      await (await sigill.connect(buyer).refund(oid)).wait();
      [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(3);
    });
  });

  // ─── Multiple observers ─────────────────────────────────────────────────

  describe("multiple observers", () => {
    it("forbids cross-observer fulfillment and rejection", async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
      await (
        await sigill
          .connect(observer2)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();

      const orderForObserver1 = await quoteAndConfirm(
        sigill,
        cUSDC,
        buyer,
        observer,
        1n,
      );

      const encAesKey = await encryptUint128(observer2, 42n);
      await expect(
        sigill
          .connect(observer2)
          .fulfillOrder(orderForObserver1, encAesKey, "x"),
      ).to.be.revertedWith("Not observer");

      await expect(
        sigill.connect(observer2).rejectOrder(orderForObserver1, "mine"),
      ).to.be.revertedWith("Not observer");
    });

    it("slashes only the targeted observer when refund fires", async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
      await (
        await sigill
          .connect(observer2)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();

      const oid = await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);
      await quoteAndConfirm(sigill, cUSDC, buyer2, observer2, 2n);

      await time.increase(ORDER_TIMEOUT + 1);
      await (await sigill.connect(buyer).refund(oid)).wait();

      expect(await sigill.getObserverBondAmount(observer.address)).to.equal(
        BOND / 2n,
      );
      expect(await sigill.getObserverBondAmount(observer2.address)).to.equal(
        BOND,
      );
    });
  });

  // ─── pickNextOrder ──────────────────────────────────────────────────────

  describe("pickNextOrder", () => {
    it("reverts when called by a non-observer", async () => {
      await expect(
        sigill.connect(outsider).pickNextOrder(),
      ).to.be.revertedWith("Only Observer allowed to call this");
    });

    it("surfaces the head Pending order for the calling observer", async () => {
      await (
        await sigill
          .connect(observer)
          .registerObserver(OBSERVER_FEE, { value: BOND })
      ).wait();
      const oid = await quoteAndConfirm(sigill, cUSDC, buyer, observer, 1n);

      const next = await sigill.connect(observer).pickNextOrder.staticCall();
      expect(next.buyer).to.equal(buyer.address);
      expect(next.observer).to.equal(observer.address);
      expect(await unsealUint64(observer, BigInt(next.encPaid))).to.equal(
        TOTAL_AMOUNT,
      );
      // Calling pickNextOrder (non-static) flips status to Processing.
      await (await sigill.connect(observer).pickNextOrder()).wait();
      const o = await sigill.getOrder(oid);
      expect(o.status).to.equal(1); // Processing
    });
  });

  // ─── ConfidentialERC20 wrap / unwrap path ───────────────────────────────

  describe("ConfidentialERC20", () => {
    it("round-trips a wrap → unwrap", async () => {
      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT);

      const encUnwrap = await encryptUint64(buyer, 40_000_000n);
      const reqReceipt = await (
        await cUSDC.connect(buyer).requestUnwrap(encUnwrap)
      ).wait();
      const ev = parseLogByName(cUSDC, reqReceipt!, "UnwrapRequested");
      const unwrapId = ev.args.unwrapId as bigint;

      const usdcBefore = await usdc.balanceOf(buyer.address);
      await (
        await cUSDC.connect(buyer).claimUnwrap(unwrapId, 40_000_000n)
      ).wait();
      expect((await usdc.balanceOf(buyer.address)) - usdcBefore).to.equal(
        40_000_000n,
      );

      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT - 40_000_000n);
    });

    it("rejects claimUnwrap from neither recipient nor unwrapper", async () => {
      const encUnwrap = await encryptUint64(buyer, 5_000_000n);
      const reqReceipt = await (
        await cUSDC.connect(buyer).requestUnwrap(encUnwrap)
      ).wait();
      const ev = parseLogByName(cUSDC, reqReceipt!, "UnwrapRequested");
      const unwrapId = ev.args.unwrapId as bigint;

      await expect(
        cUSDC.connect(outsider).claimUnwrap(unwrapId, 5_000_000n),
      ).to.be.revertedWith("Not authorised");
    });

    it("rejects double-claim of the same unwrap", async () => {
      const encUnwrap = await encryptUint64(buyer, 5_000_000n);
      const reqReceipt = await (
        await cUSDC.connect(buyer).requestUnwrap(encUnwrap)
      ).wait();
      const ev = parseLogByName(cUSDC, reqReceipt!, "UnwrapRequested");
      const unwrapId = ev.args.unwrapId as bigint;

      await (
        await cUSDC.connect(buyer).claimUnwrap(unwrapId, 5_000_000n)
      ).wait();
      await expect(
        cUSDC.connect(buyer).claimUnwrap(unwrapId, 5_000_000n),
      ).to.be.revertedWith("already claimed");
    });
  });
});
