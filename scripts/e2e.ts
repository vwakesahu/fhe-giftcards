/**
 * End-to-end test of the full private checkout flow in a single script.
 *
 * Runs on whatever --network you pass (use base-sepolia for real testnet).
 * Does everything: deploy → register observer → place order → fulfill → decrypt.
 */
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes, type AbstractProvider, type AbstractSigner } from 'cofhejs/node'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import { TypedDataField } from 'ethers'
import { callBitrefill, PRODUCT_MAP } from './bitrefill'

// --- helpers ---

function wrapSigner(signer: HardhatEthersSigner): { provider: AbstractProvider; signer: AbstractSigner } {
	const provider: AbstractProvider = {
		call: async (...args) => signer.provider.call(...args),
		getChainId: async () => (await signer.provider.getNetwork()).chainId.toString(),
		send: async (...args) => signer.provider.send(...args),
	}
	const abstractSigner: AbstractSigner = {
		signTypedData: async (domain, types, value) =>
			signer.signTypedData(domain, types as Record<string, TypedDataField[]>, value),
		getAddress: async () => signer.getAddress(),
		provider,
		sendTransaction: async (...args) => {
			const tx = await signer.sendTransaction(...args)
			return tx.hash
		},
	}
	return { provider, signer: abstractSigner }
}

async function initCofhe(signer: HardhatEthersSigner) {
	const wrapped = wrapSigner(signer)
	const isMock = ['hardhat', 'localhost'].includes(hre.network.name)

	const result = await cofhejs.initialize({
		provider: wrapped.provider,
		signer: wrapped.signer,
		environment: isMock ? 'MOCK' : 'TESTNET',
		...(isMock
			? {
					mockConfig: {
						zkvSigner: (await (async () => {
							const zkv = await hre.ethers.getImpersonatedSigner(
								'0x6E12D8C87503D4287c294f2Fdef96ACd9DFf6bd2'
							)
							return wrapSigner(zkv).signer
						})()),
					},
				}
			: {}),
	})

	if (result.error) throw new Error(`cofhejs init failed: ${result.error}`)
	return result.data
}

function encodeGiftCardCode(code: string): bigint {
	const bytes = Buffer.from(code, 'ascii')
	if (bytes.length > 16) throw new Error('Code too long for euint128 (max 16 chars)')
	let result = 0n
	for (let i = 0; i < bytes.length; i++) {
		result = (result << 8n) | BigInt(bytes[i])
	}
	return result
}

function decodeGiftCardCode(encoded: bigint): string {
	const bytes: number[] = []
	let val = encoded
	while (val > 0n) {
		bytes.unshift(Number(val & 0xffn))
		val >>= 8n
	}
	return Buffer.from(bytes).toString('ascii')
}

// --- main ---

async function main() {
	const { ethers, network } = hre
	const signers = await ethers.getSigners()
	const buyer = signers[0]
	const observer = signers.length > 1 ? signers[1] : signers[0]
	const isMock = ['hardhat', 'localhost'].includes(network.name)

	// Deploy mock FHE contracts if running on local hardhat network
	if (isMock) {
		console.log('Deploying FHE mock contracts...\n')
		await hre.cofhe.mocks.deployMocks({ deployTestBed: true, gasWarning: false, silent: false })
	}

	console.log('╔══════════════════════════════════════════╗')
	console.log('║   Private Checkout — E2E Flow            ║')
	console.log('╚══════════════════════════════════════════╝')
	console.log(`Network : ${network.name}`)
	console.log(`Buyer   : ${buyer.address}`)
	console.log(`Observer: ${observer.address}\n`)

	// ── 1. Deploy ──────────────────────────────────────────
	console.log('① Deploying PrivateCheckout...')
	const Factory = await ethers.getContractFactory('PrivateCheckout')
	const checkout = await Factory.connect(buyer).deploy()
	await checkout.waitForDeployment()
	const contractAddr = await checkout.getAddress()
	console.log(`  Contract: ${contractAddr}\n`)

	// ── 2. Register observer ───────────────────────────────
	console.log('② Registering observer (0.01 ETH bond)...')
	const regTx = await (checkout.connect(observer) as any).registerObserver({
		value: ethers.parseEther('0.01'),
	})
	await regTx.wait()
	console.log(`  Tx: ${regTx.hash}\n`)

	// ── 3. Buyer places encrypted order ────────────────────
	console.log('③ Buyer encrypting & placing order...')
	console.log('  productId=1 (test gift card), amount=1000 cents')

	await initCofhe(buyer)

	const encResult = await cofhejs.encrypt(
		[Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const
	)
	if (!encResult.data) throw new Error(`Encrypt failed: ${encResult.error}`)
	const [encProductId, encAmount] = encResult.data

	const placeTx = await (checkout.connect(buyer) as any).placeOrder(
		encProductId,
		encAmount,
		observer.address,
		{ value: ethers.parseEther('0.001') }
	)
	const placeReceipt = await placeTx.wait()

	const placeLog = placeReceipt!.logs.find((log: any) => {
		try {
			return checkout.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === 'OrderPlaced'
		} catch { return false }
	})
	const orderId = checkout.interface.parseLog({
		topics: placeLog!.topics as string[],
		data: placeLog!.data,
	})!.args.orderId

	console.log(`  Order #${orderId} placed — Tx: ${placeTx.hash}`)

	// Show what's visible on-chain
	const orderData = await checkout.getOrder(orderId)
	console.log('\n  On-chain data (what everyone sees):')
	console.log(`    buyer       : ${orderData.buyer}`)
	console.log(`    observer    : ${orderData.observer}`)
	console.log(`    encProductId: ${orderData.encProductId} (opaque handle)`)
	console.log(`    encAmount   : ${orderData.encAmount} (opaque handle)`)
	console.log(`    lockedEth   : ${ethers.formatEther(orderData.lockedEth)} ETH`)
	console.log(`    fulfilled   : ${orderData.fulfilled}`)
	console.log()

	// ── 4. Observer decrypts, buys gift card, fulfills ─────
	console.log('④ Observer decrypting order details...')
	await initCofhe(observer)

	const unsealedPid = await cofhejs.unseal(orderData.encProductId, FheTypes.Uint64)
	const unsealedAmt = await cofhejs.unseal(orderData.encAmount, FheTypes.Uint64)
	console.log(`  Decrypted productId: ${unsealedPid.data}`)
	console.log(`  Decrypted amount   : ${unsealedAmt.data} cents`)

	// Look up product and call Bitrefill API
	const productId = Number(unsealedPid.data)
	const product = PRODUCT_MAP[productId]
	if (!product) throw new Error(`Unknown product ID: ${productId}`)
	console.log(`  Product: ${product.label} (${product.slug})`)

	console.log('  Purchasing from Bitrefill...')
	const giftCardCode = await callBitrefill(product.slug, product.cents)
	console.log(`  Gift card code obtained: ${giftCardCode}`)

	const encodedCode = encodeGiftCardCode(giftCardCode)
	console.log(`  Encoded as uint128: ${encodedCode}`)

	console.log('  Encrypting code for buyer only...')
	const codeEncResult = await cofhejs.encrypt([Encryptable.uint128(encodedCode)] as const)
	if (!codeEncResult.data) throw new Error(`Encrypt code failed: ${codeEncResult.error}`)
	const [encCode] = codeEncResult.data

	console.log('  Calling fulfillOrder...')
	const fulfillTx = await (checkout.connect(observer) as any).fulfillOrder(orderId, encCode)
	await fulfillTx.wait()
	console.log(`  Fulfilled! Tx: ${fulfillTx.hash}\n`)

	// ── 5. Buyer decrypts the gift card code ───────────────
	console.log('⑤ Buyer decrypting gift card code...')
	await initCofhe(buyer)

	const finalOrder = await checkout.getOrder(orderId)
	console.log(`  encCode handle: ${finalOrder.encCode} (opaque — useless to anyone else)`)

	const unsealedCode = await cofhejs.unseal(finalOrder.encCode, FheTypes.Uint128)
	const decoded = decodeGiftCardCode(unsealedCode.data as bigint)

	console.log('\n╔══════════════════════════════════════════╗')
	console.log(`║  Gift card code: ${decoded.padEnd(23)}║`)
	console.log('╚══════════════════════════════════════════╝')

	// ── Summary ────────────────────────────────────────────
	console.log('\n── Privacy summary ──')
	console.log('✓ Product ID    — encrypted on-chain, only observer could decrypt')
	console.log('✓ Amount        — encrypted on-chain, only observer could decrypt')
	console.log('✓ Gift card code — encrypted on-chain, only buyer can decrypt')
	console.log('✓ ETH payment   — visible (0.001 ETH), but what was bought is hidden')
	console.log('✓ Block explorer shows opaque handles, not actual values')
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
