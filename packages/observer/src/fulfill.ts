import { ethers } from "ethers";
import { Encryptable, FheTypes, type CofheClient, type CofheConfig } from "@cofhe/sdk";

import { PRODUCT_MAP, purchaseGiftCard } from "./giftcard";
import { aesEncrypt, aesKeyToBigInt, generateAesKey } from "./crypto";
import { uploadToIpfs } from "./ipfs";

const FHE_RETRY = 10;
const FHE_DELAY_MS = 3_000;

// Base Sepolia public RPC returns CALL_EXCEPTION on estimateGas for FHE
// transactions even when the call would succeed. Hardcode a gas ceiling so
// ethers skips estimateGas entirely.
const FHE_GAS_LIMIT = 800_000n;

async function tryDecrypt(
  client: CofheClient<CofheConfig>,
  handle: bigint,
  type: FheTypes,
): Promise<bigint | null> {
  for (let i = 1; i <= FHE_RETRY; i++) {
    try {
      const result = await client
        .decryptForView(handle, type)
        .withPermit()
        .execute();
      if (result !== undefined && result !== null) return result as bigint;
    } catch {
      // CoFHE returns "not yet decrypted" while threshold network is processing
    }
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

export async function fulfillOne(
  orderId: bigint,
  order: OrderView,
  sigill: Sigill,
  client: CofheClient<CofheConfig>,
): Promise<true | false | null> {
  const prefix = `[order #${orderId}]`;

  const pid = await tryDecrypt(client, order.encProductId, FheTypes.Uint64);
  const paid = await tryDecrypt(client, order.encPaid, FheTypes.Uint64);
  if (pid === null || paid === null) {
    console.log(`${prefix} FHE decrypt pending — will retry next loop`);
    return null;
  }

  const product = PRODUCT_MAP[Number(pid)];
  if (!product) {
    console.log(`${prefix} unknown productId ${pid} — rejecting`);
    const tx = await sigill.rejectOrder(orderId, "unknown product", { gasLimit: FHE_GAS_LIMIT });
    await tx.wait();
    return false;
  }

  const expected = BigInt(product.unitPrice) * 1_000_000n;
  if (paid < expected) {
    console.log(`${prefix} paid=${paid} < expected=${expected} — rejecting`);
    const tx = await sigill.rejectOrder(orderId, "payment below product price", { gasLimit: FHE_GAS_LIMIT });
    await tx.wait();
    return false;
  }

  console.log(`${prefix} product=${product.label}, paid=${Number(paid) / 1e6} USDC`);
  const code = await purchaseGiftCard(product.productId, product.unitPrice, orderId);

  const aesKey = generateAesKey();
  const payload = aesEncrypt(code, aesKey);
  const cid = await uploadToIpfs(payload, orderId);

  const [encAesKey] = await client
    .encryptInputs([Encryptable.uint128(aesKeyToBigInt(aesKey))])
    .execute();

  const tx = await sigill.fulfillOrder(orderId, encAesKey, cid, { gasLimit: FHE_GAS_LIMIT });
  const receipt = await tx.wait();
  console.log(`${prefix} fulfilled · tx=${tx.hash} · gasUsed=${receipt?.gasUsed}`);
  return true;
}
