import { describe, expect, test } from 'bun:test'
import {
	AuctionMultipartyPublishScheduleError,
	parseMultipartyRecipientLines,
	resolveMultipartyPayoutSchedule,
} from '../auction/multipartyPublishSchedule'
import { AuctionMultipartyScheduleError } from '../auction/multipartySchedule'

const SELLER = 'f'.repeat(64)
const VALIDATOR = '2'.repeat(64)
const V4V = '3'.repeat(64)
const OFFER_ID = 'b'.repeat(64)
const CAPABILITY_VALIDATOR = 'a'.repeat(64)
const CAPABILITY_V4V = 'c'.repeat(64)

const VALIDATOR_LINE = `validator, ${VALIDATOR}, 625, ${CAPABILITY_VALIDATOR}, ${OFFER_ID}`
const V4V_LINE = `v4v, ${V4V}, 313, ${CAPABILITY_V4V}`

const code = (fn: () => unknown): string => {
	try {
		fn()
	} catch (error) {
		if (error instanceof AuctionMultipartyPublishScheduleError) return error.code
		if (error instanceof AuctionMultipartyScheduleError) return error.code
		return `not_our_error:${String(error)}`
	}
	return 'no_error'
}

describe('Multiparty payout recipients — seller-side lines', () => {
	test('parses a validator line and a v4v line into recipient inputs', () => {
		expect(parseMultipartyRecipientLines(`${VALIDATOR_LINE}\n${V4V_LINE}`)).toEqual([
			{
				role: 'validator',
				recipient_pubkey: VALIDATOR,
				allocation_bps: 625,
				payout_capability_event_id: CAPABILITY_VALIDATOR,
				validator_offer_event_id: OFFER_ID,
			},
			{
				role: 'v4v',
				recipient_pubkey: V4V,
				allocation_bps: 313,
				payout_capability_event_id: CAPABILITY_V4V,
			},
		])
	})

	test('accepts commas, whitespace and mixed separators between the fields', () => {
		const comma = parseMultipartyRecipientLines(VALIDATOR_LINE)
		const spaces = parseMultipartyRecipientLines(`validator ${VALIDATOR} 625 ${CAPABILITY_VALIDATOR} ${OFFER_ID}`)
		const mixed = parseMultipartyRecipientLines(`validator,${VALIDATOR} 625, ${CAPABILITY_VALIDATOR},${OFFER_ID}`)
		expect(spaces).toEqual(comma)
		expect(mixed).toEqual(comma)
	})

	test('ignores blank lines and comment lines', () => {
		expect(parseMultipartyRecipientLines(`\n# a note about the split\n${V4V_LINE}\n\n`)).toEqual([
			{
				role: 'v4v',
				recipient_pubkey: V4V,
				allocation_bps: 313,
				payout_capability_event_id: CAPABILITY_V4V,
			},
		])
	})

	test('an empty field yields no recipients, so the single-party path is untouched', () => {
		expect(parseMultipartyRecipientLines('')).toEqual([])
		expect(parseMultipartyRecipientLines('   \n\n')).toEqual([])
		expect(resolveMultipartyPayoutSchedule({ recipients: [], auditors: [VALIDATOR], sellerPubkey: SELLER })).toBeNull()
	})

	test('rejects a line with too few or too many fields, naming the line number', () => {
		expect(code(() => parseMultipartyRecipientLines(`validator, ${VALIDATOR}, 625`))).toBe('payout_recipient_line_invalid:1')
		expect(
			code(() =>
				parseMultipartyRecipientLines(`${VALIDATOR_LINE}\nvalidator, ${VALIDATOR}, 625, ${CAPABILITY_VALIDATOR}, ${OFFER_ID}, extra`),
			),
		).toBe('payout_recipient_line_invalid:2')
	})

	test('rejects an unknown role, naming the line', () => {
		expect(code(() => parseMultipartyRecipientLines(`auditor, ${VALIDATOR}, 625, ${CAPABILITY_VALIDATOR}, ${OFFER_ID}`))).toBe(
			'payout_recipient_role_invalid:1',
		)
	})

	test('rejects a zero, over-budget or non-numeric allocation', () => {
		expect(code(() => parseMultipartyRecipientLines(`v4v, ${V4V}, 0, ${CAPABILITY_V4V}`))).toBe('payout_recipient_allocation_invalid:1')
		expect(code(() => parseMultipartyRecipientLines(`v4v, ${V4V}, 10001, ${CAPABILITY_V4V}`))).toBe('payout_recipient_allocation_invalid:1')
		expect(code(() => parseMultipartyRecipientLines(`v4v, ${V4V}, abc, ${CAPABILITY_V4V}`))).toBe('payout_recipient_allocation_invalid:1')
	})

	test('rejects a non-canonical pubkey or event id, naming the line and the field', () => {
		expect(code(() => parseMultipartyRecipientLines(`v4v, ${'a'.repeat(64).toUpperCase()}, 313, ${CAPABILITY_V4V}`))).toBe(
			'payout_recipient_pubkey_noncanonical:1',
		)
		expect(code(() => parseMultipartyRecipientLines(`v4v, ${V4V}, 313, short`))).toBe('payout_recipient_capability_noncanonical:1')
		expect(
			code(() =>
				parseMultipartyRecipientLines(
					`${VALIDATOR_LINE}\nv4v, ${V4V}, 313, ${CAPABILITY_V4V}\nvalidator, ${VALIDATOR}, 625, ${CAPABILITY_VALIDATOR}, short`,
				),
			),
		).toBe('payout_recipient_offer_noncanonical:3')
	})

	test('rejects an offer id on a v4v line, because there is no offer to make', () => {
		expect(code(() => parseMultipartyRecipientLines(`v4v, ${V4V}, 313, ${CAPABILITY_V4V}, ${OFFER_ID}`))).toBe(
			'payout_recipient_offer_not_allowed_for_v4v:1',
		)
	})

	test('requires an offer id for a validator recipient at resolution time', () => {
		expect(
			code(() =>
				resolveMultipartyPayoutSchedule({
					recipients: parseMultipartyRecipientLines(`validator, ${VALIDATOR}, 625, ${CAPABILITY_VALIDATOR}`),
					auditors: [VALIDATOR],
					sellerPubkey: SELLER,
				}),
			),
		).toBe('payout_recipient_validator_offer_missing')
	})

	test('compiles a schedule with canonical indexes and the seller remainder', () => {
		const resolution = resolveMultipartyPayoutSchedule({
			recipients: parseMultipartyRecipientLines(`${VALIDATOR_LINE}\n${V4V_LINE}`),
			auditors: [VALIDATOR],
			sellerPubkey: SELLER,
		})
		expect(resolution).not.toBeNull()
		expect(resolution?.entries).toEqual([
			{ schedule_index: 0, role: 'validator' },
			{ schedule_index: 1, role: 'v4v' },
		])
		expect(resolution?.schedule.auxiliary_allocation_bps).toBe(938)
		expect(resolution?.schedule.seller_remainder_bps).toBe(9_062)
		expect(resolution?.schedule.schedule_commitment).toMatch(/^[0-9a-f]{64}$/)
		expect(Object.isFrozen(resolution)).toBe(true)
	})

	test('refuses the seller as a recipient, because their remainder is implicit', () => {
		expect(
			code(() =>
				resolveMultipartyPayoutSchedule({
					recipients: parseMultipartyRecipientLines(`v4v, ${SELLER}, 313, ${CAPABILITY_V4V}`),
					auditors: [VALIDATOR],
					sellerPubkey: SELLER,
				}),
			),
		).toBe('payout_recipient_seller_included')
	})

	test('refuses a validator recipient that the auction does not list as an auditor', () => {
		expect(
			code(() =>
				resolveMultipartyPayoutSchedule({
					recipients: parseMultipartyRecipientLines(VALIDATOR_LINE),
					auditors: ['9'.repeat(64)],
					sellerPubkey: SELLER,
				}),
			),
		).toBe('payout_recipient_validator_not_listed_as_auditor')
	})

	test('leaves the remaining schedule rules to the codec instead of restating them', () => {
		// Two lines for the same recipient: the codec owns duplicate detection.
		expect(
			code(() =>
				resolveMultipartyPayoutSchedule({
					recipients: parseMultipartyRecipientLines(`${V4V_LINE}\nv4v, ${V4V}, 100, ${CAPABILITY_V4V}`),
					auditors: [VALIDATOR],
					sellerPubkey: SELLER,
				}),
			),
		).toBe('schedule_duplicate_role_recipient')
	})
})
