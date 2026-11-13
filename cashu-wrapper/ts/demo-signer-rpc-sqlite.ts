import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'

import type { DemoSignerDurableBindingV1, DemoSignerRpcJournal, DemoSignerRpcResponseV1 } from './demo-signer-rpc'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261109,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261109,
	demoSignerTerminalIncidentPermit20261109,
	type DemoSignerTerminalIncidentPermit20261109V1,
} from './demo-signer-terminal-incident-20261109'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261110,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261110,
	demoSignerTerminalIncidentPermit20261110,
	type DemoSignerTerminalIncidentPermit20261110V1,
} from './demo-signer-terminal-incident-20261110'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111,
	demoSignerTerminalIncidentPermit20261111,
	type DemoSignerTerminalIncidentPermit20261111V1,
} from './demo-signer-terminal-incident-20261111'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111_R59D,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R59D,
	demoSignerTerminalIncidentPermit20261111R59d,
	type DemoSignerTerminalIncidentPermit20261111R59dV1,
} from './demo-signer-terminal-incident-20261111-r59d'
import {
	DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111_R62,
	DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R62,
	demoSignerTerminalIncidentPermit20261111R62,
	type DemoSignerTerminalIncidentPermit20261111R62V1,
} from './demo-signer-terminal-incident-20261111-r62'

export type DemoSignerJournalIdentityV1 = Omit<
	DemoSignerDurableBindingV1,
	'schema' | 'restartEpoch' | 'journalGeneration' | 'stateDirectoryIdentity'
>
type DemoSignerStoredIdentityV1 = Omit<DemoSignerDurableBindingV1, 'schema' | 'restartEpoch' | 'journalGeneration'>
type IncidentRow = {
	schema: string
	participant_id: number
	request_id: string
	request_digest: string
	evidence_digest: string
	reason: string
	rejection_status: number
	rejection_body: string
}

function exactIncidentPermit20261109(
	permit: DemoSignerTerminalIncidentPermit20261109V1,
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261109V1 {
	if (JSON.stringify(permit) !== JSON.stringify(demoSignerTerminalIncidentPermit20261109(participantId))) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_PERMIT: exact incident permit is malformed')
	}
	return structuredClone(permit)
}

function exactIncidentPermit20261110(
	permit: DemoSignerTerminalIncidentPermit20261110V1,
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261110V1 {
	if (JSON.stringify(permit) !== JSON.stringify(demoSignerTerminalIncidentPermit20261110(participantId))) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_PERMIT: exact 20261110 incident permit is malformed')
	}
	return structuredClone(permit)
}

function exactIncidentPermit20261111(
	permit: DemoSignerTerminalIncidentPermit20261111V1,
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261111V1 {
	if (JSON.stringify(permit) !== JSON.stringify(demoSignerTerminalIncidentPermit20261111(participantId))) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_PERMIT: exact 20261111 incident permit is malformed')
	}
	return structuredClone(permit)
}

function exactIncidentPermit20261111R59d(
	permit: DemoSignerTerminalIncidentPermit20261111R59dV1,
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261111R59dV1 {
	if (JSON.stringify(permit) !== JSON.stringify(demoSignerTerminalIncidentPermit20261111R59d(participantId))) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_PERMIT: exact 20261111 R59d incident permit is malformed')
	}
	return structuredClone(permit)
}

function exactIncidentPermit20261111R62(
	permit: DemoSignerTerminalIncidentPermit20261111R62V1,
	participantId: 1 | 2 | 3 | 4,
): DemoSignerTerminalIncidentPermit20261111R62V1 {
	if (JSON.stringify(permit) !== JSON.stringify(demoSignerTerminalIncidentPermit20261111R62(participantId))) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_PERMIT: exact 20261111 R62 incident permit is malformed')
	}
	return structuredClone(permit)
}

function readIncidentTombstoneExact(
	database: Database,
	permit: DemoSignerTerminalIncidentPermit20261109V1 | DemoSignerTerminalIncidentPermit20261110V1
		| DemoSignerTerminalIncidentPermit20261111V1 | DemoSignerTerminalIncidentPermit20261111R59dV1
		| DemoSignerTerminalIncidentPermit20261111R62V1 | undefined,
	tableName: string,
	createSql: string,
): IncidentRow | undefined {
	const table = database.query<{ name: string; type: string; sql: string | null }, [string]>(
		'SELECT name,type,sql FROM sqlite_master WHERE tbl_name=? ORDER BY type,name',
	).all(tableName)
	if (table.length === 0) return undefined
	if (permit === undefined) throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: permit is absent')
	if (table.length !== 2 || table[0]?.type !== 'index'
		|| table[0].name !== `sqlite_autoindex_${tableName}_1`
		|| table[0].sql !== null || table[1]?.type !== 'table'
		|| table[1].name !== tableName || table[1].sql === null) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: schema objects differ')
	}
	const normalizeSql = (value: string) => value.replace(/[\s;]/g, '')
	if (normalizeSql(table[1].sql) !== normalizeSql(createSql)) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: table SQL differs')
	}
	const columns = database.query<{
		cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number
	}, []>(`PRAGMA table_info(${tableName})`).all()
	const expected = [
		[0, 'schema', 'TEXT', 1, null, 0], [1, 'participant_id', 'INTEGER', 1, null, 1],
		[2, 'request_id', 'TEXT', 1, null, 0], [3, 'request_digest', 'TEXT', 1, null, 0],
		[4, 'evidence_digest', 'TEXT', 1, null, 0], [5, 'reason', 'TEXT', 1, null, 0],
		[6, 'rejection_status', 'INTEGER', 1, null, 0], [7, 'rejection_body', 'TEXT', 1, null, 0],
	]
	if (JSON.stringify(columns.map((column) => [
		column.cid, column.name, column.type, column.notnull, column.dflt_value, column.pk,
	])) !== JSON.stringify(expected)) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: columns differ')
	}
	const indexes = database.query<{ seq: number; name: string; unique: number; origin: string; partial: number }, []>(
		`PRAGMA index_list(${tableName})`,
	).all()
	if (indexes.length !== 1 || indexes[0]?.seq !== 0
		|| indexes[0].name !== `sqlite_autoindex_${tableName}_1`
		|| indexes[0].unique !== 1 || indexes[0].origin !== 'u' || indexes[0].partial !== 0) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: unique index differs')
	}
	const indexColumns = database.query<{ seqno: number; cid: number; name: string }, []>(
		`PRAGMA index_info(${indexes[0].name})`,
	).all()
	if (JSON.stringify(indexColumns) !== JSON.stringify([{ seqno: 0, cid: 2, name: 'request_id' }])) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: unique index columns differ')
	}
	const tableList = database.query<{ name: string; ncol: number; wr: number; strict: number }, []>(
		`PRAGMA table_list(${tableName})`,
	).all()
	if (tableList.length !== 1 || tableList[0]?.name !== tableName
		|| tableList[0].ncol !== 8 || tableList[0].wr !== 0 || tableList[0].strict !== 1) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: table boundary differs')
	}
	const rows = database.query<IncidentRow, []>(
		`SELECT schema,participant_id,request_id,request_digest,evidence_digest,reason,rejection_status,rejection_body
		 FROM ${tableName}`,
	).all()
	if (rows.length !== 1) throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: expected exactly one row')
	const row = rows[0]!
	if (JSON.stringify(row) !== JSON.stringify({
		schema: permit.schema, participant_id: permit.participantId, request_id: permit.requestId,
		request_digest: permit.requestDigest, evidence_digest: permit.evidenceDigest, reason: permit.reason,
		rejection_status: permit.rejectionStatus, rejection_body: permit.rejectionBody,
	})) throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: row differs from exact permit')
	const pending = database.query<{ request_digest: string; status: string; response_json: string | null }, [string]>(
		'SELECT request_digest,status,response_json FROM demo_signer_rpc_journal WHERE request_id=?',
	).get(permit.requestId)
	if (pending === null || pending.request_digest !== permit.requestDigest
		|| pending.status !== 'pending' || pending.response_json !== null) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: original pending row differs')
	}
	return row
}

export function assertDemoSignerTerminalIncidentTombstone20261109(
	database: Database,
	permit: DemoSignerTerminalIncidentPermit20261109V1,
): void {
	if (readIncidentTombstoneExact(database, permit, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261109,
		DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261109) === undefined) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: exact table is absent')
	}
}

export function assertDemoSignerTerminalIncidentTombstone20261110(
	database: Database,
	permit: DemoSignerTerminalIncidentPermit20261110V1,
): void {
	if (readIncidentTombstoneExact(database, permit, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261110,
		DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261110) === undefined) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: exact 20261110 table is absent')
	}
}

export function assertDemoSignerTerminalIncidentTombstone20261111(
	database: Database,
	permit: DemoSignerTerminalIncidentPermit20261111V1,
): void {
	if (readIncidentTombstoneExact(database, permit, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111,
		DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111) === undefined) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: exact 20261111 table is absent')
	}
}

export function assertDemoSignerTerminalIncidentTombstone20261111R59d(
	database: Database,
	permit: DemoSignerTerminalIncidentPermit20261111R59dV1,
): void {
	if (readIncidentTombstoneExact(database, permit, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R59D,
		DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111_R59D) === undefined) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: exact 20261111 R59d table is absent')
	}
}

export function assertDemoSignerTerminalIncidentTombstone20261111R62(
	database: Database,
	permit: DemoSignerTerminalIncidentPermit20261111R62V1,
): void {
	if (readIncidentTombstoneExact(database, permit, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R62,
		DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111_R62) === undefined) {
		throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: exact 20261111 R62 table is absent')
	}
}

function stateDirectoryIdentity(path: string): string {
	const exact = realpathSync(path)
	const stat = statSync(exact)
	if (!stat.isDirectory()) throw new Error('DEMO_SIGNER_RPC_STATE_DIRECTORY: signer state path is not a directory')
	return createHash('sha256').update(JSON.stringify(['COCO_DEMO_SIGNER_STATE_DIRECTORY_V1', exact, stat.dev, stat.ino])).digest('hex')
}

function identityOf(value: DemoSignerDurableBindingV1): DemoSignerStoredIdentityV1 {
	return {
		participantId: value.participantId, keysetId: value.keysetId, keysetVersion: value.keysetVersion,
		dkgRunId: value.dkgRunId, publicKeyPackageSha256: value.publicKeyPackageSha256,
		signerRosterDigest: value.signerRosterDigest, stateDirectory: value.stateDirectory,
		stateDirectoryIdentity: value.stateDirectoryIdentity, processIdentity: value.processIdentity,
		verifyingShare: value.verifyingShare,
	}
}

function sameIdentity(left: DemoSignerStoredIdentityV1, right: DemoSignerStoredIdentityV1): boolean {
	return left.participantId === right.participantId && left.keysetId === right.keysetId
		&& left.keysetVersion === right.keysetVersion && left.dkgRunId === right.dkgRunId
		&& left.publicKeyPackageSha256 === right.publicKeyPackageSha256
		&& left.signerRosterDigest === right.signerRosterDigest
		&& left.stateDirectory === right.stateDirectory
		&& left.stateDirectoryIdentity === right.stateDirectoryIdentity
		&& left.processIdentity === right.processIdentity && left.verifyingShare === right.verifyingShare
}

export class DemoSignerRpcSqliteJournal implements DemoSignerRpcJournal {
	readonly #database: Database
	readonly #binding: DemoSignerDurableBindingV1
	readonly #claim: (requestId: string, requestDigest: string) =>
		| { status: 'created' }
		| { status: 'pending' }
		| { status: 'incident_rejected'; body: typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109
			| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110
			| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111
			| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D
			| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62 }
		| { status: 'replay'; response: DemoSignerRpcResponseV1 }
	readonly #complete: (requestId: string, requestDigest: string, response: DemoSignerRpcResponseV1) => void
	readonly #incidents: readonly IncidentRow[]

	constructor(
		database: Database,
		identity: DemoSignerJournalIdentityV1,
		incidentPermit?: DemoSignerTerminalIncidentPermit20261109V1,
		incidentPermit20261110?: DemoSignerTerminalIncidentPermit20261110V1,
		incidentPermit20261111?: DemoSignerTerminalIncidentPermit20261111V1,
		incidentPermit20261111R59d?: DemoSignerTerminalIncidentPermit20261111R59dV1,
		incidentPermit20261111R62?: DemoSignerTerminalIncidentPermit20261111R62V1,
	) {
		this.#database = database
		const expectedIdentity = { ...structuredClone(identity), stateDirectoryIdentity: stateDirectoryIdentity(identity.stateDirectory) }
		const exactPermit = incidentPermit === undefined ? undefined : exactIncidentPermit20261109(incidentPermit, identity.participantId)
		const exactPermit20261110 = incidentPermit20261110 === undefined ? undefined
			: exactIncidentPermit20261110(incidentPermit20261110, identity.participantId)
		const exactPermit20261111 = incidentPermit20261111 === undefined ? undefined
			: exactIncidentPermit20261111(incidentPermit20261111, identity.participantId)
		const exactPermit20261111R59d = incidentPermit20261111R59d === undefined ? undefined
			: exactIncidentPermit20261111R59d(incidentPermit20261111R59d, identity.participantId)
		const exactPermit20261111R62 = incidentPermit20261111R62 === undefined ? undefined
			: exactIncidentPermit20261111R62(incidentPermit20261111R62, identity.participantId)
		database.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA synchronous = FULL;
			CREATE TABLE IF NOT EXISTS demo_signer_rpc_journal (
				request_id TEXT PRIMARY KEY NOT NULL,
				request_digest TEXT NOT NULL,
				status TEXT NOT NULL CHECK(status IN ('pending', 'complete')),
				response_json TEXT
			) STRICT;
			CREATE TABLE IF NOT EXISTS demo_signer_rpc_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK(id = 1),
				binding_json TEXT NOT NULL
			) STRICT;
		`)
		this.#incidents = [
			readIncidentTombstoneExact(database, exactPermit, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261109,
				DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261109),
			readIncidentTombstoneExact(database, exactPermit20261110, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261110,
				DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261110),
			readIncidentTombstoneExact(database, exactPermit20261111, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111,
				DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111),
			readIncidentTombstoneExact(database, exactPermit20261111R59d, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R59D,
				DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111_R59D),
			readIncidentTombstoneExact(database, exactPermit20261111R62, DEMO_TERMINAL_INCIDENT_TOMBSTONE_TABLE_20261111_R62,
				DEMO_TERMINAL_INCIDENT_TOMBSTONE_CREATE_SQL_20261111_R62),
		].filter((value): value is IncidentRow => value !== undefined)
		const open = database.transaction((expected: DemoSignerStoredIdentityV1) => {
			const found = database.query<{ binding_json: string }, []>(
				'SELECT binding_json FROM demo_signer_rpc_metadata WHERE id = 1',
			).get()
			if (found === null) {
				if (this.#incidents.length !== 0) throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: metadata is absent')
				const binding: DemoSignerDurableBindingV1 = {
					schema: 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1', ...structuredClone(expected),
					restartEpoch: 1, journalGeneration: randomBytes(32).toString('hex'),
				}
				database.query('INSERT INTO demo_signer_rpc_metadata(id, binding_json) VALUES (1, ?)').run(JSON.stringify(binding))
				return binding
			}
			const prior = JSON.parse(found.binding_json) as DemoSignerDurableBindingV1
			const restartEpoch = prior.restartEpoch
			const journalGeneration = prior.journalGeneration
			const storedIdentity = identityOf(prior)
			if (prior.schema !== 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1' || !Number.isSafeInteger(restartEpoch)
				|| restartEpoch < 1 || !/^[0-9a-f]{64}$/.test(journalGeneration)
				|| !sameIdentity(storedIdentity, expected)) {
				throw new Error('DEMO_SIGNER_RPC_METADATA_MISMATCH: signer state directory, DKG, keyset, or roster changed')
			}
			const binding = { ...prior, restartEpoch: restartEpoch + 1 }
			database.query('UPDATE demo_signer_rpc_metadata SET binding_json = ? WHERE id = 1').run(JSON.stringify(binding))
			return binding
		})
		this.#binding = open.immediate(expectedIdentity)
		const claim = database.transaction((requestId: string, requestDigest: string) => {
			const found = database.query<{
				request_digest: string
				status: 'pending' | 'complete'
				response_json: string | null
			}, [string]>('SELECT request_digest, status, response_json FROM demo_signer_rpc_journal WHERE request_id = ?').get(requestId)
			if (found === null) {
				database.query('INSERT INTO demo_signer_rpc_journal(request_id, request_digest, status) VALUES (?, ?, ?)')
					.run(requestId, requestDigest, 'pending')
				return { status: 'created' as const }
			}
			if (found.request_digest !== requestDigest) throw new Error('DEMO_SIGNER_RPC_JOURNAL_CONFLICT: request id digest changed')
			if (found.status === 'pending') {
				const incident = this.#incidents.find((value) => value.request_id === requestId && value.request_digest === requestDigest)
				if (incident !== undefined) {
					if (![DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109, DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110,
						DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111, DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D,
						DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62]
						.includes(incident.rejection_body)) {
						throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: cached body differs')
					}
					return {
						status: 'incident_rejected' as const,
						body: incident.rejection_body as
							| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261109
							| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261110
							| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111
							| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R59D
							| typeof DEMO_TERMINAL_INCIDENT_REJECTION_BODY_20261111_R62,
					}
				}
				return { status: 'pending' as const }
			}
			if (found.response_json === null) throw new Error('DEMO_SIGNER_RPC_JOURNAL_STATE: completed request is missing response')
			return { status: 'replay' as const, response: JSON.parse(found.response_json) as DemoSignerRpcResponseV1 }
		})
		this.#claim = claim.immediate.bind(claim)
		const complete = database.transaction((requestId: string, requestDigest: string, response: DemoSignerRpcResponseV1) => {
			const found = database.query<{ request_digest: string; status: 'pending' | 'complete'; response_json: string | null }, [string]>(
				'SELECT request_digest, status, response_json FROM demo_signer_rpc_journal WHERE request_id = ?',
			).get(requestId)
			if (found === null || found.request_digest !== requestDigest) {
				throw new Error('DEMO_SIGNER_RPC_JOURNAL_STATE: request was not durably claimed')
			}
			if (this.#incidents.some((value) => value.request_id === requestId && value.request_digest === requestDigest)) {
				throw new Error('DEMO_SIGNER_RPC_INCIDENT_TOMBSTONE: rejected request cannot complete')
			}
			const serialized = JSON.stringify(response)
			if (found.status === 'complete') {
				if (found.response_json !== serialized) throw new Error('DEMO_SIGNER_RPC_JOURNAL_CONFLICT: terminal response changed')
				return
			}
			const result = database.query("UPDATE demo_signer_rpc_journal SET status = ?, response_json = ? WHERE request_id = ? AND request_digest = ? AND status = 'pending'")
				.run('complete', serialized, requestId, requestDigest)
			if (result.changes !== 1) throw new Error('DEMO_SIGNER_RPC_JOURNAL_CAS: request changed during completion')
		})
		this.#complete = complete.immediate.bind(complete)
	}

	async readBinding(): Promise<DemoSignerDurableBindingV1> {
		const found = this.#database.query<{ binding_json: string }, []>(
			'SELECT binding_json FROM demo_signer_rpc_metadata WHERE id = 1',
		).get()
		if (found === null) throw new Error('DEMO_SIGNER_RPC_METADATA_MISSING: signer durable identity is absent')
		const current = JSON.parse(found.binding_json) as DemoSignerDurableBindingV1
		if (JSON.stringify(current) !== JSON.stringify(this.#binding)) {
			throw new Error('DEMO_SIGNER_RPC_METADATA_REGRESSED: signer metadata changed after process startup')
		}
		return structuredClone(current)
	}

	async assertReady(): Promise<void> {
		const pending = this.#database.query<{ request_id: string; request_digest: string; response_json: string | null }, []>(
			"SELECT request_id,request_digest,response_json FROM demo_signer_rpc_journal WHERE status = 'pending' ORDER BY request_id",
		).all()
		if (pending.length === 0) return
		const expected = [...this.#incidents].sort((left, right) => left.request_id.localeCompare(right.request_id))
		if (pending.length !== expected.length || pending.some((row, index) => row.request_id !== expected[index]?.request_id
			|| row.request_digest !== expected[index]?.request_digest || row.response_json !== null)) {
			throw new Error('DEMO_SIGNER_RPC_QUARANTINED: signer journal contains an interrupted request')
		}
	}

	async claim(requestId: string, requestDigest: string): ReturnType<DemoSignerRpcJournal['claim']> {
		return this.#claim(requestId, requestDigest)
	}

	async complete(requestId: string, requestDigest: string, response: DemoSignerRpcResponseV1): Promise<void> {
		this.#complete(requestId, requestDigest, structuredClone(response))
	}
}
