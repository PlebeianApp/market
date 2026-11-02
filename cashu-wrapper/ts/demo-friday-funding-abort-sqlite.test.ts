import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import type { DemoFridayFundingAbortJournalRecordV1 } from './demo-friday-funding-abort-service'
import {
	DemoFridayFundingAbortJournalSqlite,
	DemoFridayFundingAbortRollbackAnchorSqlite,
} from './demo-friday-funding-abort-sqlite'

const h = (character: string) => character.repeat(64)
const record = (): DemoFridayFundingAbortJournalRecordV1 => ({
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_JOURNAL_V1', operationId: 'funding-1', phase: 'signed', revision: 0,
	certificate: {} as never, transactionHex: '00', transactionHash: h('1'), abortCertificateDigest: h('2'),
	lockedEvidenceDigest: h('3'),
})

describe('FundingAbortV1 SQLite journal', () => {
	test('persists one CAS-owned operation across restart and advances an independent anchor', async () => {
		const journalDb = new Database(':memory:', { strict: true })
		const anchorDb = new Database(':memory:', { strict: true })
		try {
			const first = new DemoFridayFundingAbortJournalSqlite(journalDb, 'friday-abort-test')
			const anchor = new DemoFridayFundingAbortRollbackAnchorSqlite(anchorDb, true)
			anchor.observeExact(first.anchorSnapshot())
			const claimed = await first.claimExact(record())
			const broadcasting = { ...claimed, phase: 'broadcasting' as const, revision: 1 }
			await first.transitionExact(claimed, broadcasting)
			anchor.observeExact(first.anchorSnapshot())
			const restarted = new DemoFridayFundingAbortJournalSqlite(journalDb, 'friday-abort-test')
			await expect(restarted.readExact('funding-1')).resolves.toEqual(broadcasting)
			await expect(restarted.claimExact(record())).rejects.toThrow(/already owned/)
		} finally { anchorDb.close(false); journalDb.close(false) }
	})

	test('rejects same-revision mutation and revision rollback', async () => {
		const journalDb = new Database(':memory:', { strict: true })
		const anchorDb = new Database(':memory:', { strict: true })
		try {
			const journal = new DemoFridayFundingAbortJournalSqlite(journalDb, 'friday-abort-test')
			const anchor = new DemoFridayFundingAbortRollbackAnchorSqlite(anchorDb, true)
			anchor.observeExact(journal.anchorSnapshot())
			await journal.claimExact(record())
			anchor.observeExact(journal.anchorSnapshot())
			journalDb.query(`UPDATE friday_funding_abort_journal SET record_json=? WHERE operation_id=?`)
				.run(JSON.stringify({ ...record(), transactionHash: h('9') }), 'funding-1')
			expect(() => anchor.observeExact(journal.anchorSnapshot())).toThrow(/changed at anchored revision/)
			journalDb.query('UPDATE friday_funding_abort_metadata SET global_revision=0 WHERE id=1').run()
			expect(() => anchor.observeExact(journal.anchorSnapshot())).toThrow(/revision regressed/)
		} finally { anchorDb.close(false); journalDb.close(false) }
	})
})
