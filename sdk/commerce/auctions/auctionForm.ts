import type { ProductShippingSelectionInput } from '../products'

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
	enableLiveChat: boolean
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
