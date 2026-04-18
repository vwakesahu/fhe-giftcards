import crypto from "node:crypto";

const AES_ALGO = "aes-128-gcm";

export interface EncryptedPayload {
  iv: string; // hex
  ciphertext: string; // hex
  tag: string; // hex
}

export function generateAesKey(): Buffer {
  return crypto.randomBytes(16); // 128-bit
}

export function aesKeyToBigInt(key: Buffer): bigint {
  return BigInt("0x" + key.toString("hex"));
}

export function aesEncrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    ciphertext: encrypted.toString("hex"),
    tag: tag.toString("hex"),
  };
}
