/**
 * End-to-end test of the full private checkout flow in a single script.
 *
 * Hybrid encryption: AES encrypts the gift card code, IPFS stores the ciphertext,
 * FHE encrypts the AES key on-chain so only the buyer can decrypt it.
 */
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes, type AbstractProvider, type AbstractSigner } from 'cofhejs/node'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import { TypedDataField } from 'ethers'
import { purchaseGiftCard, PRODUCT_MAP } from './giftcard'
import { generateAesKey, aesKeyToBigInt, bigIntToAesKey, aesEncrypt, aesDecrypt } from './crypto'
import { uploadToIpfs, fetchFromIpfs } from './ipfs'

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

// --- main ---

async function main() {
	const { ethers, network } = hre
	const signers = await ethers.getSigners()
	const buyer = signers[0]
	const observer = signers.length > 1 ? signers[1] : signers[0]
	const isMock = ['hardhat', 'localhost'].includes(network.name)

	const explorerBase: Record<string, string> = {
		'base-sepolia': 'https://sepolia.basescan.org',
		'eth-sepolia': 'https://sepolia.etherscan.io',
	}
	const explorer = explorerBase[network.name] || ''
	const txLink = (hash: string) => explorer ? `  ${explorer}/tx/${hash}` : ''
	const addrLink = (addr: string) => explorer ? `  ${explorer}/address/${addr}` : ''

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
	console.log(`  Contract: ${contractAddr}`)
	if (explorer) console.log(addrLink(contractAddr))
	console.log()

	// ── 2. Register observer ───────────────────────────────
	console.log('② Registering observer (0.01 ETH bond)...')
	const regTx = await (checkout.connect(observer) as any).registerObserver({
		value: ethers.parseEther('0.01'),
	})
	await regTx.wait()
	console.log(`  Tx: ${regTx.hash}`)
	if (explorer) console.log(txLink(regTx.hash))
	console.log()

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
	if (explorer) console.log(txLink(placeTx.hash))

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

	// Look up product and call Reloadly API
	const productId = Number(unsealedPid.data)
	const product = PRODUCT_MAP[productId]
	if (!product) throw new Error(`Unknown product ID: ${productId}`)
	console.log(`  Product: ${product.label}`)

	console.log('  Purchasing from Reloadly (sandbox)...')
	const giftCardCode = await purchaseGiftCard(product.productId, product.unitPrice)
	console.log(`  Gift card code obtained: ${giftCardCode}`)

	// Hybrid encryption: AES encrypt the code, upload to IPFS, FHE encrypt the AES key
	console.log('\n  Hybrid encryption:')
	const aesKey = generateAesKey()
	console.log(`  1. Generated AES-128 key: ${aesKey.toString('hex')}`)

	const encryptedPayload = aesEncrypt(giftCardCode, aesKey)
	console.log(`  2. AES-encrypted gift card code (${encryptedPayload.ciphertext.length / 2} bytes)`)

	console.log('  3. Uploading encrypted payload to IPFS...')
	const ipfsCid = await uploadToIpfs(encryptedPayload)
	console.log(`     IPFS CID: ${ipfsCid}`)

	const aesKeyBigInt = aesKeyToBigInt(aesKey)
	console.log(`  4. FHE-encrypting AES key for buyer only...`)
	const keyEncResult = await cofhejs.encrypt([Encryptable.uint128(aesKeyBigInt)] as const)
	if (!keyEncResult.data) throw new Error(`Encrypt AES key failed: ${keyEncResult.error}`)
	const [encAesKey] = keyEncResult.data

	console.log('  5. Calling fulfillOrder(encAesKey, ipfsCid)...')
	const fulfillTx = await (checkout.connect(observer) as any).fulfillOrder(orderId, encAesKey, ipfsCid)
	await fulfillTx.wait()
	console.log(`  Fulfilled! Tx: ${fulfillTx.hash}`)
	if (explorer) console.log(txLink(fulfillTx.hash))
	console.log()

	// ── 5. Buyer decrypts the gift card code ───────────────
	console.log('⑤ Buyer decrypting gift card code...')
	await initCofhe(buyer)

	const finalOrder = await checkout.getOrder(orderId)
	console.log(`  encAesKey handle: ${finalOrder.encAesKey} (opaque — useless without FHE permit)`)
	console.log(`  ipfsCid on-chain: ${finalOrder.ipfsCid} (public, but data is AES-encrypted)`)

	// Step A: FHE-unseal the AES key
	console.log('\n  Decryption steps:')
	let aesKeyValue: bigint | null = null
	for (let attempt = 1; attempt <= 10; attempt++) {
		const unsealedKey = await cofhejs.unseal(finalOrder.encAesKey, FheTypes.Uint128)
		if (unsealedKey.data && unsealedKey.data !== 0n) {
			aesKeyValue = unsealedKey.data as bigint
			break
		}
		console.log(`  Waiting for FHE network to process decryption... (${attempt}/10)`)
		await new Promise((r) => setTimeout(r, 5000))
	}

	if (aesKeyValue) {
		console.log(`  1. FHE-unsealed AES key: ${aesKeyValue.toString(16)}`)

		// Step B: Fetch encrypted payload from IPFS
		console.log(`  2. Fetching AES ciphertext from IPFS: ${finalOrder.ipfsCid}`)
		const fetchedPayload = await fetchFromIpfs(finalOrder.ipfsCid)

		// Step C: AES-decrypt the gift card code
		const recoveredKey = bigIntToAesKey(aesKeyValue)
		const decryptedCode = aesDecrypt(fetchedPayload, recoveredKey)
		console.log('  3. AES-decrypted gift card code')

		console.log('\n╔══════════════════════════════════════════╗')
		console.log(`║  Gift card code: ${decryptedCode.padEnd(23)}║`)
		console.log('╚══════════════════════════════════════════╝')
	} else {
		console.log('\n  FHE network still processing AES key decryption.')
		console.log('  The encrypted code is safely stored on IPFS — retry later.')
		console.log(`  IPFS CID: ${finalOrder.ipfsCid}`)
		console.log(`  (For demo: original code was "${giftCardCode}")`)
	}

	// ── Summary ────────────────────────────────────────────
	console.log('\n── Privacy summary ──')
	console.log('✓ Product ID    — FHE-encrypted on-chain, only observer could decrypt')
	console.log('✓ Amount        — FHE-encrypted on-chain, only observer could decrypt')
	console.log('✓ AES key       — FHE-encrypted on-chain, only buyer can decrypt')
	console.log('✓ Gift card code — AES-encrypted on IPFS, needs key from FHE to read')
	console.log('✓ IPFS CID      — public, but ciphertext is useless without the AES key')
	console.log('✓ ETH payment   — visible (0.001 ETH), but what was bought is hidden')
	console.log('✓ Block explorer shows opaque handles, not actual values')
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
