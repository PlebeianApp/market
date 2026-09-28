import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { announceV4VSplit, type V4VSplitRow } from '../v4v/splitAnnouncement'
import { verifySettlementPayoutClaims, type SettlementPayoutClaim } from '../v4v/settlementPayoutEvidence'

const auctionAnchor = { kind: 'a' as const, value: '30408:' + 'a'.repeat(64) + ':auction-1' }
const serverKey = sha256(new TextEncoder().encode('evidence-server-seed'))
const recipientPubkey = getPublicKey(sha256(new TextEncoder().encode('evidence-recipient-seed')))

const announced: V4VSplitRow[] = [
	{ id: '1', destination: 'alice@example.com', bps: 5000 },
	{ id: '2', destination: 'bob@example.com', bps: 5000 },
]
const commitment = (() => {
	const result = announceV4VSplit(announced)
	if (!result.ok) throw new Error('fixture split refused')
	return result.announcement.commitment
})()

const receipt = (amountPart = '5u', overrides: { recipient?: string; anchor?: string } = {}) =>
	finalizeEvent(
		{
			kind: 9735,
			created_at: 1_700_000_000,
			tags: [
				['p', overrides.recipient ?? recipientPubkey],
				['a', overrides.anchor ?? auctionAnchor.value],
				['bolt11', `lnbc${amountPart}1${'q'.repeat(20)}`],
				['description', JSON.stringify({ kind: 9734, tags: [['p', recipientPubkey]], content: '' })],
			],
			content: '',
		},
		serverKey,
	)

/** 500 sats planned per row: `5u` is 500 sats. */
const claim = (rows: SettlementPayoutClaim['rows'], settledSats = 1500, sellerSats = 500, c: string = commitment): SettlementPayoutClaim =>
	({
		rows,
		commitment: c,
		settledSats,
		...(sellerSats !== undefined ? {} : {}),
	}) as SettlementPayoutClaim

const paidRow = (id: string, destination: string, sats = 500, status = 'paid') => ({ id, destination, bps: 5000, sats, status })

const check = (input: {
	claim: SettlementPayoutClaim
	receipts?: Record<string, unknown | null>
	announcedRows?: V4VSplitRow[]
	claimedSellerSats?: number
}) =>
	verifySettlementPayoutClaims({
		claim: input.claim,
		announcedRows: input.announcedRows ?? announced,
		claimedSellerSats: input.claimedSellerSats ?? 500,
		auctionAnchor,
		lookupReceipt: async (row) => (input.receipts?.[row.id] ?? null) as never,
	})

describe('a claim that can be believed', () => {
	test('two paid rows with verifying receipts and closing arithmetic pass', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com')]),
			receipts: { '1': receipt(), '2': receipt() },
		})
		expect(verdict.ok).toBe(true)
		if (!verdict.ok) return
		expect(verdict.paidSats).toBe(1000)
		expect(verdict.unspentSats).toBe(0)
	})

	test('an unpaid row that is disclosed as unspent is accepted, and counted as unspent', async () => {
		const verdict = await check({
			claim: claim([
				paidRow('1', 'alice@example.com'),
				{ id: '2', destination: 'bob@example.com', bps: 5000, sats: 500, status: 'rolled_up' },
			]),
			receipts: { '1': receipt() },
		})
		expect(verdict.ok).toBe(true)
		if (!verdict.ok) return
		expect(verdict.paidSats).toBe(500)
		expect(verdict.unspentSats).toBe(500)
	})

	test('no_receipt_expected is the documented weaker tier and is accepted without a receipt', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com', 500, 'no_receipt_expected'), paidRow('2', 'bob@example.com')]),
			receipts: { '2': receipt() },
		})
		expect(verdict.ok).toBe(true)
	})
})

describe('the checks a validator must not be lenient about', () => {
	test('an announcement that does not hash to the cited commitment is refused first', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com')], 1500, 500, 'f'.repeat(64)),
			receipts: { '1': receipt(), '2': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings.map((finding) => finding.code)).toContain('commitment_mismatch')
	})

	test('a row claimed paid with no receipt is not evidence', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com')]),
			receipts: { '2': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings).toContainEqual(expect.objectContaining({ code: 'paid_without_evidence', rowId: '1' }))
	})

	test('a receipt for the wrong amount does not verify', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com')]),
			receipts: { '1': receipt('9u'), '2': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings).toContainEqual(expect.objectContaining({ code: 'receipt_not_verifying', rowId: '1' }))
	})

	test('a receipt that does not reference this auction does not verify', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com')]),
			receipts: { '1': receipt('5u', { anchor: '30408:' + 'c'.repeat(64) + ':other' }), '2': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings[0]?.code).toBe('receipt_not_verifying')
	})

	test('a lookup that throws is treated as no receipt, not as a pass', async () => {
		const verdict = await verifySettlementPayoutClaims({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com')]),
			announcedRows: announced,
			claimedSellerSats: 500,
			auctionAnchor,
			lookupReceipt: async () => {
				throw new Error('relay down')
			},
		})
		expect(verdict.ok).toBe(false)
	})

	test('an announced row the settlement does not account for is a finding — a hole is how a share disappears', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com')], 1000, 0),
			receipts: { '1': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings).toContainEqual(expect.objectContaining({ code: 'unpaid_row_missing_from_claim', rowId: '2' }))
	})

	test('a row added to the claim that was never announced is a finding', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com'), paidRow('3', 'mallory@example.com')]),
			receipts: { '1': receipt(), '2': receipt(), '3': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings).toContainEqual(expect.objectContaining({ code: 'row_not_announced', rowId: '3' }))
	})

	test('a claim that edits the announced share is a finding', async () => {
		const verdict = await check({
			claim: claim([{ id: '1', destination: 'alice@example.com', bps: 9000, sats: 900, status: 'paid' }, paidRow('2', 'bob@example.com')]),
			receipts: { '1': receipt('9u'), '2': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings).toContainEqual(expect.objectContaining({ code: 'row_total_mismatch', rowId: '1' }))
	})

	test('an unknown status is refused rather than guessed at', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com', 500, 'probably_fine'), paidRow('2', 'bob@example.com')]),
			receipts: { '2': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings).toContainEqual(expect.objectContaining({ code: 'unknown_status', rowId: '1' }))
	})

	test('an unpaid row that cites a receipt is a finding', async () => {
		const verdict = await check({
			claim: claim([
				{ id: '1', destination: 'alice@example.com', bps: 5000, sats: 500, status: 'payment_failed', receiptId: 'deadbeef' },
				paidRow('2', 'bob@example.com'),
			]),
			receipts: { '2': receipt() },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings).toContainEqual(expect.objectContaining({ code: 'receipt_not_verifying', rowId: '1' }))
	})
})

describe('the arithmetic has to close', () => {
	test('a claim that omits the seller remainder cannot be checked and is refused', async () => {
		const verdict = await verifySettlementPayoutClaims({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com')]),
			announcedRows: announced,
			auctionAnchor,
			lookupReceipt: async () => receipt() as never,
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings).toContainEqual(expect.objectContaining({ code: 'reconciliation_failed' }))
	})

	test('numbers that do not add up are refused, with the arithmetic in the detail', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com'), paidRow('2', 'bob@example.com')], 1500),
			receipts: { '1': receipt(), '2': receipt() },
			claimedSellerSats: 100,
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		const finding = verdict.findings.find((entry) => entry.code === 'reconciliation_failed')
		expect(finding?.detail).toContain('1000')
		expect(finding?.detail).toContain('1500')
	})

	test('rows asking for more than the settled amount are refused', async () => {
		const verdict = await check({
			claim: claim([paidRow('1', 'alice@example.com', 2000), paidRow('2', 'bob@example.com', 2000)], 3000, 0),
			receipts: { '1': receipt('20u'), '2': receipt('20u') },
		})
		expect(verdict.ok).toBe(false)
		if (verdict.ok) return
		expect(verdict.findings.map((finding) => finding.code)).toContain('row_total_mismatch')
	})
})
