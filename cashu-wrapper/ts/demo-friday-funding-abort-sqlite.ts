/** Durable FundingAbortV1 journal and independent fail-closed rollback anchor. */
import { randomBytes } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import type {
	DemoFridayFundingAbortJournalPort,
	DemoFridayFundingAbortJournalRecordV1,
} from './demo-friday-funding-abort-service'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
function fail(message: string): never { throw new Error(`DEMO_FRIDAY_FUNDING_ABORT_SQLITE: ${message}`) }
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) fail('non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') fail('unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function digest(value: unknown): string {
	return bytesToHex(sha256(new TextEncoder().encode(canonical(value))))
}
function parsed(raw: string): DemoFridayFundingAbortJournalRecordV1 {
	let value: unknown
	try { value = JSON.parse(raw) }
	catch { return fail('record JSON is invalid') }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('record is not an object')
	return value as DemoFridayFundingAbortJournalRecordV1
}

export interface DemoFridayFundingAbortAnchorSnapshotV1 {
	schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_ANCHOR_SNAPSHOT_V1'
	deploymentId: string
	storeGeneration: string
	globalRevision: number
	stateDigest: string
}

export class DemoFridayFundingAbortJournalSqlite implements DemoFridayFundingAbortJournalPort {
	readonly storeGeneration: string
	constructor(private readonly database: Database, readonly deploymentId: string) {
		if (!ID.test(deploymentId)) fail('deployment identity is invalid')
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_funding_abort_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id=1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, global_revision INTEGER NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS friday_funding_abort_journal (
				operation_id TEXT PRIMARY KEY NOT NULL, phase TEXT NOT NULL,
				revision INTEGER NOT NULL, record_json TEXT NOT NULL
			) STRICT`)
		database.transaction(() => {
			const prior = database.query<{ deployment_id: string; store_generation: string }, []>(
				'SELECT deployment_id,store_generation FROM friday_funding_abort_metadata WHERE id=1',
			).get()
			if (prior === null) database.query(`INSERT INTO friday_funding_abort_metadata
				(id,deployment_id,store_generation,global_revision) VALUES(1,?,?,0)`)
				.run(deploymentId, randomBytes(32).toString('hex'))
			else if (prior.deployment_id !== deploymentId || !HEX_32.test(prior.store_generation)) {
				fail('database belongs to another deployment or generation')
			}
		}).immediate()
		this.storeGeneration = database.query<{ store_generation: string }, []>(
			'SELECT store_generation FROM friday_funding_abort_metadata WHERE id=1',
		).get()!.store_generation
	}

	#advance(): void {
		if (this.database.query(`UPDATE friday_funding_abort_metadata
			SET global_revision=global_revision+1 WHERE id=1`).run().changes !== 1) fail('metadata did not advance')
	}

	async readExact(operationId: string): Promise<DemoFridayFundingAbortJournalRecordV1 | null> {
		if (!ID.test(operationId)) fail('operation identity is invalid')
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_funding_abort_journal WHERE operation_id=?',
		).get(operationId)
		return row === null ? null : structuredClone(parsed(row.record_json))
	}

	async listRecoverableExact(): Promise<string[]> {
		return this.database.query<{ operation_id: string }, []>(`SELECT operation_id
			FROM friday_funding_abort_journal WHERE phase != 'terminal_imported' ORDER BY operation_id LIMIT 64`)
			.all().map(({ operation_id }) => {
				if (!ID.test(operation_id)) fail('stored recoverable operation identity is invalid')
				return operation_id
			})
	}

	async claimExact(record: DemoFridayFundingAbortJournalRecordV1): Promise<DemoFridayFundingAbortJournalRecordV1> {
		if (!ID.test(record.operationId) || record.phase !== 'signed' || record.revision !== 0) fail('initial record is invalid')
		return this.database.transaction(() => {
			const prior = this.database.query<{ record_json: string }, [string]>(
				'SELECT record_json FROM friday_funding_abort_journal WHERE operation_id=?',
			).get(record.operationId)
			if (prior !== null) {
				const held = parsed(prior.record_json)
				if (canonical(held) !== canonical(record)) fail('operation identity is already owned')
				return structuredClone(held)
			}
			this.database.query(`INSERT INTO friday_funding_abort_journal
				(operation_id,phase,revision,record_json) VALUES(?,?,?,?)`)
				.run(record.operationId, record.phase, record.revision, canonical(record))
			this.#advance()
			return structuredClone(record)
		}).immediate()
	}

	async transitionExact(prior: DemoFridayFundingAbortJournalRecordV1,
		next: DemoFridayFundingAbortJournalRecordV1): Promise<DemoFridayFundingAbortJournalRecordV1> {
		if (prior.operationId !== next.operationId || next.revision !== prior.revision + 1) fail('transition identity is invalid')
		return this.database.transaction(() => {
			const row = this.database.query<{ record_json: string }, [string]>(
				'SELECT record_json FROM friday_funding_abort_journal WHERE operation_id=?',
			).get(prior.operationId)
			if (row === null || canonical(parsed(row.record_json)) !== canonical(prior)) fail('record changed concurrently')
			const changed = this.database.query(`UPDATE friday_funding_abort_journal
				SET phase=?,revision=?,record_json=? WHERE operation_id=? AND phase=? AND revision=?`)
				.run(next.phase, next.revision, canonical(next), prior.operationId, prior.phase, prior.revision)
			if (changed.changes !== 1) fail('journal CAS failed')
			this.#advance()
			return structuredClone(next)
		}).immediate()
	}

	anchorSnapshot(): DemoFridayFundingAbortAnchorSnapshotV1 {
		const meta = this.database.query<{ global_revision: number; store_generation: string }, []>(
			'SELECT global_revision,store_generation FROM friday_funding_abort_metadata WHERE id=1',
		).get()!
		const records = this.database.query<{ record_json: string }, []>(
			'SELECT record_json FROM friday_funding_abort_journal ORDER BY operation_id',
		).all().map((row) => parsed(row.record_json))
		return {
			schema: 'PLEBEIAN_FRIDAY_FUNDING_ABORT_ANCHOR_SNAPSHOT_V1', deploymentId: this.deploymentId,
			storeGeneration: meta.store_generation, globalRevision: meta.global_revision,
			stateDigest: digest(['PLEBEIAN_FRIDAY_FUNDING_ABORT_STATE_V1', this.deploymentId,
				meta.store_generation, meta.global_revision, records]),
		}
	}
}

export class DemoFridayFundingAbortRollbackAnchorSqlite {
	constructor(private readonly database: Database, private readonly allowFirstEnrollment = false) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_funding_abort_rollback_anchor (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id=1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, maximum_revision INTEGER NOT NULL, state_digest TEXT NOT NULL
			) STRICT`)
	}

	observeExact(snapshot: DemoFridayFundingAbortAnchorSnapshotV1): void {
		if (snapshot.schema !== 'PLEBEIAN_FRIDAY_FUNDING_ABORT_ANCHOR_SNAPSHOT_V1'
			|| !ID.test(snapshot.deploymentId) || !HEX_32.test(snapshot.storeGeneration)
			|| !HEX_32.test(snapshot.stateDigest) || !Number.isSafeInteger(snapshot.globalRevision)
			|| snapshot.globalRevision < 0) fail('anchor snapshot is invalid')
		this.database.transaction(() => {
			const prior = this.database.query<{ deployment_id: string; store_generation: string;
				maximum_revision: number; state_digest: string }, []>(`SELECT deployment_id,store_generation,
				maximum_revision,state_digest FROM friday_funding_abort_rollback_anchor WHERE id=1`).get()
			if (prior === null) {
				if (!this.allowFirstEnrollment || snapshot.globalRevision !== 0) fail('independent anchor is missing')
				this.database.query(`INSERT INTO friday_funding_abort_rollback_anchor
					(id,deployment_id,store_generation,maximum_revision,state_digest) VALUES(1,?,?,?,?)`)
					.run(snapshot.deploymentId, snapshot.storeGeneration, snapshot.globalRevision, snapshot.stateDigest)
				return
			}
			if (prior.deployment_id !== snapshot.deploymentId || prior.store_generation !== snapshot.storeGeneration) {
				fail('deployment or store generation was replaced')
			}
			if (snapshot.globalRevision < prior.maximum_revision) fail('journal revision regressed')
			if (snapshot.globalRevision === prior.maximum_revision) {
				if (snapshot.stateDigest !== prior.state_digest) fail('journal changed at anchored revision')
				return
			}
			const changed = this.database.query(`UPDATE friday_funding_abort_rollback_anchor
				SET maximum_revision=?,state_digest=? WHERE id=1 AND maximum_revision=? AND state_digest=?`)
				.run(snapshot.globalRevision, snapshot.stateDigest, prior.maximum_revision, prior.state_digest)
			if (changed.changes !== 1) fail('anchor changed concurrently')
		}).immediate()
	}
}
