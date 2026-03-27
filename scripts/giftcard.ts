const RELOADLY_AUTH_URL = 'https://auth.reloadly.com/oauth/token'
const RELOADLY_SANDBOX_URL = 'https://giftcards-sandbox.reloadly.com'

// Product ID → Reloadly product mapping
// Using sandbox — $1000 test balance, fake codes returned
export const PRODUCT_MAP: Record<number, { productId: number; label: string; unitPrice: number }> = {
	1: { productId: 5, label: 'Amazon US $5', unitPrice: 5 },
	2: { productId: 5, label: 'Amazon US $10', unitPrice: 10 },
	3: { productId: 5, label: 'Amazon US $25', unitPrice: 25 },
}

let cachedToken: string | null = null

async function getAccessToken(): Promise<string> {
	if (cachedToken) return cachedToken

	const clientId = process.env.RELOADLY_CLIENT_ID
	const clientSecret = process.env.RELOADLY_CLIENT_SECRET
	if (!clientId || !clientSecret) throw new Error('RELOADLY_CLIENT_ID and RELOADLY_CLIENT_SECRET must be set in .env')

	const res = await fetch(RELOADLY_AUTH_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'client_credentials',
			audience: RELOADLY_SANDBOX_URL,
		}),
	})

	if (!res.ok) throw new Error(`Reloadly auth failed: ${res.status} ${await res.text()}`)

	const data = (await res.json()) as { access_token: string }
	cachedToken = data.access_token
	return cachedToken
}

export async function purchaseGiftCard(productId: number, unitPrice: number): Promise<string> {
	const token = await getAccessToken()
	const headers = {
		'Content-Type': 'application/json',
		Accept: 'application/com.reloadly.giftcards-v1+json',
		Authorization: `Bearer ${token}`,
	}

	// Step 1: Order the gift card
	console.log('  Placing Reloadly order...')
	const orderRes = await fetch(`${RELOADLY_SANDBOX_URL}/orders`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			productId,
			countryCode: 'US',
			quantity: 1,
			unitPrice,
			customIdentifier: `spectre-pay-${Date.now()}`,
		}),
	})

	if (!orderRes.ok) {
		throw new Error(`Reloadly order failed: ${orderRes.status} ${await orderRes.text()}`)
	}

	const orderData = (await orderRes.json()) as { transactionId: number; status: string }
	console.log(`  Order created: txn #${orderData.transactionId} (${orderData.status})`)

	// Step 2: Get the redeem code
	console.log('  Fetching redeem code...')

	// Poll a few times in case it's not instant
	for (let i = 0; i < 10; i++) {
		const codeRes = await fetch(
			`${RELOADLY_SANDBOX_URL}/orders/transactions/${orderData.transactionId}/cards`,
			{ headers }
		)

		if (codeRes.ok) {
			const cards = (await codeRes.json()) as { cardNumber?: string; pinCode?: string }[]
			if (cards.length > 0 && cards[0].cardNumber) {
				const code = cards[0].pinCode
					? `${cards[0].cardNumber}-${cards[0].pinCode}`
					: cards[0].cardNumber
				return code
			}
		}

		if (i < 9) {
			console.log(`  Waiting for code... (${i + 1}/10)`)
			await new Promise((r) => setTimeout(r, 2000))
		}
	}

	throw new Error('Failed to retrieve gift card code from Reloadly')
}
