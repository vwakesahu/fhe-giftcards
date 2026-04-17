import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'
import { cofhejs_initializeWithHardhatSigner } from 'cofhe-hardhat-plugin'
import { getDeployment } from '../tasks/utils'

// Decode a BigInt back to the original ASCII string
function decodeGiftCardCode(encoded: bigint): string {
	const bytes: number[] = []
	let val = encoded
	while (val > 0n) {
		bytes.unshift(Number(val & 0xffn))
		val >>= 8n
	}
	return Buffer.from(bytes).toString('ascii')
}

async function main() {
	const { ethers, network } = hre
	const contractAddress = getDeployment(network.name, 'PrivateCheckout')

	if (!contractAddress) {
		console.error(`No PrivateCheckout deployment found for ${network.name}`)
		console.error('Deploy first: npx hardhat deploy-checkout --network <network>')
		process.exit(1)
	}

	console.log('=== Private Checkout Demo ===')
	console.log(`Network: ${network.name}`)
	console.log(`Contract: ${contractAddress}\n`)

	const signers = await ethers.getSigners()
	const buyer = signers[0]
	console.log(`Buyer address: ${buyer.address}`)

	// Initialize cofhejs with buyer's signer
	await cofhejs_initializeWithHardhatSigner(hre, buyer)

	const checkout = await ethers.getContractAt('PrivateCheckout', contractAddress)

	// Read observer address from env or use second signer
	const observerAddress =
		process.env.OBSERVER_ADDRESS || (signers.length > 1 ? signers[1].address : buyer.address)
	console.log(`Observer: ${observerAddress}\n`)

	// Step 1: Encrypt product details
	console.log('Step 1: Encrypting order details...')
	console.log('  Product: Amazon US $10 (productId=1, amount=1000 cents)')

	const encryptResult = await cofhejs.encrypt(
		[Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const
	)
	if (!encryptResult.data) {
		throw new Error(`Encryption failed: ${encryptResult.error}`)
	}
	const [encProductId, encAmount] = encryptResult.data
	console.log('  Encrypted successfully\n')

	// Step 2: Place order
	console.log('Step 2: Placing order (locking 0.001 ETH)...')
	const placeTx = await checkout.placeOrder(encProductId, encAmount, observerAddress, {
		value: hre.ethers.parseEther('0.001'),
	})
	const placeReceipt = await placeTx.wait()

	// Extract orderId from event
	const orderPlacedEvent = placeReceipt!.logs.find((log: any) => {
		try {
			return checkout.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === 'OrderPlaced'
		} catch {
			return false
		}
	})

	const parsedEvent = checkout.interface.parseLog({
		topics: orderPlacedEvent!.topics as string[],
		data: orderPlacedEvent!.data,
	})
	const orderId = parsedEvent!.args.orderId
	console.log(`  Order placed! ID: ${orderId}`)
	console.log(`  Tx: ${placeReceipt!.hash}\n`)

	// Step 3: Wait for fulfillment
	console.log('Step 3: Waiting for observer to fulfill...')
	console.log('  (Observer decrypts productId, buys gift card, encrypts code for you)')

	let fulfilled = false
	for (let i = 0; i < 120; i++) {
		await new Promise((r) => setTimeout(r, 5000))
		const order = await checkout.getOrder(orderId)
		if (order.fulfilled) {
			fulfilled = true
			console.log('  Order fulfilled!\n')
			break
		}
		if (i % 6 === 0) console.log(`  Still waiting... (${i * 5}s elapsed)`)
	}

	if (!fulfilled) {
		console.error('  Order was not fulfilled within 10 minutes')
		console.error('  You can call refund() to get your ETH back')
		process.exit(1)
	}

	// Step 4: Decrypt the gift card code
	console.log('Step 4: Decrypting your gift card code...')

	// Re-initialize cofhejs to ensure fresh permit
	await cofhejs_initializeWithHardhatSigner(hre, buyer)

	const order = await checkout.getOrder(orderId)
	const unsealResult = await cofhejs.unseal(order.encCode, FheTypes.Uint128)

	if (!unsealResult.data && unsealResult.data !== 0n) {
		throw new Error(`Failed to decrypt code: ${unsealResult.error}`)
	}

	const decodedCode = decodeGiftCardCode(unsealResult.data as bigint)

	console.log('\n========================================')
	console.log(`  Your gift card code: ${decodedCode}`)
	console.log('========================================')
	console.log('\nThis code was encrypted on-chain — only you can see it.')
	console.log('Block explorer shows encrypted blobs, not the actual code.')
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
