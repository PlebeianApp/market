import {
	normalizeProductShippingSelection,
	type ProductShippingSelection,
	type ProductShippingSelectionInput,
} from './utils/productShippingSelections'

export const AUCTION_MIN_DURATION_SECONDS = 30 * 60

export type AuctionPublishValidationField =
	| 'title'
	| 'description'
	| 'startingBid'
	| 'bidIncrement'
	| 'reserve'
	| 'startAt'
	| 'endAt'
	| 'duration'
	| 'antiSnipingWindowSeconds'
	| 'antiSnipingExtensionSeconds'
	| 'antiSnipingMaxExtensions'
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
	antiSnipingEnabled?: boolean | null
	antiSnipingWindowSeconds?: string | number | null
	antiSnipingExtensionSeconds?: string | number | null
	antiSnipingMaxExtensions?: string | number | null
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
	reserve: number
	startAt: number
	endAt: number
	durationSeconds: number
	antiSnipingEnabled: boolean
	antiSnipingWindowSeconds: number
	antiSnipingExtensionSeconds: number
	antiSnipingMaxExtensions: number
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

const INTEGER_PATTERN = /^\d+$/

const toTrimmedString = (value: string | number | null | undefined): string =>
	value === null || value === undefined ? '' : String(value).trim()

const parseNonNegativeInteger = (
	value: string | number | null | undefined,
	field: AuctionPublishValidationField,
	label: string,
	issues: AuctionPublishValidationIssue[],
): number | null => {
	const text = toTrimmedString(value)
	if (!INTEGER_PATTERN.test(text)) {
		issues.push({ field, message: `${label} must be an integer greater than or equal to 0` })
		return null
	}

	const parsed = Number(text)
	if (!Number.isSafeInteger(parsed)) {
		issues.push({ field, message: `${label} must be a safe integer greater than or equal to 0` })
		return null
	}

	return parsed
}

const parsePositiveInteger = (
	value: string | number | null | undefined,
	field: AuctionPublishValidationField,
	label: string,
	issues: AuctionPublishValidationIssue[],
): number | null => {
	const parsed = parseNonNegativeInteger(value, field, label, issues)
	if (parsed === null) return null
	if (parsed <= 0) {
		issues.push({ field, message: `${label} must be greater than 0` })
		return null
	}

	return parsed
}

const parseOptionalUnixTimestamp = (
	value: string | null | undefined,
	field: AuctionPublishValidationField,
	label: string,
	issues: AuctionPublishValidationIssue[],
): number | null => {
	const text = toTrimmedString(value)
	if (!text) return null

	const timestampMs = new Date(text).getTime()
	if (!Number.isFinite(timestampMs)) {
		issues.push({ field, message: `${label} must be a valid date and time` })
		return null
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
	const reserve = parseNonNegativeInteger(input.reserve, 'reserve', 'Reserve', issues)

	if (startingBid !== null && reserve !== null && reserve < startingBid) {
		issues.push({ field: 'reserve', message: 'Reserve must be greater than or equal to the starting bid' })
	}

	const parsedStartAt = parseOptionalUnixTimestamp(input.startAt, 'startAt', 'Auction start time', issues)
	const startAt = parsedStartAt ?? nowSeconds
	const parsedEndAt = parseOptionalUnixTimestamp(input.endAt, 'endAt', 'Auction end time', issues)
	if (!toTrimmedString(input.endAt)) {
		issues.push({ field: 'endAt', message: 'Auction end time is required' })
	}

	const endAt = parsedEndAt ?? 0
	const effectiveStartBoundary = Math.max(startAt, nowSeconds)
	if (parsedEndAt !== null && parsedEndAt <= effectiveStartBoundary) {
		issues.push({ field: 'endAt', message: 'Auction end time must be after the start time and current time' })
	}

	const durationSeconds = parsedEndAt === null ? 0 : parsedEndAt - effectiveStartBoundary
	if (parsedEndAt !== null && options.minDurationSeconds !== undefined && durationSeconds < options.minDurationSeconds) {
		issues.push({ field: 'duration', message: 'Auction duration must be at least 30 minutes' })
	}

	const antiSnipingEnabled = input.antiSnipingEnabled === true
	const antiSnipingWindowSeconds = antiSnipingEnabled
		? parsePositiveInteger(input.antiSnipingWindowSeconds, 'antiSnipingWindowSeconds', 'Anti-sniping window', issues)
		: 0
	const antiSnipingExtensionSeconds = antiSnipingEnabled
		? parsePositiveInteger(input.antiSnipingExtensionSeconds, 'antiSnipingExtensionSeconds', 'Anti-sniping extension', issues)
		: 0
	const antiSnipingMaxExtensions = antiSnipingEnabled
		? parsePositiveInteger(input.antiSnipingMaxExtensions, 'antiSnipingMaxExtensions', 'Max anti-sniping extensions', issues)
		: 0

	const imageUrls = normalizeImages(input.imageUrls)
	if (imageUrls.length === 0) {
		issues.push({ field: 'imageUrls', message: 'At least one image is required' })
	}

	const trustedMints = normalizeTrustedMints(input.trustedMints)
	if (trustedMints.length === 0) {
		issues.push({ field: 'trustedMints', message: 'At least one trusted mint is required' })
	}

	const shippings = normalizeShippingSelections(input.shippings, issues)

	const maxEndAt =
		antiSnipingEnabled && antiSnipingExtensionSeconds !== null && antiSnipingMaxExtensions !== null
			? endAt + antiSnipingExtensionSeconds * antiSnipingMaxExtensions
			: endAt

	return {
		value: {
			title,
			summary: toTrimmedString(input.summary),
			description,
			startingBid: startingBid ?? 0,
			bidIncrement: bidIncrement ?? 0,
			reserve: reserve ?? 0,
			startAt,
			endAt,
			durationSeconds,
			antiSnipingEnabled,
			antiSnipingWindowSeconds: antiSnipingWindowSeconds ?? 0,
			antiSnipingExtensionSeconds: antiSnipingExtensionSeconds ?? 0,
			antiSnipingMaxExtensions: antiSnipingMaxExtensions ?? 0,
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
