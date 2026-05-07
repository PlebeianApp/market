import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { PlebeianServerClient } from '@/lib/ctxcn-clients/PlebeianServerClient'
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
 * Seeds a kind-1023 bid event with a real path-oracle grant.
 *
 * Calls `request_path` on the running CVM server to allocate a derivation
 * path + child pubkey from the auction's `p2pk_xpub`. The returned values
 * are stamped onto the kind-1023 event so the registry has a real entry
 * for this bidder and the seller could (in principle) settle.
 *
 * Cashu lock is intentionally placeholder — seeded bidders don't have
 * pre-funded NIP-60 wallets, so the encoded `token` field would have no
 * real proofs to back it. `commitment` is therefore a placeholder hash
 * and `submit_bid_token` is NOT called. The registry entry stays at
 * status `issued` (not `locked`), and settlement will correctly skip
 * these bids — but every spec field is real except the token itself.
 */
export async function createAuctionBidEvent(params: {
	signer: NDKPrivateKeySigner
	ndk: NDK
	auctionEventId: string
	auctionCoordinates: string
	sellerPubkey: string
	pathIssuerPubkey: string
	cvmRelays: string[]
	bidderPrivateKeyHex: string
	amount: number
	mint: string
	endAt: number
	settlementGraceSeconds: number
	createdAt?: number
}): Promise<boolean> {
	const {
		signer,
		ndk,
		auctionEventId,
		auctionCoordinates,
		sellerPubkey,
		pathIssuerPubkey,
		cvmRelays,
		bidderPrivateKeyHex,
		amount,
		mint,
		endAt,
		settlementGraceSeconds,
		createdAt,
	} = params
	const bidNonce = `seed-${faker.string.alphanumeric(16)}`
	const placeholderRefundPubkey = `02${faker.string.hexadecimal({ length: 64, prefix: '', casing: 'lower' })}`
	const locktime = endAt + settlementGraceSeconds

	// Real path issuance against the running CVM server — ensures the
	// kind-30410 registry has a genuine entry for this bid and the
	// child_pubkey on the event is derived from the auction's p2pk_xpub.
	const auctionClient = new PlebeianServerClient({
		privateKey: bidderPrivateKeyHex,
		relays: cvmRelays,
		serverPubkey: pathIssuerPubkey,
	})
	let grant
	try {
		grant = await auctionClient.RequestPath(auctionEventId, auctionCoordinates, placeholderRefundPubkey, amount)
	} catch (error) {
		console.error('[seed] request_path failed for bidder', error instanceof Error ? error.message : error)
		await auctionClient.disconnect()
		return false
	} finally {
		await auctionClient.disconnect()
	}

	// Placeholder commitment — real bids hash a private payload that
	// includes the encoded Cashu token; seeded bidders have no funded
	// NIP-60 wallet so we skip `submit_bid_token` entirely. The
	// registry entry stays at status `issued`.
	const placeholderCommitment = faker.string.hexadecimal({ length: 64, prefix: '', casing: 'lower' })

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
		['locktime', String(locktime)],
		['refund_pubkey', placeholderRefundPubkey],
		['created_for_end_at', String(endAt)],
		['bid_nonce', bidNonce],
		['key_scheme', 'hd_p2pk'],
		['status', 'locked'],
		['schema', 'auction_bid_v1'],
		['child_pubkey', grant.childPubkey],
		['path_issuer', grant.pathIssuerPubkey],
		['path_grant_id', grant.grantId],
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
