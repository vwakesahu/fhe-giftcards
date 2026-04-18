import type { EncryptedPayload } from "./crypto";

export async function uploadToIpfs(payload: EncryptedPayload, orderId: bigint): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error("PINATA_JWT is required — set it in .env.local");
  }

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: payload,
      pinataMetadata: { name: `sigill-order-${orderId}` },
    }),
  });
  if (!res.ok) {
    throw new Error(`Pinata upload failed: ${res.status} ${await res.text()}`);
  }
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  console.log(`  [ipfs] pinned via Pinata: ${IpfsHash}`);
  return IpfsHash;
}
