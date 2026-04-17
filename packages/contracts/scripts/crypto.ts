import crypto from 'crypto'

const AES_ALGO = 'aes-128-gcm'

export interface EncryptedPayload {
	iv: string      // hex
	ciphertext: string  // hex
	tag: string     // hex
}

// Generate a random 128-bit AES key
export function generateAesKey(): Buffer {
	return crypto.randomBytes(16) // 128 bits
}

// AES key as BigInt (for FHE encryption as euint128)
export function aesKeyToBigInt(key: Buffer): bigint {
	return BigInt('0x' + key.toString('hex'))
}

// BigInt back to AES key buffer
export function bigIntToAesKey(val: bigint): Buffer {
	const hex = val.toString(16).padStart(32, '0')
	return Buffer.from(hex, 'hex')
}

// Encrypt plaintext with AES-128-GCM
export function aesEncrypt(plaintext: string, key: Buffer): EncryptedPayload {
	const iv = crypto.randomBytes(12)
	const cipher = crypto.createCipheriv(AES_ALGO, key, iv)
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	const tag = cipher.getAuthTag()
	return {
		iv: iv.toString('hex'),
		ciphertext: encrypted.toString('hex'),
		tag: tag.toString('hex'),
	}
}

// Decrypt AES-128-GCM ciphertext
export function aesDecrypt(payload: EncryptedPayload, key: Buffer): string {
	const decipher = crypto.createDecipheriv(
		AES_ALGO,
		key,
		Buffer.from(payload.iv, 'hex')
	)
	decipher.setAuthTag(Buffer.from(payload.tag, 'hex'))
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(payload.ciphertext, 'hex')),
		decipher.final(),
	])
	return decrypted.toString('utf8')
}
