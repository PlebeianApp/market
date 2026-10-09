import { describe, expect, test } from 'bun:test'
import { HDKey } from '@scure/bip32'
import { base64urlnopad } from '@scure/base'
import { AuctionMultipartyAuthorizationError, parseMultipartyRoot } from '../auction/multipartyAuthorization'
import { buildMultipartyRootTags } from '../auction/multipartyRootTags'
import { parseMultipartyRecipientLines, resolveMultipartyPayoutSchedule } from '../auction/multipartyPublishSchedule'
import type { AuctionMultipartyCanonicalSchedule } from '../auction/multipartySchedule'
import { AUCTION_SETTLEMENT_POLICY } from '../auctionSettlement'
import { buildAuctionRootTagList } from '../../publish/auctions'
import type { ValidatedAuctionPublishData } from '../auctionPublishValidation'

const SELLER = 'f'.repeat(64)
const VALIDATOR = '2'.repeat(64)
const V4V = '3'.repeat(64)
const OFFER_ID = 'b'.repeat(64)
const CAPABILITY_VALIDATOR = 'a'.repeat(64)
const CAPABILITY_V4V = 'c'.repeat(64)
const MINT = 'https://mint.example'
const MULTIPARTY_POLICY = 'cashu_p2pk_bidder_path_multiparty_v1'
/** A real public xpub: the root parser validates it with HDKey, not by shape. */
const SELLER_XPUB = HDKey.fromMasterSeed(new Uint8Array(32).fill(1)).publicExtendedKey

const validated = (overrides: Partial<ValidatedAuctionPublishData> = {}): ValidatedAuctionPublishData => ({
	title: 'Harvest auction',
	summary: 'A crate of pears',
	description: 'Straight from the orchard.',
	startingBid: 1_000,
	bidIncrement: 100,
	reserve: 0,
	startAt: 1_800_000_000,
	endAt: 1_800_003_600,
	durationSeconds: 3_600,
	antiSnipeWindowSeconds: 0,
	minBidCurveShape: 'none',
	minBidCurvePeakMultiplier: 1,
	settlementGracePreset: '1h',
	maxEndAt: 1_800_003_600,
	imageUrls: [],
	shippings: [],
	trustedMints: [MINT],
	...overrides,
})

const baseTags = (): string[][] =>
	buildAuctionRootTagList({
		id: 'auction_1',
		validated: validated(),
		auditors: [VALIDATOR],
		p2pkXpub: SELLER_XPUB,
		settlementGraceSeconds: 3_600,
		minBidCurveTagValue: 'none:1.0',
		keyScheme: 'hd_p2pk',
		mainCategory: 'fruit',
		categories: ['pears'],
		specs: [],
		isNSFW: false,
		enableLiveChat: true,
	})

const scheduleFor = (): AuctionMultipartyCanonicalSchedule => {
	const resolution = resolveMultipartyPayoutSchedule({
		recipients: parseMultipartyRecipientLines(
			`validator, ${VALIDATOR}, 625, ${CAPABILITY_VALIDATOR}, ${OFFER_ID}\nv4v, ${V4V}, 313, ${CAPABILITY_V4V}`,
		),
		auditors: [VALIDATOR],
		sellerPubkey: SELLER,
	})
	if (resolution === null) {
		throw new Error('fixture must resolve to a schedule')
	}
	return resolution.schedule
}

const rootEvent = (tags: string[][]) => ({
	id: 'd'.repeat(64),
	pubkey: SELLER,
	sig: 'e'.repeat(128),
	created_at: 1_800_000_000,
	kind: 30408,
	tags,
	content: '',
})

const readTag = (tags: readonly string[][], name: string): string | undefined => tags.find((tag) => tag[0] === name)?.[1]

const code = (fn: () => unknown): string => {
	try {
		fn()
	} catch (error) {
		return error instanceof AuctionMultipartyAuthorizationError ? error.code : `not_our_error:${String(error)}`
	}
	return 'no_error'
}

describe('Auction root tags — single-party and multiparty', () => {
	test('the single-party tag list is what the publish path emitted before', () => {
		const tags = baseTags()
		expect(readTag(tags, 'd')).toBe('auction_1')
		expect(readTag(tags, 'settlement_policy')).toBe(AUCTION_SETTLEMENT_POLICY)
		expect(readTag(tags, 'payout_schedule')).toBeUndefined()
		expect(readTag(tags, 'payout_schedule_commitment')).toBeUndefined()
		expect(tags.filter((tag) => tag[0] === 'mint')).toEqual([['mint', MINT]])
		expect(tags.filter((tag) => tag[0] === 'auditors')).toEqual([['auditors', VALIDATOR]])
		expect(readTag(tags, 'auditor_quorum')).toBe('1')
		expect(readTag(tags, 'starting_bid')).toBe('1000')
		expect(readTag(tags, 'p2pk_xpub')).toBe(SELLER_XPUB)
		expect(readTag(tags, 'schema')).toBe('auction_v1')
		expect(readTag(tags, 'title')).toBe('Harvest auction')
	})

	test('the multiparty projection switches the policy and appends the schedule', () => {
		const base = baseTags()
		const schedule = scheduleFor()
		const tags = buildMultipartyRootTags({ baseTags: base, schedule })

		expect(readTag(tags, 'settlement_policy')).toBe(MULTIPARTY_POLICY)
		expect(tags.filter((tag) => tag[0] === 'settlement_policy')).toHaveLength(1)
		const scheduleTagValue = readTag(tags, 'payout_schedule') as string
		expect(scheduleTagValue.startsWith('b64u:')).toBe(true)
		expect(base64urlnopad.decode(scheduleTagValue.slice('b64u:'.length))).toEqual(schedule.canonical_bytes)
		expect(readTag(tags, 'payout_schedule_commitment')).toBe(schedule.schedule_commitment)
	})

	test('the projection leaves the caller-owned base tags untouched', () => {
		const base = baseTags()
		const snapshot = JSON.stringify(base)
		buildMultipartyRootTags({ baseTags: base, schedule: scheduleFor() })
		expect(JSON.stringify(base)).toBe(snapshot)
	})

	test('the published multiparty root parses through the read-side root parser', () => {
		const schedule = scheduleFor()
		const tags = buildMultipartyRootTags({ baseTags: baseTags(), schedule })
		const parsed = parseMultipartyRoot(rootEvent(tags))

		expect(parsed.payout_schedule_commitment).toBe(schedule.schedule_commitment)
		expect(parsed.seller_pubkey).toBe(SELLER)
		expect(base64urlnopad.decode(parsed.payout_schedule_b64u)).toEqual(schedule.canonical_bytes)
	})

	test('a root whose commitment tag does not match its schedule bytes is refused', () => {
		const tags = buildMultipartyRootTags({ baseTags: baseTags(), schedule: scheduleFor() })
		const tampered = tags.map((tag) => (tag[0] === 'payout_schedule_commitment' ? ['payout_schedule_commitment', '0'.repeat(64)] : tag))
		expect(code(() => parseMultipartyRoot(rootEvent(tampered)))).toBe('root_schedule_commitment_mismatch')
	})
})
