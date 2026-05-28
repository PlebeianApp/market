import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	clearAuctionFormDraft,
	getAuctionFormDraft,
	hasAuctionFormDraft,
	isMeaningfulDraft,
	saveAuctionFormDraft,
	type AuctionFormDraft,
} from '@/lib/utils/auctionFormStorage'
import type { AuctionFormData } from '@/publish/auctions'

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {}

const localStorageMock = {
	getItem: (key: string) => store[key] ?? null,
	setItem: (key: string, value: string) => {
		store[key] = value
	},
	removeItem: (key: string) => {
		delete store[key]
	},
	clear: () => {
		for (const k of Object.keys(store)) delete store[k]
	},
}

Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true })
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PUBKEY_A = 'aaaa1111'
const PUBKEY_B = 'bbbb2222'

const baseDraft: Omit<AuctionFormDraft, 'pubkey' | 'savedAt'> = {
	formData: {
		title: 'Vintage Camera',
		summary: 'Rare find',
		description: 'A beautiful vintage camera in great condition.',
		startingBid: '5000',
		bidIncrement: '100',
		reserve: '10000',
		startAt: '',
		endAt: '2099-01-01T12:00',
		antiSnipeWindowMinutes: 15,
		minBidCurveShape: 'linear',
		minBidCurvePeakMultiplier: 5,
		settlementGracePreset: '1h',
		mainCategory: 'Photography',
		categories: ['Collectibles', 'Film'],
		imageUrls: ['https://example.com/camera.jpg'],
		specs: [{ key: 'Brand', value: 'Leica' }],
		shippings: [{ shippingRef: '30406:seller:standard', extraCost: '200' }],
		trustedMints: ['https://mint.example.com'],
		isNSFW: false,
		pathIssuerPubkey: '',
	},
	images: [{ imageUrl: 'https://example.com/camera.jpg', imageOrder: 0 }],
	startMode: 'immediate',
	endMode: 'absolute',
	durationSeconds: 86400,
	subCategoryInput: 'Collectibles, Film',
}

beforeEach(() => localStorageMock.clear())
afterEach(() => localStorageMock.clear())

// ---------------------------------------------------------------------------
// Save / load roundtrip
// ---------------------------------------------------------------------------

describe('save/load roundtrip', () => {
	test('restores all formData fields exactly', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const loaded = getAuctionFormDraft(PUBKEY_A)

		expect(loaded).not.toBeNull()
		expect(loaded!.formData.title).toBe('Vintage Camera')
		expect(loaded!.formData.startingBid).toBe('5000')
		expect(loaded!.formData.antiSnipeWindowMinutes).toBe(15)
		expect(loaded!.formData.minBidCurveShape).toBe('linear')
		expect(loaded!.formData.minBidCurvePeakMultiplier).toBe(5)
		expect(loaded!.formData.settlementGracePreset).toBe('1h')
		expect(loaded!.formData.specs).toEqual([{ key: 'Brand', value: 'Leica' }])
		expect(loaded!.formData.shippings).toEqual([{ shippingRef: '30406:seller:standard', extraCost: '200' }])
		expect(loaded!.formData.trustedMints).toEqual(['https://mint.example.com'])
		expect(loaded!.formData.isNSFW).toBe(false)
	})

	test('restores top-level draft fields', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const loaded = getAuctionFormDraft(PUBKEY_A)

		expect(loaded!.startMode).toBe('immediate')
		expect(loaded!.endMode).toBe('absolute')
		expect(loaded!.durationSeconds).toBe(86400)
		expect(loaded!.subCategoryInput).toBe('Collectibles, Film')
		expect(loaded!.images).toEqual([{ imageUrl: 'https://example.com/camera.jpg', imageOrder: 0 }])
	})

	test('savedAt is a recent timestamp', () => {
		const before = Date.now()
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const after = Date.now()
		const loaded = getAuctionFormDraft(PUBKEY_A)

		expect(loaded!.savedAt).toBeGreaterThanOrEqual(before)
		expect(loaded!.savedAt).toBeLessThanOrEqual(after)
	})

	test('overwriting a draft replaces it entirely', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		saveAuctionFormDraft(PUBKEY_A, { ...baseDraft, formData: { ...baseDraft.formData, title: 'Updated Title' } })
		const loaded = getAuctionFormDraft(PUBKEY_A)

		expect(loaded!.formData.title).toBe('Updated Title')
	})
})

// ---------------------------------------------------------------------------
// Malformed JSON handling
// ---------------------------------------------------------------------------

describe('malformed JSON handling', () => {
	test('returns null for unparseable JSON', () => {
		store[`auction_form_draft_${PUBKEY_A}`] = '{not valid json'
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('returns null for JSON null', () => {
		store[`auction_form_draft_${PUBKEY_A}`] = 'null'
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('returns null when pubkey field is missing', () => {
		const { pubkey: _omit, ...withoutPubkey } = { ...baseDraft, pubkey: PUBKEY_A, savedAt: Date.now() }
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(withoutPubkey)
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('returns null when savedAt is missing', () => {
		const record = { ...baseDraft, pubkey: PUBKEY_A }
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(record)
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('coerces unknown antiSnipeWindowMinutes to 0', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const raw = JSON.parse(store[`auction_form_draft_${PUBKEY_A}`]!)
		raw.formData.antiSnipeWindowMinutes = 999
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(raw)

		const loaded = getAuctionFormDraft(PUBKEY_A)
		expect(loaded!.formData.antiSnipeWindowMinutes).toBe(0)
	})

	test('coerces unknown minBidCurveShape to "none"', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const raw = JSON.parse(store[`auction_form_draft_${PUBKEY_A}`]!)
		raw.formData.minBidCurveShape = 'zigzag'
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(raw)

		const loaded = getAuctionFormDraft(PUBKEY_A)
		expect(loaded!.formData.minBidCurveShape).toBe('none')
	})

	test('coerces unknown settlementGracePreset to "1h"', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const raw = JSON.parse(store[`auction_form_draft_${PUBKEY_A}`]!)
		raw.formData.settlementGracePreset = 'forever'
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(raw)

		const loaded = getAuctionFormDraft(PUBKEY_A)
		expect(loaded!.formData.settlementGracePreset).toBe('1h')
	})

	test('drops non-string entries from trustedMints array', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const raw = JSON.parse(store[`auction_form_draft_${PUBKEY_A}`]!)
		raw.formData.trustedMints = ['https://good.mint', 42, null, 'https://other.mint']
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(raw)

		const loaded = getAuctionFormDraft(PUBKEY_A)
		expect(loaded!.formData.trustedMints).toEqual(['https://good.mint', 'https://other.mint'])
	})

	test('drops images with empty imageUrl', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const raw = JSON.parse(store[`auction_form_draft_${PUBKEY_A}`]!)
		raw.images = [
			{ imageUrl: '', imageOrder: 0 },
			{ imageUrl: 'https://example.com/ok.jpg', imageOrder: 1 },
		]
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(raw)

		const loaded = getAuctionFormDraft(PUBKEY_A)
		expect(loaded!.images).toEqual([{ imageUrl: 'https://example.com/ok.jpg', imageOrder: 1 }])
	})

	test('stringified "true" for isNSFW is not treated as true', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		const raw = JSON.parse(store[`auction_form_draft_${PUBKEY_A}`]!)
		raw.formData.isNSFW = 'true'
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(raw)

		const loaded = getAuctionFormDraft(PUBKEY_A)
		expect(loaded!.formData.isNSFW).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// Cross-user safety
// ---------------------------------------------------------------------------

describe('cross-user safety', () => {
	test('drafts are isolated per pubkey', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		saveAuctionFormDraft(PUBKEY_B, { ...baseDraft, formData: { ...baseDraft.formData, title: 'User B Draft' } })

		expect(getAuctionFormDraft(PUBKEY_A)!.formData.title).toBe('Vintage Camera')
		expect(getAuctionFormDraft(PUBKEY_B)!.formData.title).toBe('User B Draft')
	})

	test('clearing one user draft does not affect the other', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		saveAuctionFormDraft(PUBKEY_B, baseDraft)

		clearAuctionFormDraft(PUBKEY_A)

		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
		expect(getAuctionFormDraft(PUBKEY_B)).not.toBeNull()
	})

	test('empty pubkey is rejected on save and returns null on load', () => {
		saveAuctionFormDraft('', baseDraft)
		expect(getAuctionFormDraft('')).toBeNull()
	})

	test('returns null when stored pubkey does not match the requested pubkey', () => {
		// simulate a tampered or misplaced draft: PUBKEY_B's data written under PUBKEY_A's key
		const tampered = { ...baseDraft, pubkey: PUBKEY_B, savedAt: Date.now() }
		store[`auction_form_draft_${PUBKEY_A}`] = JSON.stringify(tampered)
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// Storage access hardening
// ---------------------------------------------------------------------------

const throwingWindow = Object.defineProperty({}, 'localStorage', {
	get() {
		throw new Error('Storage access denied')
	},
})

describe('storage access hardening', () => {
	test('save is a no-op when window.localStorage access throws', () => {
		const original = (globalThis as Record<string, unknown>).window
		;(globalThis as Record<string, unknown>).window = throwingWindow
		try {
			expect(() => saveAuctionFormDraft(PUBKEY_A, baseDraft)).not.toThrow()
		} finally {
			;(globalThis as Record<string, unknown>).window = original
		}
		expect(store[`auction_form_draft_${PUBKEY_A}`]).toBeUndefined()
	})

	test('get returns null when window.localStorage access throws', () => {
		const original = (globalThis as Record<string, unknown>).window
		;(globalThis as Record<string, unknown>).window = throwingWindow
		try {
			expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
		} finally {
			;(globalThis as Record<string, unknown>).window = original
		}
	})
})

// ---------------------------------------------------------------------------
// Clear draft behaviour
// ---------------------------------------------------------------------------

describe('clear draft behaviour', () => {
	test('getAuctionFormDraft returns null after clear', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		clearAuctionFormDraft(PUBKEY_A)
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('hasAuctionFormDraft returns false after clear', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		clearAuctionFormDraft(PUBKEY_A)
		expect(hasAuctionFormDraft(PUBKEY_A)).toBe(false)
	})

	test('clearing a non-existent draft is a no-op', () => {
		expect(() => clearAuctionFormDraft(PUBKEY_A)).not.toThrow()
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// Publish clears draft (simulated via the storage layer)
// ---------------------------------------------------------------------------

describe('publish clears draft', () => {
	test('draft is absent after the publish flow removes it', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		expect(hasAuctionFormDraft(PUBKEY_A)).toBe(true)

		// simulate what handleSubmit does on success
		clearAuctionFormDraft(PUBKEY_A)

		expect(hasAuctionFormDraft(PUBKEY_A)).toBe(false)
	})

	test('saving a new draft after publish works correctly', () => {
		saveAuctionFormDraft(PUBKEY_A, baseDraft)
		clearAuctionFormDraft(PUBKEY_A)

		const newDraft = { ...baseDraft, formData: { ...baseDraft.formData, title: 'New Auction' } }
		saveAuctionFormDraft(PUBKEY_A, newDraft)

		expect(getAuctionFormDraft(PUBKEY_A)!.formData.title).toBe('New Auction')
	})
})

// ---------------------------------------------------------------------------
// Empty form not persisted (guard matches isMeaningfulDraft in the component)
// ---------------------------------------------------------------------------

describe('empty form not persisted', () => {
	test('hasAuctionFormDraft returns false when nothing has been saved', () => {
		expect(hasAuctionFormDraft(PUBKEY_A)).toBe(false)
	})

	test('getAuctionFormDraft returns null for a key that was never written', () => {
		expect(getAuctionFormDraft(PUBKEY_A)).toBeNull()
	})

	test('a draft saved then loaded with no meaningful fields still round-trips structurally', () => {
		const emptyLike: Omit<AuctionFormDraft, 'pubkey' | 'savedAt'> = {
			...baseDraft,
			formData: {
				...baseDraft.formData,
				title: '',
				summary: '',
				description: '',
				startingBid: '',
			},
			images: [],
			subCategoryInput: '',
		}
		// The storage layer itself does not block saving empty content —
		// that guard lives in the component (isMeaningfulDraft). Verify that
		// the storage layer faithfully round-trips whatever it receives.
		saveAuctionFormDraft(PUBKEY_A, emptyLike)
		const loaded = getAuctionFormDraft(PUBKEY_A)
		expect(loaded!.formData.title).toBe('')
		expect(loaded!.images).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// isMeaningfulDraft
// ---------------------------------------------------------------------------

const EMPTY_FORM: AuctionFormData = {
	title: '',
	summary: '',
	description: '',
	startingBid: '',
	bidIncrement: '1',
	reserve: '0',
	startAt: '',
	endAt: '',
	antiSnipeWindowMinutes: 0,
	minBidCurveShape: 'none',
	minBidCurvePeakMultiplier: 2,
	settlementGracePreset: '1h',
	mainCategory: '',
	categories: [],
	imageUrls: [],
	specs: [],
	shippings: [],
	trustedMints: [],
	isNSFW: false,
	pathIssuerPubkey: '',
}

describe('isMeaningfulDraft', () => {
	test('returns false for completely empty form', () => {
		expect(isMeaningfulDraft(EMPTY_FORM)).toBe(false)
	})

	test('returns false when all fields are whitespace-only', () => {
		expect(
			isMeaningfulDraft({
				...EMPTY_FORM,
				title: '   ',
				summary: '\t',
				description: '\n',
				startingBid: ' ',
				mainCategory: '  ',
			}),
		).toBe(false)
	})

	test('returns true when title is set', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, title: 'Vintage Camera' })).toBe(true)
	})

	test('returns true when summary is set', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, summary: 'Rare find' })).toBe(true)
	})

	test('returns true when description is set', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, description: 'Detailed description' })).toBe(true)
	})

	test('returns true when startingBid is set', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, startingBid: '5000' })).toBe(true)
	})

	test('returns true when startAt is set', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, startAt: '2099-01-01T12:00' })).toBe(true)
	})

	test('returns true when endAt is set', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, endAt: '2099-06-01T12:00' })).toBe(true)
	})

	test('returns true when mainCategory is set', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, mainCategory: 'Electronics' })).toBe(true)
	})

	test('returns true when categories has entries', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, categories: ['Photography'] })).toBe(true)
	})

	test('returns true when imageUrls has entries', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, imageUrls: ['https://example.com/img.jpg'] })).toBe(true)
	})

	test('returns true when specs has entries', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, specs: [{ key: 'Brand', value: 'Leica' }] })).toBe(true)
	})

	test('returns true when shippings has entries', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, shippings: [{ shippingRef: '30406:seller:standard', extraCost: '200' }] })).toBe(true)
	})

	test('returns true when isNSFW is toggled', () => {
		expect(isMeaningfulDraft({ ...EMPTY_FORM, isNSFW: true })).toBe(true)
	})

	test('returns true when all fields are populated', () => {
		expect(isMeaningfulDraft(baseDraft.formData)).toBe(true)
	})
})
