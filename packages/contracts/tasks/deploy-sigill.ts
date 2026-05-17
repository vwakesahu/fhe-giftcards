import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

task('deploy-sigill', 'Deploy ConfidentialERC20 (cUSDC) + Sigill').setAction(
	async (_, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		const [deployer] = await ethers.getSigners()
		console.log(`Deploying to ${network.name} with ${deployer.address}`)

		const usdcAddress = process.env.USDC_ADDRESS
		if (!usdcAddress) {
			throw new Error(
				'USDC_ADDRESS env var required. Circle USDC on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e'
			)
		}
		console.log(`Using USDC at ${usdcAddress}`)

		// Trusted unwrapper (owner of the Threshold-Network-replacement role).
		// Defaults to OBSERVER_PRIVATE_KEY's address since the observer is
		// already a trust anchor in the Sigill flow.
		const signers = await ethers.getSigners()
		const unwrapperAddress =
			process.env.UNWRAPPER_ADDRESS ??
			(signers.length > 1 ? signers[1].address : signers[0].address)
		console.log(`Unwrapper: ${unwrapperAddress}`)

		console.log('Deploying ConfidentialERC20 (cUSDC)...')
		const CFactory = await ethers.getContractFactory('ConfidentialERC20')
		const cUSDC = await CFactory.deploy(
			usdcAddress,
			unwrapperAddress,
			'Confidential USDC',
			'cUSDC'
		)
		await cUSDC.waitForDeployment()
		const cUSDCAddress = await cUSDC.getAddress()
		saveDeployment(network.name, 'ConfidentialERC20', cUSDCAddress)
		console.log(`  cUSDC: ${cUSDCAddress}`)

		console.log('Deploying Sigill...')
		const SigillFactory = await ethers.getContractFactory('Sigill')
		const sigill = await SigillFactory.deploy(cUSDCAddress)
		await sigill.waitForDeployment()
		const sigillAddress = await sigill.getAddress()
		saveDeployment(network.name, 'Sigill', sigillAddress)
		console.log(`  Sigill: ${sigillAddress}`)

		// Seed the product catalogue. quoteOrder reverts on an unknown product,
		// so without this the buy wizard can't place its first order. The IDs
		// here mirror PRODUCTS in packages/app/src/lib/contracts.ts. Override
		// with PRODUCT_IDS=1,2,3 in the env to deploy a different set.
		const productIds = (process.env.PRODUCT_IDS ?? '1,2,3')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => BigInt(s))
		console.log(`Activating products: ${productIds.join(', ')}`)
		for (const pid of productIds) {
			const tx = await (sigill as any).setProductActive(pid, true)
			await tx.wait()
		}
		console.log('  Products activated')
	}
)
