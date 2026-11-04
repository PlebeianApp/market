/** Fresh signer-local storage V2; public request/success envelopes stay V1. */
import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { closeSync, lstatSync, openSync, readSync } from 'node:fs'
import { DemoSignerCachedRejection, DemoSignerJournalConflict, demoSignerRejectionBody, type DemoSignerPureReason } from './demo-signer-pure-policy'

export const DEMO_SIGNER_LOCAL_SCHEMA = 2
export const DEMO_SIGNER_MAX_JOURNAL_ROWS = 10000
export const DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON = 'PRE_EFFECT_LOCAL_PREREQUISITE' as const
const PRE_EFFECT_RECOVERY_BODY = JSON.stringify({ error: `DEMO_SIGNER_RECOVERED_NO_EFFECT:${DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON}` })
const HEX = /^[0-9a-f]{64}$/
const TABLES = ['demo_fips_admission_rpc_journal', 'demo_fips_funding_abort_rpc_journal'] as const
export type DemoSignerJournalTable = typeof TABLES[number]

/** Header-only inspection: no writable connection/PRAGMA/sidecar on old stores. */
export function assertDemoSignerStoreHeader(path: string): boolean {
	let metadata
	try { metadata = lstatSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('DEMO_SIGNER_SCHEMA_QUARANTINED: unsafe store')
	const header = Buffer.alloc(100), fd = openSync(path, 'r')
	let length: number
	try { length = readSync(fd, header, 0, 100, 0) } finally { closeSync(fd) }
	if (length < 100 || header.subarray(0, 16).toString('binary') !== 'SQLite format 3\u0000'
		|| header.readUInt32BE(60) !== DEMO_SIGNER_LOCAL_SCHEMA) throw new Error('DEMO_SIGNER_SCHEMA_QUARANTINED: old or unknown store; no migration')
	return true
}
export function assertDemoSignerDatabaseSchema(database: Database): void {
	if ((database.query('PRAGMA user_version').get() as { user_version: number }).user_version !== DEMO_SIGNER_LOCAL_SCHEMA) {
		throw new Error('DEMO_SIGNER_SCHEMA_QUARANTINED: old or unknown store; no migration')
	}
}
export function initializeDemoSignerAdmissionSchema(database: Database): void {
	const version = (database.query('PRAGMA user_version').get() as { user_version: number }).user_version
	const tables = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
	if (version !== 0 && version !== DEMO_SIGNER_LOCAL_SCHEMA || version === 0 && tables.length !== 0) throw new Error('DEMO_SIGNER_SCHEMA_QUARANTINED: no migration')
	if (version === DEMO_SIGNER_LOCAL_SCHEMA) {
		for (const table of TABLES) {
			const columns = database.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
			if (columns.map((x) => x.name).join(',') !== 'request_id,request_digest,status,response_json,rejection_reason,rejection_status,rejection_body,safety_witness') throw new Error('DEMO_SIGNER_SCHEMA_QUARANTINED: layout differs')
		}
		database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL')
		return
	}
	database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
		CREATE TABLE admission_safety_metadata(id INTEGER PRIMARY KEY CHECK(id=1),store_generation TEXT NOT NULL,revision INTEGER NOT NULL) STRICT;
		CREATE TABLE fips_admission_proof_claims(proof_ref TEXT PRIMARY KEY,network TEXT NOT NULL,chain_id TEXT NOT NULL,auction_id TEXT NOT NULL,funding_operation_id TEXT NOT NULL) STRICT;`)
	for (const table of TABLES) database.exec(`CREATE TABLE ${table} (
		request_id TEXT PRIMARY KEY NOT NULL,request_digest TEXT NOT NULL,
		status TEXT NOT NULL CHECK(status IN ('pending','complete','rejected_no_effect')), response_json TEXT,
		rejection_reason TEXT,rejection_status INTEGER,rejection_body TEXT,safety_witness TEXT,
		CHECK ((status='pending' AND response_json IS NULL AND rejection_reason IS NULL AND rejection_status IS NULL AND rejection_body IS NULL AND safety_witness IS NULL)
		 OR (status='complete' AND response_json IS NOT NULL AND rejection_reason IS NULL AND rejection_status IS NULL AND rejection_body IS NULL AND safety_witness IS NULL)
		 OR (status='rejected_no_effect' AND response_json IS NULL AND rejection_reason IS NOT NULL AND rejection_status=422 AND rejection_body IS NOT NULL AND safety_witness IS NOT NULL))
	) STRICT;`)
	database.query('INSERT INTO admission_safety_metadata VALUES(1,?,0)').run(randomBytes(32).toString('hex'))
	database.exec('PRAGMA user_version=2')
}

export interface DemoSignerJournalSafety {
	assertAdmissionJournalCurrent(): void
	recordAdmissionJournalAdvance(): void
	assertNoEffectWitness?(witness: string): void
	captureNoEffectWitness?(): string
	recordRpcJournalAdvance?(witness: string, table: string, id: string, prior: Record<string, unknown> | null, next: Record<string, unknown>): void
}
interface Row { request_digest: string; status: 'pending' | 'complete' | 'rejected_no_effect'; response_json: string | null;
	rejection_reason: string | null; rejection_status: number | null; rejection_body: string | null; safety_witness: string | null }
export type DemoSignerJournalInspection<R> = { status: 'absent' } | { status: 'pending' } | { status: 'replay'; response: R } | { status: 'rejected'; body: string }

export class DemoSignerRpcJournalV2<R> {
	constructor(private readonly database: Database, private readonly table: DemoSignerJournalTable, private readonly safety?: DemoSignerJournalSafety) {
		if (!TABLES.includes(table)) throw new Error('JOURNAL_TABLE_INVALID')
		initializeDemoSignerAdmissionSchema(database)
	}
	private expectedRow(id: string, digest: string, status: string, response: string | null = null, reason: string | null = null, body: string | null = null, witness: string | null = null): Record<string, unknown> {
		return { request_id: id, request_digest: digest, status, response_json: response,
			rejection_reason: reason, rejection_status: reason === null ? null : 422, rejection_body: body, safety_witness: witness }
	}
	private storedRow(id: string): Record<string, unknown> | null {
		return this.database.query<Record<string, unknown>, [string]>(`SELECT request_id,request_digest,status,response_json,rejection_reason,rejection_status,rejection_body,safety_witness FROM ${this.table} WHERE request_id=?`).get(id)
	}
	private advance(witness: string | undefined, id: string, prior: Record<string, unknown> | null, next: Record<string, unknown>): void {
		if (witness !== undefined && this.safety?.recordRpcJournalAdvance) this.safety.recordRpcJournalAdvance(witness, this.table, id, prior, next)
		else this.safety?.recordAdmissionJournalAdvance()
	}
	private current(): void { assertDemoSignerDatabaseSchema(this.database); this.safety?.assertAdmissionJournalCurrent() }
	assertReadyNow(): void {
		this.current()
		for (const table of TABLES) if (this.database.query(`SELECT request_id FROM ${table} WHERE status='pending' LIMIT 1`).get() !== null) {
			throw new Error('DEMO_SIGNER_RPC_QUARANTINED: journal contains an interrupted request')
		}
	}
	async assertReady(): Promise<void> { this.assertReadyNow() }
	private inspectNow(id: string, digest: string): DemoSignerJournalInspection<R> {
		if (!HEX.test(id) || !HEX.test(digest)) throw new Error('JOURNAL_ID_INVALID')
		const row = this.database.query<Row, [string]>(`SELECT request_digest,status,response_json,rejection_reason,rejection_status,rejection_body,safety_witness FROM ${this.table} WHERE request_id=?`).get(id)
		if (row === null) return { status: 'absent' }
		if (row.request_digest !== digest) throw new DemoSignerJournalConflict()
		if (row.status === 'pending') return { status: 'pending' }
		if (row.status === 'rejected_no_effect') {
			if (row.rejection_status !== 422 || row.rejection_body === null || row.safety_witness === null
				|| row.rejection_body !== (row.rejection_reason === DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON
					? PRE_EFFECT_RECOVERY_BODY : demoSignerRejectionBody(row.rejection_reason as DemoSignerPureReason))) throw new Error('JOURNAL_REJECTION_INVALID')
			return { status: 'rejected', body: row.rejection_body }
		}
		if (row.status !== 'complete' || row.response_json === null) throw new Error('JOURNAL_STATE_INVALID')
		return { status: 'replay', response: JSON.parse(row.response_json) as R }
	}
	async inspect(id: string, digest: string): Promise<DemoSignerJournalInspection<R>> { this.current(); return this.inspectNow(id, digest) }
	private room(): void {
		const count = this.database.query<{ count: number }, []>(`SELECT (SELECT COUNT(*) FROM ${TABLES[0]})+(SELECT COUNT(*) FROM ${TABLES[1]}) AS count`).get()!.count
		if (count >= DEMO_SIGNER_MAX_JOURNAL_ROWS) throw new Error('DEMO_SIGNER_JOURNAL_QUARANTINED: retention budget reached; no pruning')
	}
	async claim(id: string, digest: string): Promise<{ status: 'created' } | Exclude<DemoSignerJournalInspection<R>, { status: 'absent' }>> {
		this.current()
		const witness = this.safety?.captureNoEffectWitness?.()
		const result = this.database.transaction(() => {
			const prior = this.inspectNow(id, digest); if (prior.status !== 'absent') return prior
			this.room(); this.database.query(`INSERT INTO ${this.table}(request_id,request_digest,status) VALUES(?,?,'pending')`).run(id, digest)
			this.database.exec('UPDATE admission_safety_metadata SET revision=revision+1 WHERE id=1'); return { status: 'created' as const }
		}).immediate()
		if (result.status === 'created') this.advance(witness, id, null, this.expectedRow(id, digest, 'pending'))
		else this.current()
		return result
	}
	async rejectNoEffect(id: string, digest: string, reason: DemoSignerPureReason, witness: string): Promise<never> {
		this.current()
		if (this.safety?.assertNoEffectWitness === undefined || this.safety.recordRpcJournalAdvance === undefined || witness.length > 8192) throw new Error('JOURNAL_NO_EFFECT_WITNESS_REQUIRED')
		const body = demoSignerRejectionBody(reason)
		this.database.transaction(() => {
			this.safety!.assertNoEffectWitness!(witness)
			if (this.inspectNow(id, digest).status !== 'absent') throw new Error('JOURNAL_REJECTION_NOT_FRESH')
			this.room(); this.database.query(`INSERT INTO ${this.table}(request_id,request_digest,status,rejection_reason,rejection_status,rejection_body,safety_witness) VALUES(?,?,'rejected_no_effect',?,422,?,?)`).run(id, digest, reason, body, witness)
			this.database.exec('UPDATE admission_safety_metadata SET revision=revision+1 WHERE id=1')
		}).immediate()
		this.advance(witness, id, null, this.expectedRow(id, digest, 'rejected_no_effect', null, reason, body, witness))
		throw new DemoSignerCachedRejection(body)
	}
	/** Offline operator transition for a request proven to have stopped before
	 * the Rust effect boundary.  It intentionally accepts no request identifier:
	 * the store must contain exactly one pending row, which is retained as a
	 * cached terminal rejection.  Callers must hold the signer lease and bind the
	 * supplied witness to independent zero-effect evidence before invoking this.
	 */
	async operatorRejectOnlyPendingPreEffect(witness: string): Promise<void> {
		this.current()
		if (this.safety?.assertNoEffectWitness === undefined || this.safety.recordRpcJournalAdvance === undefined
			|| witness.length > 8192) throw new Error('JOURNAL_NO_EFFECT_WITNESS_REQUIRED')
		const rows = this.database.query<Record<string, unknown>, []>(
			`SELECT request_id,request_digest,status,response_json,rejection_reason,rejection_status,rejection_body,safety_witness
			 FROM ${this.table} WHERE status='pending' ORDER BY request_id`,
		).all()
		if (rows.length !== 1 || typeof rows[0]!.request_id !== 'string' || typeof rows[0]!.request_digest !== 'string'
			|| !HEX.test(rows[0]!.request_id as string) || !HEX.test(rows[0]!.request_digest as string)) {
			throw new Error('JOURNAL_PRE_EFFECT_RECOVERY_REQUIRES_ONE_PENDING')
		}
		const prior = rows[0]!, id = prior.request_id as string, digest = prior.request_digest as string
		this.safety.assertNoEffectWitness(witness)
		const body = PRE_EFFECT_RECOVERY_BODY
		const next = this.expectedRow(id, digest, 'rejected_no_effect', null,
			DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON, body, witness)
		this.database.transaction(() => {
			this.safety!.assertNoEffectWitness!(witness)
			const found = this.storedRow(id)
			if (found === null || JSON.stringify(found) !== JSON.stringify(prior)) {
				throw new Error('JOURNAL_PRE_EFFECT_RECOVERY_ROW_CHANGED')
			}
			const changed = this.database.query(`UPDATE ${this.table}
				SET status='rejected_no_effect',response_json=NULL,rejection_reason=?,rejection_status=422,rejection_body=?,safety_witness=?
				WHERE request_id=? AND request_digest=? AND status='pending'`).run(
				DEMO_SIGNER_PRE_EFFECT_RECOVERY_REASON, body, witness, id, digest,
			)
			if (changed.changes !== 1) throw new Error('JOURNAL_PRE_EFFECT_RECOVERY_CAS')
			this.database.exec('UPDATE admission_safety_metadata SET revision=revision+1 WHERE id=1')
		}).immediate()
		this.advance(witness, id, prior, next)
	}
	async complete(id: string, digest: string, response: R): Promise<void> {
		this.current(); const body = JSON.stringify(response)
		const witness = this.safety?.captureNoEffectWitness?.(), priorRow = this.storedRow(id)
		if (Buffer.byteLength(body) > 262144) throw new Error('JOURNAL_RESPONSE_LIMIT')
		const changed = this.database.transaction(() => {
			const prior = this.inspectNow(id, digest)
			if (prior.status === 'replay') { if (JSON.stringify(prior.response) !== body) throw new Error('JOURNAL_RESPONSE_CONFLICT'); return false }
			if (prior.status !== 'pending') throw new Error('JOURNAL_NOT_OWNED_PENDING')
			const result = this.database.query(`UPDATE ${this.table} SET status='complete',response_json=? WHERE request_id=? AND request_digest=? AND status='pending'`).run(body, id, digest)
			if (result.changes !== 1) throw new Error('JOURNAL_COMPLETE_CAS')
			this.database.exec('UPDATE admission_safety_metadata SET revision=revision+1 WHERE id=1'); return true
		}).immediate()
		if (changed) this.advance(witness, id, priorRow, this.expectedRow(id, digest, 'complete', body)); else this.current()
	}
}

