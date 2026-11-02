import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	demoIntegratedFundingV4AdmissionSignatureDigest,
	finalizeDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4Unsigned,
} from './demo-integrated-funding-receipt-v4'
import {
	DemoFridayV4BroadcastJournalSqlite,
	DemoFridayV4BroadcastRollbackAnchorSqlite,
} from './demo-friday-v4-funding-service'

const ACTOR_KEY = hexToBytes('1'.padStart(64, '0'))

function receipt() {
	const unsigned = (JSON.parse(readFileSync('../fixtures/integrated-funding-v4-browser-golden.json', 'utf8')) as {
		receipt: DemoIntegratedFundingReceiptV4Unsigned
	}).receipt
	const policy = 'd'.repeat(64)
	return finalizeDemoIntegratedFundingReceiptV4(
		unsigned, policy, bytesToHex(schnorr.sign(
			hexToBytes(demoIntegratedFundingV4AdmissionSignatureDigest(unsigned, policy)),
			hexToBytes('4'.padStart(64, '0')),
		)),
	)
}

function signed(receiptValue: ReturnType<typeof receipt>) {
	const unsigned = {
		pubkey: receiptValue.bidder, created_at: receiptValue.attested_at, kind: 28641 as const,
		tags: [] as string[][], content: JSON.stringify({
			auction_id: receiptValue.auction_id, amount: receiptValue.bid_amount,
			replaces_bid_id: receiptValue.replaces_bid_id, integrated_funding: receiptValue,
		}),
	}
	const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	const event = { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), ACTOR_KEY)) }
	const tx = new TextEncoder().encode(JSON.stringify({ version: 1, type: 'event', event }))
	return { event, transactionHash: bytesToHex(sha256(tx)), transactionHex: bytesToHex(tx) }
}

describe('Friday V4 broadcast journal', () => {
	test('owns event/operation globally and persists an outcome-unknown broadcast boundary', () => {
		const database = new Database(':memory:')
		const first = new DemoFridayV4BroadcastJournalSqlite(database, 'friday-blue')
		const exact = receipt()
		let row = first.claimExact(exact.actor_funding_authorization.id, exact.funding_operation_id)
		expect(first.claimExact(exact.actor_funding_authorization.id, exact.funding_operation_id)).toEqual(row)
		expect(() => first.claimExact(exact.actor_funding_authorization.id, 'another-operation')).toThrow(/already owned/)
		row = first.transitionExact(row, 'prepared', { receipt: exact })
		expect(first.readExact(exact.actor_funding_authorization.id)).toEqual(row)
		row = first.transitionExact(row, 'signed', { signed: signed(exact) })
		row = first.transitionExact(row, 'broadcasting')
		const beforeRestart = first.anchorSnapshot()
		const restarted = new DemoFridayV4BroadcastJournalSqlite(database, 'friday-blue')
		const recovered = restarted.claimExact(exact.actor_funding_authorization.id, exact.funding_operation_id)
		expect(recovered).toMatchObject({ phase: 'broadcasting', revision: 3 })
		expect(restarted.anchorSnapshot()).toEqual(beforeRestart)
	})

	test('detects a deployment identity change', () => {
		const database = new Database(':memory:')
		new DemoFridayV4BroadcastJournalSqlite(database, 'friday-blue')
		expect(() => new DemoFridayV4BroadcastJournalSqlite(database, 'friday-green')).toThrow(/another deployment/)
	})

	test('fails closed on a restored broadcast journal behind its independent anchor', () => {
		const journalDb = new Database(':memory:')
		const anchorDb = new Database(':memory:')
		const journal = new DemoFridayV4BroadcastJournalSqlite(journalDb, 'friday-blue')
		const anchor = new DemoFridayV4BroadcastRollbackAnchorSqlite(anchorDb, true)
		anchor.observeExact(journal.anchorSnapshot())
		const exact = receipt()
		journal.claimExact(exact.actor_funding_authorization.id, exact.funding_operation_id)
		anchor.observeExact(journal.anchorSnapshot())
		const restored = new DemoFridayV4BroadcastJournalSqlite(new Database(':memory:'), 'friday-blue')
		expect(() => anchor.observeExact(restored.anchorSnapshot())).toThrow(/replaced|restored/)
	})
})
