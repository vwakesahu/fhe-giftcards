import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import {
	cofhejs,
	Encryptable,
	type AbstractProvider,
	type AbstractSigner,
} from 'cofhejs/node'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { TypedDataField } from 'ethers'

import { getDeployment } from './utils'

/**
 * Unwrap cUSDC → USDC for the signer configured in hardhat.config.
 * Two-step: requestUnwrap (encrypted amount) → poll claimUnwrap until the
 * FHE network produces a plaintext. Prints the USDC balance delta on success.
 *
 * Default signer is `PRIVATE_KEY`. Pass `--observer` to use `OBSERVER_PRIVATE_KEY`
 * instead, so the operator can cash out escrow earnings.
 *
 *   pnpm hardhat unwrap --amount 10
 *   pnpm hardhat unwrap --amount 50 --observer
 */
task('unwrap', 'Request + claim an unwrap of cUSDC back to USDC')
	.addParam('amount', 'USDC amount (human units, e.g. 50 for 50 USDC)')
	.addFlag('observer', 'Use OBSERVER_PRIVATE_KEY (second signer) instead of PRIVATE_KEY')
	.setAction(async ({ amount, observer }, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		const signers = await ethers.getSigners()
		if (observer && signers.length < 2) {
			throw new Error('--observer flag needs OBSERVER_PRIVATE_KEY set in .env')
		}
		const signer = observer ? signers[1] : signers[0]

		const cUSDCAddress = getDeployment(network.name, 'ConfidentialERC20')
		const usdcAddress = getDeployment(network.name, 'MockUSDC') ?? process.env.USDC_ADDRESS
		if (!cUSDCAddress) throw new Error(`No ConfidentialERC20 deployment for ${network.name}`)
		if (!usdcAddress) throw new Error('USDC address unknown (no MockUSDC deployment nor USDC_ADDRESS env)')

		const cUSDC = await ethers.getContractAt('ConfidentialERC20', cUSDCAddress, signer)
		const usdc = await ethers.getContractAt(
			['function balanceOf(address) view returns (uint256)'],
			usdcAddress,
			signer,
		)

		const human = Number(amount)
		if (!Number.isFinite(human) || human <= 0) throw new Error(`Invalid amount: ${amount}`)
		const amountRaw = BigInt(Math.floor(human * 1_000_000))

		const explorer = 'https://sepolia.basescan.org'
		const before = await usdc.balanceOf(signer.address)

		console.log('╔══════════════════════════════════════════╗')
		console.log('║   Sigill — unwrap cUSDC → USDC            ║')
		console.log('╚══════════════════════════════════════════╝')
		console.log(`  signer       : ${signer.address}${observer ? ' (observer)' : ''}`)
		console.log(`  cUSDC        : ${cUSDCAddress}`)
		console.log(`  amount       : ${human} USDC (${amountRaw} raw)`)
		console.log(`  USDC before  : ${Number(before) / 1e6}\n`)

		// ── init cofhejs ──
		console.log('① Initialising cofhejs…')
		await initCofhe(signer)
		console.log('  ready\n')

		// ── encrypt amount ──
		console.log('② Encrypting unwrap amount…')
		const encRes = await cofhejs.encrypt([Encryptable.uint64(amountRaw)] as const)
		if (encRes.error || !encRes.data) throw new Error(`encrypt failed: ${String(encRes.error)}`)
		const [encAmount] = encRes.data

		// ── requestUnwrap ──
		console.log('③ Calling requestUnwrap…')
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const reqTx = await (cUSDC as any).requestUnwrap(encAmount)
		const reqReceipt = await reqTx.wait()
		console.log(`  tx: ${reqTx.hash}`)
		console.log(`  ${explorer}/tx/${reqTx.hash}`)

		// Parse UnwrapRequested to get the unwrapId
		const iface = cUSDC.interface
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const unwrapLog = reqReceipt!.logs.find((log: any) => {
			try {
				return (
					iface.parseLog({ topics: log.topics as string[], data: log.data })?.name ===
					'UnwrapRequested'
				)
			} catch {
				return false
			}
		})
		if (!unwrapLog) throw new Error('UnwrapRequested event missing from receipt')
		const parsed = iface.parseLog({
			topics: (unwrapLog as { topics: string[] }).topics,
			data: (unwrapLog as { data: string }).data,
		})!
		const unwrapId: bigint = parsed.args.unwrapId
		console.log(`  unwrapId: ${unwrapId}\n`)

		// ── poll claimUnwrap ──
		console.log('④ Polling claimUnwrap (FHE network decrypt)…')
		let claimed = false
		for (let i = 1; i <= 20; i++) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const claimTx = await (cUSDC as any).claimUnwrap(unwrapId)
				await claimTx.wait()
				console.log(`  claimed! tx: ${claimTx.hash}`)
				console.log(`  ${explorer}/tx/${claimTx.hash}`)
				claimed = true
				break
			} catch (err) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const msg: string = (err as any)?.shortMessage || (err as Error)?.message || String(err)
				if (msg.includes('decrypt pending') || msg.includes('execution reverted')) {
					console.log(`  decrypt still pending… (${i}/20)`)
					await new Promise((r) => setTimeout(r, 5_000))
				} else {
					throw err
				}
			}
		}
		if (!claimed) {
			console.log('\n  ✗ unwrap still pending after 100s. Re-run this task or call claimUnwrap manually.')
			console.log(`    unwrapId: ${unwrapId}`)
			return
		}

		const after = await usdc.balanceOf(signer.address)
		console.log(`\n  USDC after  : ${Number(after) / 1e6}`)
		console.log(`  delta       : +${Number(after - before) / 1e6} USDC`)
	})

// ── helpers ──────────────────────────────────────────────

function wrapSigner(signer: HardhatEthersSigner): {
	provider: AbstractProvider
	signer: AbstractSigner
} {
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
	const result = await cofhejs.initialize({
		provider: wrapped.provider,
		signer: wrapped.signer,
		environment: 'TESTNET',
	})
	if (result.error) throw new Error(`cofhejs init failed: ${result.error}`)
}
