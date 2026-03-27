const BITREFILL_BASE = 'https://api.bitrefill.com/v2'

// Product ID → Bitrefill mapping
// Wave 1 uses free test products — swap slugs for real ones in Wave 2
export const PRODUCT_MAP: Record<number, { slug: string; label: string; cents: number }> = {
	1: { slug: 'test-gift-card-code', label: 'Test Gift Card (code)', cents: 1000 },
	2: { slug: 'test-gift-card-link', label: 'Test Gift Card (link)', cents: 2500 },
	3: { slug: 'test-gift-card-code-fail', label: 'Test Gift Card (fail)', cents: 1000 },
}

export async function callBitrefill(slug: string, cents: number): Promise<string> {
	const apiKey = process.env.BITREFILL_API_KEY

	if (!apiKey) {
		throw new Error('BITREFILL_API_KEY not set in .env')
	}

	const headers = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${apiKey}`,
	}

	// Create order
	const createRes = await fetch(`${BITREFILL_BASE}/order`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			operatorSlug: slug,
			valuePackage: cents,
			paymentMethod: 'balance',
			sendEmail: false,
		}),
	})

	if (!createRes.ok) {
		throw new Error(`Bitrefill create order failed: ${createRes.status} ${await createRes.text()}`)
	}

	const orderData = (await createRes.json()) as { id: string }
	console.log(`  Bitrefill order created: ${orderData.id}`)

	// Poll until delivered
	for (let i = 0; i < 30; i++) {
		await new Promise((r) => setTimeout(r, 2000))

		const pollRes = await fetch(`${BITREFILL_BASE}/order/${orderData.id}`, { headers })

		const pollData = (await pollRes.json()) as {
			delivered: boolean
			deliveredCodes?: { code: string }[]
		}

		if (pollData.delivered && pollData.deliveredCodes?.[0]?.code) {
			return pollData.deliveredCodes[0].code
		}
		console.log(`  Waiting for delivery... (${i + 1}/30)`)
	}

	throw new Error('Bitrefill delivery timed out')
}
