import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'

type AuctionStatus = 'live' | 'ended'

export type GeneratedAuctionData = {
	kind: 30408
	created_at: number
	content: string
	tags: NDKTag[]
}

export function generateAuctionData(params: {
	sellerPubkey: string
	escrowPubkey: string
	availableShippingRefs?: string[]
	trustedMints?: string[]
	status?: AuctionStatus
	p2pkXpub?: string
}): GeneratedAuctionData {
	const { sellerPubkey, escrowPubkey, availableShippingRefs = [], trustedMints = ['https://nofees.testnut.cashu.space'] } = params
	const status = params.status ?? (Math.random() < 0.2 ? 'ended' : 'live')
	const p2pkXpub = params.p2pkXpub?.trim() || ''
	if (!p2pkXpub) {
		throw new Error('p2pkXpub is required for hd_p2pk auction generation')
	}
	if (!escrowPubkey.trim()) {
		throw new Error('escrowPubkey is required for hd_p2pk auction generation')
	}
	const now = Math.floor(Date.now() / 1000)

	const startAt = now - faker.number.int({ min: 60 * 60, max: 60 * 60 * 48 })
	const endAt =
		status === 'ended'
			? now - faker.number.int({ min: 60 * 5, max: 60 * 60 * 6 })
			: now + faker.number.int({ min: 60 * 30, max: 60 * 60 * 72 })

	const startingBid = faker.number.int({ min: 500, max: 50_000 })
	const bidIncrement = faker.number.int({ min: 50, max: 2_000 })
	const reserve = faker.number.int({ min: 0, max: startingBid * 2 })
	const auctionId = `auction_${faker.string.alphanumeric(10)}`

	const images = Array.from(
		{ length: faker.number.int({ min: 1, max: 4 }) },
		(_, i) => ['image', faker.image.urlPicsumPhotos({ width: 1200, height: 800 }), '800x600', i.toString()] as NDKTag,
	)

	const categoryTags: NDKTag[] = [['t', faker.helpers.arrayElement([...PRODUCT_CATEGORIES])]]
	const extraTagCount = faker.number.int({ min: 0, max: 2 })
	for (let i = 0; i < extraTagCount; i++) {
		categoryTags.push(['t', faker.commerce.department()])
	}

	const shippingTags: NDKTag[] = []
	if (availableShippingRefs.length > 0) {
		const selectedRefs = faker.helpers.arrayElements(
			availableShippingRefs,
			faker.number.int({ min: 1, max: Math.min(2, availableShippingRefs.length) }),
		)
		for (const shippingRef of selectedRefs) {
			const includeExtraCost = faker.datatype.boolean()
			if (includeExtraCost) {
				shippingTags.push(['shipping_option', shippingRef, String(faker.number.int({ min: 100, max: 5_000 }))])
			} else {
				shippingTags.push(['shipping_option', shippingRef])
			}
		}
	}

	const specTags: NDKTag[] = Array.from({ length: faker.number.int({ min: 2, max: 5 }) }, () => [
		'spec',
		faker.commerce.productAdjective(),
		faker.commerce.productMaterial(),
	])

	return {
		kind: 30408,
		// 30408 is replaceable/addressable; keep created_at current so relays accept it.
		created_at: now,
		content: faker.commerce.productDescription(),
		tags: [
			['d', auctionId],
			['title', faker.commerce.productName()],
			['summary', faker.commerce.productDescription()],
			['auction_type', 'english'],
			['start_at', String(startAt)],
			['end_at', String(endAt)],
			['currency', 'SAT'],
			['price', String(startingBid), 'SAT'],
			['starting_bid', String(startingBid), 'SAT'],
			['bid_increment', String(bidIncrement)],
			['reserve', String(reserve)],
			...trustedMints.map((mint) => ['mint', mint] as NDKTag),
			['escrow_pubkey', escrowPubkey],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', p2pkXpub],
			['settlement_policy', 'cashu_p2pk_v1'],
			['schema', 'auction_v1'],
			...images,
			...categoryTags,
			...specTags,
			...shippingTags,
		],
	}
}

export async function createAuctionEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	auctionData: GeneratedAuctionData,
): Promise<NDKEvent | null> {
	const event = new NDKEvent(ndk)
	event.kind = auctionData.kind
	event.content = auctionData.content
	event.tags = auctionData.tags
	event.created_at = auctionData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(`Published auction: ${auctionData.tags.find((tag) => tag[0] === 'title')?.[1]}`)
		return event
	} catch (error) {
		console.error('Failed to publish auction', error)
		return null
	}
}

export async function createAuctionBidEvent(params: {
	signer: NDKPrivateKeySigner
	ndk: NDK
	auctionEventId: string
	auctionCoordinates: string
	amount: number
	mint: string
	createdAt?: number
}): Promise<boolean> {
	const { signer, ndk, auctionEventId, auctionCoordinates, amount, mint, createdAt } = params
	const event = new NDKEvent(ndk)
	event.kind = 1023
	event.content = JSON.stringify({
		type: 'cashu_bid_commitment',
		amount,
		mint,
	})
	event.tags = [
		['e', auctionEventId],
		['a', auctionCoordinates],
		['amount', String(amount), 'SAT'],
		['mint', mint],
		['status', 'locked'],
		['schema', 'auction_bid_v1'],
	]
	if (createdAt) {
		event.created_at = createdAt
	}

	try {
		await event.sign(signer)
		await event.publish()
		return true
	} catch (error) {
		console.error('Failed to publish auction bid', error)
		return false
	}
}
