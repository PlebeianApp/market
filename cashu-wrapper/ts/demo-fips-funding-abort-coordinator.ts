/** Coordinator composition for validator-confirmed FundingAbortV1 over FIPS RPC. */
import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'

import type { DemoFridayFundingAbortCommitteePort } from './demo-friday-funding-abort-service'
import type { DemoFridayFundingAbortCapsuleStore } from './demo-friday-funding-abort-capsule'
import type {
	DemoFipsFundingAbortCommitPayloadV1,
	DemoFipsFundingAbortPolicyPayloadV1,
	DemoFipsFundingAbortRpcClient,
	DemoFipsFundingAbortSharePayloadV1,
} from './demo-fips-funding-abort-rpc'
import { DemoFipsFundingAbortRpcUnavailableError } from './demo-fips-funding-abort-rpc'
import {
	DEMO_FROST_FUNDING_ABORT_VERSION,
	demoFrostFundingAbortAuthorization,
	demoFrostFundingAbortAuthorizationDigest,
	demoFrostFundingAbortParticipantPolicyDigest,
	demoFrostFundingAbortTranscriptDigest,
	type DemoFundingAbortParticipantEvidenceV1,
	type DemoFridayFundingAbortCommitteeUnsignedV1,
	type DemoFrostFundingAbortAggregateV1,
	type DemoFrostFundingAbortCommitmentV1,
	type DemoFrostFundingAbortShareV1,
} from './demo-frost-threshold3-funding-abort'

type ParticipantId = 1 | 2 | 3 | 4
type Three<T> = [T, T, T]
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED = /^(?:02|03)[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

export interface DemoFundingAbortSigningSessionStore {
	read(operationId: string): Promise<{
		operationRoot: string; committeeDigest: string
		participantIds: [ParticipantId, ParticipantId, ParticipantId]
		participantEvidence: Three<DemoFundingAbortParticipantEvidenceV1>
		attemptNumber: number
		excludedParticipantIds: ParticipantId[]
	} | null>
	claim(binding: { operationId: string; operationRoot: string; committeeDigest: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId] },
		participantEvidence: Three<DemoFundingAbortParticipantEvidenceV1>): Promise<{
		sessionId: string
		attemptNumber: number
		participantEvidence: Three<DemoFundingAbortParticipantEvidenceV1>
		commitments?: DemoFrostFundingAbortCommitmentV1[]
		shares?: DemoFrostFundingAbortShareV1[]
		completed?: { participantPolicyDigest: string; committeeAbortSignature: string;
			participantIds: [ParticipantId, ParticipantId, ParticipantId] }
	}>
	rollover(binding: { operationId: string; operationRoot: string; committeeDigest: string; sessionId: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId] }, failedParticipantId: ParticipantId,
		nextBinding: { operationId: string; operationRoot: string; committeeDigest: string;
			participantIds: [ParticipantId, ParticipantId, ParticipantId] },
		participantEvidence: Three<DemoFundingAbortParticipantEvidenceV1>): Promise<{
			sessionId: string; attemptNumber: number
			participantEvidence: Three<DemoFundingAbortParticipantEvidenceV1>
		}>
	complete(binding: { operationId: string; operationRoot: string; committeeDigest: string; sessionId: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId] }, value: {
		participantPolicyDigest: string; committeeAbortSignature: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId]
	}): Promise<void>
	saveCommitments(binding: { operationId: string; operationRoot: string; committeeDigest: string; sessionId: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId] }, value: DemoFrostFundingAbortCommitmentV1[]): Promise<void>
	saveShares(binding: { operationId: string; operationRoot: string; committeeDigest: string; sessionId: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId] }, value: DemoFrostFundingAbortShareV1[]): Promise<void>
	observeParticipant(binding: DemoFrostFundingAbortCommitmentV1['durable_binding']): Promise<void>
}

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new Error('DEMO_FIPS_ABORT_SESSION: non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') throw new Error('DEMO_FIPS_ABORT_SESSION: unsupported value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function exactResult(value: { participantPolicyDigest: string; committeeAbortSignature: string;
	participantIds: [ParticipantId, ParticipantId, ParticipantId] }) {
	if (!HEX_32.test(value.participantPolicyDigest) || !HEX_64.test(value.committeeAbortSignature)
		|| value.participantIds.length !== 3 || new Set(value.participantIds).size !== 3
		|| value.participantIds.some((id, index) => ![1, 2, 3, 4].includes(id)
			|| (index > 0 && value.participantIds[index - 1]! >= id))) {
		throw new Error('DEMO_FIPS_ABORT_SESSION: completed result is malformed')
	}
	return structuredClone(value)
}

function exactEvidence(value: DemoFundingAbortParticipantEvidenceV1[]): Three<DemoFundingAbortParticipantEvidenceV1> {
	const result = structuredClone(value).sort((left, right) => left.participantId - right.participantId)
	// This computes the strict canonical digest and therefore validates every
	// evidence field used by the threshold authorization.
	demoFrostFundingAbortParticipantPolicyDigest(result)
	return result as Three<DemoFundingAbortParticipantEvidenceV1>
}

export interface DemoFundingAbortSessionAnchorSnapshotV1 {
	schema: 'COCO_DEMO_FUNDING_ABORT_SESSION_ANCHOR_V1'
	deploymentId: string
	storeGeneration: string
	globalRevision: number
	stateDigest: string
}

/** Independent file anchor for the coordinator's FROST session database. */
export class DemoFundingAbortSessionRollbackAnchorSqlite {
	constructor(private readonly database: Database, private readonly allowFirstEnrollment = false) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS demo_funding_abort_session_rollback_anchor (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id=1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, maximum_revision INTEGER NOT NULL, state_digest TEXT NOT NULL
			) STRICT`)
	}

	observeExact(snapshot: DemoFundingAbortSessionAnchorSnapshotV1): void {
		if (snapshot.schema !== 'COCO_DEMO_FUNDING_ABORT_SESSION_ANCHOR_V1'
			|| !ID.test(snapshot.deploymentId) || !HEX_32.test(snapshot.storeGeneration)
			|| !HEX_32.test(snapshot.stateDigest) || !Number.isSafeInteger(snapshot.globalRevision)
			|| snapshot.globalRevision < 0) throw new Error('DEMO_FIPS_ABORT_SESSION_ANCHOR: snapshot is invalid')
		this.database.transaction(() => {
			const row = this.database.query<{ deployment_id: string; store_generation: string;
				maximum_revision: number; state_digest: string }, []>(`SELECT deployment_id,store_generation,
				maximum_revision,state_digest FROM demo_funding_abort_session_rollback_anchor WHERE id=1`).get()
			if (row === null) {
				if (!this.allowFirstEnrollment || snapshot.globalRevision !== 0) {
					throw new Error('DEMO_FIPS_ABORT_SESSION_ANCHOR: independent anchor is missing')
				}
				this.database.query(`INSERT INTO demo_funding_abort_session_rollback_anchor
					(id,deployment_id,store_generation,maximum_revision,state_digest) VALUES(1,?,?,?,?)`)
					.run(snapshot.deploymentId, snapshot.storeGeneration, snapshot.globalRevision, snapshot.stateDigest)
				return
			}
			if (row.deployment_id !== snapshot.deploymentId || row.store_generation !== snapshot.storeGeneration) {
				throw new Error('DEMO_FIPS_ABORT_SESSION_ANCHOR: deployment or generation was replaced')
			}
			if (snapshot.globalRevision < row.maximum_revision) {
				throw new Error('DEMO_FIPS_ABORT_SESSION_ANCHOR: session revision regressed')
			}
			if (snapshot.globalRevision === row.maximum_revision) {
				if (snapshot.stateDigest !== row.state_digest) {
					throw new Error('DEMO_FIPS_ABORT_SESSION_ANCHOR: session changed at anchored revision')
				}
				return
			}
			const updated = this.database.query(`UPDATE demo_funding_abort_session_rollback_anchor
				SET maximum_revision=?,state_digest=? WHERE id=1 AND maximum_revision=? AND state_digest=?`)
				.run(snapshot.globalRevision, snapshot.stateDigest, row.maximum_revision, row.state_digest)
			if (updated.changes !== 1) throw new Error('DEMO_FIPS_ABORT_SESSION_ANCHOR: anchor changed concurrently')
		}).immediate()
	}
}

/** Separate durable domain from admission and disposition signing sessions. */
export class DemoFundingAbortSqliteSessionStore implements DemoFundingAbortSigningSessionStore {
	readonly storeGeneration?: string
	constructor(private readonly database: Database, private readonly options?: {
		deploymentId: string
		anchor: DemoFundingAbortSessionRollbackAnchorSqlite
		initialize?: boolean
	}) {
		database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
		const priorTable = database.query<{ name: string }, []>(`SELECT name FROM sqlite_master
			WHERE type='table' AND name='demo_funding_abort_sessions'`).get()
		if (priorTable !== null) {
			const priorColumns = new Set(database.query<{ name: string }, []>(
				'PRAGMA table_info(demo_funding_abort_sessions)',
			).all().map(({ name }) => name))
			for (const required of ['operation_id', 'operation_root', 'committee_digest', 'participant_ids',
				'participant_evidence_json', 'session_id', 'attempt_number', 'excluded_participant_ids',
				'commitments_json', 'shares_json', 'completed_json']) {
				if (!priorColumns.has(required)) {
					throw new Error('DEMO_FIPS_ABORT_SESSION_SCHEMA_OLD: existing store must be quarantined, not migrated in place')
				}
			}
		}
		database.exec(`
			CREATE TABLE IF NOT EXISTS demo_funding_abort_sessions (
				operation_id TEXT PRIMARY KEY, operation_root TEXT NOT NULL, committee_digest TEXT NOT NULL,
				participant_ids TEXT NOT NULL, participant_evidence_json TEXT NOT NULL,
				session_id TEXT NOT NULL UNIQUE, attempt_number INTEGER NOT NULL CHECK(attempt_number>=1),
				excluded_participant_ids TEXT NOT NULL,
				commitments_json TEXT, shares_json TEXT, completed_json TEXT
			) STRICT;
			CREATE TABLE IF NOT EXISTS demo_funding_abort_abandoned_sessions (
				operation_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, operation_root TEXT NOT NULL,
				committee_digest TEXT NOT NULL, participant_ids TEXT NOT NULL,
				participant_evidence_json TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE,
				excluded_participant_ids TEXT NOT NULL, commitments_json TEXT, shares_json TEXT,
				failed_participant_id INTEGER NOT NULL CHECK(failed_participant_id BETWEEN 1 AND 4),
				PRIMARY KEY(operation_id,attempt_number)
			) STRICT;
			CREATE TABLE IF NOT EXISTS demo_funding_abort_signer_anchors (
				participant_id INTEGER PRIMARY KEY NOT NULL, stable_identity TEXT NOT NULL,
				maximum_restart_epoch INTEGER NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS demo_funding_abort_session_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id=1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, global_revision INTEGER NOT NULL
			) STRICT;`)
		if (options !== undefined) {
			if (!ID.test(options.deploymentId)) throw new Error('DEMO_FIPS_ABORT_SESSION: deployment identity is invalid')
			database.transaction(() => {
				const row = database.query<{ deployment_id: string; store_generation: string }, []>(
					'SELECT deployment_id,store_generation FROM demo_funding_abort_session_metadata WHERE id=1',
				).get()
				if (row === null) {
					if (!options.initialize) throw new Error('DEMO_FIPS_ABORT_SESSION: store metadata is missing')
					database.query(`INSERT INTO demo_funding_abort_session_metadata
						(id,deployment_id,store_generation,global_revision) VALUES(1,?,?,0)`)
						.run(options.deploymentId, randomBytes(32).toString('hex'))
				} else if (row.deployment_id !== options.deploymentId || !HEX_32.test(row.store_generation)) {
					throw new Error('DEMO_FIPS_ABORT_SESSION: deployment or generation differs')
				}
			}).immediate()
			this.storeGeneration = database.query<{ store_generation: string }, []>(
				'SELECT store_generation FROM demo_funding_abort_session_metadata WHERE id=1',
			).get()!.store_generation
			this.#observeAnchor()
		}
	}

	#advance(): void {
		if (this.options !== undefined && this.database.query(`UPDATE demo_funding_abort_session_metadata
			SET global_revision=global_revision+1 WHERE id=1`).run().changes !== 1) {
			throw new Error('DEMO_FIPS_ABORT_SESSION: metadata did not advance')
		}
	}

	#snapshot(): DemoFundingAbortSessionAnchorSnapshotV1 {
		if (this.options === undefined || this.storeGeneration === undefined) {
			throw new Error('DEMO_FIPS_ABORT_SESSION_ANCHOR: store is not independently anchored')
		}
		const metadata = this.database.query<{ global_revision: number }, []>(
			'SELECT global_revision FROM demo_funding_abort_session_metadata WHERE id=1',
		).get()!
		const sessions = this.database.query<Record<string, string | number | null>, []>(`SELECT operation_id,
			operation_root,committee_digest,participant_ids,participant_evidence_json,session_id,attempt_number,
			excluded_participant_ids,commitments_json,shares_json,completed_json
			FROM demo_funding_abort_sessions ORDER BY operation_id`).all()
		const abandoned = this.database.query<Record<string, string | number | null>, []>(`SELECT operation_id,
			attempt_number,operation_root,committee_digest,participant_ids,participant_evidence_json,session_id,
			excluded_participant_ids,commitments_json,shares_json,failed_participant_id
			FROM demo_funding_abort_abandoned_sessions ORDER BY operation_id,attempt_number`).all()
		const signers = this.database.query<Record<string, string | number>, []>(`SELECT participant_id,
			stable_identity,maximum_restart_epoch FROM demo_funding_abort_signer_anchors ORDER BY participant_id`).all()
		return { schema: 'COCO_DEMO_FUNDING_ABORT_SESSION_ANCHOR_V1',
			deploymentId: this.options.deploymentId, storeGeneration: this.storeGeneration,
			globalRevision: metadata.global_revision,
			stateDigest: createHash('sha256').update(canonical(['COCO_DEMO_FUNDING_ABORT_SESSION_STATE_V2',
				this.options.deploymentId, this.storeGeneration, metadata.global_revision, sessions, abandoned, signers])).digest('hex') }
	}

	#observeAnchor(): void { if (this.options !== undefined) this.options.anchor.observeExact(this.#snapshot()) }

	async read(operationId: string): Promise<{
		operationRoot: string; committeeDigest: string
		participantIds: [ParticipantId, ParticipantId, ParticipantId]
		participantEvidence: Three<DemoFundingAbortParticipantEvidenceV1>
		attemptNumber: number
		excludedParticipantIds: ParticipantId[]
	} | null> {
		if (!ID.test(operationId)) throw new Error('DEMO_FIPS_ABORT_SESSION: operation identity is invalid')
		const row = this.database.query<Record<string, string | number>, [string]>(`SELECT operation_root,
			committee_digest,participant_ids,participant_evidence_json,attempt_number,excluded_participant_ids
			FROM demo_funding_abort_sessions
			WHERE operation_id=?`).get(operationId)
		if (row === null) return null
		const participantIds = JSON.parse(String(row.participant_ids)) as [ParticipantId, ParticipantId, ParticipantId]
		const participantEvidence = exactEvidence(JSON.parse(String(row.participant_evidence_json)) as DemoFundingAbortParticipantEvidenceV1[])
		const excludedParticipantIds = JSON.parse(String(row.excluded_participant_ids)) as ParticipantId[]
		if (canonical(participantIds) !== canonical(participantEvidence.map(({ participantId }) => participantId))) {
			throw new Error('DEMO_FIPS_ABORT_SESSION: persisted participant identities differ')
		}
		if (!Number.isSafeInteger(row.attempt_number) || Number(row.attempt_number) < 1
			|| excludedParticipantIds.some((id, index) => ![1, 2, 3, 4].includes(id)
				|| (index > 0 && excludedParticipantIds[index - 1]! >= id))
			|| participantIds.some((id) => excludedParticipantIds.includes(id))) {
			throw new Error('DEMO_FIPS_ABORT_SESSION: persisted attempt state is malformed')
		}
		return { operationRoot: String(row.operation_root), committeeDigest: String(row.committee_digest),
			participantIds, participantEvidence, attemptNumber: Number(row.attempt_number), excludedParticipantIds }
	}

	async claim(binding: { operationId: string; operationRoot: string; committeeDigest: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId] },
		participantEvidenceValue: Three<DemoFundingAbortParticipantEvidenceV1>) {
		if (!HEX_32.test(binding.operationRoot) || !HEX_32.test(binding.committeeDigest)) {
			throw new Error('DEMO_FIPS_ABORT_SESSION: malformed binding')
		}
		const ids = JSON.stringify(binding.participantIds)
		const participantEvidence = exactEvidence(participantEvidenceValue)
		if (canonical(binding.participantIds) !== canonical(participantEvidence.map(({ participantId }) => participantId))) {
			throw new Error('DEMO_FIPS_ABORT_SESSION: participant evidence differs from selected identities')
		}
		const evidenceJson = canonical(participantEvidence)
		const result = this.database.transaction(() => {
			const row = this.database.query<Record<string, string | number | null>, [string]>(`SELECT operation_root,
				committee_digest,participant_ids,participant_evidence_json,session_id,attempt_number,
				commitments_json,shares_json,completed_json FROM demo_funding_abort_sessions
				WHERE operation_id=?`).get(binding.operationId)
			if (row !== null) {
				if (row.operation_root !== binding.operationRoot || row.committee_digest !== binding.committeeDigest
					|| row.participant_ids !== ids || canonical(JSON.parse(String(row.participant_evidence_json))) !== evidenceJson) {
					throw new Error('DEMO_FIPS_ABORT_SESSION_CONFLICT: operation binding changed')
				}
				return { sessionId: String(row.session_id), attemptNumber: Number(row.attempt_number), participantEvidence,
					commitments: row.commitments_json === null ? undefined
						: structuredClone(JSON.parse(String(row.commitments_json)) as DemoFrostFundingAbortCommitmentV1[]),
					shares: row.shares_json === null ? undefined
						: structuredClone(JSON.parse(String(row.shares_json)) as DemoFrostFundingAbortShareV1[]),
					completed: row.completed_json === null
						? undefined : exactResult(JSON.parse(String(row.completed_json)) as ReturnType<typeof exactResult>) }
			}
			const sessionId = randomBytes(32).toString('hex')
			this.database.query(`INSERT INTO demo_funding_abort_sessions
				(operation_id,operation_root,committee_digest,participant_ids,participant_evidence_json,
				session_id,attempt_number,excluded_participant_ids,commitments_json,shares_json,completed_json)
				VALUES(?,?,?,?,?,?,1,'[]',NULL,NULL,NULL)`).run(binding.operationId, binding.operationRoot,
				binding.committeeDigest, ids, evidenceJson, sessionId)
			this.#advance()
			return { sessionId, attemptNumber: 1, participantEvidence }
		}).immediate()
		this.#observeAnchor()
		return result
	}

	async rollover(binding: Parameters<DemoFundingAbortSigningSessionStore['rollover']>[0],
		failedParticipantId: ParticipantId,
		nextBinding: Parameters<DemoFundingAbortSigningSessionStore['rollover']>[2],
		participantEvidenceValue: Three<DemoFundingAbortParticipantEvidenceV1>) {
		if (binding.operationId !== nextBinding.operationId || !binding.participantIds.includes(failedParticipantId)
			|| !HEX_32.test(nextBinding.operationRoot) || !HEX_32.test(nextBinding.committeeDigest)) {
			throw new Error('DEMO_FIPS_ABORT_SESSION_ROLLOVER: malformed attempt transition')
		}
		const participantEvidence = exactEvidence(participantEvidenceValue)
		const nextIds = participantEvidence.map(({ participantId }) => participantId) as Three<ParticipantId>
		if (canonical(nextIds) !== canonical(nextBinding.participantIds)) {
			throw new Error('DEMO_FIPS_ABORT_SESSION_ROLLOVER: next evidence differs from participant identities')
		}
		const nextSessionId = randomBytes(32).toString('hex')
		const result = this.database.transaction(() => {
			const row = this.database.query<Record<string, string | number | null>, [string]>(`SELECT operation_root,
				committee_digest,participant_ids,participant_evidence_json,session_id,attempt_number,
				excluded_participant_ids,commitments_json,shares_json,completed_json
				FROM demo_funding_abort_sessions WHERE operation_id=?`).get(binding.operationId)
			if (row === null || row.operation_root !== binding.operationRoot || row.committee_digest !== binding.committeeDigest
				|| row.participant_ids !== JSON.stringify(binding.participantIds) || row.session_id !== binding.sessionId
				|| row.completed_json !== null) {
				throw new Error('DEMO_FIPS_ABORT_SESSION_ROLLOVER: active attempt changed or completed')
			}
			const priorExcluded = JSON.parse(String(row.excluded_participant_ids)) as ParticipantId[]
			const excluded = [...new Set([...priorExcluded, failedParticipantId])].sort((left, right) => left - right)
			if (excluded.length !== 1 || Number(row.attempt_number) !== 1
				|| nextBinding.participantIds.some((id) => excluded.includes(id))
				|| nextBinding.participantIds.length !== 3) {
				throw new Error('DEMO_FIPS_ABORT_SESSION_ROLLOVER: only one fresh 3-of-4 attempt is safe')
			}
			this.database.query(`INSERT INTO demo_funding_abort_abandoned_sessions
				(operation_id,attempt_number,operation_root,committee_digest,participant_ids,
				participant_evidence_json,session_id,excluded_participant_ids,commitments_json,shares_json,
				failed_participant_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(binding.operationId,
				row.attempt_number, row.operation_root, row.committee_digest, row.participant_ids,
				row.participant_evidence_json, row.session_id, row.excluded_participant_ids,
				row.commitments_json, row.shares_json, failedParticipantId)
			const updated = this.database.query(`UPDATE demo_funding_abort_sessions SET operation_root=?,
				committee_digest=?,participant_ids=?,participant_evidence_json=?,session_id=?,attempt_number=2,
				excluded_participant_ids=?,commitments_json=NULL,shares_json=NULL,completed_json=NULL
				WHERE operation_id=? AND session_id=?`).run(nextBinding.operationRoot, nextBinding.committeeDigest,
				JSON.stringify(nextBinding.participantIds), canonical(participantEvidence), nextSessionId,
				JSON.stringify(excluded), binding.operationId, binding.sessionId)
			if (updated.changes !== 1) throw new Error('DEMO_FIPS_ABORT_SESSION_ROLLOVER: attempt changed concurrently')
			this.#advance()
			return { sessionId: nextSessionId, attemptNumber: 2, participantEvidence }
		}).immediate()
		this.#observeAnchor()
		return result
	}

	#observeParticipant(binding: DemoFrostFundingAbortCommitmentV1['durable_binding']): void {
		if (binding.version !== DEMO_FROST_FUNDING_ABORT_VERSION || ![1, 2, 3, 4].includes(binding.participant_id)
			|| !HEX_32.test(binding.public_key_package_sha256) || !HEX_32.test(binding.signer_roster_digest)
			|| !HEX_32.test(binding.state_directory_identity) || !HEX_32.test(binding.journal_generation)
			|| !Number.isSafeInteger(binding.restart_epoch) || binding.restart_epoch < 1) {
			throw new Error('DEMO_FIPS_ABORT_ANCHOR: participant durable binding is malformed')
		}
		const { restart_epoch: _restartEpoch, ...stableBinding } = binding
		const stable = canonical(stableBinding)
		const found = this.database.query<{ stable_identity: string; maximum_restart_epoch: number }, [number]>(
			'SELECT stable_identity,maximum_restart_epoch FROM demo_funding_abort_signer_anchors WHERE participant_id=?',
		).get(binding.participant_id)
		if (found === null) {
			this.database.query('INSERT INTO demo_funding_abort_signer_anchors(participant_id,stable_identity,maximum_restart_epoch) VALUES(?,?,?)')
				.run(binding.participant_id, stable, binding.restart_epoch); return
		}
		if (found.stable_identity !== stable) throw new Error('DEMO_FIPS_ABORT_ANCHOR_REPLACED: participant state changed')
		if (binding.restart_epoch <= found.maximum_restart_epoch) throw new Error('DEMO_FIPS_ABORT_ANCHOR_REGRESSED: restart epoch regressed')
		if (this.database.query(`UPDATE demo_funding_abort_signer_anchors SET maximum_restart_epoch=?
			WHERE participant_id=? AND maximum_restart_epoch=?`).run(binding.restart_epoch,
			binding.participant_id, found.maximum_restart_epoch).changes !== 1) {
			throw new Error('DEMO_FIPS_ABORT_ANCHOR_CAS: participant epoch changed concurrently')
		}
	}

	#savePhase<T extends DemoFrostFundingAbortCommitmentV1 | DemoFrostFundingAbortShareV1>(binding: {
		operationId: string; operationRoot: string; committeeDigest: string; sessionId: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId]
	}, column: 'commitments_json' | 'shares_json', value: T[]): void {
		if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
			throw new Error('DEMO_FIPS_ABORT_SESSION_PHASE: phase must contain one to three responses')
		}
		const serialized = canonical(value)
		const changed = this.database.transaction(() => {
			const row = this.database.query<Record<string, string | null>, [string]>(`SELECT operation_root,
				committee_digest,participant_ids,session_id,commitments_json,shares_json,completed_json
				FROM demo_funding_abort_sessions WHERE operation_id=?`).get(binding.operationId)
			if (row === null || row.operation_root !== binding.operationRoot || row.committee_digest !== binding.committeeDigest
				|| row.participant_ids !== JSON.stringify(binding.participantIds) || row.session_id !== binding.sessionId
				|| row.completed_json !== null || (column === 'shares_json' && (row.commitments_json === null
					|| (JSON.parse(row.commitments_json) as unknown[]).length !== 3))) {
				throw new Error('DEMO_FIPS_ABORT_SESSION_PHASE: durable session differs or phase order regressed')
			}
			const prior = row[column] === null ? [] : JSON.parse(row[column]!) as T[]
			if (value.length < prior.length || canonical(value.slice(0, prior.length)) !== canonical(prior)) {
				throw new Error('DEMO_FIPS_ABORT_SESSION_PHASE: durable phase is not an exact prefix')
			}
			for (const response of value.slice(prior.length)) this.#observeParticipant(response.durable_binding)
			if (canonical(prior) === serialized) return false
			this.database.query(`UPDATE demo_funding_abort_sessions SET ${column}=? WHERE operation_id=?`)
				.run(JSON.stringify(value), binding.operationId)
			this.#advance()
			return true
		}).immediate()
		if (changed) this.#observeAnchor()
	}

	async saveCommitments(binding: Parameters<DemoFundingAbortSigningSessionStore['saveCommitments']>[0],
		value: DemoFrostFundingAbortCommitmentV1[]): Promise<void> {
		this.#savePhase(binding, 'commitments_json', value)
	}

	async saveShares(binding: Parameters<DemoFundingAbortSigningSessionStore['saveShares']>[0],
		value: DemoFrostFundingAbortShareV1[]): Promise<void> {
		this.#savePhase(binding, 'shares_json', value)
	}

	async complete(binding: { operationId: string; operationRoot: string; committeeDigest: string; sessionId: string;
		participantIds: [ParticipantId, ParticipantId, ParticipantId] }, value: ReturnType<typeof exactResult>): Promise<void> {
		const exact = exactResult(value), serialized = canonical(exact)
		const changed = this.database.transaction(() => {
			const row = this.database.query<Record<string, string | null>, [string]>(`SELECT operation_root,
				committee_digest,participant_ids,session_id,commitments_json,shares_json,completed_json FROM demo_funding_abort_sessions
				WHERE operation_id=?`).get(binding.operationId)
			if (row === null || row.operation_root !== binding.operationRoot || row.committee_digest !== binding.committeeDigest
				|| row.participant_ids !== JSON.stringify(binding.participantIds) || row.session_id !== binding.sessionId
				|| JSON.stringify(exact.participantIds) !== JSON.stringify(binding.participantIds)
				|| row.commitments_json === null || (JSON.parse(row.commitments_json) as unknown[]).length !== 3
				|| row.shares_json === null || (JSON.parse(row.shares_json) as unknown[]).length !== 3) {
				throw new Error('DEMO_FIPS_ABORT_SESSION_RESULT: durable session differs')
			}
			if (row.completed_json !== null && canonical(JSON.parse(row.completed_json)) !== serialized) {
				throw new Error('DEMO_FIPS_ABORT_SESSION_RESULT: completed result changed')
			}
			if (row.completed_json !== null) return false
			this.database.query('UPDATE demo_funding_abort_sessions SET completed_json=? WHERE operation_id=?')
				.run(JSON.stringify(exact), binding.operationId)
			this.#advance()
			return true
		}).immediate()
		if (changed) this.#observeAnchor()
	}

	async observeParticipant(binding: DemoFrostFundingAbortCommitmentV1['durable_binding']): Promise<void> {
		this.database.transaction(() => { this.#observeParticipant(binding); this.#advance() }).immediate()
		this.#observeAnchor()
	}
}

async function privateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' }); await chmod(path, 0o600)
}
async function scratch<T>(parent: string, run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(parent, 'funding-abort-aggregate-')); await chmod(directory, 0o700)
	try { return await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

class FundingAbortParticipantUnavailable extends Error {
	constructor(readonly participantId: ParticipantId, message: string, options?: ErrorOptions) {
		super(message, options); this.name = 'FundingAbortParticipantUnavailable'
	}
}

async function boundedParticipantCall<T>(participantId: ParticipantId, timeoutMs: number,
	run: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const abort = new AbortController()
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			abort.abort()
			reject(new FundingAbortParticipantUnavailable(participantId,
				`DEMO_FIPS_ABORT_UNAVAILABLE: participant ${participantId} timed out`))
		}, timeoutMs)
	})
	try {
		return await Promise.race([run(abort.signal), timeout])
	} catch (cause) {
		if (cause instanceof FundingAbortParticipantUnavailable) throw cause
		if (cause instanceof DemoFipsFundingAbortRpcUnavailableError || abort.signal.aborted) {
			throw new FundingAbortParticipantUnavailable(participantId,
				`DEMO_FIPS_ABORT_UNAVAILABLE: participant ${participantId} transport failed`,
				{ cause: cause instanceof Error ? cause : undefined })
		}
		throw cause
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}

async function firstFundingAbortPolicyQuorum(options: {
	clients: [DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient,
		DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient]
	payload: DemoFipsFundingAbortPolicyPayloadV1
	excludedParticipantIds: ParticipantId[]
	timeoutMs: number
}): Promise<Three<DemoFundingAbortParticipantEvidenceV1>> {
	type Outcome = { participantId: ParticipantId; evidence?: DemoFundingAbortParticipantEvidenceV1; error?: unknown }
	const all: Promise<Outcome>[] = []
	for (const participantId of [1, 2, 3, 4] as const) {
		if (options.excludedParticipantIds.includes(participantId)) continue
		const call = boundedParticipantCall(participantId, options.timeoutMs,
			(signal) => options.clients[participantId - 1].call('policy', options.payload, signal))
		const outcome = call.then((evidence) => ({ participantId, evidence }),
			(error: unknown) => ({ participantId, error }))
		all.push(outcome)
	}
	const outcomes = await Promise.all(all)
	const evidence: DemoFundingAbortParticipantEvidenceV1[] = []
	for (const outcome of outcomes) {
		if (outcome.error !== undefined && !(outcome.error instanceof FundingAbortParticipantUnavailable)) {
			throw outcome.error
		}
		if (outcome.evidence !== undefined) {
			if (outcome.evidence.participantId !== outcome.participantId) {
				throw new Error('DEMO_FIPS_ABORT_POLICY: signer returned another participant identity')
			}
			evidence.push(outcome.evidence)
		}
	}
	if (evidence.length < 3) throw new Error('DEMO_FIPS_ABORT_QUORUM: fewer than three signer-local policies accepted')
	// All four calls are bounded and settled before the durable claim. An
	// explicit signer-local refusal is therefore never hidden behind a faster
	// quorum, while one unavailable participant still leaves a deterministic
	// 3-of-4 subset.
	return exactEvidence(evidence.slice(0, 3))
}

export function createDemoFipsFundingAbortCommittee(options: {
	clients: [DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient,
		DemoFipsFundingAbortRpcClient, DemoFipsFundingAbortRpcClient]
	capsules: DemoFridayFundingAbortCapsuleStore
	sessions: DemoFundingAbortSigningSessionStore
	binaryPath: string
	publicKeyPackagePath: string
	scratchParent: string
	committeePublicKey: string
	rpcTimeoutMs?: number
	runCommand?: (argv: string[]) => Promise<void>
}): DemoFridayFundingAbortCommitteePort {
	const rpcTimeoutMs = options.rpcTimeoutMs ?? 15_000
	if (!Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 10 || rpcTimeoutMs > 60_000) {
		throw new Error('DEMO_FIPS_ABORT_TIMEOUT: RPC timeout must be between 10ms and 60s')
	}
	const runCommand = options.runCommand ?? (async (argv: string[]) => {
		const child = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
		const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
		if (code !== 0) throw new Error(`DEMO_FIPS_ABORT_AGGREGATE_COMMAND: exit ${code}: ${stderr.trim() || 'no diagnostic'}`)
	})
	const authorizeExact = async (input: Parameters<DemoFridayFundingAbortCommitteePort['authorizeExact']>[0]) => {
			const capsule = await options.capsules.readByOperationExact(input.actorTerms.operationId)
			if (capsule.refund.operationId !== input.actorTerms.operationId
				|| capsule.refund.templateDigest !== input.actorTerms.returnPackageDigest
				|| capsule.refund.cashuSigAllDigest !== input.actorTerms.returnCashuSigAllDigest
				|| capsule.capsuleDigest !== input.actorTerms.fundingAuthorizationEventId) {
				throw new Error('DEMO_FIPS_ABORT_PREPARED: encrypted refund package differs from abort terms')
			}
			const request = { schema: 'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_POLICY_REQUEST_V1' as const,
				actorTerms: structuredClone(input.actorTerms), actorAbortEvent: structuredClone(input.actorAbortEvent),
				evidence: structuredClone(input.evidence), returnTemplate: structuredClone(capsule.refund),
				nowSeconds: Math.floor(Date.now() / 1000) }
			const prior = await options.sessions.read(input.actorTerms.operationId)
			let evidence: Three<DemoFundingAbortParticipantEvidenceV1>
			if (prior !== null) evidence = prior.participantEvidence
			else evidence = await firstFundingAbortPolicyQuorum({ clients: options.clients,
				payload: { schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_POLICY_PAYLOAD_V1', request },
				excludedParticipantIds: [], timeoutMs: rpcTimeoutMs })
			const participantPolicyDigest = demoFrostFundingAbortParticipantPolicyDigest(evidence)
			const committeeUnsigned: DemoFridayFundingAbortCommitteeUnsignedV1 = {
				...structuredClone(input.actorTerms), participantPolicyDigest,
				actorAbortEvent: structuredClone(input.actorAbortEvent),
			}
			const provisional = demoFrostFundingAbortAuthorization({ committeeUnsigned,
				participantEvidence: evidence, sessionId: '00'.repeat(32) })
			const selected = evidence.map(({ participantId }) => participantId) as [ParticipantId, ParticipantId, ParticipantId]
			const binding = { operationId: provisional.operation_id, operationRoot: provisional.operation_root,
				committeeDigest: provisional.committee_digest, participantIds: selected }
			const claimed = await options.sessions.claim(binding, evidence)
			if (claimed.completed !== undefined) return claimed.completed
			if (!HEX_32.test(claimed.sessionId)) throw new Error('DEMO_FIPS_ABORT_SESSION: invalid durable session')
			const authorization = demoFrostFundingAbortAuthorization({ committeeUnsigned,
				participantEvidence: claimed.participantEvidence, sessionId: claimed.sessionId })
			if (authorization.operation_root !== binding.operationRoot) throw new Error('DEMO_FIPS_ABORT_SESSION: root changed')
			const base: DemoFipsFundingAbortCommitPayloadV1 = {
				schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_COMMIT_PAYLOAD_V1', request,
				participantEvidence: claimed.participantEvidence, sessionId: claimed.sessionId,
			}
			const authorizationDigest = demoFrostFundingAbortAuthorizationDigest(authorization)
			const exactCommitment = (result: DemoFrostFundingAbortCommitmentV1, index: number): void => {
				if (result.version !== DEMO_FROST_FUNDING_ABORT_VERSION
				|| result.operation_id !== authorization.operation_id || result.session_id !== claimed.sessionId
				|| result.authorization_digest !== authorizationDigest || result.participant_id !== selected[index]
				|| !COMPRESSED.test(result.hiding_hex) || !COMPRESSED.test(result.binding_hex)) {
					throw new Error('DEMO_FIPS_ABORT_COMMITMENT: signer returned another authorization')
				}
			}
			let exactCommitments: Three<DemoFrostFundingAbortCommitmentV1>
			let exactShares: Three<DemoFrostFundingAbortShareV1>
			let transcript: string
			try {
				const commitments = structuredClone(claimed.commitments ?? [])
				commitments.forEach(exactCommitment)
				for (let index = commitments.length; index < selected.length; index += 1) {
					const participantId = selected[index]!
					const result = await boundedParticipantCall(participantId, rpcTimeoutMs,
						(signal) => options.clients[participantId - 1].call('commit', base, signal))
					exactCommitment(result, index); commitments.push(result)
					await options.sessions.saveCommitments({ ...binding, sessionId: claimed.sessionId }, commitments)
				}
				exactCommitments = commitments as Three<DemoFrostFundingAbortCommitmentV1>
				const sharesPayload: DemoFipsFundingAbortSharePayloadV1 = {
					...base, schema: 'COCO_DEMO_FIPS_FUNDING_ABORT_SHARE_PAYLOAD_V1', commitments: exactCommitments,
				}
				transcript = demoFrostFundingAbortTranscriptDigest(authorizationDigest, exactCommitments)
				const exactShare = (result: DemoFrostFundingAbortShareV1, index: number): void => {
					if (result.operation_id !== authorization.operation_id
					|| result.session_id !== claimed.sessionId || result.authorization_digest !== authorizationDigest
					|| result.commitments_digest !== transcript || result.participant_id !== selected[index]
					|| !HEX_32.test(result.share_hex)) throw new Error('DEMO_FIPS_ABORT_SHARE: signer returned another transcript')
				}
				const shares = structuredClone(claimed.shares ?? [])
				shares.forEach(exactShare)
				for (let index = shares.length; index < selected.length; index += 1) {
					const participantId = selected[index]!
					const result = await boundedParticipantCall(participantId, rpcTimeoutMs,
						(signal) => options.clients[participantId - 1].call('share', sharesPayload, signal))
					exactShare(result, index); shares.push(result)
					await options.sessions.saveShares({ ...binding, sessionId: claimed.sessionId }, shares)
				}
				exactShares = shares as Three<DemoFrostFundingAbortShareV1>
			} catch (cause) {
				// A signer claims operation_id -> operation_root durably before it
				// creates a nonce.  Changing the policy subset changes that root, so a
				// retained signer cannot safely be recycled into a fresh transcript.
				// Availability is handled before the claim by firstPolicyQuorum; once a
				// session is claimed, any selected-member failure must remain fail closed.
				throw cause
			}
			const aggregate = await scratch(options.scratchParent, async (directory) => {
				const authPath = join(directory, 'authorization.json'), sharesPath = join(directory, 'shares.json')
				const outputPath = join(directory, 'aggregate.json')
				await privateJson(authPath, authorization)
				await privateJson(sharesPath, { version: DEMO_FROST_FUNDING_ABORT_VERSION,
					operation_id: authorization.operation_id, session_id: authorization.session_id,
					commitments: exactCommitments.map(({ participant_id, hiding_hex, binding_hex }) => ({ participant_id, hiding_hex, binding_hex })),
					shares: exactShares.map(({ participant_id, share_hex }) => ({ participant_id, share_hex })) })
				await runCommand([options.binaryPath, 'funding-abort-aggregate', authPath,
					options.publicKeyPackagePath, sharesPath, outputPath])
				return JSON.parse(await readFile(outputPath, 'utf8')) as DemoFrostFundingAbortAggregateV1
			})
			if (aggregate.operation_id !== authorization.operation_id || aggregate.operation_root !== authorization.operation_root
				|| aggregate.session_id !== authorization.session_id || aggregate.authorization_digest !== authorizationDigest
				|| aggregate.commitments_digest !== transcript || aggregate.committee_digest !== authorization.committee_digest
				|| aggregate.participant_policy_digest !== participantPolicyDigest
				|| JSON.stringify(aggregate.participant_ids) !== JSON.stringify(selected) || !HEX_64.test(aggregate.signature_hex)
				|| !schnorr.verify(hexToBytes(aggregate.signature_hex), hexToBytes(authorization.committee_digest),
					hexToBytes(options.committeePublicKey.slice(2)))) {
				throw new Error('DEMO_FIPS_ABORT_AGGREGATE: threshold signature differs from exact certificate')
			}
			const result = { participantPolicyDigest, committeeAbortSignature: aggregate.signature_hex,
				participantIds: selected }
			await options.sessions.complete({ ...binding, sessionId: claimed.sessionId }, result)
			return result
	}
	return Object.freeze({ authorizeExact })
}
