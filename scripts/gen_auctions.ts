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
			['path_issuer', pathIssuerPubkey],
			['key_scheme', 'hd_p2pk'],
			['p2pk_xpub', p2pkXpub],
			['settlement_policy', 'cashu_p2pk_path_oracle_v1'],
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

/**
 * Seeds a kind-1023 bid event for UI / display testing.
 *
 * NOTE: This bypasses the path-oracle bid flow — no real Cashu lock is
 * created at the mint, no path is requested from the issuer, and the
 * cryptographic fields below (`commitment`, `locktime`, `refund_pubkey`,
 * `child_pubkey`) are placeholder values. The event is **structurally**
 * spec-compliant (all required AUCTIONS.md §4.2 tags emitted) so list
 * rendering, price aggregation, and bid-count UI work correctly, but it
 * cannot be settled — the issuer registry has no entry for the placeholder
 * `child_pubkey`, so settlement would (correctly) skip these.
 */
export async function createAuctionBidEvent(params: {
	signer: NDKPrivateKeySigner
	ndk: NDK
	auctionEventId: string
	auctionCoordinates: string
	sellerPubkey: string
	amount: number
	mint: string
	endAt: number
	settlementGraceSeconds: number
	createdAt?: number
}): Promise<boolean> {
	const { signer, ndk, auctionEventId, auctionCoordinates, sellerPubkey, amount, mint, endAt, settlementGraceSeconds, createdAt } = params
	const bidder = await signer.user()
	const bidNonce = `seed-${faker.string.alphanumeric(16)}`
	// Placeholder commitment — real bids hash a private payload that
	// includes the encoded Cashu token; seeded bids have no token.
	const placeholderCommitment = faker.string.hexadecimal({ length: 64, prefix: '', casing: 'lower' })
	// Placeholder compressed secp256k1 pubkeys (66 hex chars, 02/03 prefix).
	const placeholderChildPubkey = `02${faker.string.hexadecimal({ length: 64, prefix: '', casing: 'lower' })}`
	const placeholderRefundPubkey = `02${faker.string.hexadecimal({ length: 64, prefix: '', casing: 'lower' })}`
	// Locktime mirrors what publishAuctionBid would compute for a real bid
	// against this auction: max_end_at + settlement_grace.
	const placeholderLocktime = endAt + settlementGraceSeconds

	const event = new NDKEvent(ndk)
	event.kind = 1023
	event.content = JSON.stringify({
		type: 'cashu_bid_commitment',
		amount,
		delta_amount: amount,
		prev_amount: 0,
		mint,
		commitment: placeholderCommitment,
		key_scheme: 'hd_p2pk',
		seeded: true,
	})
	event.tags = [
		['e', auctionEventId],
		['a', auctionCoordinates],
		['p', sellerPubkey],
		['amount', String(amount), 'SAT'],
		['delta_amount', String(amount), 'SAT'],
		['currency', 'SAT'],
		['mint', mint],
		['commitment', placeholderCommitment],
		['locktime', String(placeholderLocktime)],
		['refund_pubkey', placeholderRefundPubkey],
		['created_for_end_at', String(endAt)],
		['bid_nonce', bidNonce],
		['key_scheme', 'hd_p2pk'],
		['status', 'locked'],
		['schema', 'auction_bid_v1'],
		['child_pubkey', placeholderChildPubkey],
	]
	void bidder
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
