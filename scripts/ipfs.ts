import type { EncryptedPayload } from './crypto'

// For hackathon demo: use web3.storage or store locally
// In production: use Pinata, web3.storage, or direct IPFS node

// Simple in-memory store for local/demo — replace with real IPFS in production
const localStore = new Map<string, string>()
let cidCounter = 0

export async function uploadToIpfs(payload: EncryptedPayload): Promise<string> {
	const json = JSON.stringify(payload)

	// Try Pinata if JWT is set
	const pinataJwt = process.env.PINATA_JWT
	if (pinataJwt) {
		const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${pinataJwt}`,
			},
			body: JSON.stringify({
				pinataContent: payload,
				pinataMetadata: { name: `order-${Date.now()}` },
			}),
		})
		if (res.ok) {
			const data = (await res.json()) as { IpfsHash: string }
			console.log(`  Uploaded to IPFS via Pinata: ${data.IpfsHash}`)
			return data.IpfsHash
		}
		console.log(`  Pinata upload failed (${res.status}), using local store`)
	}

	// Fallback: local in-memory store with a fake CID
	const cid = `local-${++cidCounter}-${Date.now()}`
	localStore.set(cid, json)
	console.log(`  Stored locally (demo mode): ${cid}`)
	return cid
}

export async function fetchFromIpfs(cid: string): Promise<EncryptedPayload> {
	// Try IPFS gateway first
	if (!cid.startsWith('local-')) {
		const gatewayUrl = process.env.PINATA_GATEWAY
			? `https://${process.env.PINATA_GATEWAY}/ipfs/${cid}`
			: `https://gateway.pinata.cloud/ipfs/${cid}`

		const res = await fetch(gatewayUrl)
		if (res.ok) {
			return (await res.json()) as EncryptedPayload
		}
	}

	// Fallback: local store
	const json = localStore.get(cid)
	if (!json) throw new Error(`CID not found: ${cid}`)
	return JSON.parse(json) as EncryptedPayload
}
