import { Database } from 'bun:sqlite'
import type { DemoFipsFundingAbortRpcResponseV1 } from './demo-fips-funding-abort-rpc'
import { DemoSignerRpcJournalV2 } from './demo-signer-rpc-journal-v2'
/** Same fresh store and immutable anchor as admission. */
export class DemoFipsFundingAbortRpcSqliteJournal extends DemoSignerRpcJournalV2<DemoFipsFundingAbortRpcResponseV1> {
	constructor(database: Database, safety?: {
		assertFundingAbortJournalCurrent(): void; recordFundingAbortJournalAdvance(): void; assertNoEffectWitness?(witness: string): void
		captureNoEffectWitness?(): string
		recordRpcJournalAdvance?(witness: string, table: string, id: string, prior: Record<string, unknown> | null, next: Record<string, unknown>): void
	}) { super(database, 'demo_fips_funding_abort_rpc_journal', safety && {
		assertAdmissionJournalCurrent: safety.assertFundingAbortJournalCurrent,
		recordAdmissionJournalAdvance: safety.recordFundingAbortJournalAdvance,
		assertNoEffectWitness: safety.assertNoEffectWitness,
		captureNoEffectWitness: safety.captureNoEffectWitness, recordRpcJournalAdvance: safety.recordRpcJournalAdvance,
	}) }
}
