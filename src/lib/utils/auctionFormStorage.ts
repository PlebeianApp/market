import type {
	AuctionAntiSnipeWindowMinutesPreset,
	AuctionFormData,
	AuctionMinBidCurvePeakPreset,
	AuctionMinBidCurveShape,
	AuctionSettlementGracePreset,
} from '@/publish/auctions'
import {
	AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES,
	AUCTION_MIN_BID_CURVE_PEAK_PRESETS,
	AUCTION_SETTLEMENT_GRACE_PRESETS,
} from '@/publish/auctions'

type AuctionImage = { imageUrl: string; imageOrder: number }
type StartMode = 'immediate' | 'scheduled'
type EndMode = 'duration' | 'absolute'

export type AuctionFormDraft = {
	pubkey: string
	formData: AuctionFormData
	images: AuctionImage[]
	startMode: StartMode
	endMode: EndMode
	durationSeconds: number
	subCategoryInput: string
	savedAt: number
}

const storageKey = (pubkey: string) => `auction_form_draft_${pubkey}`

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

function str(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function strArray(v: unknown): string[] {
	if (!Array.isArray(v)) return []
	return v.filter((x): x is string => typeof x === 'string')
}

function validateDraft(raw: unknown): AuctionFormDraft | null {
	if (!raw || typeof raw !== 'object') return null
	const d = raw as Record<string, unknown>

	const pubkey = str(d.pubkey)
	if (!pubkey) return null

	const savedAt = num(d.savedAt, 0)
	if (!savedAt) return null

	const fd = d.formData && typeof d.formData === 'object' ? (d.formData as Record<string, unknown>) : {}

	const antiSnipeWindowMinutes = (AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES as readonly number[]).includes(
		num(fd.antiSnipeWindowMinutes, 0),
	)
		? (num(fd.antiSnipeWindowMinutes, 0) as AuctionAntiSnipeWindowMinutesPreset)
		: 0

	const minBidCurveShapeOptions: AuctionMinBidCurveShape[] = ['none', 'linear', 'exponential']
	const minBidCurveShape: AuctionMinBidCurveShape = minBidCurveShapeOptions.includes(fd.minBidCurveShape as AuctionMinBidCurveShape)
		? (fd.minBidCurveShape as AuctionMinBidCurveShape)
		: 'none'

	const minBidCurvePeakMultiplier = (AUCTION_MIN_BID_CURVE_PEAK_PRESETS as readonly number[]).includes(num(fd.minBidCurvePeakMultiplier, 2))
		? (num(fd.minBidCurvePeakMultiplier, 2) as AuctionMinBidCurvePeakPreset)
		: 2

	const settlementGraceOptions = Object.keys(AUCTION_SETTLEMENT_GRACE_PRESETS) as AuctionSettlementGracePreset[]
	const settlementGracePreset: AuctionSettlementGracePreset = settlementGraceOptions.includes(
		fd.settlementGracePreset as AuctionSettlementGracePreset,
	)
		? (fd.settlementGracePreset as AuctionSettlementGracePreset)
		: '1h'

	const rawSpecs = Array.isArray(fd.specs) ? fd.specs : []
	const specs = rawSpecs
		.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
		.map((s) => ({ key: str(s.key), value: str(s.value) }))

	const rawShippings = Array.isArray(fd.shippings) ? fd.shippings : []
	const shippings = rawShippings
		.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
		.map((s) => ({ shippingRef: str(s.shippingRef), extraCost: str(s.extraCost) }))

	const rawImages = Array.isArray(d.images) ? d.images : []
	const images: AuctionImage[] = rawImages
		.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
		.map((i) => ({ imageUrl: str(i.imageUrl), imageOrder: num(i.imageOrder, 0) }))
		.filter((i) => i.imageUrl.length > 0)

	const startModeRaw = str(d.startMode)
	const startMode: StartMode = startModeRaw === 'scheduled' ? 'scheduled' : 'immediate'

	const endModeRaw = str(d.endMode)
	const endMode: EndMode = endModeRaw === 'absolute' ? 'absolute' : 'duration'

	const formData: AuctionFormData = {
		title: str(fd.title),
		summary: str(fd.summary),
		description: str(fd.description),
		startingBid: str(fd.startingBid),
		bidIncrement: str(fd.bidIncrement, '1'),
		reserve: str(fd.reserve, '0'),
		startAt: str(fd.startAt),
		endAt: str(fd.endAt),
		antiSnipeWindowMinutes,
		minBidCurveShape,
		minBidCurvePeakMultiplier,
		settlementGracePreset,
		mainCategory: str(fd.mainCategory),
		categories: strArray(fd.categories),
		imageUrls: strArray(fd.imageUrls),
		specs,
		shippings,
		trustedMints: strArray(fd.trustedMints),
		isNSFW: fd.isNSFW === true,
		pathIssuerPubkey: str(fd.pathIssuerPubkey),
	}

	return {
		pubkey,
		formData,
		images,
		startMode,
		endMode,
		durationSeconds: num(d.durationSeconds, 86400),
		subCategoryInput: str(d.subCategoryInput),
		savedAt,
	}
}

export const saveAuctionFormDraft = (pubkey: string, draft: Omit<AuctionFormDraft, 'pubkey' | 'savedAt'>): void => {
	if (!isBrowser() || !pubkey) return
	try {
		const record: AuctionFormDraft = { ...draft, pubkey, savedAt: Date.now() }
		localStorage.setItem(storageKey(pubkey), JSON.stringify(record))
	} catch (error) {
		console.error('Failed to save auction form draft:', error)
	}
}

export const getAuctionFormDraft = (pubkey: string): AuctionFormDraft | null => {
	if (!isBrowser() || !pubkey) return null
	try {
		const raw = localStorage.getItem(storageKey(pubkey))
		if (!raw) return null
		return validateDraft(JSON.parse(raw))
	} catch (error) {
		console.error('Failed to get auction form draft:', error)
		return null
	}
}

export const clearAuctionFormDraft = (pubkey: string): void => {
	if (!isBrowser() || !pubkey) return
	try {
		localStorage.removeItem(storageKey(pubkey))
	} catch (error) {
		console.error('Failed to clear auction form draft:', error)
	}
}

export const hasAuctionFormDraft = (pubkey: string): boolean => getAuctionFormDraft(pubkey) !== null
