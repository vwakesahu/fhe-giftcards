const BITREFILL_BASE = 'https://api.bitrefill.com/v2'

// Product ID → Bitrefill mapping
// Wave 1 uses free test products — swap slugs for real ones in Wave 2
export const PRODUCT_MAP: Record<number, { slug: string; label: string; value: number }> = {
	1: { slug: 'test-gift-card-code', label: 'Test Gift Card (code)', value: 10 },
	2: { slug: 'test-gift-card-link', label: 'Test Gift Card (link)', value: 25 },
	3: { slug: 'test-gift-card-code-fail', label: 'Test Gift Card (fail)', value: 10 },
}

function getAuthHeader(): string {
	const apiKey = process.env.BITREFILL_API_KEY
	if (!apiKey) throw new Error('BITREFILL_API_KEY not set in .env')
	return `Bearer ${apiKey}`
}

export async function callBitrefill(slug: string, value: number): Promise<string> {
	const auth = getAuthHeader()
	const headers = {
		'Content-Type': 'application/json',
		Authorization: auth,
	}

	// Step 1: Create invoice with auto_pay
	console.log('  Creating Bitrefill invoice...')
	const invoiceRes = await fetch(`${BITREFILL_BASE}/invoices`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			products: [
				{
					product_id: slug,
					value,
					quantity: 1,
				},
			],
			payment_method: 'balance',
			auto_pay: true,
		}),
	})

	if (!invoiceRes.ok) {
		const body = await invoiceRes.text()
		throw new Error(`Bitrefill create invoice failed: ${invoiceRes.status} ${body}`)
	}

	const invoiceData = (await invoiceRes.json()) as { id: string; order_id?: string }
	console.log(`  Invoice created: ${invoiceData.id}`)

	// Step 2: Poll for the order to be delivered
	// The invoice with auto_pay creates an order automatically
	let orderId = invoiceData.order_id

	// If order_id not in invoice response, poll the invoice to get it
	if (!orderId) {
		for (let i = 0; i < 15; i++) {
			await new Promise((r) => setTimeout(r, 2000))
			const pollRes = await fetch(`${BITREFILL_BASE}/invoices/${invoiceData.id}`, { headers })
			const pollData = (await pollRes.json()) as { order_id?: string }
			if (pollData.order_id) {
				orderId = pollData.order_id
				break
			}
			console.log(`  Waiting for order creation... (${i + 1}/15)`)
		}
	}

	if (!orderId) throw new Error('Invoice created but no order_id returned')
	console.log(`  Order ID: ${orderId}`)

	// Step 3: Wait for delivery then unseal to get the code
	for (let i = 0; i < 30; i++) {
		await new Promise((r) => setTimeout(r, 2000))

		const orderRes = await fetch(`${BITREFILL_BASE}/orders/${orderId}`, { headers })
		const orderData = (await orderRes.json()) as { status?: string; delivered?: boolean }

		if (orderData.delivered || orderData.status === 'delivered') {
			// Step 4: Unseal to get the actual code
			const unsealRes = await fetch(`${BITREFILL_BASE}/orders/${orderId}/unseal`, { headers })
			if (!unsealRes.ok) {
				throw new Error(`Unseal failed: ${unsealRes.status} ${await unsealRes.text()}`)
			}
			const unsealData = (await unsealRes.json()) as {
				items?: { code?: string; pin?: string; link?: string }[]
			}

			const code = unsealData.items?.[0]?.code || unsealData.items?.[0]?.pin || unsealData.items?.[0]?.link
			if (!code) throw new Error(`Order delivered but no code found in unseal response: ${JSON.stringify(unsealData)}`)
			return code
		}
		console.log(`  Waiting for delivery... (${i + 1}/30)`)
	}

	throw new Error('Bitrefill delivery timed out')
}
