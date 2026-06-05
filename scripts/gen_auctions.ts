import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'
import { generateAuctionDerivationPath } from '@/lib/auctionPathOracle'
import { hashToCurveHexFromString } from '@/lib/cashu/hashToCurve'
import { buildBidEventTags } from '@/lib/auction/tagBuilders'
import { getPublicKey } from '@noble/secp256k1'

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

// =============================================================================
// Bidder-held-path bid seeding (Phase 3)
// =============================================================================
//
// Seeded bids are intentionally *synthetic* — no real mint round-trip
// happens. We tried minting against `testnut.cashu.space` originally
// but it rate-limits aggressively (5–10 mints/second per IP), which
// makes seeding flaky and slow. Real proofs aren't necessary for the
// dev UI: validators will NUT-7-query the bid's mint and find these
// Ys missing, so they'll emit `bid_pending_review` rather than
// `valid_bid_placed`. That's fine for "make sure the bid UI renders"
// purposes; it's not fine for testing settlement, which requires real
// proofs and is out of scope for Phase 3 seeding anyway.
//
// What we DO produce:
//   - A real bidder-chosen derivation path (high entropy, §5.5).
//   - A real `seller_child = derive(p2pk_xpub, path)` so a future
//     kind-1025 from the bidder would actually derive cleanly.
//   - A fresh per-bid refund keypair (real secp256k1).
//   - A well-formed NUT-10 P2PK secret per proof with the auction's
//     locktime + refund pubkey + lock pubkey — anything that parses
//     this lock_secret sees a structurally-correct lock.
//   - A real `Y = hash_to_curve(secret)` so validators can NUT-7
//     query it (and learn the mint doesn't know about it).
//   - A random `C` (compressed secp256k1 point) so the proof shape is
//     valid; the mint would never accept it for redemption but
//     no protocol code under test inspects this field.
//
// What we DON'T produce: a token that the seller could actually redeem
// at the mint. Settlement of seeded bids is impossible by construction.

export async function createAuctionBidEvent(params: {
	signer: NDKPrivateKeySigner
	ndk: NDK
	auctionEventId: string
	auctionCoordinates: string
	sellerPubkey: string
	p2pkXpub: string
	cvmRelays: string[] // historical name, kept for call-site compat — unused under bidder-held-path
	bidderPrivateKeyHex: string
	amount: number
	mint: string
	endAt: number
	maxEndAt: number
	settlementGraceSeconds: number
	createdAt?: number
}): Promise<boolean> {
	void params.cvmRelays
	void params.bidderPrivateKeyHex

	try {
		// Local path + derived child.
		const derivationPath = generateAuctionDerivationPath()
		const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(params.p2pkXpub, derivationPath)

		// Fresh refund keypair (real crypto; only the lock target itself is fake).
		const refundPrivateKey = crypto.getRandomValues(new Uint8Array(32))
		const refundPubkeyBytes = getPublicKey(refundPrivateKey, true)
		const refundPubkey = bytesToHex(refundPubkeyBytes)

		const locktime = params.maxEndAt + params.settlementGraceSeconds

		// Synthesise the lock proofs. Split into the standard
		// power-of-2 denomination set to mirror what a real wallet
		// would produce, so the multi-proof tag path gets exercised
		// in dev.
		const denominations = splitIntoPowerOfTwoDenominations(params.amount)
		const lockSecrets: string[] = []
		const proofYs: string[] = []
		for (const denomination of denominations) {
			const secret = buildFakeP2PKSecret({
				childPubkey,
				locktime,
				refundPubkey,
				amount: denomination,
			})
			lockSecrets.push(secret)
			proofYs.push(hashToCurveHexFromString(secret))
		}

		// Publish kind-1023.
		const bidEvent = new NDKEvent(params.ndk)
		bidEvent.kind = 1023
		bidEvent.created_at = params.createdAt ?? Math.floor(Date.now() / 1000)
		bidEvent.content = JSON.stringify({
			type: 'auction_bid_v1',
			amount: params.amount,
			mint: params.mint,
			seed_synthetic: true,
		})
		bidEvent.tags = buildBidEventTags({
			auctionRootEventId: params.auctionEventId,
			auctionCoordinate: params.auctionCoordinates,
			sellerPubkey: params.sellerPubkey,
			amount: params.amount,
			mint: params.mint,
			locktime,
			refundPubkey,
			childPubkey,
			lockSecrets,
			proofYs,
			createdForEndAt: params.endAt,
			bidNonce: `seed-${faker.string.alphanumeric(16)}`,
		}) as NDKTag[]

		await bidEvent.sign(params.signer)
		await bidEvent.publish()
		console.log(`  ✓ Bid published: ${params.amount} sats by ${bidEvent.pubkey.slice(0, 8)}... (${denominations.length} synthetic proof(s))`)
		return true
	} catch (error) {
		console.error('[seed] createAuctionBidEvent failed:', error instanceof Error ? error.message : error)
		return false
	}
}

// ----------------------------------------------------------------------------
// Helpers for the synthetic lock builder
// ----------------------------------------------------------------------------

/**
 * Split `total` sats into the standard Cashu power-of-2 denomination
 * set (greedy from highest bit). e.g. 100 → [64, 32, 4]. This mirrors
 * what a real NIP-60 wallet would emit for a locked send, so the
 * multi-proof tag handling is exercised in dev.
 */
const splitIntoPowerOfTwoDenominations = (total: number): number[] => {
	const out: number[] = []
	let remaining = Math.floor(total)
	while (remaining > 0) {
		const next = 1 << Math.floor(Math.log2(remaining))
		out.push(next)
		remaining -= next
	}
	return out
}

/**
 * Build a well-formed NUT-10 P2PK secret string (JSON-encoded
 * `["P2PK", { ... }]`) suitable for embedding in a kind-1023 bid
 * event's `lock_secret` tag. The output is structurally identical to
 * what a real Cashu mint would attach to a P2PK-locked proof; the
 * only thing missing is the corresponding mint-signed `C` value,
 * which the seed flow doesn't produce because nothing in the dev UI
 * needs to redeem these proofs.
 */
const buildFakeP2PKSecret = (params: { childPubkey: string; locktime: number; refundPubkey: string; amount: number }): string => {
	// Random 32-byte nonce, hex-encoded — gives each fake proof a
	// distinct `Y` so multi-proof bids are properly disambiguated.
	const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
	return JSON.stringify([
		'P2PK',
		{
			nonce,
			data: params.childPubkey,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', String(params.locktime)],
				['refund', params.refundPubkey],
				['n_sigs_refund', '1'],
			],
		},
	])
}

const bytesToHex = (bytes: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
	return out
}
