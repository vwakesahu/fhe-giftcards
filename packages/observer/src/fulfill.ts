import { ethers } from "ethers";
import { cofhejs, Encryptable, FheTypes } from "cofhejs/node";

import { PRODUCT_MAP, purchaseGiftCard } from "./giftcard";
import { aesEncrypt, aesKeyToBigInt, generateAesKey } from "./crypto";
import { uploadToIpfs } from "./ipfs";

const FHE_RETRY = 10;
const FHE_DELAY_MS = 3_000;

async function tryUnseal(handle: bigint, type: FheTypes): Promise<bigint | null> {
  for (let i = 1; i <= FHE_RETRY; i++) {
    const res = await cofhejs.unseal(handle, type);
    if (res.data !== undefined && res.data !== null) return res.data as bigint;
    if (i < FHE_RETRY) await new Promise((r) => setTimeout(r, FHE_DELAY_MS));
  }
  return null;
}

type Sigill = ethers.Contract;

type OrderView = {
  buyer: string;
  observer: string;
  encProductId: bigint;
  encPaid: bigint;
  status: number;
};

/**
 * Fulfil a single Pending order. Returns `true` when the fulfillOrder tx
 * lands, `false` when the order was rejected on-chain (bad product /
 * underpayment), and `null` when the FHE network hasn't produced a plaintext
 * yet — caller should retry on the next loop.
 */
export async function fulfillOne(
  orderId: bigint,
  order: OrderView,
  sigill: Sigill,
): Promise<true | false | null> {
  const prefix = `[order #${orderId}]`;

  const pid = await tryUnseal(order.encProductId, FheTypes.Uint64);
  const paid = await tryUnseal(order.encPaid, FheTypes.Uint64);
  if (pid === null || paid === null) {
    console.log(`${prefix} FHE decrypt pending — will retry next loop`);
    return null;
  }

  const product = PRODUCT_MAP[Number(pid)];
  if (!product) {
    console.log(`${prefix} unknown productId ${pid} — rejecting`);
    const tx = await sigill.rejectOrder(orderId, "unknown product");
    await tx.wait();
    return false;
  }

  const expected = BigInt(product.unitPrice) * 1_000_000n;
  if (paid < expected) {
    console.log(`${prefix} paid=${paid} < expected=${expected} — rejecting`);
    const tx = await sigill.rejectOrder(orderId, "payment below product price");
    await tx.wait();
    return false;
  }

  console.log(`${prefix} product=${product.label}, paid=${Number(paid) / 1e6} USDC`);
  const code = await purchaseGiftCard(product.productId, product.unitPrice, orderId);

  const aesKey = generateAesKey();
  const payload = aesEncrypt(code, aesKey);
  const cid = await uploadToIpfs(payload, orderId);

  const encRes = await cofhejs.encrypt([Encryptable.uint128(aesKeyToBigInt(aesKey))] as const);
  if (encRes.error || !encRes.data) {
    throw new Error(`cofhejs.encrypt failed: ${String(encRes.error)}`);
  }
  const [encAesKey] = encRes.data;

  const tx = await sigill.fulfillOrder(orderId, encAesKey, cid);
  const receipt = await tx.wait();
  console.log(`${prefix} fulfilled · tx=${tx.hash} · gasUsed=${receipt?.gasUsed}`);
  return true;
}
