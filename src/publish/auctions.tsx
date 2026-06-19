import {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_SETTLEMENT_KIND,
	AUCTION_SETTLEMENT_POLICY,
	getAuctionTagValue,
} from '@/lib/auctionSettlement'
import { AUCTION_MIN_DURATION_SECONDS, validateAuctionPublishInput } from '@/lib/auctionPublishValidation'
import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import { nip60Actions, type AuctionP2pkKeyScheme } from '@/lib/stores/nip60'
import type { ProductShippingSelectionInput } from '@/lib/utils/productShippingSelections'
import { getBidAmount, getBidStatus, markAuctionAsDeleted } from '@/queries/auctions'
import { generateAuctionDerivationPath } from '@/lib/auctionPathOracle'
import { deriveAuctionChildP2pkPubkeyFromXpub } from '@/lib/auctionP2pk'
import { hashToCurveHexFromString } from '@/lib/cashu/hashToCurve'
import { buildBidEventTags, buildPathReleaseTags } from '@/lib/auction/tagBuilders'
import { buildAuctionClaimPublicMarkerTags, createPrivateAuctionClaimMessageWithSigner } from '@/lib/auctions/privateAuctionClaimMessage'
import {
	findLatestBidderRecordForAuction,
	updateBidderRecordStatus,
	upsertBidderRecord,
	walkBidderRecordChain,
} from '@/lib/auction/bidderRecords'
import { AUCTION_PATH_RELEASE_KIND, type PathReleaseReason } from '@/lib/auction/constants'
import { getEncodedToken, type Proof } from '@cashu/cashu-ts'
import { getPublicKey } from '@noble/secp256k1'
import { auctionKeys, orderKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, NDKRelaySet, NDKUser, type NDKFilter, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'

export interface AuctionSpecEntry {
	key: string
	value: string
}

/**
 * Settlement grace presets (AUCTIONS.md §4.1). Seconds between
 * `max_end_at` and the bid's Cashu locktime — i.e. how long the seller
 * has to publish the kind-1024 settlement after bidding closes.
 */
export const AUCTION_SETTLEMENT_GRACE_PRESETS = {
	'5min': 300,
	'1h': 3600,
	'3h': 10800,
} as const
export type AuctionSettlementGracePreset = keyof typeof AUCTION_SETTLEMENT_GRACE_PRESETS

/**
 * Anti-snipe curve shapes (AUCTIONS.md §6.1). Controls how the bid
 * floor scales in `(end_at, max_end_at]`.
 */
export type AuctionMinBidCurveShape = 'none' | 'linear' | 'exponential'

/**
 * Peak-multiplier presets for the anti-snipe curve. Applied as
 * `floor = baseline × peak` at `t = max_end_at`. 1.0 is implicit when
 * `shape = 'none'`.
 */
export const AUCTION_MIN_BID_CURVE_PEAK_PRESETS = [2, 5, 10] as const
export type AuctionMinBidCurvePeakPreset = (typeof AUCTION_MIN_BID_CURVE_PEAK_PRESETS)[number]

/**
 * Anti-snipe window presets — minutes added to `end_at` to compute
 * `max_end_at`. Drives the duration of the curve. `0` disables the
 * window entirely (max_end_at = end_at, no curve regardless of shape).
 */
export const AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES = [0, 5, 15, 30] as const
export type AuctionAntiSnipeWindowMinutesPreset = (typeof AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES)[number]

export interface AuctionFormData {
	title: string
	summary: string
	description: string
	startingBid: string
	bidIncrement: string
	reserve?: string
	startAt?: string
	endAt: string
	/**
	 * Seconds added to `end_at` to compute `max_end_at`. Zero = no
	 * anti-snipe window. When zero the curve has zero duration and is
	 * effectively disabled regardless of `minBidCurveShape`.
	 */
	antiSnipeWindowMinutes: AuctionAntiSnipeWindowMinutesPreset
	/** Shape of the anti-snipe floor curve in the `(end_at, max_end_at]` window. */
	minBidCurveShape: AuctionMinBidCurveShape
	/** Floor multiplier applied at `t = max_end_at`. Only relevant when shape ≠ none. */
	minBidCurvePeakMultiplier: AuctionMinBidCurvePeakPreset
	/**
	 * Settlement grace preset — chosen as `5min`/`1h`/`3h` in the UI,
	 * mapped to seconds at publish time via
	 * `AUCTION_SETTLEMENT_GRACE_PRESETS[preset]`.
	 */
	settlementGracePreset: AuctionSettlementGracePreset
	mainCategory: string
	categories: string[]
	imageUrls: string[]
	specs: AuctionSpecEntry[]
	shippings: ProductShippingSelectionInput[]
	trustedMints: string[]
	isNSFW: boolean
	/**
	 * Pubkey of the validator (auditor) the seller wants listed on the
	 * auction's `auditors` tag. Empty string = "use the app's configured
	 * default" (resolved at publish time via `getAuctionAuditorsOrThrow`).
	 *
	 * Single value today; the kind-30408 event supports a multi-auditor
	 * list. The Phase 7 reputation UI is expected to grow this into a
	 * multi-select; for the demo a single pubkey is fine.
	 */
	auditorPubkey: string
}

export interface AuctionBidFormData {
	auctionEventId: string
	auctionCoordinates: string
	amount: number
	/**
	 * Auction `start_at` (unix seconds). Required so the publish path can
	 * refuse bids placed before the auction has officially opened. Without
	 * this gate, bids land on the relay with `created_at < start_at` and are
	 * silently rejected by the settlement filter — the seller and bidder both
	 * see "0 bids / starting price" while the events sit on the relay.
	 */
	auctionStartAt: number
	auctionEffectiveEndAt: number
	auctionLocktimeAt: number
	/**
	 * Per-auction settlement grace in seconds (the gap between max_end_at and
	 * the Cashu locktime). Read from the auction event's `settlement_grace`
	 * tag — see AUCTIONS.md §4.1. Authoritative at bid time; the locktime
	 * stamped into the proof is `auctionLocktimeAt + settlementGraceSeconds`.
	 */
	settlementGraceSeconds: number
	sellerPubkey: string
	p2pkXpub: string
	/**
	 * Ordered list of the auction's trusted mints (`mint` tags on
	 * kind 30408). The lock flow walks this list and picks the first
	 * one where the bidder's NIP-60 wallet has enough balance for the
	 * delta amount. Falls back to `DEFAULT_BID_MINT` only when the list
	 * is empty (legacy bid forms that didn't pass mints).
	 *
	 * Replaces the older `mint?: string` field which always picked
	 * the seller's first declared mint regardless of whether the
	 * bidder actually had any sats there.
	 */
	mintCandidates: string[]
}

// `AuctionPathGrantResponse`, `openAuctionPathOracleClient`,
// `requestAuctionPathGrant` — all removed. They belonged to the v1
// path-oracle scheme where a coordinator handed out paths over CVM.
// Under `cashu_p2pk_bidder_path_v1` the bidder generates the path
// locally; there's nothing to "request" from anyone. Phase 3 wires the
// new bid-creation flow into `publishAuctionBid` below.

export interface AuctionSettlementFormData {
	auctionEventId: string
	auctionCoordinates?: string
	/**
	 * Optional expected outcome. When omitted the backend computes it from the
	 * bids + reserve and the client publishes whatever it resolves to. Provide
	 * this only if the caller wants a safety assertion that their expectation
	 * matches reality — mismatch causes the backend to reject.
	 */
	status?: 'settled' | 'reserve_not_met'
	closeAt?: number
	winningBidEventId?: string
	winnerPubkey?: string
	finalAmount?: number
	reason?: string
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

/**
 * Resolve the auditor pubkey(s) to bake into a new auction's
 * `auditors` tag(s). Selection priority:
 *
 *   1. The seller's explicit choice from the form (`formData.auditorPubkey`).
 *      Validated as 32-byte hex.
 *   2. The app's configured default (`configStore.config.cvmServerPubkey`).
 *
 * Throws when neither is available — without an auditor the auction
 * has no validator emitting kind-30440 verdicts, which means clients
 * have nothing to filter or aggregate against.
 */
const getAuctionAuditorsOrThrow = (formAuditorPubkey?: string): string[] => {
	// Single auditor today; kind-30408 supports a list (multiple
	// `auditors` tags). Phase 7 (reputation UI) is expected to grow this
	// into a multi-select. Falls back to the app's configured validator
	// pubkey when the form field is empty, so dev/seed flows that don't
	// choose an auditor explicitly still get one.
	const explicit = formAuditorPubkey?.trim()
	if (explicit) {
		if (!HEX_PUBKEY_RE.test(explicit)) {
			throw new Error('Selected auditor pubkey is not a 32-byte hex Nostr pubkey.')
		}
		return [explicit]
	}
	const fallback = configStore.state.config.cvmServerPubkey?.trim()
	if (!fallback) {
		throw new Error('No auditor pubkey selected and no default auditor available. Wait for app config to load and try again.')
	}
	return [fallback]
}

/**
 * Wrap an error thrown from a specific step of the bid flow with a tag that
 * names the step. Makes the eventual toast unambiguous about whether the
 * rate limit / failure came from the mint, the issuer, or the relay.
 */
const tagBidError = (step: string, cause: unknown): Error => {
	const detail = cause instanceof Error ? cause.message : String(cause)
	const tagged = new Error(`[${step}] ${detail}`)
	if (cause instanceof Error && cause.stack) {
		tagged.stack = cause.stack
	}
	return tagged
}

export const createAuctionEvent = async (formData: AuctionFormData, signer: NDKSigner, ndk: NDK, auctionId?: string): Promise<NDKEvent> => {
	const validated = validateAuctionPublishInput(formData, { minDurationSeconds: AUCTION_MIN_DURATION_SECONDS })
	const event = new NDKEvent(ndk)
	event.kind = 30408
	event.content = validated.description

	const id = auctionId || `auction_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
	const startingBid = String(validated.startingBid)
	const bidIncrement = String(validated.bidIncrement)
	// Defensive `?? 0` even though `validated.reserve` is now non-optional.
	// `String(undefined)` produced `"undefined"` on the wire for auction
	// `1618640c…0881` on staging (kind-30408 tag). Belt-and-braces.
	const reserve = String(validated.reserve ?? 0)
	// AUCTIONS.md §6.0 — the three timestamps:
	//   end_at      → nominal close. Floor stays flat in [start_at, end_at].
	//   max_end_at  → hard bidding cutoff. Equals end_at + window_seconds
	//                 where window_seconds is the seller-chosen anti-snipe
	//                 window (or 0 → max_end_at = end_at, no curve).
	//   locktime    → max_end_at + settlement_grace, mint-enforced refund opens.
	//
	// `min_bid_curve` defines the floor ramp in `(end_at, max_end_at]`.
	// AUCTIONS.md §6.1 — replaces the legacy `extension_rule:anti_sniping:*`
	// scheme. Floor is monotonic over time; bidder UI displays the floor
	// at `client_now`, server enforces with a 5 s grace.
	const minBidCurveTagValue =
		formData.minBidCurveShape === 'none' ? 'none:1.0' : `${formData.minBidCurveShape}:${formData.minBidCurvePeakMultiplier}.0`
	const settlementGraceSeconds = AUCTION_SETTLEMENT_GRACE_PRESETS[formData.settlementGracePreset]
	const keyScheme: AuctionP2pkKeyScheme = 'hd_p2pk'
	// Validators auctions trust. One pubkey per `auditors` tag; the form
	// gives the seller a single field today and falls back to the app's
	// configured default. Phase 7 (reputation UI) will grow this into a
	// multi-select.
	const auditorsList = getAuctionAuditorsOrThrow(formData.auditorPubkey)
	const p2pkXpub = await nip60Actions.getAuctionP2pkXpub()

	const imageTags = validated.imageUrls.map((url, index) => ['image', url, '800x600', String(index)] as NDKTag)
	const categoryTags: NDKTag[] = []
	if (formData.mainCategory) {
		categoryTags.push(['t', formData.mainCategory] as NDKTag)
	}
	for (const category of formData.categories) {
		if (category && category.trim()) {
			categoryTags.push(['t', category.trim()] as NDKTag)
		}
	}

	const specTags: NDKTag[] = (formData.specs ?? [])
		.filter((spec) => spec && spec.key.trim() && spec.value.trim())
		.map((spec) => ['spec', spec.key.trim(), spec.value.trim()] as NDKTag)

	const shippingTags: NDKTag[] = validated.shippings.map((ship) =>
		ship.extraCost ? (['shipping_option', ship.shippingRef, ship.extraCost] as NDKTag) : (['shipping_option', ship.shippingRef] as NDKTag),
	)

	event.tags = [
		['d', id],
		['title', validated.title],
		...(validated.summary ? ([['summary', validated.summary] as NDKTag] as NDKTag[]) : []),
		['auction_type', 'english'],
		['start_at', String(validated.startAt)],
		['end_at', String(validated.endAt)],
		['currency', 'SAT'],
		['price', startingBid, 'SAT'],
		['starting_bid', startingBid, 'SAT'],
		['bid_increment', bidIncrement],
		['reserve', reserve],
		...validated.trustedMints.map((mint) => ['mint', mint] as NDKTag),
		// Bidder-held-path scheme: list one or more validator pubkeys whose
		// kind-30440 verdicts compliant clients consult to gate bid validity
		// for THIS auction. See AUCTIONS.md §4.1.
		...auditorsList.map((auditor) => ['auditors', auditor] as NDKTag),
		// Explicit values for the per-auction validator parameters.
		// Defaults match `DEFAULT_AUDITOR_QUORUM` / `DEFAULT_MAX_SKEW_SECONDS`
		// in src/lib/auction/constants.ts — emitting them explicitly
		// makes the auction round-trip cleanly through compliant
		// validators that strictly check tag presence.
		['auditor_quorum', String(auditorsList.length)],
		['max_skew_sec', '120'],
		['max_end_at', String(validated.maxEndAt)],
		['settlement_grace', String(settlementGraceSeconds)],
		['min_bid_curve', minBidCurveTagValue],
		['key_scheme', keyScheme],
		['p2pk_xpub', p2pkXpub],
		['settlement_policy', AUCTION_SETTLEMENT_POLICY],
		['schema', 'auction_v1'],
		...imageTags,
		...categoryTags,
		...specTags,
		...shippingTags,
		...(formData.isNSFW ? ([['content-warning', 'nsfw'] as NDKTag] as NDKTag[]) : []),
	]

	return event
}

export const publishAuction = async (formData: AuctionFormData, signer: NDKSigner, ndk: NDK, auctionId?: string): Promise<string> => {
	validateAuctionPublishInput(formData, { minDurationSeconds: AUCTION_MIN_DURATION_SECONDS })

	const event = await createAuctionEvent(formData, signer, ndk, auctionId)
	await event.sign(signer)
	await ndkActions.publishEvent(event)
	return event.id
}

export const usePublishAuctionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (formData: AuctionFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return publishAuction(formData, signer, ndk)
		},
		onSuccess: async () => {
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				userPubkey = user?.pubkey || ''
			}
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			if (userPubkey) {
				await queryClient.invalidateQueries({ queryKey: auctionKeys.byPubkey(userPubkey) })
			}
			toast.success('Auction published successfully')
		},
		onError: (error) => {
			console.error('Failed to publish auction:', error)
			toast.error(`Failed to publish auction: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

export const deleteAuction = async (auctionDTag: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	const deleteEvent = new NDKEvent(ndk)
	deleteEvent.kind = 5
	deleteEvent.content = 'Auction deleted'

	const pubkey = await signer.user().then((user) => user.pubkey)
	deleteEvent.tags = [['a', `30408:${pubkey}:${auctionDTag}`]]

	await deleteEvent.sign(signer)
	await ndkActions.publishEvent(deleteEvent)
	return true
}

export const useDeleteAuctionMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (auctionDTag: string) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return deleteAuction(auctionDTag, signer, ndk)
		},
		onSuccess: async (_success, auctionDTag) => {
			markAuctionAsDeleted(auctionDTag)

			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				userPubkey = user?.pubkey || ''
			}

			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			if (userPubkey) {
				await queryClient.invalidateQueries({ queryKey: auctionKeys.byPubkey(userPubkey) })
			}
			toast.success('Auction deleted successfully')
		},
		onError: (error) => {
			console.error('Failed to delete auction:', error)
			toast.error(`Failed to delete auction: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

const DEFAULT_BID_MINT = 'https://nofees.testnut.cashu.space'

const ACTIVE_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

const getFirstTagValue = getAuctionTagValue

const isSpentTokenError = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	return message.includes('already spent') || message.includes('token spent') || message.includes('proof not found')
}

const resolveLatestActiveBidByBidder = (bids: NDKEvent[], bidderPubkey: string): NDKEvent | null => {
	const bidderBids = bids.filter((bid) => bid.pubkey === bidderPubkey && ACTIVE_BID_STATUSES.has(getBidStatus(bid)))
	if (!bidderBids.length) return null

	return bidderBids.sort((a, b) => {
		const amountDelta = getBidAmount(b) - getBidAmount(a)
		if (amountDelta !== 0) return amountDelta
		const createdAtDelta = (b.created_at || 0) - (a.created_at || 0)
		if (createdAtDelta !== 0) return createdAtDelta
		return b.id.localeCompare(a.id)
	})[0]
}

/**
 * Publish a bidder-held-path bid (kind 1023) — AUCTIONS.md §4.2.
 *
 * Flow:
 *   1. Sanity-check the form + window (the bidder shouldn't sign a bid
 *      outside the auction window even though the validator would catch it).
 *   2. Generate a fresh high-entropy derivation path locally (§5.5).
 *   3. Compute `seller_child = derive(p2pk_xpub, path)`.
 *   4. Generate a fresh refund keypair (per-bid for privacy + isolation).
 *   5. Lock the Cashu bid via the NIP-60 wallet (1-of-1 P2PK to seller_child
 *      with refund timelock).
 *   6. Decode the locked token to extract each proof's `secret` (= lock_secret
 *      for the bid event) and compute `proof_y = hash_to_curve(secret)`.
 *   7. Publish kind-1023 with all (lock_secret, proof_y) pairs embedded.
 *   8. Persist a {path, refundPrivKey, fullProofs} record locally so we can
 *      (a) release the path at settlement, (b) refund via timelock if we
 *      grief or the seller never settles.
 *
 * Returns the published bid event id.
 */
export const publishAuctionBid = async (formData: AuctionBidFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	if (!formData.auctionEventId) throw new Error('Auction event id is required')
	if (!formData.auctionCoordinates) throw new Error('Auction coordinates are required')
	if (!formData.sellerPubkey) throw new Error('Seller pubkey is required')
	if (!formData.p2pkXpub) throw new Error('Auction p2pk_xpub is required for path derivation')
	if (!Number.isFinite(formData.amount) || formData.amount <= 0) throw new Error('Bid amount must be a positive number')
	if (!Number.isFinite(formData.auctionStartAt) || formData.auctionStartAt <= 0) {
		throw new Error('Auction start time is required for bidding')
	}
	if (!Number.isFinite(formData.auctionEffectiveEndAt) || formData.auctionEffectiveEndAt <= 0) {
		throw new Error('Auction effective end time is required for bidding')
	}
	if (!Number.isFinite(formData.auctionLocktimeAt) || formData.auctionLocktimeAt <= 0) {
		throw new Error('Auction locktime base is required')
	}
	if (!Number.isFinite(formData.settlementGraceSeconds) || formData.settlementGraceSeconds <= 0) {
		throw new Error('Auction is missing settlement_grace — refusing to lock without an authoritative grace period')
	}

	const now = Math.floor(Date.now() / 1000)
	if (now < formData.auctionStartAt) throw new Error('Auction has not started yet')
	if (now >= formData.auctionEffectiveEndAt) throw new Error('Auction already ended')
	if (now >= formData.auctionLocktimeAt) throw new Error('Auction has reached its hard bidding cutoff')

	const bidderUser = await signer.user()
	const bidderPubkey = bidderUser.pubkey

	// Step 1.5 — rebid detection. If this bidder already has a leg on
	// this auction, the new bid is a chain rebid: we lock ONLY the
	// delta `formData.amount - prev_leg.amount`, point at the prev leg
	// via `prev_bid`, and the seller will walk the chain on settle.
	// This keeps the bidder's total collateral equal to their latest
	// committed bid amount rather than the sum-of-all-rebids.
	//
	// AUCTIONS.md §4.2 — `prev_bid: previous bid event id from same
	// bidder (replacement chain)`. AUCTIONS.md §8 — seller "derives
	// every child privkey in the winner's chain, swaps each leg at the
	// mint" with a uniform locktime across legs.
	const prevLeg = findLatestBidderRecordForAuction(formData.auctionEventId)
	const prevLegAmount = prevLeg?.amount ?? 0
	if (prevLeg && formData.amount <= prevLeg.amount) {
		throw new Error(`Rebid (${formData.amount} sats) must exceed your previous bid on this auction (${prevLeg.amount} sats)`)
	}
	const legLockAmount = formData.amount - prevLegAmount
	if (legLockAmount <= 0) {
		throw new Error(`Computed lock amount must be positive (got ${legLockAmount})`)
	}

	// Step 2/3 — generate path + derive child pubkey locally. Fresh per
	// leg: each rebid gets its own path/child so refund branches don't
	// cluster across legs.
	const derivationPath = generateAuctionDerivationPath()
	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(formData.p2pkXpub, derivationPath)

	// Step 4 — fresh per-leg refund keypair. Privacy: refund branches
	// don't cluster. Isolation: a leaked refund key only affects this
	// one leg.
	const refundPrivateKeyBytes = crypto.getRandomValues(new Uint8Array(32))
	const refundPubkeyBytes = getPublicKey(refundPrivateKeyBytes, true)
	const refundPubkey = bytesToLowerHex(refundPubkeyBytes)
	const refundPrivateKey = bytesToLowerHex(refundPrivateKeyBytes)

	// Step 5 — lock at the mint. We lock the DELTA (`legLockAmount`),
	// not the full cumulative bid. The previous leg(s) stay locked at
	// their own pubkeys/locktime until settled or refunded — the chain
	// settles together, the delta is just this leg's contribution.
	//
	// Locktime invariant (AUCTIONS.md §6.0 / §8.1 line 1090): every
	// leg in a chain shares the same locktime — `max_end_at +
	// settlement_grace`. We compute it from the auction (not from the
	// previous leg) because both legs reference the same auction event.
	const locktime = formData.auctionLocktimeAt + formData.settlementGraceSeconds
	if (prevLeg && prevLeg.locktime !== locktime) {
		// Should be impossible (same auction → same max_end_at +
		// settlement_grace), but if the seller mutated the auction
		// event in between, locktimes can drift. Refuse rather than
		// emit a chain with non-uniform locktimes.
		throw new Error(
			`Locktime invariant broken: previous leg locktime=${prevLeg.locktime}, new leg locktime=${locktime}. Auction's max_end_at or settlement_grace was changed since the previous bid.`,
		)
	}
	const mintCandidates = formData.mintCandidates?.length ? formData.mintCandidates : []
	const lockResult = await nip60Actions.lockAuctionBidFunds({
		amount: legLockAmount,
		preferredMints: mintCandidates,
		locktime,
		refundPubkey,
		lockPubkey: childPubkey,
		auctionEventId: formData.auctionEventId,
		auctionCoordinates: formData.auctionCoordinates,
		sellerPubkey: formData.sellerPubkey,
		// Bidder-held-path scheme: no path issuer to record; supply the
		// path/child here so the wallet's pending-token diagnostics can
		// surface them for the bidder.
		derivationPath,
		childPubkey,
	})

	// Step 6 — extract lock_secret + proof_y directly from the locked
	// proofs. We pull `proofs` off the lock result rather than
	// decoding the encoded `token` because token decode fails on v2
	// short keyset IDs without a mint keyset map — see
	// AUCTIONS.md §5 history and `LockAuctionBidFundsResult.proofs`.
	const proofs = lockResult.proofs
	if (!proofs.length) throw new Error('Lock result contained no proofs')
	const lockSecrets = proofs.map((proof: Proof) => proof.secret)
	const proofYs = proofs.map((proof: Proof) => hashToCurveHexFromString(proof.secret))

	// Step 7 — publish kind-1023. `amount` is the cumulative bid value
	// (what the validator uses for the min-increment check); the lock
	// itself is only the delta. `prev_bid` chains the leg to the
	// previous one when this is a rebid.
	const bidNonce = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).toString()
	const bidEvent = new NDKEvent(ndk)
	bidEvent.kind = AUCTION_BID_KIND
	bidEvent.content = JSON.stringify({
		type: 'auction_bid_v1',
		amount: formData.amount,
		mint: lockResult.mintUrl,
		leg_locked: legLockAmount,
	})
	bidEvent.tags = buildBidEventTags({
		auctionRootEventId: formData.auctionEventId,
		auctionCoordinate: formData.auctionCoordinates,
		sellerPubkey: formData.sellerPubkey,
		amount: formData.amount,
		mint: lockResult.mintUrl,
		locktime,
		refundPubkey,
		childPubkey,
		lockSecrets,
		proofYs,
		createdForEndAt: formData.auctionEffectiveEndAt,
		bidNonce,
		prevBidId: prevLeg?.bidEventId,
	}) as NDKTag[]

	await bidEvent.sign(signer)
	await ndkActions.publishEvent(bidEvent)
	const updatedPendingToken = nip60Actions.updatePendingTokenContext(lockResult.tokenId, {
		kind: 'auction_bid',
		auctionEventId: formData.auctionEventId,
		auctionCoordinates: formData.auctionCoordinates,
		bidEventId: bidEvent.id,
		sellerPubkey: formData.sellerPubkey,
		pathIssuerPubkey: '',
		lockPubkey: lockResult.lockPubkey,
		refundPubkey: lockResult.refundPubkey,
		locktime: lockResult.locktime,
		derivationPath: lockResult.derivationPath,
		childPubkey: lockResult.childPubkey,
		grantId: lockResult.grantId,
	})
	if (!updatedPendingToken) {
		console.warn('[auctions] Published auction bid but could not attach bid event id to the local pending lock record')
	}

	// Step 8 — persist the bidder-side record. Loss of this record makes
	// settlement (and timelock refund) impossible for this bid, so we
	// write it after the lock succeeds but before returning so the
	// caller can't observe a "bid event but no record" state.
	upsertBidderRecord({
		bidEventId: bidEvent.id,
		auctionRootEventId: formData.auctionEventId,
		auctionCoordinate: formData.auctionCoordinates,
		sellerPubkey: formData.sellerPubkey,
		p2pkXpub: formData.p2pkXpub,
		derivationPath,
		childPubkey,
		refundPubkey,
		refundPrivateKey,
		mintUrl: lockResult.mintUrl,
		amount: formData.amount, // cumulative bid value
		legLockedAmount: lockResult.amount, // sats actually locked by this leg
		prevBidEventId: prevLeg?.bidEventId ?? null,
		locktime,
		proofs,
		lockSecrets,
		proofYs,
		createdAt: now,
		status: 'live',
	})

	void bidderPubkey
	return bidEvent.id
}

const bytesToLowerHex = (bytes: Uint8Array): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
	return out
}

// ============================================================================
// Phase 5 — Bidder kind-1025 path release (AUCTIONS.md §4.3.1)
// ============================================================================

export interface PublishBidderPathReleaseInput {
	/** kind-1023 bid event id this release applies to. */
	bidEventId: string
	/** Why we're releasing. Default 'settlement' (we won). */
	releaseReason?: PathReleaseReason
	/** Optional validator verdict event ids the bidder is responding to. */
	auditorRefs?: string[]
	/** Optional kind-1026 fallback offer this release accepts. */
	fallbackOfferId?: string
	/** Free-form human note for the event content. */
	note?: string
}

export interface PublishBidderPathReleaseResult {
	/**
	 * kind-1025 event id from the LATEST leg in the chain — the one the
	 * seller's kind-1024 will reference via `path_release`. For
	 * single-leg bids there's exactly one. For rebid chains the older
	 * legs' kind-1025s are also published but not returned here; query
	 * the relay to retrieve them.
	 */
	pathReleaseEventId: string
	/** Released path for the latest leg (diagnostics; do not display in UI). */
	derivationPath: string
	/** Number of kind-1025 events published in this call (= legs in chain). */
	legsReleased: number
	/** Cumulative bid value the chain represents. Sum of every leg's lock. */
	cumulativeBidAmount: number
}

/**
 * Bidder-side "settle" action — AUCTIONS.md §4.3.1.
 *
 * Publishes a kind-1025 path release for one of our own bids. The
 * seller can then derive `seller_child_privkey = derive(seller_xpriv,
 * path)` and redeem the locked proofs at the mint. After we publish:
 *   - validators observe the kind-1025, verify
 *     `derive(p2pk_xpub, path) == child_pubkey`, and flip the bid's
 *     verdict to `settled_promptly` (or `fraudulent_bid` if the
 *     derivation doesn't match, which would only happen if our local
 *     record is corrupted).
 *   - the seller's settlement client picks up the release and runs
 *     redemption.
 *
 * Pre-publish we verify the local record's `derive(p2pk_xpub, path) ==
 * child_pubkey` ourselves: if it doesn't match, the path or the
 * child_pubkey in storage is corrupted and publishing a kind-1025 would
 * only produce a `fraudulent_bid` on our own reputation. Failing fast
 * locally is the right call.
 *
 * Idempotency: if the record is already `settled`, returns the existing
 * kind-1025 isn't tracked — caller can re-publish if they want a fresh
 * event, but the typical path returns early without re-emitting.
 */
export const publishBidderPathRelease = async (
	input: PublishBidderPathReleaseInput,
	signer: NDKSigner,
	ndk: NDK,
): Promise<PublishBidderPathReleaseResult> => {
	if (!input.bidEventId) throw new Error('bidEventId is required')

	// Walk the rebid chain. For a single-leg bid this returns one
	// record. For a rebid chain, oldest→newest, every leg the bidder
	// locked. Each leg has its own derivation_path + cashu_token; the
	// seller redeems them all on settle.
	const chain = walkBidderRecordChain(input.bidEventId)
	if (chain.length === 0) {
		throw new Error(
			`No local bidder record for bid ${input.bidEventId}. The bidder client must hold the derivation path to settle; lost record = unsettleable.`,
		)
	}

	// Pre-publish sanity for every leg. If any leg's derivation is
	// corrupted, refuse the whole release — the seller would fail on
	// that leg and validators would mark the bid `fraudulent_bid`.
	// Better to surface the local-storage corruption than burn
	// reputation.
	for (const leg of chain) {
		const derivedChild = deriveAuctionChildP2pkPubkeyFromXpub(leg.p2pkXpub, leg.derivationPath)
		if (derivedChild.toLowerCase() !== leg.childPubkey.toLowerCase()) {
			throw new Error(
				`Refusing to publish chain release: leg ${leg.bidEventId.slice(0, 8)}… derive(p2pk_xpub, path) = ${derivedChild} does not match stored child_pubkey ${leg.childPubkey}. Local bidder record is corrupted.`,
			)
		}
	}

	const releaseReason: PathReleaseReason = input.releaseReason ?? 'settlement'

	let latestEventId = ''
	let latestDerivationPath = ''
	let cumulative = 0

	for (const leg of chain) {
		// Encode this leg's locked Cashu token so the seller can decode
		// + redeem. Proofs are P2PK-locked to derive(p2pk_xpub, path) —
		// only the seller (who holds `seller_xpriv`) can spend, so
		// publishing publicly is safe.
		let cashuToken: string
		try {
			if (!leg.proofs || leg.proofs.length === 0) {
				throw new Error(`leg ${leg.bidEventId.slice(0, 8)}… has no proofs in local record`)
			}
			cashuToken = getEncodedToken({ mint: leg.mintUrl, proofs: leg.proofs })
		} catch (err) {
			throw new Error(
				`Failed to encode Cashu token for leg ${leg.bidEventId.slice(0, 8)}…: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		const event = new NDKEvent(ndk)
		event.kind = AUCTION_PATH_RELEASE_KIND as unknown as number
		event.content = input.note ?? ''
		event.tags = buildPathReleaseTags({
			bidEventId: leg.bidEventId,
			auctionCoordinate: leg.auctionCoordinate,
			sellerPubkey: leg.sellerPubkey,
			derivationPath: leg.derivationPath,
			childPubkey: leg.childPubkey,
			releaseReason,
			// Only the latest leg carries auditorRefs / fallbackOfferId —
			// those reference verdicts/offers about the chain's current
			// state, not its history.
			auditorRefs: leg.bidEventId === input.bidEventId ? input.auditorRefs : undefined,
			fallbackOfferId: leg.bidEventId === input.bidEventId ? input.fallbackOfferId : undefined,
			cashuToken,
		}) as NDKTag[]

		await event.sign(signer)
		await ndkActions.publishEvent(event)

		updateBidderRecordStatus(leg.bidEventId, 'settled')

		latestEventId = event.id
		latestDerivationPath = leg.derivationPath
		cumulative += leg.legLockedAmount
	}

	return {
		pathReleaseEventId: latestEventId,
		derivationPath: latestDerivationPath,
		legsReleased: chain.length,
		cumulativeBidAmount: cumulative,
	}
}

export const usePublishAuctionBidMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (formData: AuctionBidFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return publishAuctionBid(formData, signer, ndk)
		},
		onSuccess: async (_eventId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.bids(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			toast.success('Bid submitted')
		},
		onError: (error) => {
			console.error('Failed to publish auction bid:', error)
			toast.error(`Failed to submit bid: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

// ============================================================================
// Phase 6 — Seller kind-1024 settlement (AUCTIONS.md §4.3.2 / §8.1)
// ============================================================================
//
// Flow (happy path):
//   1. Fetch the auction event (need p2pk_xpub, max_end_at, settlement_grace,
//      coordinate, root event id).
//   2. Fetch the bids on the auction; pick the winning bid (highest amount
//      in the valid window).
//   3. Fetch the kind-1025 path release for that winning bid. Refuse to
//      settle without one.
//   4. Verify derive(p2pk_xpub, release.derivation_path) === bid.child_pubkey;
//      mismatch means the bid was fraudulent (lock pubkey not actually a
//      child of the seller's xpub) — caller falls back to the next bid.
//   5. Derive seller_child_privkey via the wallet's HD account.
//   6. Decode the cashu_token from the path release; redeem at the mint
//      (NIP-60 wallet's receiveLockedEcash handles the swap into the
//      seller's wallet state).
//   7. Publish the kind-1024 settlement event with payout + path_release
//      refs.
//
// Non-happy paths the form can also drive (status override):
//   - 'reserve_not_met' — no redemption; just publish a kind-1024 noting
//     status and let losers self-refund at locktime.
//
// Fallback chains, cancellations, multi-validator quorum — all out of
// scope for the MVP. The UI's only settle button this milestone is "I
// won, here's the path / I have a path, redeem".

export const publishAuctionSettlement = async (formData: AuctionSettlementFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	if (!formData.auctionEventId) throw new Error('Auction event id is required')

	// Lazy imports to avoid pulling settlement-only deps into the bid
	// path's bundle.
	const [
		{ fetchAuction, fetchAuctionBids, fetchAuctionPathReleases, getBidAmount },
		auctionSettlementMod,
		settlementEventsMod,
		constantsMod,
	] = await Promise.all([
		import('@/queries/auctions'),
		import('@/lib/auctionSettlement'),
		import('@/lib/schemas/auction/settlementEvents'),
		import('@/lib/auction/constants'),
	])
	const { getAuctionTagValue: getTag, AUCTION_SETTLEMENT_KIND: kind1024 } = auctionSettlementMod
	const { parsePathReleaseEvent } = settlementEventsMod
	const { AUCTION_SETTLEMENT_POLICY: policyV1 } = constantsMod

	// 1. Auction event.
	const auctionEvent = await fetchAuction(formData.auctionEventId)
	if (!auctionEvent) throw new Error(`Auction ${formData.auctionEventId} not found on relay`)
	const sellerPubkey = auctionEvent.pubkey
	const signerUser = await signer.user()
	if (signerUser.pubkey !== sellerPubkey) {
		throw new Error('Only the auction seller can publish a kind-1024 settlement event')
	}
	const auctionDTag = getTag(auctionEvent, 'd')?.trim()
	const auctionCoordinate = formData.auctionCoordinates?.trim() || (auctionDTag ? `${30408}:${sellerPubkey}:${auctionDTag}` : '')
	if (!auctionCoordinate) {
		throw new Error('Auction coordinate is required to query kind-1025 path releases')
	}
	const auctionRootEventId = auctionEvent.id
	const p2pkXpub = getTag(auctionEvent, 'p2pk_xpub') ?? ''
	const declaredPolicy = getTag(auctionEvent, 'settlement_policy')
	if (declaredPolicy && declaredPolicy !== policyV1) {
		throw new Error(`Auction settlement_policy is ${declaredPolicy}; this client only handles ${policyV1}`)
	}

	const closeAt = Math.floor(Date.now() / 1000)

	// 2. Resolve `reserve_not_met` shortcut. No on-mint work for this path —
	// losers self-refund at locktime via their refund branch.
	if (formData.status === 'reserve_not_met') {
		const event = new NDKEvent(ndk)
		event.kind = AUCTION_SETTLEMENT_KIND
		event.content = ''
		event.tags = (await import('@/lib/auction/tagBuilders')).buildSettlementTags({
			auctionRootEventId,
			auctionCoordinate,
			status: 'reserve_not_met',
			closeAt,
			finalAmount: 0,
			reason: formData.reason ?? 'reserve_not_met',
		}) as NDKTag[]
		await event.sign(signer)
		await ndkActions.publishEvent(event)
		return event.id
	}

	// 3. Bids → winning bid.
	const bids = await fetchAuctionBids(formData.auctionEventId, 1000, auctionCoordinate)
	if (!bids.length) {
		throw new Error('No bids on this auction — nothing to settle. Use reserve_not_met to close it.')
	}
	let winningBid: NDKEvent | null = null
	if (formData.winningBidEventId) {
		winningBid = bids.find((b) => b.id === formData.winningBidEventId) ?? null
		if (!winningBid) throw new Error(`Winning bid ${formData.winningBidEventId} not found in fetched bids`)
	} else {
		winningBid = bids.reduce<NDKEvent | null>((best, bid) => {
			if (!best) return bid
			const delta = getBidAmount(bid) - getBidAmount(best)
			if (delta > 0) return bid
			if (delta < 0) return best
			return (bid.created_at ?? 0) < (best.created_at ?? 0) ? bid : best
		}, null)
	}
	if (!winningBid) throw new Error('Could not resolve winning bid')
	const winningBidId = winningBid.id
	const winnerPubkey = winningBid.pubkey
	const winningAmount = getBidAmount(winningBid)
	if (winningAmount <= 0) throw new Error('Winning bid amount must be positive')
	const childPubkeyFromBid = (getTag(winningBid, 'child_pubkey') ?? '').toLowerCase()
	const mintUrl = getTag(winningBid, 'mint') ?? ''
	if (!mintUrl) throw new Error('Winning bid is missing its `mint` tag — cannot redeem')

	// 4. Walk the rebid chain. The winning bid may be a rebid; if so it
	// has a `prev_bid` tag pointing at the previous leg, which in turn
	// may chain back further. Each leg is locked at its OWN
	// derivation_path with its OWN delta amount. To redeem the full
	// cumulative bid the seller must redeem every leg in the chain.
	//
	// AUCTIONS.md §8.1 line 1014: "derive every child privkey in the
	// winner's chain, swap each leg at the mint".
	const bidsById = new Map(bids.map((b) => [b.id, b]))
	const chainBids: NDKEvent[] = []
	const seenIds = new Set<string>()
	let cursor: string | undefined = winningBidId
	while (cursor) {
		if (seenIds.has(cursor)) throw new Error(`prev_bid cycle detected at ${cursor.slice(0, 8)}…`)
		seenIds.add(cursor)
		const leg = bidsById.get(cursor)
		if (!leg) throw new Error(`Chain leg ${cursor.slice(0, 8)}… not found in fetched bids; relay set incomplete?`)
		chainBids.unshift(leg) // oldest → newest
		cursor = getTag(leg, 'prev_bid') || undefined
	}
	if (chainBids.length === 0) throw new Error('Empty chain — should be impossible')

	// 5. Path releases — collect a kind-1025 for every leg. The bidder
	// publishes one per leg as part of `publishBidderPathRelease`.
	// Refuse to settle if any leg is missing its release: a partial
	// chain can't be redeemed and the seller would only end up with
	// some of the bid value.
	const allReleases = await fetchAuctionPathReleases(formData.auctionEventId, 500, auctionCoordinate)
	const releasesByBidId = new Map<string, NDKEvent[]>()
	for (const ev of allReleases) {
		const e = getTag(ev, 'e') ?? ''
		if (!e) continue
		const arr = releasesByBidId.get(e) ?? []
		arr.push(ev)
		releasesByBidId.set(e, arr)
	}

	interface ResolvedLeg {
		bid: NDKEvent
		releaseEventId: string
		derivationPath: string
		childPubkey: string
		mintUrl: string
		cashuToken: string
		legAmount: number // sats this leg specifically contributes (delta)
	}

	const resolvedLegs: ResolvedLeg[] = []
	let runningCumulative = 0
	for (const legBid of chainBids) {
		const legReleases = releasesByBidId.get(legBid.id) ?? []
		if (!legReleases.length) {
			throw new Error(
				`Chain leg ${legBid.id.slice(0, 8)}… (amount ${getBidAmount(legBid)} sats) has no kind-1025 path release. The bidder must publish a release for every leg in the chain.`,
			)
		}
		const latestRelease = legReleases.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
		const parsed = parsePathReleaseEvent(latestRelease)
		if (!parsed.ok) {
			throw new Error(`Path release for leg ${legBid.id.slice(0, 8)}… is malformed`)
		}
		const release = parsed.value
		if (release.bidderPubkey !== legBid.pubkey) {
			throw new Error(`Leg ${legBid.id.slice(0, 8)}… release was signed by a different pubkey than the bid`)
		}
		if (!release.cashuToken) {
			throw new Error(`Leg ${legBid.id.slice(0, 8)}… release carries no cashu_token — cannot redeem. Bidder must republish with proofs.`)
		}
		const legChildFromBid = (getTag(legBid, 'child_pubkey') ?? '').toLowerCase()
		const derivedChild = deriveAuctionChildP2pkPubkeyFromXpub(p2pkXpub, release.derivationPath).toLowerCase()
		if (derivedChild !== legChildFromBid) {
			throw new Error(
				`Leg ${legBid.id.slice(0, 8)}… release derives to ${derivedChild} but the bid was locked to ${legChildFromBid}. Fraudulent bid leg.`,
			)
		}
		if (derivedChild !== release.childPubkey.toLowerCase()) {
			throw new Error(`Leg ${legBid.id.slice(0, 8)}… release child_pubkey tag does not match locally-derived child pubkey`)
		}

		const legCumulative = getBidAmount(legBid)
		const legAmount = legCumulative - runningCumulative
		if (legAmount <= 0) {
			throw new Error(`Leg ${legBid.id.slice(0, 8)}… has non-positive delta (${legAmount}) — chain invariant broken`)
		}
		runningCumulative = legCumulative

		const legMint = getTag(legBid, 'mint') ?? ''
		if (!legMint) throw new Error(`Leg ${legBid.id.slice(0, 8)}… is missing its mint tag`)

		resolvedLegs.push({
			bid: legBid,
			releaseEventId: release.id,
			derivationPath: release.derivationPath,
			childPubkey: derivedChild,
			mintUrl: legMint,
			cashuToken: release.cashuToken,
			legAmount,
		})
	}

	if (runningCumulative !== winningAmount) {
		throw new Error(
			`Chain sum (${runningCumulative} sats) does not equal winning bid amount (${winningAmount} sats). Chain integrity broken.`,
		)
	}

	// 6. For each leg in the chain (oldest → newest): derive the
	// seller's child privkey from the auction xpriv + leg's path, then
	// receive the locked Cashu token. Order doesn't matter
	// cryptographically but processing oldest-first matches the order
	// the bidder locked them.
	const payouts: Array<{ bidEventId: string; amount: number; status: string }> = []
	for (const leg of resolvedLegs) {
		const childPrivkey = await nip60Actions.getAuctionHdChildPrivkey({
			derivationPath: leg.derivationPath,
			expectedPubkey: leg.childPubkey,
		})
		let redeemed = false
		try {
			// Pass leg.mintUrl explicitly so receiveLockedEcash skips the
			// `getDecodedToken(token)` step that fails on v2 short keyset IDs.
			redeemed = await nip60Actions.receiveLockedEcash(leg.cashuToken, childPrivkey, leg.mintUrl)
		} catch (err) {
			throw tagBidError(`settlement-receive-leg-${leg.bid.id.slice(0, 8)}`, err)
		}
		if (!redeemed) {
			throw new Error(`Cashu redemption did not complete for leg ${leg.bid.id.slice(0, 8)}…`)
		}
		payouts.push({ bidEventId: leg.bid.id, amount: leg.legAmount, status: 'redeemed' })
	}

	// 7. Publish kind-1024. `path_release` references the LATEST leg's
	// release (the one the bidder's "settle" button surfaced); the
	// chain history is reconstructible from the chain of bid events
	// via their prev_bid tags. `payouts` enumerates each leg the
	// seller actually redeemed.
	const latestLeg = resolvedLegs[resolvedLegs.length - 1]
	const event = new NDKEvent(ndk)
	event.kind = kind1024
	event.content = ''
	event.tags = (await import('@/lib/auction/tagBuilders')).buildSettlementTags({
		auctionRootEventId,
		auctionCoordinate,
		status: 'settled',
		closeAt,
		finalAmount: winningAmount,
		winningBidId,
		winnerPubkey,
		pathReleaseEventId: latestLeg.releaseEventId,
		payouts,
	}) as NDKTag[]
	await event.sign(signer)
	await ndkActions.publishEvent(event)
	return event.id
}

export const usePublishAuctionSettlementMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (formData: AuctionSettlementFormData) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')
			return publishAuctionSettlement(formData, signer, ndk)
		},
		onSuccess: async (_eventId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.bids(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.settlements(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.all })
			toast.success('Auction settlement published')
		},
		onError: (error) => {
			console.error('Failed to publish auction settlement:', error)
			toast.error(`Failed to publish settlement: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

// ---------------------------------------------------------------------------
// Auction Claim Order — winner submits shipping address after settlement
// ---------------------------------------------------------------------------

export interface AuctionClaimFormData {
	auctionEventId: string
	auctionCoordinates: string
	settlementEventId: string
	sellerPubkey: string
	finalAmount: number
	shippingAddress: {
		name: string
		firstLineOfAddress: string
		city: string
		zipPostcode: string
		country: string
		additionalInformation?: string
	}
	email?: string
	phone?: string
	notes?: string
}

/**
 * Creates a Kind 16 order event that references the won auction.
 * This is identical to a normal order creation but uses an `a` tag
 * pointing at the auction coordinate and an `e` tag pointing at the
 * settlement event instead of product `item` tags.
 */
export const publishAuctionClaimOrder = async (formData: AuctionClaimFormData): Promise<string> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No active user')

	const buyerPubkey = await resolveAuctionClaimBuyerPubkey(ndk, signer)
	const orderId = uuidv4()
	const claimFields = {
		orderId,
		auctionCoordinates: formData.auctionCoordinates,
		auctionEventId: formData.auctionEventId,
		settlementEventId: formData.settlementEventId,
		buyerPubkey,
		sellerPubkey: formData.sellerPubkey,
		totalAmountSats: formData.finalAmount,
		shippingAddress: formData.shippingAddress,
		email: formData.email,
		phone: formData.phone,
		notes: formData.notes,
	}

	const privateClaim = await createPrivateAuctionClaimMessageWithSigner({
		...claimFields,
		signer,
	})
	const privateEvent = new NDKEvent(ndk, privateClaim.giftWrap)
	const privateRelayUrls = await publishRequiredPrivateGiftWrap(privateEvent)

	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.content = ''
	event.tags = buildAuctionClaimPublicMarkerTags(claimFields) as NDKTag[]

	await event.sign(signer)
	await publishAuctionClaimMarkerToPrivateRelays(event, ndk, privateRelayUrls)

	return event.id
}

function publishResultHasRelayDetails(result: unknown): boolean {
	return result instanceof Set || Array.isArray(result) || (typeof result === 'object' && result !== null && 'size' in result)
}

function publishResultHasRelaySuccess(result: unknown): boolean {
	if (result instanceof Set) return result.size > 0
	if (Array.isArray(result)) return result.length > 0
	if (typeof result === 'object' && result !== null && 'size' in result && typeof (result as { size?: unknown }).size === 'number') {
		return (result as { size: number }).size > 0
	}
	return true
}

function publishResultAcceptedRelayUrls(result: unknown): string[] {
	const relays = result instanceof Set || Array.isArray(result) ? Array.from(result) : []
	const urls = relays
		.map((relay) =>
			typeof relay === 'object' && relay !== null && 'url' in relay && typeof (relay as { url?: unknown }).url === 'string'
				? (relay as { url: string }).url.trim()
				: '',
		)
		.filter((url) => url.length > 0)

	return [...new Set(urls)]
}

async function publishRequiredPrivateGiftWrap(event: NDKEvent): Promise<string[]> {
	const result = await ndkActions.publishEvent(event)
	if (publishResultHasRelayDetails(result) && !publishResultHasRelaySuccess(result)) {
		throw new Error('Encrypted auction claim details could not be published')
	}
	const acceptedRelayUrls = publishResultAcceptedRelayUrls(result)
	if (acceptedRelayUrls.length === 0) {
		throw new Error('Encrypted auction claim details were published but no accepted relay URLs were available')
	}
	return acceptedRelayUrls
}

async function publishAuctionClaimMarkerToPrivateRelays(event: NDKEvent, ndk: NDK, privateRelayUrls: string[]): Promise<void> {
	const markerRelaySet = NDKRelaySet.fromRelayUrls(privateRelayUrls, ndk)
	const result = await event.publish(markerRelaySet)
	if (!publishResultHasRelayDetails(result) || !publishResultHasRelaySuccess(result)) {
		throw new Error('Auction claim marker could not be published to the private claim relays')
	}
}

async function resolveAuctionClaimBuyerPubkey(ndk: NDK, signer: NDKSigner): Promise<string> {
	const user = await signer.user()
	const signerPubkey = user.pubkey
	if (!HEX_PUBKEY_RE.test(signerPubkey)) throw new Error('Active signer pubkey is not a 32-byte hex Nostr pubkey.')

	const activeUserPubkey = ndk.activeUser?.pubkey
	if (activeUserPubkey && activeUserPubkey !== signerPubkey) {
		throw new Error('Active user does not match active signer.')
	}

	return signerPubkey
}

export const usePublishAuctionClaimOrderMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	return useMutation({
		mutationFn: publishAuctionClaimOrder,
		onSuccess: async (_orderId, variables) => {
			await queryClient.invalidateQueries({ queryKey: auctionKeys.settlements(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: auctionKeys.details(variables.auctionEventId) })
			await queryClient.invalidateQueries({ queryKey: orderKeys.all })
			if (currentUserPubkey) {
				await queryClient.invalidateQueries({ queryKey: orderKeys.byBuyer(currentUserPubkey) })
				await queryClient.invalidateQueries({ queryKey: orderKeys.byPubkey(currentUserPubkey) })
			}
			toast.success('Shipping details submitted — the seller has been notified')
		},
		onError: (error) => {
			console.error('Failed to submit auction claim:', error)
			toast.error(`Failed to submit claim: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}
