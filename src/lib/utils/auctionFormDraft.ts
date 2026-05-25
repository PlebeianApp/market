import type { AuctionFormData } from '@/publish/auctions'
import { z } from 'zod'

export type AuctionImage = { imageUrl: string; imageOrder: number }

export type AuctionTab = 'name' | 'auction' | 'category' | 'spec' | 'images' | 'shipping'
export type StartMode = 'immediate' | 'scheduled'
export type EndMode = 'duration' | 'absolute'

export interface AuctionFormDraft {
	formData: AuctionFormData
	images: AuctionImage[]
	subCategoryInput: string
	startMode: StartMode
	endMode: EndMode
	durationSeconds: number
	activeTab: AuctionTab
}

export const DRAFT_VERSION = 1 as const

export const auctionDraftEnvelopeSchema = z.object({
	version: z.literal(DRAFT_VERSION),
	ownerPubkey: z.string().min(1),
	savedAt: z.number().int().positive(),
	draft: z.object({
		formData: z.object({
			title: z.string(),
			summary: z.string(),
			description: z.string(),
			startingBid: z.string(),
			bidIncrement: z.string(),
			reserve: z.string().optional(),
			startAt: z.string().optional(),
			endAt: z.string(),
			antiSnipeWindowMinutes: z.number(),
			minBidCurveShape: z.string(),
			minBidCurvePeakMultiplier: z.number(),
			settlementGracePreset: z.string(),
			mainCategory: z.string(),
			categories: z.array(z.string()),
			imageUrls: z.array(z.string()),
			specs: z.array(z.object({ key: z.string(), value: z.string() })),
			shippings: z.array(z.record(z.string(), z.unknown())),
			trustedMints: z.array(z.string()),
			isNSFW: z.boolean(),
			pathIssuerPubkey: z.string(),
		}),
		images: z.array(z.object({ imageUrl: z.string(), imageOrder: z.number() })),
		subCategoryInput: z.string(),
		startMode: z.enum(['immediate', 'scheduled']),
		endMode: z.enum(['duration', 'absolute']),
		durationSeconds: z.number().positive(),
		activeTab: z.enum(['name', 'auction', 'category', 'spec', 'images', 'shipping']),
	}),
})

export type AuctionDraftEnvelope = z.infer<typeof auctionDraftEnvelopeSchema>

export function isDraftMeaningful({ formData, images, subCategoryInput }: AuctionFormDraft): boolean {
	const { title, summary, description, startingBid, reserve, startAt, endAt, mainCategory, categories, imageUrls, specs, shippings } =
		formData
	return (
		[title, summary, description, startingBid, reserve ?? '', startAt ?? '', endAt, mainCategory, subCategoryInput].some(
			(s) => s.trim().length > 0,
		) || [categories, imageUrls, specs, shippings, images].some((a) => a.length > 0)
	)
}

export function getAuctionDraftKey(pubkey: string | undefined): string | null {
	return pubkey ? `auction-form-draft:v1:${pubkey}` : null
}

export function saveDraft(pubkey: string | undefined, draft: AuctionFormDraft): void {
	const key = getAuctionDraftKey(pubkey)
	if (!key || !pubkey) return
	const envelope: AuctionDraftEnvelope = {
		version: DRAFT_VERSION,
		ownerPubkey: pubkey,
		savedAt: Date.now(),
		draft,
	}
	try {
		localStorage.setItem(key, JSON.stringify(envelope))
	} catch {}
}

export function loadDraft(pubkey: string | undefined): AuctionFormDraft | null {
	const key = getAuctionDraftKey(pubkey)
	if (!key || !pubkey) return null
	try {
		const raw = localStorage.getItem(key)
		if (!raw) return null
		const parsed: unknown = JSON.parse(raw)
		const result = auctionDraftEnvelopeSchema.safeParse(parsed)
		if (!result.success) return null
		if (result.data.ownerPubkey !== pubkey) return null
		return result.data.draft as AuctionFormDraft
	} catch {
		return null
	}
}

export function clearDraft(pubkey: string | undefined): void {
	const key = getAuctionDraftKey(pubkey)
	if (!key) return
	try {
		localStorage.removeItem(key)
	} catch {}
}
