import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { getDeployment } from './utils'

task('register-observer', 'Register observer with bond on Sigill').setAction(
	async (_, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre
		const contractAddress = getDeployment(network.name, 'Sigill')

		if (!contractAddress) {
			console.error(`No Sigill deployment found for ${network.name}`)
			return
		}

		const signers = await ethers.getSigners()
		const signer = signers.length > 1 ? signers[1] : signers[0]
		console.log(`Registering observer: ${signer.address}`)
		console.log(`Contract: ${contractAddress}`)

		const sigill = await ethers.getContractAt('Sigill', contractAddress, signer)
		const tx = await sigill.registerObserver({ value: ethers.parseEther('0.01') })
		const receipt = await tx.wait()

		console.log(`Observer registered! Bond: 0.01 ETH`)
		console.log(`Tx: ${receipt!.hash}`)
	}
)
