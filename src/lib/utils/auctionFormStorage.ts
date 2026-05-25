import type { AuctionFormData } from '@/publish/auctions'

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
		return JSON.parse(raw) as AuctionFormDraft
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
