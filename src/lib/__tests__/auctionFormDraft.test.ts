import { beforeEach, describe, expect, test } from 'bun:test'
import type { AuctionFormData } from '@/publish/auctions'
import {
	clearDraft,
	getAuctionDraftKey,
	isDraftMeaningful,
	loadDraft,
	saveDraft,
	type AuctionFormDraft,
} from '@/lib/utils/auctionFormDraft'

// ── localStorage mock ───────────────────────────────────────────────────────
// Bun's test runner has no browser globals; wire up a minimal in-memory shim.
const store: Record<string, string> = {}
const localStorageMock = {
	getItem: (key: string) => store[key] ?? null,
	setItem: (key: string, value: string) => {
		store[key] = value
	},
	removeItem: (key: string) => {
		delete store[key]
	},
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

// ── fixtures ────────────────────────────────────────────────────────────────
const PUBKEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PUBKEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const emptyFormData: AuctionFormData = {
	title: '',
	summary: '',
	description: '',
	startingBid: '',
	bidIncrement: '1',
	reserve: undefined,
	startAt: '',
	endAt: '',
	antiSnipeWindowMinutes: 0,
	minBidCurveShape: 'none' as const,
	minBidCurvePeakMultiplier: 2,
	settlementGracePreset: '1h' as const,
	mainCategory: '',
	categories: [],
	imageUrls: [],
	specs: [],
	shippings: [],
	trustedMints: [],
	isNSFW: false,
	pathIssuerPubkey: '',
}

const meaningfulFormData: AuctionFormData = { ...emptyFormData, title: 'Rare print', description: 'First edition', startingBid: '1000' }

const baseDraft: AuctionFormDraft = {
	formData: meaningfulFormData,
	images: [],
	subCategoryInput: '',
	startMode: 'immediate',
	endMode: 'duration',
	durationSeconds: 86400,
	activeTab: 'name',
}

beforeEach(() => {
	// Wipe the mock store between tests so they don't bleed into each other.
	for (const key of Object.keys(store)) delete store[key]
})

// ── save / load roundtrip ───────────────────────────────────────────────────
describe('save/load roundtrip', () => {
	test('loaded draft matches what was saved', () => {
		saveDraft(PUBKEY_A, baseDraft)
		const loaded = loadDraft(PUBKEY_A)
		expect(loaded).not.toBeNull()
		expect(loaded!.formData.title).toBe('Rare print')
		expect(loaded!.formData.startingBid).toBe('1000')
		expect(loaded!.startMode).toBe('immediate')
		expect(loaded!.endMode).toBe('duration')
		expect(loaded!.durationSeconds).toBe(86400)
		expect(loaded!.activeTab).toBe('name')
	})

	test('roundtrip preserves images array', () => {
		const draft: AuctionFormDraft = {
			...baseDraft,
			images: [{ imageUrl: 'https://cdn.example/img.jpg', imageOrder: 0 }],
		}
		saveDraft(PUBKEY_A, draft)
		const loaded = loadDraft(PUBKEY_A)
		expect(loaded!.images).toEqual([{ imageUrl: 'https://cdn.example/img.jpg', imageOrder: 0 }])
	})
})

// ── malformed JSON handling ─────────────────────────────────────────────────
describe('malformed JSON handling', () => {
	test('returns null when stored value is not valid JSON', () => {
		const key = getAuctionDraftKey(PUBKEY_A)!
		store[key] = '{ this is not json }'
		expect(loadDraft(PUBKEY_A)).toBeNull()
	})

	test('returns null when stored JSON fails schema validation', () => {
		const key = getAuctionDraftKey(PUBKEY_A)!
		store[key] = JSON.stringify({ version: 99, ownerPubkey: PUBKEY_A, savedAt: Date.now(), draft: {} })
		expect(loadDraft(PUBKEY_A)).toBeNull()
	})

	test('returns null when storage key is absent', () => {
		expect(loadDraft(PUBKEY_A)).toBeNull()
	})
})

// ── cross-user safety ───────────────────────────────────────────────────────
describe('cross-user safety', () => {
	test('draft saved by user A is not returned when loading as user B', () => {
		saveDraft(PUBKEY_A, baseDraft)
		expect(loadDraft(PUBKEY_B)).toBeNull()
	})

	test('each user gets their own storage key', () => {
		expect(getAuctionDraftKey(PUBKEY_A)).not.toBe(getAuctionDraftKey(PUBKEY_B))
	})

	test('tampered ownerPubkey in envelope is rejected', () => {
		// Save a valid draft for A, then mutate the stored envelope to claim it belongs to B.
		saveDraft(PUBKEY_A, baseDraft)
		const key = getAuctionDraftKey(PUBKEY_A)!
		const raw = JSON.parse(store[key])
		raw.ownerPubkey = PUBKEY_B
		store[key] = JSON.stringify(raw)
		// Loading as A should fail because ownerPubkey !== A.
		expect(loadDraft(PUBKEY_A)).toBeNull()
	})
})

// ── clear draft behavior ────────────────────────────────────────────────────
describe('clear draft behavior', () => {
	test('clearDraft removes the stored item so loadDraft returns null', () => {
		saveDraft(PUBKEY_A, baseDraft)
		expect(loadDraft(PUBKEY_A)).not.toBeNull()
		clearDraft(PUBKEY_A)
		expect(loadDraft(PUBKEY_A)).toBeNull()
	})

	test('clearDraft with no prior draft does not throw', () => {
		expect(() => clearDraft(PUBKEY_A)).not.toThrow()
	})

	test("clearDraft only removes the target user's draft", () => {
		saveDraft(PUBKEY_A, baseDraft)
		saveDraft(PUBKEY_B, baseDraft)
		clearDraft(PUBKEY_A)
		expect(loadDraft(PUBKEY_A)).toBeNull()
		expect(loadDraft(PUBKEY_B)).not.toBeNull()
	})
})

// ── publish clears draft ────────────────────────────────────────────────────
describe('publish clears draft', () => {
	test('calling clearDraft after a successful publish removes the draft', () => {
		saveDraft(PUBKEY_A, baseDraft)
		// Simulate what AuctionFormContent does on successful publish:
		clearDraft(PUBKEY_A)
		expect(loadDraft(PUBKEY_A)).toBeNull()
	})

	test('draft key is absent from storage after publish-triggered clear', () => {
		saveDraft(PUBKEY_A, baseDraft)
		clearDraft(PUBKEY_A)
		const key = getAuctionDraftKey(PUBKEY_A)!
		expect(store[key]).toBeUndefined()
	})
})

// ── empty form not persisted ────────────────────────────────────────────────
describe('empty form not persisted', () => {
	test('isDraftMeaningful returns false for a fully empty form', () => {
		const candidate: AuctionFormDraft = {
			formData: emptyFormData,
			images: [],
			subCategoryInput: '',
			startMode: 'immediate',
			endMode: 'duration',
			durationSeconds: 86400,
			activeTab: 'name',
		}
		expect(isDraftMeaningful(candidate)).toBe(false)
	})

	test('isDraftMeaningful returns true once a field is filled in', () => {
		const candidate: AuctionFormDraft = {
			formData: { ...emptyFormData, description: 'something' },
			images: [],
			subCategoryInput: '',
			startMode: 'immediate',
			endMode: 'duration',
			durationSeconds: 86400,
			activeTab: 'name',
		}
		expect(isDraftMeaningful(candidate)).toBe(true)
	})

	test('isDraftMeaningful returns true when images list is non-empty', () => {
		const candidate: AuctionFormDraft = {
			formData: emptyFormData,
			images: [{ imageUrl: 'https://cdn.example/img.jpg', imageOrder: 0 }],
			subCategoryInput: '',
			startMode: 'immediate',
			endMode: 'duration',
			durationSeconds: 86400,
			activeTab: 'name',
		}
		expect(isDraftMeaningful(candidate)).toBe(true)
	})

	test('isDraftMeaningful returns true when subCategoryInput has content', () => {
		const candidate: AuctionFormDraft = {
			formData: emptyFormData,
			images: [],
			subCategoryInput: 'Collectibles',
			startMode: 'immediate',
			endMode: 'duration',
			durationSeconds: 86400,
			activeTab: 'name',
		}
		expect(isDraftMeaningful(candidate)).toBe(true)
	})

	test('saveDraft with no pubkey does not write to storage', () => {
		saveDraft(undefined, baseDraft)
		expect(Object.keys(store)).toHaveLength(0)
	})
})
