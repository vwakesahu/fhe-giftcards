import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

task('deploy-checkout', 'Deploy the PrivateCheckout contract').setAction(async (_, hre: HardhatRuntimeEnvironment) => {
	const { ethers, network } = hre

	console.log(`Deploying PrivateCheckout to ${network.name}...`)

	const [deployer] = await ethers.getSigners()
	console.log(`Deploying with account: ${deployer.address}`)

	const Factory = await ethers.getContractFactory('PrivateCheckout')
	const contract = await Factory.deploy()
	await contract.waitForDeployment()

	const address = await contract.getAddress()
	console.log(`PrivateCheckout deployed to: ${address}`)

	saveDeployment(network.name, 'PrivateCheckout', address)

	return address
})
