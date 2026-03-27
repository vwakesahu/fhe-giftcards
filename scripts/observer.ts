import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { cofhejs_initializeWithHardhatSigner } from 'cofhe-hardhat-plugin'
import { getDeployment } from '../tasks/utils'

const BITREFILL_BASE = 'https://api.bitrefill.com/v2'

// Product ID → Bitrefill mapping
// Wave 1 uses free test products — swap slugs for real ones in Wave 2
const PRODUCT_MAP: Record<number, { slug: string; label: string; cents: number }> = {
	1: { slug: 'test-gift-card-code', label: 'Test Gift Card (code)', cents: 1000 },
	2: { slug: 'test-gift-card-link', label: 'Test Gift Card (link)', cents: 2500 },
	3: { slug: 'test-gift-card-code-fail', label: 'Test Gift Card (fail)', cents: 1000 },
	// Wave 2 real products:
	// 1: { slug: 'amazon-us', label: 'Amazon US $10', cents: 1000 },
	// 2: { slug: 'amazon-us', label: 'Amazon US $25', cents: 2500 },
	// 3: { slug: 'google-play-us', label: 'Google Play US $10', cents: 1000 },
}

// Encode a gift card code string into a BigInt (ASCII bytes packed into uint128)
// Max 16 ASCII chars fit in 128 bits
function encodeGiftCardCode(code: string): bigint {
	const bytes = Buffer.from(code, 'ascii')
	if (bytes.length > 16) throw new Error('Code too long for euint128 (max 16 chars)')
	let result = 0n
	for (let i = 0; i < bytes.length; i++) {
		result = (result << 8n) | BigInt(bytes[i])
	}
	return result
}

async function callBitrefill(slug: string, cents: number): Promise<string> {
	const apiKey = process.env.BITREFILL_API_KEY

	if (!apiKey) {
		console.log('  [DEMO MODE] No BITREFILL_API_KEY — returning mock gift card code')
		return 'DEMO-XXXX-1234'
	}

	const headers = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${apiKey}`,
	}

	// Create order
	const createRes = await fetch(`${BITREFILL_BASE}/order`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			operatorSlug: slug,
			valuePackage: cents,
			paymentMethod: 'balance',
			sendEmail: false,
		}),
	})

	if (!createRes.ok) {
		throw new Error(`Bitrefill create order failed: ${createRes.status} ${await createRes.text()}`)
	}

	const orderData = (await createRes.json()) as { id: string }
	console.log(`  Bitrefill order created: ${orderData.id}`)

	// Poll until delivered
	for (let i = 0; i < 30; i++) {
		await new Promise((r) => setTimeout(r, 2000))

		const pollRes = await fetch(`${BITREFILL_BASE}/order/${orderData.id}`, { headers })

		const pollData = (await pollRes.json()) as {
			delivered: boolean
			deliveredCodes?: { code: string }[]
		}

		if (pollData.delivered && pollData.deliveredCodes?.[0]?.code) {
			return pollData.deliveredCodes[0].code
		}
		console.log(`  Waiting for delivery... (${i + 1}/30)`)
	}

	throw new Error('Bitrefill delivery timed out')
}

async function main() {
	const { ethers, network } = hre
	const contractAddress = getDeployment(network.name, 'PrivateCheckout')

	if (!contractAddress) {
		console.error(`No PrivateCheckout deployment found for ${network.name}`)
		console.error('Deploy first: npx hardhat deploy-checkout --network <network>')
		process.exit(1)
	}

	console.log(`Observer starting on ${network.name}`)
	console.log(`Contract: ${contractAddress}`)

	// signers[0] = buyer (PRIVATE_KEY), signers[1] = observer (OBSERVER_PRIVATE_KEY)
	const signers = await ethers.getSigners()
	const observer = signers.length > 1 ? signers[1] : signers[0]
	console.log(`Observer address: ${observer.address}`)

	await cofhejs_initializeWithHardhatSigner(hre, observer)

	const checkout = await ethers.getContractAt('PrivateCheckout', contractAddress)

	console.log('\nListening for OrderPlaced events...\n')

	// Watch for new orders
	checkout.on(
		checkout.filters.OrderPlaced(),
		async (
			orderId: bigint,
			buyer: string,
			productIdHandle: bigint,
			amountHandle: bigint,
			orderObserver: string,
			deadline: bigint
		) => {
			// Only process orders assigned to us
			if (orderObserver.toLowerCase() !== observer.address.toLowerCase()) {
				console.log(`Order ${orderId} — not our assignment, skipping`)
				return
			}

			console.log(`\n--- Order ${orderId} received ---`)
			console.log(`  Buyer: ${buyer}`)
			console.log(`  Deadline: ${new Date(Number(deadline) * 1000).toISOString()}`)

			try {
				// Step 1: Decrypt productId and amount
				console.log('  Decrypting product details...')
				const unsealedProductId = await cofhejs.unseal(productIdHandle, FheTypes.Uint64)
				const unsealedAmount = await cofhejs.unseal(amountHandle, FheTypes.Uint64)

				if (!unsealedProductId.data && unsealedProductId.data !== 0n) {
					throw new Error('Failed to unseal productId')
				}
				if (!unsealedAmount.data && unsealedAmount.data !== 0n) {
					throw new Error('Failed to unseal amount')
				}

				const productId = Number(unsealedProductId.data)
				const amount = Number(unsealedAmount.data)
				console.log(`  Product ID: ${productId}, Amount: ${amount} cents`)

				// Step 2: Map to Bitrefill product
				const product = PRODUCT_MAP[productId]
				if (!product) {
					console.error(`  Unknown product ID: ${productId} — cannot fulfill`)
					return
				}
				console.log(`  Product: ${product.label} (${product.slug})`)

				// Step 3: Call Bitrefill API (or mock)
				console.log('  Purchasing from Bitrefill...')
				const giftCardCode = await callBitrefill(product.slug, product.cents)
				console.log(`  Gift card code obtained: ${giftCardCode.substring(0, 4)}****`)

				// Step 4: Encode the code as uint128
				const encodedCode = encodeGiftCardCode(giftCardCode)
				console.log(`  Encoded as uint128: ${encodedCode}`)

				// Step 5: Encrypt for the contract
				console.log('  Encrypting code for buyer...')
				const encryptResult = await cofhejs.encrypt([Encryptable.uint128(encodedCode)] as const)
				if (!encryptResult.data) {
					throw new Error(`Encryption failed: ${encryptResult.error}`)
				}
				const [encCode] = encryptResult.data

				// Step 6: Call fulfillOrder
				console.log('  Submitting fulfillOrder tx...')
				const tx = await checkout.fulfillOrder(orderId, encCode)
				const receipt = await tx.wait()
				console.log(`  Order ${orderId} fulfilled! Tx: ${receipt!.hash}`)
			} catch (err) {
				console.error(`  Failed to fulfill order ${orderId}:`, err)
				console.error('  Buyer can refund after deadline passes')
			}
		}
	)

	// Keep the script alive
	console.log('Observer is running. Press Ctrl+C to stop.\n')
	await new Promise(() => {})
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
