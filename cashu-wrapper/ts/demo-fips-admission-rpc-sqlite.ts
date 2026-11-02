import { Database } from 'bun:sqlite'
import type { DemoFipsAdmissionRpcResponseV1 } from './demo-fips-admission-rpc'
import { DemoSignerRpcJournalV2, type DemoSignerJournalSafety } from './demo-signer-rpc-journal-v2'
/** Fresh internal V2 journal, unchanged V1 envelopes. No legacy migration. */
export class DemoFipsAdmissionRpcSqliteJournal extends DemoSignerRpcJournalV2<DemoFipsAdmissionRpcResponseV1> {
	constructor(database: Database, safety?: DemoSignerJournalSafety) { super(database, 'demo_fips_admission_rpc_journal', safety) }
}
