import { describe, expect, test } from 'bun:test'
import { announceV4VSplit, splitMatchesCommitment, type V4VSplitRow } from '../v4v/splitAnnouncement'
import { payoutLedgerTagsForSettlement, readPayoutLedgerFromTags, readSplitFromTags, splitTagsForRoot } from '../v4v/zapSplitTags'
import { verifySettlementPayoutClaims } from '../v4v/settlementPayoutEvidence'

const rows: V4VSplitRow[] = [
	{ id: '1', destination: 'alice@example.com', bps: 2500, name: 'Alice' },
	{ id: '2', destination: 'bob@example.com', bps: 2500 },
]
const commitment = (() => {
	const result = announceV4VSplit(rows)
	if (!result.ok) throw new Error('fixture refused')
	return result.announcement.commitment
})()

describe('the announced split on the wire', () => {
	test('writes a split tag and one row tag per row, and reads back the same rows', () => {
		const tags = splitTagsForRoot({ rows, commitment })
		expect(tags[0][0]).toBe('v4v_split')
		expect(tags.filter((tag) => tag[0] === 'v4v_row')).toHaveLength(2)

		const read = readSplitFromTags(tags)
		expect(read.ok).toBe(true)
		if (!read.ok) return
		expect(read.value.rows).toEqual(rows)
		expect(read.value.commitment).toBe(commitment)
		// and the round trip still satisfies the commitment — the point of the whole arrangement
		expect(splitMatchesCommitment(read.value.rows, read.value.commitment)).toBe(true)
	})

	test('a name is optional and travels only when present', () => {
		const tags = splitTagsForRoot({ rows, commitment })
		const alice = tags.find((tag) => tag[0] === 'v4v_row' && tag[1] === '1')
		const bob = tags.find((tag) => tag[0] === 'v4v_row' && tag[1] === '2')
		expect(alice).toHaveLength(5)
		expect(bob).toHaveLength(4)
	})

	test('the declared row count comes from the rows, so it cannot disagree with itself', () => {
		const tags = splitTagsForRoot({ rows, commitment })
		expect(tags[0][3]).toBe('2')
	})

	test('the encoding version travels with the commitment', () => {
		const tags = splitTagsForRoot({ rows, commitment })
		expect(tags[0][2]).toBe('v4v-split-v1')
	})
})

describe("reading a split back is strict, because a validator runs this on a stranger's event", () => {
	test('no split tag at all', () => {
		expect(readSplitFromTags([['e', 'x']])).toMatchObject({ ok: false, code: 'split_tag_missing' })
		expect(readSplitFromTags(undefined)).toMatchObject({ ok: false, code: 'split_tag_missing' })
		expect(readSplitFromTags('nope')).toMatchObject({ ok: false, code: 'split_tag_missing' })
	})

	test('a commitment that is not a hash is malformed', () => {
		expect(readSplitFromTags([['v4v_split', 'deadbeef', 'v4v-split-v1', '0']])).toMatchObject({ ok: false, code: 'split_tag_malformed' })
	})

	test('an unknown encoding version is refused, never compared anyway', () => {
		// a commitment over different bytes is not a mismatch, it is a different question
		expect(readSplitFromTags([['v4v_split', commitment, 'v4v-split-v2', '0']])).toMatchObject({
			ok: false,
			code: 'split_version_unsupported',
		})
	})

	test('a declared row count that disagrees with the rows is refused', () => {
		const tags = splitTagsForRoot({ rows, commitment })
		tags[0] = [tags[0][0], tags[0][1], tags[0][2], '5']
		expect(readSplitFromTags(tags)).toMatchObject({ ok: false, code: 'split_tag_malformed' })
	})

	test('a row with no destination or an unusable share is refused, not skipped', () => {
		expect(
			readSplitFromTags([
				['v4v_split', commitment, 'v4v-split-v1', '1'],
				['v4v_row', '1', '', '1000'],
			]),
		).toMatchObject({
			ok: false,
			code: 'row_tag_malformed',
		})
		expect(
			readSplitFromTags([
				['v4v_split', commitment, 'v4v-split-v1', '1'],
				['v4v_row', '1', 'alice@example.com', 'half'],
			]),
		).toMatchObject({
			ok: false,
			code: 'row_tag_malformed',
		})
		// a silently skipped row is a share that disappears, which is the failure this reader exists to stop
		expect(
			readSplitFromTags([
				['v4v_split', commitment, 'v4v-split-v1', '2'],
				['v4v_row', '1', 'alice@example.com', '1000'],
			]),
		).toMatchObject({
			ok: false,
			code: 'split_tag_malformed',
		})
	})
})

describe('the settlement payout ledger on the wire', () => {
	const claim = {
		commitment,
		settledSats: 1000,
		rows: [
			{ id: '1', destination: 'alice@example.com', bps: 2500, sats: 250, status: 'paid', receiptId: 'abc123' },
			{ id: '2', destination: 'bob@example.com', bps: 2500, sats: 250, status: 'rolled_up' },
		],
	}

	test('round trips, receipt id and all', () => {
		const read = readPayoutLedgerFromTags(payoutLedgerTagsForSettlement({ claim, sellerSats: 500 }))
		expect(read.ok).toBe(true)
		if (!read.ok) return
		expect(read.value.claim.rows).toEqual(claim.rows)
		expect(read.value.claim.settledSats).toBe(1000)
		expect(read.value.claim.commitment).toBe(commitment)
		expect(read.value.sellerSats).toBe(500)
	})

	test('an unknown status fails the whole read, not just that row', () => {
		const tags = payoutLedgerTagsForSettlement({ claim, sellerSats: 500 })
		tags[2] = ['v4v_payout', '1', 'alice@example.com', '2500', '250', 'probably_fine']
		expect(readPayoutLedgerFromTags(tags)).toMatchObject({ ok: false, code: 'row_status_unknown' })
	})

	test('a missing settled amount or commitment is refused', () => {
		expect(readPayoutLedgerFromTags([['v4v_payout', '1', 'alice@example.com', '2500', '250', 'paid']])).toMatchObject({
			ok: false,
			code: 'payout_tag_malformed',
		})
		expect(readPayoutLedgerFromTags([['v4v_settled', '1000', 'nothash']])).toMatchObject({ ok: false, code: 'payout_tag_malformed' })
	})

	test('a negative or fractional amount is refused', () => {
		expect(readPayoutLedgerFromTags([['v4v_settled', '-5', commitment]])).toMatchObject({ ok: false, code: 'payout_tag_malformed' })
		expect(
			readPayoutLedgerFromTags([
				['v4v_settled', '1000', commitment],
				['v4v_payout', '1', 'alice@example.com', '2500', '2.5', 'paid'],
			]),
		).toMatchObject({ ok: false, code: 'payout_tag_malformed' })
	})

	test('an absent seller remainder reads as zero rather than failing — the validator refuses it later, in one place', () => {
		const tags = payoutLedgerTagsForSettlement({ claim, sellerSats: 500 }).filter((tag) => tag[0] !== 'v4v_seller')
		const read = readPayoutLedgerFromTags(tags)
		expect(read.ok).toBe(true)
		if (!read.ok) return
		expect(read.value.sellerSats).toBe(0)
	})
})

describe('the wire and the check compose', () => {
	test('tags written by a seller are readable, committable and checkable end to end', async () => {
		const rootTags = splitTagsForRoot({ rows, commitment })
		const readSplit = readSplitFromTags(rootTags)
		expect(readSplit.ok).toBe(true)
		if (!readSplit.ok) return

		// both announced rows are accounted for: the check refuses a claim that leaves one out, so a
		// fixture that omitted bob would be testing the hole rather than the composition
		const claim = {
			commitment: readSplit.value.commitment,
			settledSats: 1000,
			rows: [
				{ id: '1', destination: 'alice@example.com', bps: 2500, sats: 250, status: 'no_receipt_expected' },
				{ id: '2', destination: 'bob@example.com', bps: 2500, sats: 250, status: 'rolled_up' },
			],
		}
		// 250 + 250 to the rows, so the seller remainder that closes the sum is 500 — the check refuses a
		// ledger whose arithmetic does not close, and this fixture has to close for the right reason
		const readLedger = readPayoutLedgerFromTags(payoutLedgerTagsForSettlement({ claim, sellerSats: 500 }))
		expect(readLedger.ok).toBe(true)
		if (!readLedger.ok) return

		// the announcement as read off the wire is the one the commitment was made to
		expect(splitMatchesCommitment(readSplit.value.rows, readLedger.value.claim.commitment)).toBe(true)

		// and the validator's check accepts the ledger the seller actually published
		const verdict = await verifySettlementPayoutClaims({
			claim: readLedger.value.claim,
			announcedRows: readSplit.value.rows,
			claimedSellerSats: readLedger.value.sellerSats,
			lookupReceipt: async () => null,
		})
		expect(verdict.ok).toBe(true)
	})

	test('a settlement whose ledger was edited on the wire no longer matches the announcement', async () => {
		const rootTags = splitTagsForRoot({ rows, commitment })
		const readSplit = readSplitFromTags(rootTags)
		if (!readSplit.ok) throw new Error('fixture refused')

		// the seller keeps alice's address but rewrites her share on the settlement
		const readLedger = readPayoutLedgerFromTags(
			payoutLedgerTagsForSettlement({
				claim: {
					commitment,
					settledSats: 1000,
					rows: [{ id: '1', destination: 'alice@example.com', bps: 9000, sats: 900, status: 'no_receipt_expected' }],
				},
				sellerSats: 100,
			}),
		)
		if (!readLedger.ok) throw new Error('fixture refused')

		const verdict = await verifySettlementPayoutClaims({
			claim: readLedger.value.claim,
			announcedRows: readSplit.value.rows,
			claimedSellerSats: readLedger.value.sellerSats,
			lookupReceipt: async () => null,
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings.map((finding) => finding.code)).toContain('row_total_mismatch')
	})
})
