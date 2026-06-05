import { AUCTION_BID_KIND, AUCTION_KIND, AUCTION_SETTLEMENT_KIND, AUCTION_SETTLEMENT_POLICY, getAuctionTagValue } from '@/lib/auctionSettlement'
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
import { buildBidEventTags } from '@/lib/auction/tagBuilders'
import { upsertBidderRecord } from '@/lib/auction/bidderRecords'
import type { Proof } from '@cashu/cashu-ts'
import { getPublicKey } from '@noble/secp256k1'
import { auctionKeys, orderKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, NDKUser, type NDKFilter, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
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
	 * Pubkey of the path-oracle the seller wants to use for this auction.
	 * Empty string = "use the app's configured default" (resolved at
	 * publish time via `getAuctionPathIssuerPubkeyOrThrow`). The form's
	 * oracle picker writes a non-empty value once the seller has chosen a
	 * specific announcement from the CEP-15 directory.
	 */
	pathIssuerPubkey: string
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
	/**
	 * Nostr pubkey of the auction's path issuer (the oracle). The bidder
	 * requests a derivation-path grant from this pubkey before locking funds.
	 */
	pathIssuerPubkey: string
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
 * Resolve the path-oracle pubkey to bake into a new auction's
 * `path_issuer` tag. Selection priority:
 *
 *   1. The seller's explicit choice from the form's CEP-15 oracle
 *      picker (`formData.pathIssuerPubkey`). Validated as 32-byte hex.
 *   2. The app's configured default (`configStore.config.cvmServerPubkey`).
 *
 * Throws when neither is available — the form is supposed to have
 * pre-selected the default before submit, so reaching this branch
 * usually means the app's `/api/config` hasn't loaded yet.
 */
const getAuctionAuditorsOrThrow = (formAuditorPubkey?: string): string[] => {
	// In the v1 path-oracle scheme this resolved a single `path_issuer`.
	// Under `cashu_p2pk_bidder_path_v1` the auction lists `auditors`
	// (validators whose verdicts the seller trusts). Until the form UI
	// is updated to multi-select (Phase 7), we promote the
	// single-pubkey field to a one-element auditors list. Falls back to
	// the app's CVM server pubkey when the field is empty, so dev/seed
	// flows that don't choose an auditor explicitly still get one.
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
	// Validators auctions trust. Sourced from the same form field that used
	// to carry `path_issuer` (kept as `pathIssuerPubkey` during the
	// migration so UI components don't have to change in lockstep) plus
	// the cvm server pubkey as a default until the form is updated to
	// select multiple validators. Phase 7 (reputation UI) will replace
	// the single field with a multi-select.
	const auditorsList = getAuctionAuditorsOrThrow(formData.pathIssuerPubkey)
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

	// Step 2/3 — generate path + derive child pubkey locally.
	const derivationPath = generateAuctionDerivationPath()
	const childPubkey = deriveAuctionChildP2pkPubkeyFromXpub(formData.p2pkXpub, derivationPath)

	// Step 4 — fresh per-bid refund keypair. Privacy: refund branches
	// don't cluster across the bidder's bids. Isolation: a leaked refund
	// key only affects one bid.
	const refundPrivateKeyBytes = crypto.getRandomValues(new Uint8Array(32))
	const refundPubkeyBytes = getPublicKey(refundPrivateKeyBytes, true)
	const refundPubkey = bytesToLowerHex(refundPubkeyBytes)
	const refundPrivateKey = bytesToLowerHex(refundPrivateKeyBytes)

	// Step 5 — lock at the mint. `lockAuctionBidFunds` does the mint
	// swap + writes the locked proofs into the wallet's pending state.
	// The auctionEventId / sellerPubkey arguments below are advisory
	// (used for diagnostic context tagging in the wallet's pending-token
	// record).
	const locktime = formData.auctionLocktimeAt + formData.settlementGraceSeconds
	const mintCandidates = formData.mintCandidates?.length ? formData.mintCandidates : []
	const lockResult = await nip60Actions.lockAuctionBidFunds({
		amount: formData.amount,
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

	// Step 7 — publish kind-1023 with the new tag set (AUCTIONS.md §4.2).
	const bidNonce = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).toString()
	const bidEvent = new NDKEvent(ndk)
	bidEvent.kind = AUCTION_BID_KIND
	bidEvent.content = JSON.stringify({
		type: 'auction_bid_v1',
		amount: formData.amount,
		mint: lockResult.mintUrl,
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
	}) as NDKTag[]

	await bidEvent.sign(signer)
	await ndkActions.publishEvent(bidEvent)

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
		amount: lockResult.amount,
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

export const publishAuctionSettlement = async (formData: AuctionSettlementFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	throw new Error("publishAuctionSettlement: not implemented — Phase 6 of the bidder-held-path migration will reimplement this. Seller settlement now reads a kind-1025 from the winner, derives via auctionP2pk, swaps on-mint, then publishes kind-1024. See AUCTIONS.md §8.")
	void formData; void signer; void ndk
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

	const orderId = uuidv4()

	const addressParts = [
		formData.shippingAddress.name,
		formData.shippingAddress.firstLineOfAddress,
		formData.shippingAddress.additionalInformation,
		formData.shippingAddress.city,
		formData.shippingAddress.zipPostcode,
		formData.shippingAddress.country,
	].filter(Boolean)

	const tags: NDKTag[] = [
		['p', formData.sellerPubkey],
		['subject', `Auction claim for ${formData.auctionEventId.substring(0, 8)}`],
		['type', ORDER_MESSAGE_TYPE.ORDER_CREATION],
		['order', orderId],
		['amount', String(formData.finalAmount)],
		// Link to auction & settlement
		['a', formData.auctionCoordinates],
		['e', formData.auctionEventId],
		['e', formData.settlementEventId, '', 'settlement'],
		['address', addressParts.join('\n')],
	]

	if (formData.email) tags.push(['email', formData.email])
	if (formData.phone) tags.push(['phone', formData.phone])
	if (formData.notes) tags.push(['notes', formData.notes])

	const event = new NDKEvent(ndk)
	event.kind = ORDER_PROCESS_KIND
	event.content = formData.notes || 'Auction win — shipping details enclosed'
	event.tags = tags

	await event.sign(signer)
	await ndkActions.publishEvent(event)

	return event.id
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
