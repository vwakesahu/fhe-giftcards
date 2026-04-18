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

		console.log('Deploying ConfidentialERC20 (cUSDC)...')
		const CFactory = await ethers.getContractFactory('ConfidentialERC20')
		const cUSDC = await CFactory.deploy(usdcAddress, 'Confidential USDC', 'cUSDC')
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
	}
)
