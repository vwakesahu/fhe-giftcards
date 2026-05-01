/**
 * Sigill / Observer / ConfidentialERC20 — full simulation.
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
const ORDER_TIMEOUT = 10 * 60; // seconds — matches Observer.ORDER_TIMEOUT
const WRAP_AMOUNT = 100_000_000n; // 100 USDC (6 decimals)
const PAY_AMOUNT = 10_000_000n; // 10 USDC

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

/**
 * Single-shot helper that approves Sigill for `amount` and places an order
 * with the given observer. Returns the new order id.
 */
async function placeOrderWith(
  sigill: Sigill,
  cUSDC: ConfidentialERC20,
  buyer: HardhatEthersSigner,
  observer: HardhatEthersSigner,
  productId: bigint,
  amount: bigint = PAY_AMOUNT,
): Promise<bigint> {
  const encApprove = await encryptUint64(buyer, amount);
  await (
    await cUSDC.connect(buyer).approve(await sigill.getAddress(), encApprove)
  ).wait();
  const encProductId = await encryptUint64(buyer, productId);
  const tx = await sigill
    .connect(buyer)
    .placeOrder(encProductId, observer.address);
  const receipt = await tx.wait();
  // Contract emits OrderInProccessed for the first active order in the
  // observer's queue and OrderInQueued for everything behind it. Either one
  // carries the orderId as the first indexed arg.
  const log = receipt!.logs.find((l) => {
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

describe("Sigill — full E2E simulation", () => {
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
      observer.address, // unwrapper — observer doubles as the trusted unsealer
      "Confidential USDC",
      "cUSDC",
    )) as unknown as ConfidentialERC20;
    await cUSDC.waitForDeployment();

    const S = await ethers.getContractFactory("Sigill");
    sigill = (await S.connect(deployer).deploy(
      await cUSDC.getAddress(),
    )) as unknown as Sigill;
    await sigill.waitForDeployment();

    // Both buyers self-mint 1000 USDC and wrap 100 → cUSDC.
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

    it("exposes the public constants", async () => {
      expect(await sigill.ORDER_TIMEOUT()).to.equal(ORDER_TIMEOUT);
      expect(await sigill.PRICISION()).to.equal(1_000_000);
      expect(await sigill.MIN_BOND()).to.equal(BOND);
      expect(await sigill.getBondAmount()).to.equal(BOND);
    });

    it("starts with zero observers and zero orders", async () => {
      expect(await sigill.getObserversCount()).to.equal(0);
      expect(await sigill.nextOrderId()).to.equal(0);
      expect(await sigill.getObservers()).to.deep.equal([]);
    });
  });

  // ─── registerObserver ───────────────────────────────────────────────────

  describe("registerObserver", () => {
    it("registers when bond is sufficient and emits event", async () => {
      await expect(sigill.connect(observer).registerObserver({ value: BOND }))
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
        sigill.connect(observer).registerObserver({ value: BOND - 1n }),
      ).to.be.revertedWith("Bond too low");
    });

    it("accumulates bond on repeat calls and pushes the observer twice", async () => {
      // Note: Observer.registerObserver pushes to `observers` every time and
      // flips isObserver. Re-registering re-appends but does not double-count
      // uniqueness. We just verify the storage agrees with the contract.
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();

      expect(await sigill.getObserverBondAmount(observer.address)).to.equal(
        BOND * 2n,
      );
      expect(await sigill.getObserversCount()).to.equal(2);
    });

    it("getObserverAt reverts on out-of-bounds index", async () => {
      await expect(sigill.getObserverAt(0)).to.be.revertedWith(
        "Index out of bounds",
      );
    });
  });

  // ─── placeOrder ─────────────────────────────────────────────────────────

  describe("placeOrder", () => {
    beforeEach(async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();

      // Buyer approves Sigill for an encrypted PAY_AMOUNT allowance.
      const encApprove = await encryptUint64(buyer, PAY_AMOUNT);
      await (
        await cUSDC
          .connect(buyer)
          .approve(await sigill.getAddress(), encApprove)
      ).wait();
    });

    it("escrows the payment, queues the order, and emits OrderInProccessed", async () => {
      const encProductId = await encryptUint64(buyer, 7n);

      const tx = await sigill
        .connect(buyer)
        .placeOrder(encProductId, observer.address);
      const receipt = await tx.wait();
      expect(receipt!.status).to.equal(1);

      expect(await sigill.nextOrderId()).to.equal(1);

      const o = await sigill.getOrder(0);
      expect(o.buyer).to.equal(buyer.address);
      expect(o.observer).to.equal(observer.address);
      expect(o.status).to.equal(0); // Pending

      // productId ACL is granted to the contract + observer in Observer._placeOrder,
      // not the buyer — verify via the mock plaintext store instead of unseal.
      await hre.cofhe.mocks.expectPlaintext(BigInt(o.encProductId), 7n);
      // encPaid is the transferred handle from cUSDC.transferFromAllowance, which
      // FHE.allows the `from` (buyer), so buyer can unseal it.
      expect(await unsealUint64(buyer, o.encPaid)).to.equal(PAY_AMOUNT);

      expect(await sigill.getQueueLength(observer.address)).to.equal(1);
      expect(await sigill.getQueueAt(observer.address, 0)).to.equal(0);
      expect(await sigill.getOrderQueue(observer.address)).to.deep.equal([0n]);

      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT - PAY_AMOUNT);

      const sigillEnc = await cUSDC.balanceOf(await sigill.getAddress());
      await hre.cofhe.mocks.expectPlaintext(BigInt(sigillEnc), PAY_AMOUNT);
    });

    it("reverts when the chosen observer is not bonded", async () => {
      const encProductId = await encryptUint64(buyer, 1n);
      await expect(
        sigill.connect(buyer).placeOrder(encProductId, outsider.address),
      ).to.be.revertedWith("Observer not bonded");
    });
  });

  // ─── fulfillOrder ───────────────────────────────────────────────────────

  describe("fulfillOrder", () => {
    const orderId = 0n;
    const aesKey = 0x1234_5678_9abc_def0_1234_5678_9abc_def0n;

    beforeEach(async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);
    });

    it("marks the order Fulfilled, stores the AES key + CID, and pays the observer", async () => {
      const encAesKey = await encryptUint128(observer, aesKey);

      await expect(
        sigill.connect(observer).fulfillOrder(orderId, encAesKey, "ipfs://cid"),
      )
        .to.emit(sigill, "OrderFulfilled")
        .withArgs(orderId, "ipfs://cid");

      const o = await sigill.getOrder(orderId);
      expect(o.status).to.equal(2); // Fulfilled
      expect(o.ipfsCid).to.equal("ipfs://cid");

      await initCofhe(buyer);
      const aesRes = await cofhejs.unseal(
        BigInt(o.encAesKey),
        FheTypes.Uint128,
      );
      expect(aesRes.data).to.equal(aesKey);

      expect(
        await unsealUint64(observer, await cUSDC.balanceOf(observer.address)),
      ).to.equal(PAY_AMOUNT);

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
    const orderId = 0n;

    beforeEach(async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);
    });

    it("refunds the buyer and emits OrderRejected", async () => {
      expect(
        await unsealUint64(buyer, await cUSDC.balanceOf(buyer.address)),
      ).to.equal(WRAP_AMOUNT - PAY_AMOUNT);

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
        await sigill.connect(observer).fulfillOrder(orderId, encAesKey, "cid")
      ).wait();

      await expect(
        sigill.connect(observer).rejectOrder(orderId, "reason"),
      ).to.be.revertedWith("Not pending");
    });
  });

  // ─── refund (buyer reclaims after deadline) ─────────────────────────────

  describe("refund", () => {
    const orderId = 0n;

    beforeEach(async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);
    });

    it("reverts before the deadline", async () => {
      await expect(sigill.connect(buyer).refund(orderId)).to.be.revertedWith(
        "Deadline not passed",
      );
    });

    it("reverts if a non-buyer calls", async () => {
      await time.increase(ORDER_TIMEOUT + 1);
      await expect(sigill.connect(outsider).refund(orderId)).to.be.revertedWith(
        "Not buyer",
      );
    });

    it("refunds the buyer, slashes the observer bond by 50%, and emits the event", async () => {
      await time.increase(ORDER_TIMEOUT + 1);

      const bondBefore = await sigill.getObserverBondAmount(observer.address);
      expect(bondBefore).to.equal(BOND);

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
        await sigill.connect(observer).fulfillOrder(orderId, encAesKey, "cid")
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
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
    });

    it("tracks queue length and per-index order IDs across multiple orders", async () => {
      for (let i = 0; i < 3; i++) {
        await placeOrderWith(sigill, cUSDC, buyer, observer, BigInt(i + 1));
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
      await expect(sigill.getQueueAt(observer.address, 0)).to.be.revertedWith(
        "Index out of bounds",
      );
    });
  });

  // ─── Stat getters ───────────────────────────────────────────────────────

  describe("observer stats", () => {
    beforeEach(async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
    });

    it("updates getOrderCompleted and getOrderFailed across the lifecycle", async () => {
      for (let i = 0; i < 2; i++) {
        await placeOrderWith(sigill, cUSDC, buyer, observer, BigInt(i + 1));
      }

      expect(await sigill.getOrderFailed(observer.address)).to.equal(2); // both pending

      const encAesKey = await encryptUint128(observer, 1n);
      await (
        await sigill.connect(observer).fulfillOrder(0, encAesKey, "cid-0")
      ).wait();
      await (await sigill.connect(observer).rejectOrder(1, "rejected")).wait();

      expect(await sigill.getOrderCompleted(observer.address)).to.equal(1);
      expect(await sigill.getOrderFailed(observer.address)).to.equal(0);
      expect(await sigill.getCompleteness(observer.address)).to.be.greaterThan(
        0,
      );
    });
  });

  // ─── Observer slot system ───────────────────────────────────────────────

  describe("observer slot system", () => {
    // soltSize=4 means an observer can hold at most 4 in-flight orders. The
    // counter (slotLeft) decrements on placeOrder and increments on either
    // fulfillOrder or rejectOrder.

    beforeEach(async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      // Buyer wraps an extra 100 USDC so we can fund up to 5 orders of 10 each.
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
      console.log(d);
      expect(d.slotLeft).to.equal(4);
      expect(d.soltSize).to.equal(4);
      expect(d.sucessRate).to.equal(0);
    });

    it("decrements slotLeft on each placeOrder", async () => {
      for (let i = 0; i < 3; i++) {
        await placeOrderWith(sigill, cUSDC, buyer, observer, BigInt(i + 1));
      }
      const [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(1); // 4 - 3
      expect(d.soltSize).to.equal(4); // capacity is unchanged
    });

    it('reverts placeOrder with "Observers queue is full" when slots are exhausted', async () => {
      for (let i = 0; i < 4; i++) {
        await placeOrderWith(sigill, cUSDC, buyer, observer, BigInt(i + 1));
      }
      const [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(0);

      // 5th order should bounce — slot is full.
      const encApprove = await encryptUint64(buyer, PAY_AMOUNT);
      await (
        await cUSDC
          .connect(buyer)
          .approve(await sigill.getAddress(), encApprove)
      ).wait();
      const encProductId = await encryptUint64(buyer, 99n);
      await expect(
        sigill.connect(buyer).placeOrder(encProductId, observer.address),
      ).to.be.revertedWith("Observers queue is full");
    });

    it("frees a slot on fulfillOrder and updates sucessRate", async () => {
      const oid = await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);

      let [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(3);

      const k = await encryptUint128(observer, 7n);
      await (await sigill.connect(observer).fulfillOrder(oid, k, "cid")).wait();
      [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(4); // slot freed
      expect(d.sucessRate).to.be.greaterThan(0); // success rate bumped
    });

    it("frees a slot on rejectOrder", async () => {
      const oid = await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);
      let [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(3);

      await (
        await sigill.connect(observer).rejectOrder(oid, "price too low")
      ).wait();
      [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(4);
      // Rejection does not bump sucessRate.
      expect(d.sucessRate).to.equal(0);
    });

    it("does NOT free a slot on buyer refund (slot stays consumed)", async () => {
      const oid = await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);
      let [d] = await sigill.getObserverDetail();
      expect(d.slotLeft).to.equal(3);

      await time.increase(ORDER_TIMEOUT + 1);
      await (await sigill.connect(buyer).refund(oid)).wait();
      [d] = await sigill.getObserverDetail();
      // _refund doesn't touch slotLeft — the no-show observer keeps the slot
      // occupied (and they were just slashed, so they can't keep stuffing
      // queues anyway).
      expect(d.slotLeft).to.equal(3);
    });
  });

  // ─── Multiple observers ─────────────────────────────────────────────────

  describe("multiple observers", () => {
    it("registers and lists three independent observers", async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await (
        await sigill.connect(observer2).registerObserver({ value: BOND * 2n })
      ).wait();
      await (
        await sigill.connect(observer3).registerObserver({ value: BOND * 3n })
      ).wait();

      expect(await sigill.getObserversCount()).to.equal(3);
      expect(await sigill.getObservers()).to.deep.equal([
        observer.address,
        observer2.address,
        observer3.address,
      ]);
      expect(await sigill.getObserverAt(0)).to.equal(observer.address);
      expect(await sigill.getObserverAt(1)).to.equal(observer2.address);
      expect(await sigill.getObserverAt(2)).to.equal(observer3.address);

      expect(await sigill.getObserverBondAmount(observer.address)).to.equal(
        BOND,
      );
      expect(await sigill.getObserverBondAmount(observer2.address)).to.equal(
        BOND * 2n,
      );
      expect(await sigill.getObserverBondAmount(observer3.address)).to.equal(
        BOND * 3n,
      );
    });

    it("returns the full ObserverDetails roster via getObserverDetail()", async () => {
      expect(await sigill.getObserverDetail()).to.deep.equal([]);

      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await (
        await sigill.connect(observer2).registerObserver({ value: BOND })
      ).wait();
      await (
        await sigill.connect(observer3).registerObserver({ value: BOND })
      ).wait();

      const details = await sigill.getObserverDetail();
      expect(details.length).to.equal(3);

      // New registrations all default to (sucessRate=0, slotLeft=4, soltSize=4).
      for (let i = 0; i < 3; i++) {
        expect(details[i].sucessRate).to.equal(0);
        expect(details[i].slotLeft).to.equal(4);
        expect(details[i].soltSize).to.equal(4);
      }
      expect(details[0].observerAddress).to.equal(observer.address);
      expect(details[1].observerAddress).to.equal(observer2.address);
      expect(details[2].observerAddress).to.equal(observer3.address);
    });

    it("keeps each observer queue independent", async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await (
        await sigill.connect(observer2).registerObserver({ value: BOND })
      ).wait();

      // buyer → observer (orders 0, 1); buyer2 → observer2 (order 2);
      // buyer → observer2 (order 3).
      await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);
      await placeOrderWith(sigill, cUSDC, buyer, observer, 2n);
      await placeOrderWith(sigill, cUSDC, buyer2, observer2, 3n);
      await placeOrderWith(sigill, cUSDC, buyer, observer2, 4n);

      expect(await sigill.getOrderQueue(observer.address)).to.deep.equal([
        0n,
        1n,
      ]);
      expect(await sigill.getOrderQueue(observer2.address)).to.deep.equal([
        2n,
        3n,
      ]);

      expect(await sigill.getQueueLength(observer.address)).to.equal(2);
      expect(await sigill.getQueueLength(observer2.address)).to.equal(2);
      expect(await sigill.observersQueue(observer.address)).to.equal(2);
      expect(await sigill.observersQueue(observer2.address)).to.equal(2);

      // Per-order metadata routes to the right observer.
      expect((await sigill.getOrder(0)).observer).to.equal(observer.address);
      expect((await sigill.getOrder(1)).observer).to.equal(observer.address);
      expect((await sigill.getOrder(2)).observer).to.equal(observer2.address);
      expect((await sigill.getOrder(3)).observer).to.equal(observer2.address);

      // observer3 is unregistered → no queue, getOrderFailed under-flow guard
      // not triggered because nothing was placed against them.
      expect(await sigill.getQueueLength(observer3.address)).to.equal(0);
    });

    it("forbids cross-observer fulfillment and rejection", async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await (
        await sigill.connect(observer2).registerObserver({ value: BOND })
      ).wait();

      const orderForObserver1 = await placeOrderWith(
        sigill,
        cUSDC,
        buyer,
        observer,
        1n,
      );

      // observer2 cannot fulfill an order assigned to observer.
      const encAesKey = await encryptUint128(observer2, 42n);
      await expect(
        sigill
          .connect(observer2)
          .fulfillOrder(orderForObserver1, encAesKey, "x"),
      ).to.be.revertedWith("Not observer");

      // …nor can observer2 reject it.
      await expect(
        sigill.connect(observer2).rejectOrder(orderForObserver1, "mine"),
      ).to.be.revertedWith("Not observer");
    });

    it("tracks completion stats independently per observer", async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await (
        await sigill.connect(observer2).registerObserver({ value: BOND })
      ).wait();

      // observer: 2 orders, 1 fulfilled, 1 rejected.
      const o1 = await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);
      const o2 = await placeOrderWith(sigill, cUSDC, buyer, observer, 2n);
      // observer2: 1 order, 1 fulfilled.
      const o3 = await placeOrderWith(sigill, cUSDC, buyer2, observer2, 3n);

      const k1 = await encryptUint128(observer, 1n);
      await (
        await sigill.connect(observer).fulfillOrder(o1, k1, "cid-1")
      ).wait();
      await (await sigill.connect(observer).rejectOrder(o2, "no")).wait();

      const k2 = await encryptUint128(observer2, 2n);
      await (
        await sigill.connect(observer2).fulfillOrder(o3, k2, "cid-3")
      ).wait();

      expect(await sigill.getOrderCompleted(observer.address)).to.equal(1);
      expect(await sigill.getOrderCompleted(observer2.address)).to.equal(1);
      expect(await sigill.getOrderFailed(observer.address)).to.equal(0);
      expect(await sigill.getOrderFailed(observer2.address)).to.equal(0);

      // Each observer gets paid only for their own fulfilled work (PAY_AMOUNT each).
      expect(
        await unsealUint64(observer, await cUSDC.balanceOf(observer.address)),
      ).to.equal(PAY_AMOUNT);
      expect(
        await unsealUint64(observer2, await cUSDC.balanceOf(observer2.address)),
      ).to.equal(PAY_AMOUNT);

      // Bonds untouched (only refund() slashes; rejectOrder preserves bond).
      expect(await sigill.getObserverBondAmount(observer.address)).to.equal(
        BOND,
      );
      expect(await sigill.getObserverBondAmount(observer2.address)).to.equal(
        BOND,
      );

      // Both observers freed the slots they used and have non-zero sucessRate.
      const details = await sigill.getObserverDetail();
      expect(details[0].observerAddress).to.equal(observer.address);
      expect(details[0].slotLeft).to.equal(4); // 4 - 2 placed + 2 freed
      expect(details[0].sucessRate).to.be.greaterThan(0);
      expect(details[1].observerAddress).to.equal(observer2.address);
      expect(details[1].slotLeft).to.equal(4); // 4 - 1 placed + 1 freed
      expect(details[1].sucessRate).to.be.greaterThan(0);
    });

    it("slashes only the targeted observer when refund fires", async () => {
      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();
      await (
        await sigill.connect(observer2).registerObserver({ value: BOND })
      ).wait();

      const oid = await placeOrderWith(sigill, cUSDC, buyer, observer, 1n);
      await placeOrderWith(sigill, cUSDC, buyer2, observer2, 2n);

      await time.increase(ORDER_TIMEOUT + 1);
      await (await sigill.connect(buyer).refund(oid)).wait();

      expect(await sigill.getObserverBondAmount(observer.address)).to.equal(
        BOND / 2n,
      );
      // Untouched observer keeps the full bond.
      expect(await sigill.getObserverBondAmount(observer2.address)).to.equal(
        BOND,
      );
    });
  });

  // ─── pickNextOrder: refunded entries are skipped ────────────────────────

  describe("pickNextOrder skips refunded orders", () => {
    // The new placement flow stamps a deadline on the head order only; the
    // rest sit Queued (with deadline == creation block.timestamp) until the
    // head fulfils/rejects and _nextOrderStatusUpdate flips the next one to
    // Pending. Buyers can refund while either Pending (after deadline) or
    // Queued. _pickNextOrder is expected to walk past Refunded slots and
    // surface the next live order for the observer to work on.

    async function fundExtraBuyer(b: HardhatEthersSigner) {
      await (await usdc.connect(b).mint(b.address, 1_000_000_000n)).wait();
      await (
        await usdc.connect(b).approve(await cUSDC.getAddress(), WRAP_AMOUNT)
      ).wait();
      await (await cUSDC.connect(b).wrap(WRAP_AMOUNT)).wait();
    }

    it("walks past three refunded orders and returns the survivor", async () => {
      // buyer + buyer2 are wrapped by the outer beforeEach; spin up two more.
      const signers = await ethers.getSigners();
      const buyer3 = signers[7];
      const buyer4 = signers[8];
      const buyers = [buyer, buyer2, buyer3, buyer4];
      await fundExtraBuyer(buyer3);
      await fundExtraBuyer(buyer4);

      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();

      const orderIds: bigint[] = [];
      for (let i = 0; i < 4; i++) {
        orderIds.push(
          await placeOrderWith(sigill, cUSDC, buyers[i], observer, BigInt(i + 1)),
        );
      }
      expect(await sigill.getOrderQueue(observer.address)).to.deep.equal(
        orderIds,
      );

      // Head Pending with deadline; everything behind it Queued.
      expect((await sigill.getOrder(orderIds[0])).status).to.equal(0); // Pending
      expect((await sigill.getOrder(orderIds[0])).deadline).to.be.greaterThan(0);
      for (let i = 1; i < 4; i++) {
        expect((await sigill.getOrder(orderIds[i])).status).to.equal(5); // Queued
      }

      // Push past the head's deadline so the Pending refund passes the
      // block.timestamp > deadline check. Queued entries already satisfy it
      // because their deadline was stamped at creation block.
      await time.increase(ORDER_TIMEOUT + 1);

      // Refund 3 of 4 — leave order 3 as the only survivor.
      await (await sigill.connect(buyers[0]).refund(orderIds[0])).wait();
      await (await sigill.connect(buyers[1]).refund(orderIds[1])).wait();
      await (await sigill.connect(buyers[2]).refund(orderIds[2])).wait();

      for (let i = 0; i < 3; i++) {
        expect((await sigill.getOrder(orderIds[i])).status).to.equal(3); // Refunded
      }
      expect((await sigill.getOrder(orderIds[3])).status).to.equal(5); // still Queued

      // Inspect the return without mutating, then commit to advance orderIndex.
      const next = await sigill.connect(observer).pickNextOrder.staticCall();
      expect(next.buyer).to.equal(buyers[3].address);
      expect(next.observer).to.equal(observer.address);

      await (await sigill.connect(observer).pickNextOrder()).wait();
      // observersQueue = queue.length - orderIndex = 4 - 3 = 1.
      expect(await sigill.observersQueue(observer.address)).to.equal(1);
    });

    it("reverts pickNextOrder when every queued entry has been refunded", async () => {
      const signers = await ethers.getSigners();
      const buyer3 = signers[7];
      const buyer4 = signers[8];
      const buyers = [buyer, buyer2, buyer3, buyer4];
      await fundExtraBuyer(buyer3);
      await fundExtraBuyer(buyer4);

      await (
        await sigill.connect(observer).registerObserver({ value: BOND })
      ).wait();

      const orderIds: bigint[] = [];
      for (let i = 0; i < 4; i++) {
        orderIds.push(
          await placeOrderWith(sigill, cUSDC, buyers[i], observer, BigInt(i + 1)),
        );
      }

      await time.increase(ORDER_TIMEOUT + 1);
      for (let i = 0; i < 4; i++) {
        await (await sigill.connect(buyers[i]).refund(orderIds[i])).wait();
      }

      // Walker runs off the end of the queue — no live order to pick.
      await expect(sigill.connect(observer).pickNextOrder()).to.be.reverted;
    });

    it("reverts pickNextOrder when called by a non-observer", async () => {
      await expect(
        sigill.connect(outsider).pickNextOrder(),
      ).to.be.revertedWith("Only Observer allowed to call this");
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

      const log = reqReceipt!.logs.find((l) => {
        try {
          return (
            cUSDC.interface.parseLog({
              topics: l.topics as string[],
              data: l.data,
            })?.name === "UnwrapRequested"
          );
        } catch {
          return false;
        }
      });
      const unwrapId = cUSDC.interface.parseLog({
        topics: log!.topics as string[],
        data: log!.data,
      })!.args.unwrapId as bigint;

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
      const log = reqReceipt!.logs.find((l) => {
        try {
          return (
            cUSDC.interface.parseLog({
              topics: l.topics as string[],
              data: l.data,
            })?.name === "UnwrapRequested"
          );
        } catch {
          return false;
        }
      });
      const unwrapId = cUSDC.interface.parseLog({
        topics: log!.topics as string[],
        data: log!.data,
      })!.args.unwrapId as bigint;

      await expect(
        cUSDC.connect(outsider).claimUnwrap(unwrapId, 5_000_000n),
      ).to.be.revertedWith("Not authorised");
    });

    it("rejects double-claim of the same unwrap", async () => {
      const encUnwrap = await encryptUint64(buyer, 5_000_000n);
      const reqReceipt = await (
        await cUSDC.connect(buyer).requestUnwrap(encUnwrap)
      ).wait();
      const log = reqReceipt!.logs.find((l) => {
        try {
          return (
            cUSDC.interface.parseLog({
              topics: l.topics as string[],
              data: l.data,
            })?.name === "UnwrapRequested"
          );
        } catch {
          return false;
        }
      });
      const unwrapId = cUSDC.interface.parseLog({
        topics: log!.topics as string[],
        data: log!.data,
      })!.args.unwrapId as bigint;

      await (
        await cUSDC.connect(buyer).claimUnwrap(unwrapId, 5_000_000n)
      ).wait();
      await expect(
        cUSDC.connect(buyer).claimUnwrap(unwrapId, 5_000_000n),
      ).to.be.revertedWith("already claimed");
    });
  });
});
