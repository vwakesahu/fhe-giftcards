import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

task('deploy-usdc', 'Deploy a mintable MockUSDC (used as test USDC on Base Sepolia)').setAction(
	async (_, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre
		const [deployer] = await ethers.getSigners()
		console.log(`Deploying MockUSDC to ${network.name} with ${deployer.address}`)

		const MockUSDC = await ethers.getContractFactory('MockUSDC')
		const usdc = await MockUSDC.deploy()
		await usdc.waitForDeployment()
		const address = await usdc.getAddress()
		saveDeployment(network.name, 'MockUSDC', address)

		const balance = await usdc.balanceOf(deployer.address)
		console.log(`  MockUSDC: ${address}`)
		console.log(`  Deployer balance: ${Number(balance) / 1e6} USDC`)
		console.log()
		console.log(`Add to your .env:`)
		console.log(`  USDC_ADDRESS=${address}`)
	}
)
