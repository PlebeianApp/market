/**
 * Auction order fixture — a production-valid kind 30408 → 1023 → 30440 → 1025 →
 * 1024 event chain plus its claim order, built from the same tag builders the
 * app publishes with.
 *
 * This module is pure: it constructs and validates events, it never opens a
 * relay and never reads the e2e test config. It lives beside the auction code it
 * builds against so that both consumers can reach it in the right direction:
 * the e2e seeders (`e2e/scenarios/index.ts`) publish what it builds, and the
 * unit gate (`src/lib/__tests__/auctionOrderFixture.test.ts`) proves the built
 * chain survives the production parsers and cross-event validators, so the
 * fixture cannot silently rot into data no real client would publish.
 */

import { finalizeEvent, getPublicKey, type VerifiedEvent } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { getEncodedToken } from '@cashu/cashu-ts'
import { devUser1, devUser2, devUser3, XPUB } from '@/lib/fixtures'
import { AUCTION_CLAIM_SUBJECT } from '@/lib/auctions/privateAuctionClaimMessage'
import { v4 as uuidv4 } from 'uuid'
import { ORDER_MESSAGE_TYPE } from '@/lib/schemas/order'
import {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_PATH_RELEASE_KIND,
	AUCTION_SETTLEMENT_KIND,
	VALIDATOR_VERDICT_KIND,
} from '@/lib/auction/constants'
import {
	buildAuctionEventTags,
	buildBidEventTags,
	buildPathReleaseTags,
	buildSettlementTags,
	buildValidatorVerdictTags,
} from '@/lib/auction/tagBuilders'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'
import { hashToCurveHexFromString } from '@/lib/cashu/hashToCurve'
import { computeValidatedBids } from '@/lib/auction/bidValidation'
import { validatePathRelease, validateSettlementCompleteness } from '@/lib/auction/validation'
import { parseAuctionEvent } from '@/lib/schemas/auction/auctionEvent'
import { parseBidEvent } from '@/lib/schemas/auction/bidEvent'
import { parsePathReleaseEvent, parseSettlementEvent } from '@/lib/schemas/auction/settlementEvents'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'

// ============================================================================
// Auction order fixture (kind 30408 → 1023 → 30440 → 1025 → 1024 → claim order)
// ============================================================================

/**
 * The mint the seeded auction lists and the winning bid locks against. This is
 * the local nutshell mint the e2e harness starts (`e2e/start-local-mint.sh`,
 * `APP_DEV_TEST_MINT_URL`), so the seeded events reference a mint the app is
 * actually configured with — no external network egress.
 */
const E2E_AUCTION_MINT_URL = 'http://localhost:3338'

/** FakeWallet keyset id of the local mint; only used to shape a decodable token. */
const E2E_AUCTION_KEYSET_ID = '009a1f293253e41e'

/**
 * 5 non-hardened BIP-32 levels, matching AUCTION_PATH_HD_DEPTH (the path
 * entropy the protocol requires of a bidder-generated release path).
 */
const E2E_AUCTION_DERIVATION_PATH = 'm/0/1/2/3/4'

const E2E_AUCTION_SETTLEMENT_GRACE_SECONDS = 3600
/** The seeded auction closed half an hour before the fixture is built. */
const E2E_AUCTION_CLOSED_SECONDS_AGO = 1800
const E2E_AUCTION_OPENED_SECONDS_AGO = 7200
const E2E_AUCTION_RESERVE_SATS = 1000
const E2E_AUCTION_STARTING_BID_SATS = 1000
const E2E_AUCTION_WINNING_BID_SATS = 1500

export interface AuctionOrderFixture {
	/** kind-30408 auction listing, seller-signed, canonical (first) publish. */
	auctionEvent: VerifiedEvent
	/** kind-1023 winning bid, bidder-signed, real lock over a derived P2PK child key. */
	bidEvent: VerifiedEvent
	/** kind-30440 auditor verdict confirming the winning bid (`auditor_quorum` = 1). */
	verdictEvent: VerifiedEvent
	/** kind-1025 path release for the winning bid, carrying the locked proofs as a cashu token. */
	pathReleaseEvent: VerifiedEvent
	/** kind-1024 settled settlement, seller-signed. */
	settlementEvent: VerifiedEvent
	/** Addressable coordinate `30408:<seller>:<d>` used as the order's `item`/`a` value. */
	itemTagValue: string
	/** Settlement amount in sats — the buyer's claim order must declare the same amount. */
	amount: number
	/** The unix-second `now` the chain was built against (validation clock). */
	now: number
}

const compressedPubkeyFromSecretKey = (secretKeyHex: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(secretKeyHex), true))

/**
 * Build the NUT-10/NUT-11 P2PK well-known secret a bidder locks a bid's proofs
 * with under `cashu_p2pk_bidder_path_v1` (§5.3): single child pubkey, single
 * refund key, `n_sigs = n_sigs_refund = 1`, `SIG_INPUTS`, mandatory locktime.
 */
const buildAuctionLockSecret = (input: { childPubkey: string; refundPubkey: string; locktime: number; nonce: string }): string =>
	JSON.stringify([
		'P2PK',
		{
			nonce: input.nonce,
			data: input.childPubkey,
			tags: [
				['sigflag', 'SIG_INPUTS'],
				['locktime', String(input.locktime)],
				['refund', input.refundPubkey],
				['n_sigs', '1'],
				['n_sigs_refund', '1'],
			],
		},
	])

/**
 * Build the full, production-valid auction chain behind an auction order:
 * a *closed* kind-30408 listing, a real kind-1023 winning bid locked to a
 * derived seller child key, the auditor kind-30440 confirmation that makes the
 * bid the canonical winner, the winner's kind-1025 path release (referencing
 * the real bid event id and carrying the locked proofs), and the seller's
 * settled kind-1024 settlement (`close_at` after `max_end_at`, `final_amount`
 * >= `reserve`, payout for the winning leg).
 *
 * Every event is signed locally (deterministic ids, no relay, no mint, no
 * network) and is shaped by the same tag builders production publishes with, so
 * the app's own parsers/validators (`parseAuctionEvent`, `parseBidEvent`,
 * `parseValidatorVerdictEvent`, `parsePathReleaseEvent`, `parseSettlementEvent`,
 * `validateBid`, `validatePathRelease`, `validateSettlementCompleteness`,
 * `computeValidatedBids`) accept the result. See
 * `e2e/scenarios/auctionOrderFixture.test.ts` for that cross-validation.
 */
export function buildAuctionOrderFixture(input: { now: number; title?: string; description?: string }): AuctionOrderFixture {
	const { now } = input
	const title = input.title ?? 'Test Auction'

	const startAt = now - E2E_AUCTION_OPENED_SECONDS_AGO
	const endAt = now - E2E_AUCTION_CLOSED_SECONDS_AGO
	// No anti-snipe extension: the auction closes at end_at/max_end_at.
	const maxEndAt = endAt
	const settlementGrace = E2E_AUCTION_SETTLEMENT_GRACE_SECONDS
	const reserve = E2E_AUCTION_RESERVE_SATS
	const amount = E2E_AUCTION_WINNING_BID_SATS
	const locktime = maxEndAt + settlementGrace

	const auctionId = `auc_${now}_${uuidv4().slice(0, 8)}`
	const auctionTags = buildAuctionEventTags({
		dTag: auctionId,
		title,
		startAt,
		endAt,
		maxEndAt,
		settlementGrace,
		reserve,
		startingBid: E2E_AUCTION_STARTING_BID_SATS,
		bidIncrement: 100,
		mints: [E2E_AUCTION_MINT_URL],
		p2pkXpub: XPUB,
		auditors: [devUser3.pk],
		auditorQuorum: 1,
		minBidCurve: { shape: 'none', peakMultiplier: 1, raw: '' },
		summary: 'E2E test auction',
		categories: ['bitcoin'],
	})
	// Display-only tag the auction surfaces use for pricing cards.
	auctionTags.push(['price', String(amount), 'SAT'])

	const auctionEvent = finalizeEvent(
		{
			kind: AUCTION_KIND,
			created_at: startAt,
			content: input.description ?? 'E2E test auction description.',
			tags: auctionTags,
		},
		hexToBytes(devUser1.sk),
	)

	const itemTagValue = `${AUCTION_KIND}:${auctionEvent.pubkey}:${auctionId}`
	const bidderPubkey = getPublicKey(hexToBytes(devUser2.sk))
	const refundPubkey = compressedPubkeyFromSecretKey(devUser2.sk)
	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(XPUB, E2E_AUCTION_DERIVATION_PATH)
	const lockSecret = buildAuctionLockSecret({ childPubkey, refundPubkey, locktime, nonce: uuidv4() })
	const proofY = hashToCurveHexFromString(lockSecret)

	const bidEvent = finalizeEvent(
		{
			kind: AUCTION_BID_KIND,
			created_at: maxEndAt - 60,
			content: 'E2E winning bid',
			tags: buildBidEventTags({
				auctionRootEventId: auctionEvent.id,
				auctionCoordinate: itemTagValue,
				sellerPubkey: auctionEvent.pubkey,
				amount,
				mint: E2E_AUCTION_MINT_URL,
				locktime,
				refundPubkey,
				childPubkey,
				lockSecrets: [lockSecret],
				proofYs: [proofY],
				createdForEndAt: endAt,
				bidNonce: uuidv4(),
			}),
		},
		hexToBytes(devUser2.sk),
	)

	const verdictEvent = finalizeEvent(
		{
			kind: VALIDATOR_VERDICT_KIND,
			created_at: bidEvent.created_at + 30,
			content: 'E2E auditor confirmation',
			tags: buildValidatorVerdictTags({
				bidderPubkey,
				auctionRootEventId: auctionEvent.id,
				auctionCoordinate: itemTagValue,
				bidEventId: bidEvent.id,
				claim: 'won_pending_settlement',
				observedAt: bidEvent.created_at,
			}),
		},
		hexToBytes(devUser3.sk),
	)

	// The locked proofs as a redeemable cashu token. The proofs are P2PK-locked
	// to derive(p2pk_xpub, path), so publishing the token grants spend authority
	// to nobody but the seller. `C` is the bidder's own (valid) compressed key —
	// the e2e harness never spends this, so no live mint is involved.
	const cashuToken = getEncodedToken({
		mint: E2E_AUCTION_MINT_URL,
		proofs: [{ id: E2E_AUCTION_KEYSET_ID, amount, secret: lockSecret, C: refundPubkey }],
	})

	const pathReleaseEvent = finalizeEvent(
		{
			kind: AUCTION_PATH_RELEASE_KIND,
			created_at: maxEndAt + 60,
			content: '',
			tags: buildPathReleaseTags({
				bidEventId: bidEvent.id,
				auctionCoordinate: itemTagValue,
				sellerPubkey: auctionEvent.pubkey,
				derivationPath: E2E_AUCTION_DERIVATION_PATH,
				childPubkey,
				releaseReason: 'settlement',
				cashuToken,
			}),
		},
		hexToBytes(devUser2.sk),
	)

	const settlementEvent = finalizeEvent(
		{
			kind: AUCTION_SETTLEMENT_KIND,
			created_at: maxEndAt + 120,
			content: '',
			tags: buildSettlementTags({
				auctionRootEventId: auctionEvent.id,
				auctionCoordinate: itemTagValue,
				status: 'settled',
				closeAt: maxEndAt + 60,
				finalAmount: amount,
				winningBidId: bidEvent.id,
				winnerPubkey: bidderPubkey,
				pathReleaseEventId: pathReleaseEvent.id,
				payouts: [{ bidEventId: bidEvent.id, amount, status: 'redeemed' }],
			}),
		},
		hexToBytes(devUser1.sk),
	)

	const fixture: AuctionOrderFixture = {
		auctionEvent,
		bidEvent,
		verdictEvent,
		pathReleaseEvent,
		settlementEvent,
		itemTagValue,
		amount,
		now,
	}

	// Publish-time gate: a fixture that cannot pass the SAME parsers and
	// cross-event validators production runs must never reach the relay.
	// Green E2E on impossible relay data proves nothing, so this throws
	// instead of seeding an impossible auction.
	assertAuctionOrderFixtureValid(fixture)

	return fixture
}

/**
 * Canonical auction-claim ORDER tags for the seeded auction chain.
 *
 * Mirrors the production public marker builder
 * (`buildAuctionClaimPublicMarkerTags` in
 * `@/lib/auctions/privateAuctionClaimMessage`) so the seeded order parses
 * through `getAuctionClaimPublicMarkerFields()` and validates as the canonical
 * claim order for {@link buildAuctionOrderFixture}'s settlement:
 *
 *   - `subject: 'auction-claim'` (the marker discriminator),
 *   - `a` = the kind-30408 coordinate, `p` = the seller,
 *   - `e <auction root>` (no marker) and `e <settlement id> '' 'settlement'`,
 *   - `amount` = the settlement's final amount.
 *
 * The `item` tag is kept alongside because the order surfaces render the item
 * title from it; it plays no part in the marker.
 */
export function buildAuctionClaimOrderTags(fixture: AuctionOrderFixture, orderId: string): string[][] {
	return [
		['p', fixture.auctionEvent.pubkey],
		['subject', AUCTION_CLAIM_SUBJECT],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', orderId],
		['amount', String(fixture.amount)],
		['item', fixture.itemTagValue, '1'],
		['a', fixture.itemTagValue],
		['e', fixture.auctionEvent.id],
		['e', fixture.settlementEvent.id, '', 'settlement'],
	]
}

/**
 * Cross-event validation gate for {@link buildAuctionOrderFixture}.
 *
 * Runs every seeded event through the production parsers, then through the
 * production cross-event validators:
 *
 *   - `computeValidatedBids` — auditor quorum makes the seeded bid the
 *     canonical winner,
 *   - `validatePathRelease` — the kind-1025 release is a valid winner release
 *     for that bid (derivation path / child pubkey / release timing),
 *   - `validateSettlementCompleteness` — the kind-1024 settled event is
 *     complete for the winning bid chain (matching payout, close_at after
 *     `max_end_at`, `final_amount` >= reserve).
 *
 * Throws on the first violation, so `buildAuctionOrderFixture` can never seed
 * an auction whose events a real client would never have published.
 */
export function assertAuctionOrderFixtureValid(fixture: AuctionOrderFixture): void {
	const parsed = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }, label: string): T => {
		if (!result.ok) throw new Error(`auction order fixture: ${label} does not parse — ${result.error.message}`)
		return result.value
	}

	const auction = parsed(parseAuctionEvent(fixture.auctionEvent), 'kind-30408 listing')
	const bid = parsed(parseBidEvent(fixture.bidEvent), 'kind-1023 winning bid')
	const verdict = parsed(parseValidatorVerdictEvent(fixture.verdictEvent), 'kind-30440 auditor verdict')
	const pathRelease = parsed(parsePathReleaseEvent(fixture.pathReleaseEvent), 'kind-1025 path release')
	const settlement = parsed(parseSettlementEvent(fixture.settlementEvent), 'kind-1024 settlement')

	if (auction.endAt >= fixture.now) {
		throw new Error(
			`auction order fixture: auction is still open (end_at=${auction.endAt} >= now=${fixture.now}); a settlement cannot exist for an open auction`,
		)
	}
	if (auction.reserve == null || auction.reserve <= 0) {
		throw new Error('auction order fixture: auction has no positive reserve')
	}
	if (settlement.finalAmount < auction.reserve) {
		throw new Error(`auction order fixture: settlement final_amount ${settlement.finalAmount} is below the reserve ${auction.reserve}`)
	}

	const quorum = computeValidatedBids({
		auction,
		bids: [bid],
		verdicts: [verdict],
		postSettlement: true,
		settledBidIds: new Set([bid.id]),
	})
	if (quorum.canonicalWinner?.id !== bid.id) {
		throw new Error(`auction order fixture: auditor quorum does not confirm ${bid.id} as the canonical winning bid`)
	}

	const releaseValidity = validatePathRelease({
		auction,
		bid,
		release: pathRelease,
		now: fixture.now,
		postCloseDecision: 'winner',
		// Token decoding needs mint keysets the fixture deliberately does not
		// fetch; production validators also skip it (it is the seller's
		// redemption-time check).
		skipCashuTokenCheck: true,
	})
	if (!releaseValidity.isValid) {
		throw new Error(`auction order fixture: kind-1025 path release is invalid (${releaseValidity.failureCode}) — ${releaseValidity.detail}`)
	}

	const completeness = validateSettlementCompleteness({
		auction,
		settlement,
		winningBid: bid,
		pathRelease,
		winningBidClaim: verdict.claim,
		winningBidPostCloseDecision: 'winner',
		// A settled settlement by definition follows the seller's redemption;
		// the fixture declares its payout as redeemed.
		winningBidNut7State: 'spent',
	})
	if (!completeness.isComplete) {
		throw new Error(`auction order fixture: kind-1024 settlement is not complete (${completeness.failureCode}) — ${completeness.detail}`)
	}
}
