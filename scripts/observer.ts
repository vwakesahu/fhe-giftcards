import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { cofhejs_initializeWithHardhatSigner } from 'cofhe-hardhat-plugin'
import { getDeployment } from '../tasks/utils'
import { callBitrefill, PRODUCT_MAP } from './bitrefill'

function encodeGiftCardCode(code: string): bigint {
	const bytes = Buffer.from(code, 'ascii')
	if (bytes.length > 16) throw new Error('Code too long for euint128 (max 16 chars)')
	let result = 0n
	for (let i = 0; i < bytes.length; i++) {
		result = (result << 8n) | BigInt(bytes[i])
	}
	return result
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
				const giftCardCode = await callBitrefill(product.slug, product.value)
				console.log(`  Gift card code obtained: ${giftCardCode.substring(0, 4)}****`)

				// Step 4: Encode the code as uint256
				const encodedCode = encodeGiftCardCode(giftCardCode)
				console.log(`  Encoded as uint256: ${encodedCode}`)

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
