import { preflightAuctionSettlementP2pk } from '@/lib/auctionSettlementP2pk'
import {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_SETTLEMENT_KIND,
	AUCTION_SETTLEMENT_POLICY,
	getAuctionTagValue,
	type AuctionSettlementPublishStatus,
} from '@/lib/auctionSettlement'
import { AUCTION_MIN_DURATION_SECONDS, validateAuctionPublishInput } from '@/lib/auctionPublishValidation'
import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@/lib/schemas/order'
import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import { PlebeianAuctionClient, type RequestPathOutput, type RequestSettlementOutput } from '@/lib/ctxcn-clients/PlebeianAuctionClient'
import { nip60Actions, type AuctionP2pkKeyScheme } from '@/lib/stores/nip60'
import type { ProductShippingSelectionInput } from '@/lib/utils/productShippingSelections'
import { verifyAuctionPathGrant } from '@/lib/auctionP2pk'
import { rememberAuctionPathGrant } from '@/lib/auctionPathOracle'
import { getBidAmount, getBidStatus, markAuctionAsDeleted } from '@/queries/auctions'
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

export interface AuctionPathGrantResponse {
	grantId: string
	requestId: string
	auctionEventId: string
	auctionCoordinates: string
	bidderPubkey: string
	pathIssuerPubkey: string
	xpub: string
	derivationPath: string
	childPubkey: string
	issuedAt: number
	expiresAt: number
}

/**
 * Open the browser-safe ContextVM client for the auction path-oracle
 * tools. We can't use the ctxcn-generated `PlebeianServerClient` here
 * because `@contextvm/sdk`'s pino logger calls `pino.destination()` at
 * module init — Node-only. The seed scripts (Bun runtime) keep using the
 * generated client; the React app uses this hand-rolled equivalent.
 *
 * Wire format is identical (kind-1059 gift-wrap of kind-25910 inner with
 * NIP-44 to the facilitator pubkey). Caller MUST `client.disconnect()`
 * once the bid flow completes.
 */
const openAuctionPathOracleClient = (params: { pathIssuerPubkey: string; relays: string[] }): PlebeianAuctionClient => {
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No signer available — sign in to bid')
	if (!ndk) throw new Error('NDK is not initialised')
	return new PlebeianAuctionClient({
		signer,
		ndk,
		relays: params.relays,
		serverPubkey: params.pathIssuerPubkey,
	})
}

const getAuctionClientRelays = (): string[] => {
	const appRelay = configStore.state.config.appRelay
	if (!appRelay) throw new Error('App relay URL is unavailable. Wait for app config to load and try again.')
	return [appRelay]
}

export const requestAuctionPathGrant = async (params: {
	auctionEventId: string
	auctionCoordinates: string
	bidderPubkey: string
	bidderRefundPubkey: string
	intendedAmount: number
	expectedPathIssuer: string
	expectedXpub: string
}): Promise<AuctionPathGrantResponse> => {
	const client = openAuctionPathOracleClient({
		pathIssuerPubkey: params.expectedPathIssuer,
		relays: getAuctionClientRelays(),
	})
	let grant: RequestPathOutput
	try {
		grant = await client.RequestPath(params.auctionEventId, params.auctionCoordinates, params.bidderRefundPubkey, params.intendedAmount)
	} finally {
		await client.disconnect()
	}
	if (grant.pathIssuerPubkey !== params.expectedPathIssuer) {
		throw new Error('Path issuer pubkey mismatch — server identity does not match auction path_issuer')
	}
	verifyAuctionPathGrant({
		xpub: grant.xpub,
		derivationPath: grant.derivationPath,
		childPubkey: grant.childPubkey,
		expectedXpub: params.expectedXpub,
		expectedIssuer: params.expectedPathIssuer,
		grantIssuer: grant.pathIssuerPubkey,
	})
	const responseGrant: AuctionPathGrantResponse = {
		grantId: grant.grantId,
		// `requestId` was the HTTP-era field; the new transport doesn't
		// echo it. Synthesise one for the local registry receipt so the
		// `rememberAuctionPathGrant` shape stays unchanged.
		requestId: grant.grantId,
		auctionEventId: params.auctionEventId,
		auctionCoordinates: params.auctionCoordinates,
		bidderPubkey: params.bidderPubkey,
		pathIssuerPubkey: grant.pathIssuerPubkey,
		xpub: grant.xpub,
		derivationPath: grant.derivationPath,
		childPubkey: grant.childPubkey,
		issuedAt: grant.issuedAt,
		expiresAt: grant.expiresAt,
	}
	rememberAuctionPathGrant({
		...responseGrant,
		status: 'issued',
	})
	return responseGrant
}

export interface AuctionSettlementFormData {
	auctionEventId: string
	auctionCoordinates?: string
	/**
	 * Optional expected outcome. When omitted the backend computes it from the
	 * bids + reserve and the client publishes whatever it resolves to. Provide
	 * this only if the caller wants a safety assertion that their expectation
	 * matches reality — mismatch causes the backend to reject.
	 */
	status?: AuctionSettlementPublishStatus
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
const getAuctionPathIssuerPubkeyOrThrow = (formPathIssuerPubkey?: string): string => {
	const explicit = formPathIssuerPubkey?.trim()
	if (explicit) {
		if (!HEX_PUBKEY_RE.test(explicit)) {
			throw new Error('Selected path-oracle pubkey is not a 32-byte hex Nostr pubkey.')
		}
		return explicit
	}
	const cvmPubkey = configStore.state.config.cvmServerPubkey?.trim()
	if (!cvmPubkey) {
		throw new Error('CVM server pubkey (path-issuer) is unavailable. Wait for app config to load and try again.')
	}
	return cvmPubkey
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
	const pathIssuerPubkey = getAuctionPathIssuerPubkeyOrThrow(formData.pathIssuerPubkey)
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
		['path_issuer', pathIssuerPubkey],
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

	const { publishLiveActivity } = await import('@/publish/liveChat')
	publishLiveActivity({ auctionEvent: event }).catch((err) => {
		console.warn('[nip53] Failed to publish live activity:', err)
	})

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

export const publishAuctionBid = async (formData: AuctionBidFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	if (!formData.auctionEventId) throw new Error('Auction event id is required')
	if (!formData.auctionCoordinates) throw new Error('Auction coordinates are required')
	if (!formData.sellerPubkey) throw new Error('Seller pubkey is required')
	if (!formData.pathIssuerPubkey) throw new Error('Auction path issuer pubkey is required')
	if (!formData.p2pkXpub) throw new Error('Auction p2pk_xpub is required for path verification')
	if (!Number.isFinite(formData.amount) || formData.amount <= 0) throw new Error('Bid amount must be a positive number')
	if (!Number.isFinite(formData.auctionStartAt) || formData.auctionStartAt <= 0) {
		throw new Error('Auction start time is required for bidding')
	}
	if (!Number.isFinite(formData.auctionEffectiveEndAt) || formData.auctionEffectiveEndAt <= 0) {
		throw new Error('Auction effective end time is required for bidding')
	}
	if (!Number.isFinite(formData.auctionLocktimeAt) || formData.auctionLocktimeAt <= 0) {
		throw new Error('Auction locktime base is required for bid locking')
	}

	const now = Math.floor(Date.now() / 1000)
	// Lower bound: an auction is only open for bids once `start_at` has
	// elapsed. Without this gate we publish bids whose created_at lands
	// before the auction's start, which the settlement filter then rejects.
	if (now < formData.auctionStartAt) {
		throw new Error('Auction has not started yet')
	}
	if (now >= formData.auctionEffectiveEndAt) {
		throw new Error('Auction already ended')
	}
	// Hard bidding cutoff. Even if effective_end_at is somehow further out
	// (stale fetch, anti-sniping race), max_end_at is the final wall — no
	// bids can be accepted past it because new bids would need a locktime
	// past the existing chain's locktime, which we can't grant without
	// breaking the uniform-locktime invariant.
	if (now >= formData.auctionLocktimeAt) {
		throw new Error('Auction has reached its hard bidding cutoff')
	}

	const bidderPubkey = (await signer.user()).pubkey
	const ownBidFilters = [
		{
			kinds: [AUCTION_BID_KIND],
			authors: [bidderPubkey],
			'#e': [formData.auctionEventId],
			limit: 200,
		},
		...(formData.auctionCoordinates
			? [
					{
						kinds: [AUCTION_BID_KIND],
						authors: [bidderPubkey],
						'#a': [formData.auctionCoordinates],
						limit: 200,
					},
				]
			: []),
	]
	const existingBids = Array.from(
		await ndkActions.fetchEventsWithTimeout(ownBidFilters.length === 1 ? ownBidFilters[0] : ownBidFilters, { timeoutMs: 2500 }),
	)
	const previousBid = resolveLatestActiveBidByBidder(existingBids, bidderPubkey)
	const previousAmount = previousBid ? getBidAmount(previousBid) : 0
	if (previousAmount > 0 && formData.amount <= previousAmount) {
		throw new Error(`Rebid must exceed your current bid of ${previousAmount.toLocaleString()} sats`)
	}

	const deltaAmount = Math.max(0, formData.amount - previousAmount)
	if (deltaAmount <= 0) {
		throw new Error('No additional funds required for this rebid')
	}

	const bidderWalletP2pk = await nip60Actions.getWalletCashuP2pk()
	const bidNonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
	if (!Number.isFinite(formData.settlementGraceSeconds) || formData.settlementGraceSeconds <= 0) {
		throw new Error('Auction is missing settlement_grace — refusing to lock without an authoritative grace period')
	}
	const locktime = Math.max(formData.auctionLocktimeAt + formData.settlementGraceSeconds, now + 60)

	// Path-oracle pre-bid step: request and verify a derivation path. The
	// bidder-side verifyAuctionPathGrant inside requestAuctionPathGrant is the
	// non-negotiable §5.6 check — skipping it would let a malicious issuer
	// substitute a pubkey it controls.
	const grant = await requestAuctionPathGrant({
		auctionEventId: formData.auctionEventId,
		auctionCoordinates: formData.auctionCoordinates,
		bidderPubkey,
		bidderRefundPubkey: bidderWalletP2pk,
		intendedAmount: formData.amount,
		expectedPathIssuer: formData.pathIssuerPubkey,
		expectedXpub: formData.p2pkXpub,
	})

	const lockedBid = await nip60Actions.lockAuctionBidFunds({
		amount: deltaAmount,
		// Pass the auction's full trusted-mint list. `lockAuctionBidFunds`
		// walks it in seller-declared order and picks the first mint
		// where the bidder's wallet has enough balance for the delta —
		// fixes the "wrong mint" failure when the bidder has funds at
		// e.g. mint #4 but the seller listed minibits first.
		preferredMints: formData.mintCandidates.length > 0 ? formData.mintCandidates : [DEFAULT_BID_MINT],
		locktime,
		refundPubkey: bidderWalletP2pk,
		lockPubkey: grant.childPubkey,
		auctionEventId: formData.auctionEventId,
		auctionCoordinates: formData.auctionCoordinates,
		sellerPubkey: formData.sellerPubkey,
		pathIssuerPubkey: grant.pathIssuerPubkey,
		derivationPath: grant.derivationPath,
		childPubkey: grant.childPubkey,
		grantId: grant.grantId,
	})

	try {
		const event = new NDKEvent(ndk)
		event.kind = AUCTION_BID_KIND
		event.content = JSON.stringify({
			type: 'cashu_bid_commitment',
			amount: formData.amount,
			delta_amount: deltaAmount,
			prev_amount: previousAmount,
			mint: lockedBid.mintUrl,
			commitment: lockedBid.commitment,
			key_scheme: lockedBid.keyScheme,
		})
		event.tags = [
			['e', formData.auctionEventId],
			['a', formData.auctionCoordinates],
			['p', formData.sellerPubkey],
			['amount', String(formData.amount), 'SAT'],
			['delta_amount', String(deltaAmount), 'SAT'],
			['currency', 'SAT'],
			['mint', lockedBid.mintUrl],
			['commitment', lockedBid.commitment],
			['locktime', String(lockedBid.locktime)],
			['refund_pubkey', lockedBid.refundPubkey],
			['created_for_end_at', String(formData.auctionEffectiveEndAt)],
			['bid_nonce', bidNonce],
			['key_scheme', lockedBid.keyScheme],
			['status', 'locked'],
			['schema', 'auction_bid_v1'],
			['child_pubkey', grant.childPubkey],
			['path_issuer', grant.pathIssuerPubkey],
			['path_grant_id', grant.grantId],
		]
		if (previousBid) {
			event.tags.push(['prev_bid', previousBid.id])
			event.tags.push(['prev_amount', String(previousAmount), 'SAT'])
		}

		await event.sign(signer)
		// Submit the private token before making the public bid visible. The
		// oracle does not need the bid event on-relay to validate the grant
		// binding, and this avoids orphan public bids that say `status=locked`
		// even though the registry entry stayed `issued`.
		const submitClient = openAuctionPathOracleClient({
			pathIssuerPubkey: grant.pathIssuerPubkey,
			relays: getAuctionClientRelays(),
		})
		try {
			const submission = await submitClient.SubmitBidToken(
				formData.auctionEventId,
				formData.auctionCoordinates,
				event.id,
				grant.grantId,
				lockedBid.lockPubkey,
				lockedBid.refundPubkey,
				lockedBid.mintUrl,
				lockedBid.amount,
				formData.amount,
				lockedBid.commitment,
				bidNonce,
				lockedBid.locktime,
				lockedBid.token,
			)
			if (submission.registryStatus !== 'locked') {
				throw new Error(submission.rejectReason || 'Issuer rejected the bid token')
			}
		} catch (submitError) {
			throw tagBidError('Failed to deliver bid token to issuer', submitError)
		} finally {
			await submitClient.disconnect()
		}
		try {
			await ndkActions.publishEvent(event)
		} catch (publishError) {
			throw tagBidError('Failed to publish bid commitment event after oracle accepted token', publishError)
		}
		nip60Actions.updatePendingTokenContext(lockedBid.tokenId, {
			kind: 'auction_bid',
			auctionEventId: formData.auctionEventId,
			auctionCoordinates: formData.auctionCoordinates,
			bidEventId: event.id,
			sellerPubkey: formData.sellerPubkey,
			pathIssuerPubkey: grant.pathIssuerPubkey,
			lockPubkey: lockedBid.lockPubkey,
			refundPubkey: lockedBid.refundPubkey,
			locktime: lockedBid.locktime,
			derivationPath: grant.derivationPath,
			childPubkey: grant.childPubkey,
			grantId: grant.grantId,
		})
		return event.id
	} catch (error) {
		throw new Error(
			`Bid submission failed after locking funds. Reclaim pending token ${lockedBid.tokenId} from wallet. ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
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

export const publishAuctionSettlement = async (formData: AuctionSettlementFormData, signer: NDKSigner, ndk: NDK): Promise<string> => {
	if (!formData.auctionEventId) throw new Error('Auction event id is required')

	const sellerUser = await signer.user()
	const sellerPubkey = sellerUser.pubkey
	const auctionEvent = Array.from(
		await ndkActions.fetchEventsWithTimeout(
			{
				kinds: [AUCTION_KIND],
				ids: [formData.auctionEventId],
				limit: 1,
			},
			{ timeoutMs: 4000 },
		),
	)[0]
	if (!auctionEvent) throw new Error('Auction not found')
	if (auctionEvent.pubkey !== sellerPubkey) {
		throw new Error('Only the auction owner can settle this auction')
	}

	if (getFirstTagValue(auctionEvent, 'key_scheme') && getFirstTagValue(auctionEvent, 'key_scheme') !== 'hd_p2pk') {
		throw new Error('Only hd_p2pk auction settlement is supported')
	}

	const auctionCoordinates =
		formData.auctionCoordinates ||
		(() => {
			const dTag = getFirstTagValue(auctionEvent, 'd')
			return dTag ? `30408:${auctionEvent.pubkey}:${dTag}` : ''
		})()
	const auctionP2pkXpub = getFirstTagValue(auctionEvent, 'p2pk_xpub').trim()
	if (!auctionP2pkXpub) {
		throw new Error('Auction is missing p2pk_xpub')
	}
	const walletAuctionXpub = await nip60Actions.getAuctionP2pkXpub()
	if (walletAuctionXpub !== auctionP2pkXpub) {
		throw new Error('Auction p2pk_xpub does not match the current wallet-derived auction HD root')
	}
	const pathIssuerPubkey = getFirstTagValue(auctionEvent, 'path_issuer') || auctionEvent.pubkey
	const settlementClient = openAuctionPathOracleClient({
		pathIssuerPubkey,
		relays: getAuctionClientRelays(),
	})
	let settlementPlan: RequestSettlementOutput
	try {
		settlementPlan = await settlementClient.RequestSettlement(formData.auctionEventId, auctionCoordinates)
	} finally {
		await settlementClient.disconnect()
	}
	const closeAt = settlementPlan.closeAt || formData.closeAt || Math.floor(Date.now() / 1000)
	const winningBidEventId = settlementPlan.winningBidEventId || ''
	const winnerPubkey = settlementPlan.winnerPubkey || ''
	const finalAmount = Math.max(0, Math.floor(settlementPlan.finalAmount ?? 0))
	let winnerPayoutAmount = 0
	const settlementTags: NDKTag[] = []

	if (settlementPlan.status === 'settled') {
		if (!winningBidEventId || !winnerPubkey || finalAmount <= 0) {
			throw new Error('Settlement plan did not provide a valid winning bid')
		}
		// Cache mint keysets by URL — a multi-leg winning chain on the
		// same mint shouldn't pay N round-trips. cashu-ts ≥2.x writes
		// NUT-2 v2 short keyset IDs into the token, so `getDecodedToken`
		// throws "A short keyset ID v2 was encountered, but got no
		// keysets to map it to" without these. The wallet load also
		// warms the cashu-ts mint cache for the subsequent
		// `receiveLockedEcash` call below.
		const mintKeysetsByUrl = new Map<string, import('@cashu/cashu-ts').MintKeyset[]>()
		for (const release of settlementPlan.releases) {
			if (!mintKeysetsByUrl.has(release.mintUrl)) {
				mintKeysetsByUrl.set(release.mintUrl, await nip60Actions.loadAuctionMintKeysets(release.mintUrl))
			}
			const p2pkPreflight = preflightAuctionSettlementP2pk({
				auctionP2pkXpub,
				derivationPath: release.derivationPath,
				settlementPlanChildPubkey: release.childPubkey,
				token: release.token,
				mintKeysets: mintKeysetsByUrl.get(release.mintUrl),
			})
			const childPrivkey = await nip60Actions.getAuctionHdChildPrivkey({
				derivationPath: p2pkPreflight.derivationPath,
				expectedPubkey: p2pkPreflight.derivedChildPubkey,
			})
			try {
				const received = await nip60Actions.receiveLockedEcash(release.token, childPrivkey)
				if (!received) {
					throw new Error('Seller wallet did not receive the locked Cashu payout')
				}
			} catch (error) {
				if (!isSpentTokenError(error)) throw error
			}
			winnerPayoutAmount += release.amount
		}
		if (winnerPayoutAmount !== finalAmount) {
			throw new Error(`Winning bid proofs total ${winnerPayoutAmount} sats, expected ${finalAmount} sats`)
		}
		settlementTags.push(['payout', winningBidEventId, String(winnerPayoutAmount), 'redeemed'])
	}

	const event = new NDKEvent(ndk)
	event.kind = AUCTION_SETTLEMENT_KIND
	event.content = JSON.stringify({
		type: 'auction_settlement',
		status: settlementPlan.status,
		winning_bid: winningBidEventId || null,
		winner: winnerPubkey || null,
		final_amount: finalAmount,
		winner_payout_amount: winnerPayoutAmount || null,
		reason: formData.reason || null,
	})
	event.tags = [
		['e', formData.auctionEventId],
		['status', settlementPlan.status],
		['close_at', String(closeAt)],
		['winning_bid', winningBidEventId],
		['winner', winnerPubkey],
		['final_amount', String(finalAmount), 'SAT'],
		['schema', 'auction_settlement_v1'],
		...settlementTags,
	]
	if (auctionCoordinates) {
		event.tags.push(['a', auctionCoordinates])
	}
	if (winnerPubkey) {
		event.tags.push(['p', winnerPubkey])
	}
	if (settlementPlan.releaseId) {
		event.tags.push(['path_release_id', settlementPlan.releaseId])
	}
	if (formData.reason?.trim()) {
		event.tags.push(['reason', formData.reason.trim()])
	}

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
