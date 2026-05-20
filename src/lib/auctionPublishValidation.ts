import {
	normalizeProductShippingSelection,
	type ProductShippingSelection,
	type ProductShippingSelectionInput,
} from './utils/productShippingSelections'

export const AUCTION_MIN_DURATION_SECONDS = 60

export type AuctionPublishValidationField =
	| 'title'
	| 'description'
	| 'startingBid'
	| 'bidIncrement'
	| 'reserve'
	| 'startAt'
	| 'endAt'
	| 'duration'
	| 'antiSnipeWindowMinutes'
	| 'minBidCurveShape'
	| 'minBidCurvePeakMultiplier'
	| 'settlementGracePreset'
	| 'shippingExtraCost'
	| 'trustedMints'
	| 'imageUrls'

export type AuctionPublishValidationIssue = {
	field: AuctionPublishValidationField
	message: string
	index?: number
}

export type AuctionPublishValidationInput = {
	title?: string | null
	summary?: string | null
	description?: string | null
	startingBid?: string | number | null
	bidIncrement?: string | number | null
	reserve?: string | number | null
	startAt?: string | null
	endAt?: string | null
	/**
	 * Anti-snipe window in minutes — added to `end_at` to compute
	 * `max_end_at`. `0` (default) disables the curve entirely.
	 * Allowed values are enforced by `AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES`
	 * in `publish/auctions.tsx`; the validator just checks the integer
	 * is non-negative.
	 */
	antiSnipeWindowMinutes?: number | null
	/** `'none' | 'linear' | 'exponential'`. */
	minBidCurveShape?: string | null
	/** Peak multiplier preset: 2, 5, or 10. */
	minBidCurvePeakMultiplier?: number | null
	/** `'5min' | '1h' | '3h'`. */
	settlementGracePreset?: string | null
	imageUrls?: string[] | null
	shippings?: ProductShippingSelectionInput[] | null
	trustedMints?: string[] | null
}

export type ValidatedAuctionPublishData = {
	title: string
	summary: string
	description: string
	startingBid: number
	bidIncrement: number
	/**
	 * Reserve in sats. Always populated (defaults to 0 when the seller
	 * left the field empty) — see AUCTIONS.md §4.1: the tag is required,
	 * `0` means "no reserve". Keeping this non-optional means the
	 * publish path can safely emit `String(reserve)` without producing
	 * `"undefined"` on the wire.
	 */
	reserve: number
	startAt: number
	endAt: number
	durationSeconds: number
	/** Anti-snipe window in seconds (`antiSnipeWindowMinutes × 60`). */
	antiSnipeWindowSeconds: number
	minBidCurveShape: 'none' | 'linear' | 'exponential'
	minBidCurvePeakMultiplier: number
	settlementGracePreset: '5min' | '1h' | '3h'
	maxEndAt: number
	imageUrls: string[]
	shippings: ProductShippingSelection[]
	trustedMints: string[]
}

export type AuctionPublishValidationOptions = {
	nowSeconds?: number
	minDurationSeconds?: number
}

export class AuctionPublishValidationError extends Error {
	issues: AuctionPublishValidationIssue[]

	constructor(issues: AuctionPublishValidationIssue[]) {
		super(issues[0]?.message ?? 'Invalid auction publish data')
		this.name = 'AuctionPublishValidationError'
		this.issues = issues
	}
}

// Accept an optional leading `-` so we can distinguish "the user typed a
// signed integer" (→ specific "must be ≥ 0" / "must be > 0" message) from
// "the user typed something that isn't a number at all" (→ "Please enter
// a valid number"). Without the optional sign the regex rejected `-1`
// outright as a non-number, which masked the real validation rule.
const SIGNED_INTEGER_PATTERN = /^-?\d+$/

const toTrimmedString = (value: string | number | null | undefined): string =>
	value === null || value === undefined ? '' : String(value).trim()

const parseNonNegativeInteger = (
	value: string | number | null | undefined,
	field: AuctionPublishValidationField,
	label: string,
	issues: AuctionPublishValidationIssue[],
): number | undefined => {
	const text = toTrimmedString(value)
	if (!SIGNED_INTEGER_PATTERN.test(text)) {
		issues.push({ field, message: 'Please enter a valid number.' })
		return
	}

	const parsed = Number(text)
	if (!Number.isSafeInteger(parsed)) {
		issues.push({ field, message: 'Please enter a valid number.' })
		return
	}

	if (parsed < 0) {
		issues.push({ field, message: `${label} must be an integer greater than or equal to 0` })
		return
	}

	return parsed
}

const parsePositiveInteger = (
	value: string | number | null | undefined,
	field: AuctionPublishValidationField,
	label: string,
	issues: AuctionPublishValidationIssue[],
): number | undefined => {
	const parsed = parseNonNegativeInteger(value, field, label, issues)
	// `if (!parsed) return` was the prior bug: falsy on 0 means the
	// "must be > 0" check below was never reached for `bidIncrement: '0'`
	// (the validator returned undefined silently, the form thought it
	// was valid, and 0-sat increments slipped through). Distinguish
	// "couldn't parse" (undefined) from "parsed as 0" explicitly.
	if (parsed === undefined) return

	if (parsed <= 0) {
		issues.push({ field, message: `${label} must be greater than 0` })
		return
	}

	return parsed
}

const parseOptionalUnixTimestamp = (
	value: string | null | undefined,
	field: AuctionPublishValidationField,
	label: string,
	issues: AuctionPublishValidationIssue[],
): number | undefined => {
	const text = toTrimmedString(value)
	if (!text) return

	const timestampMs = new Date(text).getTime()
	if (!Number.isFinite(timestampMs)) {
		issues.push({ field, message: `${label} must be a valid date and time` })
		return
	}

	return Math.floor(timestampMs / 1000)
}

const normalizeImages = (imageUrls: string[] | null | undefined): string[] =>
	(imageUrls ?? []).map((url) => url.trim()).filter((url) => url.length > 0)

const normalizeTrustedMints = (trustedMints: string[] | null | undefined): string[] =>
	(trustedMints ?? []).map((mint) => mint.trim()).filter((mint) => mint.length > 0)

const normalizeShippingSelections = (
	inputs: ProductShippingSelectionInput[] | null | undefined,
	issues: AuctionPublishValidationIssue[],
): ProductShippingSelection[] => {
	const seenShippingRefs = new Set<string>()
	const normalized: ProductShippingSelection[] = []

	for (const [index, input] of (inputs ?? []).entries()) {
		const selection = normalizeProductShippingSelection(input)
		if (!selection) continue

		const shippingRef = selection.shippingRef.trim()
		if (!shippingRef || seenShippingRefs.has(shippingRef)) continue
		seenShippingRefs.add(shippingRef)

		const extraCost = selection.extraCost.trim()
		if (!extraCost) {
			normalized.push({ shippingRef, extraCost: '' })
			continue
		}

		const parsedExtraCost = parseNonNegativeInteger(extraCost, 'shippingExtraCost', 'Shipping extra cost', issues)
		if (parsedExtraCost === null) {
			const issue = issues[issues.length - 1]
			if (issue?.field === 'shippingExtraCost') issue.index = index
			continue
		}

		normalized.push({ shippingRef, extraCost: String(parsedExtraCost) })
	}

	return normalized
}

const normalizeAuctionPublishInput = (
	input: AuctionPublishValidationInput,
	options: AuctionPublishValidationOptions = {},
): { value: ValidatedAuctionPublishData; issues: AuctionPublishValidationIssue[] } => {
	const issues: AuctionPublishValidationIssue[] = []
	const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)

	const title = toTrimmedString(input.title)
	if (!title) {
		issues.push({ field: 'title', message: 'Auction title is required' })
	}

	const description = toTrimmedString(input.description)
	if (!description) {
		issues.push({ field: 'description', message: 'Auction description is required' })
	}

	const startingBid = parseNonNegativeInteger(input.startingBid, 'startingBid', 'Starting bid', issues)
	const bidIncrement = parsePositiveInteger(input.bidIncrement, 'bidIncrement', 'Bid increment', issues)

	// AUCTIONS.md §4.1: the `reserve` tag is required, with `0` meaning
	// "no reserve". Default missing/empty input to 0 so the published
	// kind-30408 always carries a numeric reserve. Without this default
	// the publish path stringified `undefined` straight into the tag —
	// auction `1618640c…0881` on the staging relay shows up with
	// `["reserve","undefined"]`. Parsers tolerate it (`parseInt` → NaN
	// → fallback 0) but it's an embarrassing data-quality bug.
	let reserve = 0
	if (input.reserve !== undefined && input.reserve !== null && toTrimmedString(input.reserve) !== '') {
		const parsedReserve = parseNonNegativeInteger(input.reserve, 'reserve', 'Reserve', issues)
		if (parsedReserve !== undefined) {
			reserve = parsedReserve
		}
		if (startingBid !== undefined && parsedReserve !== undefined && parsedReserve < startingBid) {
			issues.push({ field: 'reserve', message: 'Reserve must be greater than or equal to the starting bid' })
		}
	}

	const parsedStartAt = parseOptionalUnixTimestamp(input.startAt, 'startAt', 'Auction start time', issues)
	const startAt = parsedStartAt ?? nowSeconds
	const parsedEndAt = parseOptionalUnixTimestamp(input.endAt, 'endAt', 'Auction end time', issues)
	if (!toTrimmedString(input.endAt)) {
		issues.push({ field: 'endAt', message: 'Auction end time is required' })
	}

	const endAt = parsedEndAt ?? 0
	const effectiveStartBoundary = Math.max(startAt, nowSeconds)
	if (parsedEndAt && parsedEndAt <= effectiveStartBoundary) {
		issues.push({ field: 'endAt', message: 'Auction end time must be after the start time and current time' })
	}

	const durationSeconds = parsedEndAt ? parsedEndAt - effectiveStartBoundary : 0
	if (parsedEndAt && options.minDurationSeconds && durationSeconds < options.minDurationSeconds) {
		// Compute the human label from the configured minimum so the message
		// reflects the actual rule the form is enforcing, not a hard-coded
		// "1 minute". Prefer minute granularity above 60 s so we don't say
		// "1800 seconds" for the default 30-minute floor.
		const minSeconds = options.minDurationSeconds
		const message =
			minSeconds >= 60 && minSeconds % 60 === 0
				? `Auction duration must be at least ${minSeconds / 60} minute${minSeconds === 60 ? '' : 's'}`
				: `Auction duration must be at least ${minSeconds} second${minSeconds === 1 ? '' : 's'}`
		issues.push({ field: 'duration', message })
	}

	// Anti-snipe window in minutes → seconds. `0` means no window
	// (max_end_at = end_at, curve disabled regardless of shape).
	// AUCTIONS.md §6.0 / §6.1.
	const rawWindowMinutes = typeof input.antiSnipeWindowMinutes === 'number' ? input.antiSnipeWindowMinutes : 0
	const antiSnipeWindowMinutes = Number.isFinite(rawWindowMinutes) && rawWindowMinutes >= 0 ? Math.floor(rawWindowMinutes) : 0
	if (!Number.isFinite(rawWindowMinutes) || rawWindowMinutes < 0) {
		issues.push({ field: 'antiSnipeWindowMinutes', message: 'Anti-snipe window must be a non-negative number of minutes' })
	}
	const antiSnipeWindowSeconds = antiSnipeWindowMinutes * 60

	const minBidCurveShapeRaw = typeof input.minBidCurveShape === 'string' ? input.minBidCurveShape : 'none'
	const minBidCurveShape: 'none' | 'linear' | 'exponential' =
		minBidCurveShapeRaw === 'linear' || minBidCurveShapeRaw === 'exponential' ? minBidCurveShapeRaw : 'none'
	if (minBidCurveShape !== minBidCurveShapeRaw && minBidCurveShapeRaw !== 'none') {
		issues.push({ field: 'minBidCurveShape', message: 'Anti-snipe curve shape must be none, linear, or exponential' })
	}

	const peakRaw = typeof input.minBidCurvePeakMultiplier === 'number' ? input.minBidCurvePeakMultiplier : 2
	const minBidCurvePeakMultiplier = Number.isFinite(peakRaw) && peakRaw >= 1 && peakRaw <= 100 ? peakRaw : 2
	if (!Number.isFinite(peakRaw) || peakRaw < 1 || peakRaw > 100) {
		issues.push({
			field: 'minBidCurvePeakMultiplier',
			message: 'Anti-snipe peak multiplier must be a number in [1, 100]',
		})
	}
	// If the seller chose a curve but no window, the curve has zero
	// duration — surface that as a validation hint so the form can
	// either nudge them to widen the window or pick 'none'.
	if (minBidCurveShape !== 'none' && antiSnipeWindowMinutes === 0) {
		issues.push({
			field: 'antiSnipeWindowMinutes',
			message: 'Pick an anti-snipe window so the curve has time to ramp, or set the curve shape to none.',
		})
	}

	const settlementGraceRaw = typeof input.settlementGracePreset === 'string' ? input.settlementGracePreset : '1h'
	const settlementGracePreset: '5min' | '1h' | '3h' =
		settlementGraceRaw === '5min' || settlementGraceRaw === '1h' || settlementGraceRaw === '3h' ? settlementGraceRaw : '1h'
	if (settlementGracePreset !== settlementGraceRaw) {
		issues.push({ field: 'settlementGracePreset', message: 'Settlement grace must be 5min, 1h, or 3h' })
	}

	const imageUrls = normalizeImages(input.imageUrls)
	if (imageUrls.length === 0) {
		issues.push({ field: 'imageUrls', message: 'At least one image is required' })
	}

	const trustedMints = normalizeTrustedMints(input.trustedMints)
	if (trustedMints.length === 0) {
		issues.push({ field: 'trustedMints', message: 'At least one trusted mint is required' })
	}

	const shippings = normalizeShippingSelections(input.shippings, issues)

	// max_end_at = end_at + window (no dynamic shifting per AUCTIONS.md §6.1).
	const maxEndAt = endAt + antiSnipeWindowSeconds

	return {
		value: {
			title,
			summary: toTrimmedString(input.summary),
			description,
			startingBid: startingBid ?? 0,
			bidIncrement: bidIncrement ?? 0,
			reserve,
			startAt,
			endAt,
			durationSeconds,
			antiSnipeWindowSeconds,
			minBidCurveShape,
			minBidCurvePeakMultiplier,
			settlementGracePreset,
			maxEndAt,
			imageUrls,
			shippings,
			trustedMints,
		},
		issues,
	}
}

export const getAuctionPublishValidationIssues = (
	input: AuctionPublishValidationInput,
	options: AuctionPublishValidationOptions = {},
): AuctionPublishValidationIssue[] => normalizeAuctionPublishInput(input, options).issues

export const validateAuctionPublishInput = (
	input: AuctionPublishValidationInput,
	options: AuctionPublishValidationOptions = {},
): ValidatedAuctionPublishData => {
	const result = normalizeAuctionPublishInput(input, options)
	if (result.issues.length > 0) {
		throw new AuctionPublishValidationError(result.issues)
	}

	return result.value
}
