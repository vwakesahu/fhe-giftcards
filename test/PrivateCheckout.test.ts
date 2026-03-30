import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { expect } from 'chai'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'

describe('PrivateCheckout', function () {
	async function deployFixture() {
		const [deployer, buyer, observer, stranger] = await hre.ethers.getSigners()

		const Factory = await hre.ethers.getContractFactory('PrivateCheckout')
		const checkout = await Factory.deploy()

		return { checkout, deployer, buyer, observer, stranger }
	}

	describe('Observer Registration', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

		it('should register observer with sufficient bond', async function () {
			const { checkout, observer } = await loadFixture(deployFixture)

			await expect(
				checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			).to.emit(checkout, 'ObserverRegistered')

			expect(await checkout.observerBond(observer.address)).to.equal(hre.ethers.parseEther('0.01'))
		})

		it('should reject observer with insufficient bond', async function () {
			const { checkout, observer } = await loadFixture(deployFixture)

			await expect(
				checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.001') })
			).to.be.revertedWith('Bond too low')
		})

		it('should accumulate bond on multiple registrations', async function () {
			const { checkout, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.02') })

			expect(await checkout.observerBond(observer.address)).to.equal(hre.ethers.parseEther('0.03'))
		})
	})

	describe('Order Placement', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

		it('should place order with encrypted inputs', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			// Register observer
			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })

			// Init cofhejs for buyer
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			// Encrypt inputs
			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			// Place order
			const tx = await checkout.connect(buyer).placeOrder(
				encProductId,
				encAmount,
				observer.address,
				{ value: hre.ethers.parseEther('0.001') }
			)

			await expect(tx).to.emit(checkout, 'OrderPlaced')

			const order = await checkout.getOrder(0)
			expect(order.buyer).to.equal(buyer.address)
			expect(order.observer).to.equal(observer.address)
			expect(order.fulfilled).to.be.false
			expect(order.refunded).to.be.false
			expect(order.lockedEth).to.equal(hre.ethers.parseEther('0.001'))
		})

		it('should reject order with unbonded observer', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await expect(
				checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
					value: hre.ethers.parseEther('0.001'),
				})
			).to.be.revertedWith('Observer not bonded')
		})

		it('should reject order with no ETH', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await expect(
				checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address)
			).to.be.revertedWith('Must lock ETH')
		})

		it('should verify encrypted productId and amount are correct via mocks', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			const order = await checkout.getOrder(0)
			await hre.cofhe.mocks.expectPlaintext(order.encProductId, 1n)
			await hre.cofhe.mocks.expectPlaintext(order.encAmount, 1000n)
		})
	})

	describe('Order Fulfillment', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

		it('should fulfill order and transfer ETH to observer', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			// Observer encrypts the gift card code
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(observer))
			const [encCode] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint128(123456789n)] as const)
			)

			const observerBalBefore = await hre.ethers.provider.getBalance(observer.address)

			const tx = await checkout.connect(observer).fulfillOrder(0, encCode)
			await expect(tx).to.emit(checkout, 'OrderFulfilled')

			const receipt = await tx.wait()
			const gasUsed = receipt!.gasUsed * receipt!.gasPrice

			const observerBalAfter = await hre.ethers.provider.getBalance(observer.address)
			expect(observerBalAfter).to.equal(
				observerBalBefore + hre.ethers.parseEther('0.001') - gasUsed
			)

			const order = await checkout.getOrder(0)
			expect(order.fulfilled).to.be.true
		})

		it('should allow buyer to decrypt the code via mocks', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			// Observer fulfills
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(observer))
			const [encCode] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint128(123456789n)] as const)
			)
			await checkout.connect(observer).fulfillOrder(0, encCode)

			// Buyer unseals the code
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const order = await checkout.getOrder(0)
			const unsealedCode = await cofhejs.unseal(order.encCode, FheTypes.Uint128)
			await hre.cofhe.expectResultValue(unsealedCode, 123456789n)
		})

		it('should reject fulfillment from non-observer', async function () {
			const { checkout, buyer, observer, stranger } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(stranger))
			const [encCode] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint128(999n)] as const)
			)

			await expect(
				checkout.connect(stranger).fulfillOrder(0, encCode)
			).to.be.revertedWith('Not observer')
		})

		it('should reject double fulfillment', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(observer))
			const [encCode] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint128(123n)] as const)
			)
			await checkout.connect(observer).fulfillOrder(0, encCode)

			const [encCode2] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint128(456n)] as const)
			)
			await expect(
				checkout.connect(observer).fulfillOrder(0, encCode2)
			).to.be.revertedWith('Already fulfilled')
		})

		it('should reject fulfillment after deadline', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			// Fast forward 11 minutes
			await time.increase(11 * 60)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(observer))
			const [encCode] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint128(123n)] as const)
			)

			await expect(
				checkout.connect(observer).fulfillOrder(0, encCode)
			).to.be.revertedWith('Deadline passed')
		})
	})

	describe('Refund', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

		it('should refund buyer and slash observer bond after deadline', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			// Fast forward past deadline
			await time.increase(11 * 60)

			const buyerBalBefore = await hre.ethers.provider.getBalance(buyer.address)
			const tx = await checkout.connect(buyer).refund(0)
			await expect(tx).to.emit(checkout, 'OrderRefunded')

			const receipt = await tx.wait()
			const gasUsed = receipt!.gasUsed * receipt!.gasPrice

			const buyerBalAfter = await hre.ethers.provider.getBalance(buyer.address)
			expect(buyerBalAfter).to.equal(buyerBalBefore + hre.ethers.parseEther('0.001') - gasUsed)

			// Observer bond slashed by 50%
			expect(await checkout.observerBond(observer.address)).to.equal(hre.ethers.parseEther('0.005'))

			const order = await checkout.getOrder(0)
			expect(order.refunded).to.be.true
		})

		it('should reject refund before deadline', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			await expect(checkout.connect(buyer).refund(0)).to.be.revertedWith('Deadline not passed')
		})

		it('should reject refund on fulfilled order', async function () {
			const { checkout, buyer, observer } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(observer))
			const [encCode] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint128(123n)] as const)
			)
			await checkout.connect(observer).fulfillOrder(0, encCode)

			await time.increase(11 * 60)

			await expect(checkout.connect(buyer).refund(0)).to.be.revertedWith('Already fulfilled')
		})

		it('should reject refund from non-buyer', async function () {
			const { checkout, buyer, observer, stranger } = await loadFixture(deployFixture)

			await checkout.connect(observer).registerObserver({ value: hre.ethers.parseEther('0.01') })
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))

			const [encProductId, encAmount] = await hre.cofhe.expectResultSuccess(
				cofhejs.encrypt([Encryptable.uint64(1n), Encryptable.uint64(1000n)] as const)
			)

			await checkout.connect(buyer).placeOrder(encProductId, encAmount, observer.address, {
				value: hre.ethers.parseEther('0.001'),
			})

			await time.increase(11 * 60)

			await expect(checkout.connect(stranger).refund(0)).to.be.revertedWith('Not buyer')
		})
	})
})
