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

/**
 * Default `settlement_grace` (seconds) for seeded normal auctions. 2h gives
 * the seller a realistic settlement window. Quick-settle dev fixtures (in
 * seed.ts) override this to 30s for fast end-to-end iteration.
 */
export const DEFAULT_SEED_SETTLEMENT_GRACE_SECONDS = 7200

export function generateAuctionData(params: {
	sellerPubkey: string
	pathIssuerPubkey: string
	availableShippingRefs?: string[]
	trustedMints?: string[]
	status?: AuctionStatus
	p2pkXpub?: string
	settlementGraceSeconds?: number
}): GeneratedAuctionData {
	const { pathIssuerPubkey, availableShippingRefs = [], trustedMints = ['https://nofees.testnut.cashu.space'] } = params
	const settlementGraceSeconds = params.settlementGraceSeconds ?? DEFAULT_SEED_SETTLEMENT_GRACE_SECONDS
	const status = params.status ?? (Math.random() < 0.2 ? 'ended' : 'live')
	const p2pkXpub = params.p2pkXpub?.trim() || ''
	if (!p2pkXpub) {
		throw new Error('p2pkXpub is required for hd_p2pk auction generation')
	}
	if (!pathIssuerPubkey.trim()) {
		throw new Error('pathIssuerPubkey is required for path-oracle auction generation')
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
			// Seeded auctions don't enable anti-sniping, so the hard
			// bidding cutoff equals the nominal close (see AUCTIONS.md §6.0).
			['max_end_at', String(endAt)],
			['settlement_grace', String(settlementGraceSeconds)],
			['extension_rule', 'none'],
			['currency', 'SAT'],
			['price', String(startingBid), 'SAT'],
			['starting_bid', String(startingBid), 'SAT'],
			['bid_increment', String(bidIncrement)],
			['reserve', String(reserve)],
			...trustedMints.map((mint) => ['mint', mint] as NDKTag),
			// Bidder-held-path scheme (AUCTIONS.md §4.1): seller lists
			// validator pubkeys whose kind-30440 verdicts gate bid
			// validity. For seeded auctions we route to the CVM server
			// pubkey as the sole auditor until the validator daemon is
			// added in Phase 4.
			['auditors', pathIssuerPubkey],
			['auditor_quorum', '1'],
			['max_skew_sec', '120'],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', p2pkXpub],
			['settlement_policy', 'cashu_p2pk_bidder_path_v1'],
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

// `createAuctionBidEvent` removed in Phase 2 of the bidder-held-path
// migration. The v1 implementation called `request_path` on a CVM server
// which no longer exists; the new bid seeder (Phase 3) will be added
// alongside the bidder kind-1023 publish flow.
