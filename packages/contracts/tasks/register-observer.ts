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

		// OBSERVER_FEES: flat fee in USDC base units (6 dec). 0 = free.
		// Set this in your .env before running, e.g. OBSERVER_FEES=500000 for 0.50 USDC.
		const observerFees = BigInt(process.env.OBSERVER_FEES ?? '0')

		const signers = await ethers.getSigners()
		const signer = signers.length > 1 ? signers[1] : signers[0]
		console.log(`Registering observer : ${signer.address}`)
		console.log(`Contract             : ${contractAddress}`)
		console.log(`Observer fee         : ${Number(observerFees) / 1e6} USDC per order`)

		const sigill = await ethers.getContractAt('Sigill', contractAddress, signer)
		const tx = await (sigill as any).registerObserver(observerFees, { value: ethers.parseEther('0.01') })
		const receipt = await tx.wait()

		console.log(`Observer registered! Bond: 0.01 ETH`)
		console.log(`Tx: ${receipt!.hash}`)
	}
)
