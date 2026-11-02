import { Database } from 'bun:sqlite'

import type {
	DemoIntegratedAnyAuthorityClaim,
	DemoIntegratedAuthorityClaim,
	DemoIntegratedExecutionRootBindingV1,
	DemoIntegratedExecutionRootBindingV2,
	DemoIntegratedLifecycleRecord,
	DemoIntegratedLifecycleStatus,
	DemoIntegratedTerminalAuthorityClaimV2,
	DemoIntegratedTerminalAuthorityStore,
} from './demo-integrated-authority'
import {
	demoIntegratedExecutionRootBindingDigest,
	demoIntegratedExecutionRootBindingV2Digest,
	demoIntegratedProofPoolDigest,
} from './demo-integrated-authority'

const SCHEMA = 'COCO_DEMO_INTEGRATED_AUTHORITY_CLAIM_V1'
const HEX_32 = /^[0-9a-f]{64}$/
const COMPRESSED_POINT = /^(?:02|03)[0-9a-f]{64}$/
const CLAIM_KEYS = [
	'schema', 'operationId', 'operationRoot', 'network', 'chainId', 'auctionId', 'displacedBidId',
	'replacementBidId', 'displacementHeight', 'templateDigest', 'cashuSigAllDigest', 'outputsDigest',
	'proofStateRefs', 'poolAmount', 'admissionOperationId', 'admissionReceiptDigest', 'committeeKeysetId',
	'committeeKeysetVersion', 'dkgRunId', 'publicKeyPackageSha256', 'signerRosterDigest', 'status',
] as const
const LIFECYCLE_STATUSES = new Set<DemoIntegratedLifecycleStatus>([
	'outbid_return_pending', 'terminal_pending', 'execution_pending', 'execution_unknown', 'mint_unknown',
	'retry_ready', 'recipient_pending', 'recipient_imported', 'quarantined',
])
const EXECUTION_BINDING_KEYS = [
	'schema', 'operationId', 'authorityOperationRoot', 'frostOperationRoot', 'templateDigest',
	'network', 'chainId', 'auctionId', 'displacedBidId', 'replacementBidId', 'displacementHeight',
	'cashuSigAllDigest', 'outputsDigest', 'proofPoolDigest', 'poolAmount', 'admissionReceiptDigest',
	'committeeKeysetId', 'committeeKeysetVersion', 'dkgRunId', 'publicKeyPackageSha256',
	'signerRosterDigest', 'processRosterDigest', 'policyPackageDigest', 'bindingDigest',
] as const
const TERMINAL_CLAIM_KEYS = [
	'schema', 'operationId', 'operationRoot', 'network', 'chainId', 'auctionId', 'bidId',
	'successorBidId', 'cause', 'role', 'outcomeHeight', 'outcomeStateHash', 'outcomeEvidenceDigest',
	'templateDigest', 'cashuSigAllDigest', 'outputsDigest', 'proofStateRefs', 'poolAmount',
	'admissionOperationId', 'admissionReceiptDigest', 'committeeKeysetId', 'committeeKeysetVersion',
	'dkgRunId', 'publicKeyPackageSha256', 'signerRosterDigest', 'status',
] as const
const TERMINAL_BINDING_KEYS = [
	'schema', 'operationId', 'authorityOperationRoot', 'frostOperationRoot', 'network', 'chainId',
	'auctionId', 'bidId', 'successorBidId', 'cause', 'role', 'outcomeHeight', 'outcomeStateHash',
	'outcomeEvidenceDigest', 'templateDigest', 'cashuSigAllDigest', 'outputsDigest', 'proofPoolDigest',
	'poolAmount', 'admissionReceiptDigest', 'committeeKeysetId', 'committeeKeysetVersion', 'dkgRunId',
	'publicKeyPackageSha256', 'signerRosterDigest', 'processRosterDigest', 'policyPackageDigest', 'bindingDigest',
] as const

function canonicalClaim(value: DemoIntegratedAuthorityClaim): string {
	return JSON.stringify(value)
}

function validatedClaim(value: DemoIntegratedAuthorityClaim): DemoIntegratedAuthorityClaim {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...CLAIM_KEYS].sort())
		|| value.schema !== SCHEMA || value.status !== 'outbid_return_pending'
		|| !/^[A-Za-z0-9_-]{1,160}$/.test(value.operationId) || value.admissionOperationId !== value.operationId
		|| !Number.isSafeInteger(value.displacementHeight) || value.displacementHeight < 1
		|| !Number.isSafeInteger(value.poolAmount) || value.poolAmount < 1
		|| [value.operationRoot, value.templateDigest, value.cashuSigAllDigest, value.outputsDigest,
			value.admissionReceiptDigest, value.publicKeyPackageSha256, value.signerRosterDigest].some((digest) => !HEX_32.test(digest))
		|| value.operationRoot !== value.templateDigest
		|| [value.network, value.chainId, value.auctionId, value.displacedBidId, value.replacementBidId,
			value.committeeKeysetId, value.committeeKeysetVersion, value.dkgRunId].some((text) => typeof text !== 'string' || text.length === 0 || text.trim() !== text)
		|| !Array.isArray(value.proofStateRefs) || value.proofStateRefs.length === 0
		|| value.proofStateRefs.some((proof) => !COMPRESSED_POINT.test(proof))
		|| new Set(value.proofStateRefs.map((proof) => proof.slice(2))).size !== value.proofStateRefs.length
		|| JSON.stringify(value.proofStateRefs) !== JSON.stringify([...value.proofStateRefs].sort())) {
		throw new Error('DEMO_AUTHORITY_SQLITE_STATE: authority claim is malformed')
	}
	return structuredClone(value)
}

function parsedClaim(value: string): DemoIntegratedAuthorityClaim {
	const parsed = JSON.parse(value) as DemoIntegratedAuthorityClaim
	return validatedClaim(parsed)
}

function validatedTerminalClaim(value: DemoIntegratedTerminalAuthorityClaimV2): DemoIntegratedTerminalAuthorityClaimV2 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('DEMO_AUTHORITY_SQLITE_TERMINAL_STATE: terminal authority claim is malformed')
	}
	const returnCause = value.cause === 'outbid' || value.cause === 'reserve_unmet' || value.cause === 'rejected'
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...TERMINAL_CLAIM_KEYS].sort())
		|| value.schema !== 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2' || value.status !== 'terminal_pending'
		|| !/^[A-Za-z0-9_-]{1,160}$/.test(value.operationId) || value.admissionOperationId !== value.operationId
		|| !Number.isSafeInteger(value.outcomeHeight) || value.outcomeHeight < 1
		|| !Number.isSafeInteger(value.poolAmount) || value.poolAmount < 1
		|| [value.operationRoot, value.outcomeStateHash, value.outcomeEvidenceDigest, value.templateDigest,
			value.cashuSigAllDigest, value.outputsDigest, value.admissionReceiptDigest,
			value.publicKeyPackageSha256, value.signerRosterDigest].some((digest) => !HEX_32.test(digest))
		|| value.operationRoot !== value.templateDigest
		|| (value.cause === 'winner' ? value.role !== 'winner_settlement' : value.role !== 'refund')
		|| (value.cause === 'outbid' ? value.successorBidId.length === 0 : value.successorBidId !== '')
		|| !['outbid', 'winner', 'reserve_unmet', 'rejected'].includes(value.cause)
		|| (returnCause && value.role !== 'refund')
		|| [value.network, value.chainId, value.auctionId, value.bidId,
			value.committeeKeysetId, value.committeeKeysetVersion, value.dkgRunId]
			.some((text) => typeof text !== 'string' || text.length === 0 || text.trim() !== text)
		|| !Array.isArray(value.proofStateRefs) || value.proofStateRefs.length === 0
		|| value.proofStateRefs.some((proof) => !COMPRESSED_POINT.test(proof))
		|| new Set(value.proofStateRefs.map((proof) => proof.slice(2))).size !== value.proofStateRefs.length
		|| JSON.stringify(value.proofStateRefs) !== JSON.stringify([...value.proofStateRefs].sort())) {
		throw new Error('DEMO_AUTHORITY_SQLITE_TERMINAL_STATE: terminal authority claim is malformed')
	}
	return structuredClone(value)
}

function parsedAnyClaim(value: string): DemoIntegratedAnyAuthorityClaim {
	const parsed = JSON.parse(value) as DemoIntegratedAnyAuthorityClaim
	return parsed.schema === 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2'
		? validatedTerminalClaim(parsed)
		: validatedClaim(parsed)
}

function validatedExecutionBinding(value: DemoIntegratedExecutionRootBindingV1): DemoIntegratedExecutionRootBindingV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...EXECUTION_BINDING_KEYS].sort())
		|| value.schema !== 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V1'
		|| !/^[A-Za-z0-9_-]{1,160}$/.test(value.operationId)
		|| [value.authorityOperationRoot, value.frostOperationRoot, value.templateDigest,
			value.cashuSigAllDigest, value.outputsDigest, value.proofPoolDigest,
			value.admissionReceiptDigest, value.publicKeyPackageSha256,
			value.signerRosterDigest, value.processRosterDigest, value.policyPackageDigest,
			value.bindingDigest].some((digest) => !HEX_32.test(digest))
		|| value.authorityOperationRoot !== value.templateDigest
		|| value.bindingDigest !== demoIntegratedExecutionRootBindingDigest(value)
		|| !Number.isSafeInteger(value.displacementHeight) || value.displacementHeight < 1
		|| !Number.isSafeInteger(value.poolAmount) || value.poolAmount < 1
		|| [value.network, value.chainId, value.auctionId, value.displacedBidId, value.replacementBidId,
			value.committeeKeysetId, value.committeeKeysetVersion, value.dkgRunId]
			.some((text) => typeof text !== 'string' || text.length === 0 || text.trim() !== text)) {
		throw new Error('DEMO_AUTHORITY_SQLITE_EXECUTION_BINDING: execution-root binding is malformed')
	}
	return structuredClone(value)
}

function validatedTerminalExecutionBinding(value: DemoIntegratedExecutionRootBindingV2): DemoIntegratedExecutionRootBindingV2 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...TERMINAL_BINDING_KEYS].sort())
		|| value.schema !== 'COCO_DEMO_INTEGRATED_EXECUTION_ROOT_BINDING_V2'
		|| !/^[A-Za-z0-9_-]{1,160}$/.test(value.operationId)
		|| [value.authorityOperationRoot, value.frostOperationRoot, value.outcomeStateHash,
			value.outcomeEvidenceDigest, value.templateDigest, value.cashuSigAllDigest, value.outputsDigest,
			value.proofPoolDigest, value.admissionReceiptDigest, value.publicKeyPackageSha256,
			value.signerRosterDigest, value.processRosterDigest, value.policyPackageDigest,
			value.bindingDigest].some((digest) => !HEX_32.test(digest))
		|| value.authorityOperationRoot !== value.templateDigest
		|| value.bindingDigest !== demoIntegratedExecutionRootBindingV2Digest(value)
		|| !Number.isSafeInteger(value.outcomeHeight) || value.outcomeHeight < 1
		|| !Number.isSafeInteger(value.poolAmount) || value.poolAmount < 1
		|| (value.cause === 'winner' ? value.role !== 'winner_settlement' : value.role !== 'refund')
		|| (value.cause === 'outbid' ? value.successorBidId.length === 0 : value.successorBidId !== '')
		|| !['outbid', 'winner', 'reserve_unmet', 'rejected'].includes(value.cause)
		|| [value.network, value.chainId, value.auctionId, value.bidId,
			value.committeeKeysetId, value.committeeKeysetVersion, value.dkgRunId]
			.some((text) => typeof text !== 'string' || text.length === 0 || text.trim() !== text)) {
		throw new Error('DEMO_AUTHORITY_SQLITE_TERMINAL_BINDING: terminal execution-root binding is malformed')
	}
	return structuredClone(value)
}

/**
 * One SQLite uniqueness domain for every demo auction and payment branch.
 * A proof-Y may belong to exactly one stable operation root globally.
 */
export class DemoIntegratedAuthoritySqliteStore implements DemoIntegratedTerminalAuthorityStore {
	readonly #database: Database
	readonly #claim: (claim: DemoIntegratedAuthorityClaim) => { claim: DemoIntegratedAuthorityClaim; created: boolean }
	readonly #transition: (operationId: string, expectedRevision: number, expectedStatus: DemoIntegratedLifecycleStatus,
		nextStatus: DemoIntegratedLifecycleStatus, evidenceDigest?: string) => DemoIntegratedLifecycleRecord
	readonly #bindExecution: (binding: DemoIntegratedExecutionRootBindingV1) => { binding: DemoIntegratedExecutionRootBindingV1; created: boolean }
	readonly #terminalClaim: (claim: DemoIntegratedTerminalAuthorityClaimV2) => { claim: DemoIntegratedTerminalAuthorityClaimV2; created: boolean }
	readonly #bindTerminalExecution: (binding: DemoIntegratedExecutionRootBindingV2) => { binding: DemoIntegratedExecutionRootBindingV2; created: boolean }

	constructor(database: Database) {
		this.#database = database
		this.#database.exec(`
			PRAGMA foreign_keys = ON;
			PRAGMA journal_mode = WAL;
			PRAGMA synchronous = FULL;
			CREATE TABLE IF NOT EXISTS demo_integrated_authority_claims (
				operation_id TEXT PRIMARY KEY NOT NULL,
				operation_root TEXT UNIQUE NOT NULL,
				claim_json TEXT NOT NULL,
				revision INTEGER NOT NULL DEFAULT 0,
				lifecycle_status TEXT NOT NULL DEFAULT 'outbid_return_pending',
				evidence_digest TEXT
			) STRICT;
			CREATE TABLE IF NOT EXISTS demo_integrated_authority_proofs (
				proof_state_ref TEXT PRIMARY KEY NOT NULL,
				operation_id TEXT NOT NULL REFERENCES demo_integrated_authority_claims(operation_id)
			) STRICT;
			CREATE TABLE IF NOT EXISTS demo_integrated_execution_roots (
				operation_id TEXT PRIMARY KEY NOT NULL REFERENCES demo_integrated_authority_claims(operation_id),
				authority_operation_root TEXT UNIQUE NOT NULL,
				frost_operation_root TEXT UNIQUE NOT NULL,
				binding_json TEXT NOT NULL
			) STRICT;
		`)
		const transaction = this.#database.transaction((candidate: DemoIntegratedAuthorityClaim) => {
			const input = validatedClaim(candidate)
			const prior = this.#database.query<{ claim_json: string }, [string]>(
				'SELECT claim_json FROM demo_integrated_authority_claims WHERE operation_id = ?',
			).get(input.operationId)
			if (prior !== null) {
				const claim = parsedClaim(prior.claim_json)
				if (canonicalClaim(claim) !== canonicalClaim(input)) {
					throw new Error('DEMO_AUTHORITY_SQLITE_OPERATION_CONFLICT: operation id already has different content')
				}
				return { claim, created: false }
			}
			for (const proofStateRef of input.proofStateRefs) {
				const proofUseKey = proofStateRef.slice(2)
				const owner = this.#database.query<{ operation_id: string }, [string]>(
					'SELECT operation_id FROM demo_integrated_authority_proofs WHERE proof_state_ref = ?',
				).get(proofUseKey)
				if (owner !== null && owner.operation_id !== input.operationId) {
					throw new Error('DEMO_AUTHORITY_SQLITE_PROOF_CONFLICT: proof pool is already claimed by another operation')
				}
			}
			this.#database.query(
				'INSERT INTO demo_integrated_authority_claims(operation_id, operation_root, claim_json) VALUES (?, ?, ?)',
			).run(input.operationId, input.operationRoot, canonicalClaim(input))
			for (const proofStateRef of input.proofStateRefs) {
				this.#database.query(
					'INSERT INTO demo_integrated_authority_proofs(proof_state_ref, operation_id) VALUES (?, ?)',
				).run(proofStateRef.slice(2), input.operationId)
			}
			return { claim: structuredClone(input), created: true }
		})
		this.#claim = transaction.immediate.bind(transaction)
		const terminalTransaction = this.#database.transaction((candidate: DemoIntegratedTerminalAuthorityClaimV2) => {
			const input = validatedTerminalClaim(candidate)
			const prior = this.#database.query<{ claim_json: string }, [string]>(
				'SELECT claim_json FROM demo_integrated_authority_claims WHERE operation_id = ?',
			).get(input.operationId)
			if (prior !== null) {
				const claim = parsedAnyClaim(prior.claim_json)
				if (claim.schema !== input.schema || JSON.stringify(claim) !== JSON.stringify(input)) {
					throw new Error('DEMO_AUTHORITY_SQLITE_TERMINAL_OPERATION_CONFLICT: operation already chose another terminal branch')
				}
				return { claim, created: false }
			}
			for (const proofStateRef of input.proofStateRefs) {
				const owner = this.#database.query<{ operation_id: string }, [string]>(
					'SELECT operation_id FROM demo_integrated_authority_proofs WHERE proof_state_ref = ?',
				).get(proofStateRef.slice(2))
				if (owner !== null && owner.operation_id !== input.operationId) {
					throw new Error('DEMO_AUTHORITY_SQLITE_PROOF_CONFLICT: proof pool is already claimed by another operation')
				}
			}
			this.#database.query(
				'INSERT INTO demo_integrated_authority_claims(operation_id, operation_root, claim_json, lifecycle_status) VALUES (?, ?, ?, ?)',
			).run(input.operationId, input.operationRoot, JSON.stringify(input), input.status)
			for (const proofStateRef of input.proofStateRefs) {
				this.#database.query(
					'INSERT INTO demo_integrated_authority_proofs(proof_state_ref, operation_id) VALUES (?, ?)',
				).run(proofStateRef.slice(2), input.operationId)
			}
			return { claim: structuredClone(input), created: true }
		})
		this.#terminalClaim = terminalTransaction.immediate.bind(terminalTransaction)
		const bindExecution = database.transaction((candidate: DemoIntegratedExecutionRootBindingV1) => {
			const input = validatedExecutionBinding(candidate)
			const claimRow = database.query<{ claim_json: string }, [string]>(
				'SELECT claim_json FROM demo_integrated_authority_claims WHERE operation_id = ?',
			).get(input.operationId)
			if (claimRow === null) throw new Error('DEMO_AUTHORITY_SQLITE_EXECUTION_BINDING: authority claim is absent')
			const claim = parsedClaim(claimRow.claim_json)
			if (claim.operationRoot !== input.authorityOperationRoot || claim.templateDigest !== input.templateDigest
				|| claim.cashuSigAllDigest !== input.cashuSigAllDigest
				|| claim.outputsDigest !== input.outputsDigest
				|| demoIntegratedProofPoolDigest(claim.proofStateRefs) !== input.proofPoolDigest
				|| claim.poolAmount !== input.poolAmount || claim.network !== input.network
				|| claim.chainId !== input.chainId || claim.auctionId !== input.auctionId
				|| claim.displacedBidId !== input.displacedBidId || claim.replacementBidId !== input.replacementBidId
				|| claim.displacementHeight !== input.displacementHeight
				|| claim.admissionReceiptDigest !== input.admissionReceiptDigest || claim.dkgRunId !== input.dkgRunId
				|| claim.committeeKeysetId !== input.committeeKeysetId
				|| claim.committeeKeysetVersion !== input.committeeKeysetVersion
				|| claim.publicKeyPackageSha256 !== input.publicKeyPackageSha256
				|| claim.signerRosterDigest !== input.signerRosterDigest) {
				throw new Error('DEMO_AUTHORITY_SQLITE_EXECUTION_BINDING: binding differs from durable authority claim')
			}
			const prior = database.query<{ binding_json: string }, [string]>(
				'SELECT binding_json FROM demo_integrated_execution_roots WHERE operation_id = ?',
			).get(input.operationId)
			if (prior !== null) {
				const binding = validatedExecutionBinding(JSON.parse(prior.binding_json) as DemoIntegratedExecutionRootBindingV1)
				if (JSON.stringify(binding) !== JSON.stringify(input)) {
					throw new Error('DEMO_AUTHORITY_SQLITE_EXECUTION_CONFLICT: operation already maps to another FROST root')
				}
				return { binding, created: false }
			}
			database.query(
				'INSERT INTO demo_integrated_execution_roots(operation_id, authority_operation_root, frost_operation_root, binding_json) VALUES (?, ?, ?, ?)',
			).run(input.operationId, input.authorityOperationRoot, input.frostOperationRoot, JSON.stringify(input))
			return { binding: structuredClone(input), created: true }
		})
		this.#bindExecution = bindExecution.immediate.bind(bindExecution)
		const bindTerminalExecution = database.transaction((candidate: DemoIntegratedExecutionRootBindingV2) => {
			const input = validatedTerminalExecutionBinding(candidate)
			const claimRow = database.query<{ claim_json: string }, [string]>(
				'SELECT claim_json FROM demo_integrated_authority_claims WHERE operation_id = ?',
			).get(input.operationId)
			if (claimRow === null) throw new Error('DEMO_AUTHORITY_SQLITE_TERMINAL_BINDING: authority claim is absent')
			const claim = parsedAnyClaim(claimRow.claim_json)
			if (claim.schema !== 'COCO_DEMO_INTEGRATED_TERMINAL_AUTHORITY_CLAIM_V2'
				|| claim.operationRoot !== input.authorityOperationRoot || claim.templateDigest !== input.templateDigest
				|| claim.cashuSigAllDigest !== input.cashuSigAllDigest || claim.outputsDigest !== input.outputsDigest
				|| demoIntegratedProofPoolDigest(claim.proofStateRefs) !== input.proofPoolDigest
				|| claim.poolAmount !== input.poolAmount || claim.network !== input.network || claim.chainId !== input.chainId
				|| claim.auctionId !== input.auctionId || claim.bidId !== input.bidId
				|| claim.successorBidId !== input.successorBidId || claim.cause !== input.cause || claim.role !== input.role
				|| claim.outcomeHeight !== input.outcomeHeight || claim.outcomeStateHash !== input.outcomeStateHash
				|| claim.outcomeEvidenceDigest !== input.outcomeEvidenceDigest
				|| claim.admissionReceiptDigest !== input.admissionReceiptDigest
				|| claim.committeeKeysetId !== input.committeeKeysetId
				|| claim.committeeKeysetVersion !== input.committeeKeysetVersion || claim.dkgRunId !== input.dkgRunId
				|| claim.publicKeyPackageSha256 !== input.publicKeyPackageSha256
				|| claim.signerRosterDigest !== input.signerRosterDigest) {
				throw new Error('DEMO_AUTHORITY_SQLITE_TERMINAL_BINDING: binding differs from terminal authority claim')
			}
			const prior = database.query<{ binding_json: string }, [string]>(
				'SELECT binding_json FROM demo_integrated_execution_roots WHERE operation_id = ?',
			).get(input.operationId)
			if (prior !== null) {
				const parsed = JSON.parse(prior.binding_json) as DemoIntegratedExecutionRootBindingV2
				const binding = validatedTerminalExecutionBinding(parsed)
				if (JSON.stringify(binding) !== JSON.stringify(input)) {
					throw new Error('DEMO_AUTHORITY_SQLITE_TERMINAL_EXECUTION_CONFLICT: operation already maps to another FROST root')
				}
				return { binding, created: false }
			}
			database.query(
				'INSERT INTO demo_integrated_execution_roots(operation_id, authority_operation_root, frost_operation_root, binding_json) VALUES (?, ?, ?, ?)',
			).run(input.operationId, input.authorityOperationRoot, input.frostOperationRoot, JSON.stringify(input))
			return { binding: structuredClone(input), created: true }
		})
		this.#bindTerminalExecution = bindTerminalExecution.immediate.bind(bindTerminalExecution)
		const transition = database.transaction((operationId: string, expectedRevision: number,
			expectedStatus: DemoIntegratedLifecycleStatus, nextStatus: DemoIntegratedLifecycleStatus, evidenceDigest?: string) => {
			const found = database.query<{
				claim_json: string; revision: number; lifecycle_status: DemoIntegratedLifecycleStatus; evidence_digest: string | null
			}, [string]>('SELECT claim_json, revision, lifecycle_status, evidence_digest FROM demo_integrated_authority_claims WHERE operation_id = ?')
				.get(operationId)
			if (found === null) throw new Error('DEMO_AUTHORITY_SQLITE_MISSING: lifecycle operation is absent')
			if (found.revision !== expectedRevision || found.lifecycle_status !== expectedStatus) {
				throw new Error('DEMO_AUTHORITY_SQLITE_CAS: lifecycle revision or status changed')
			}
			const allowed: Record<DemoIntegratedLifecycleStatus, DemoIntegratedLifecycleStatus[]> = {
				outbid_return_pending: ['execution_pending', 'quarantined'],
				terminal_pending: ['execution_pending', 'quarantined'],
				execution_pending: ['execution_unknown', 'mint_unknown', 'retry_ready', 'recipient_pending', 'recipient_imported', 'quarantined'],
				execution_unknown: ['mint_unknown', 'retry_ready', 'recipient_pending', 'recipient_imported', 'quarantined'],
				mint_unknown: ['retry_ready', 'recipient_pending', 'recipient_imported', 'quarantined'],
				retry_ready: ['execution_pending', 'mint_unknown', 'recipient_pending', 'recipient_imported', 'quarantined'],
				recipient_pending: ['recipient_imported', 'quarantined'],
				recipient_imported: [],
				quarantined: [],
			}
			if (!allowed[expectedStatus].includes(nextStatus)) throw new Error('DEMO_AUTHORITY_SQLITE_TRANSITION: lifecycle transition is not allowed')
			if (evidenceDigest !== undefined && !/^[0-9a-f]{64}$/.test(evidenceDigest)) {
				throw new Error('DEMO_AUTHORITY_SQLITE_EVIDENCE: evidence digest is malformed')
			}
			const result = database.query(
				'UPDATE demo_integrated_authority_claims SET revision = revision + 1, lifecycle_status = ?, evidence_digest = ? WHERE operation_id = ? AND revision = ? AND lifecycle_status = ?',
			).run(nextStatus, evidenceDigest ?? null, operationId, expectedRevision, expectedStatus)
			if (result.changes !== 1) throw new Error('DEMO_AUTHORITY_SQLITE_CAS: lifecycle changed during transition')
			return {
				schema: 'COCO_DEMO_INTEGRATED_LIFECYCLE_V1', revision: expectedRevision + 1,
				claim: parsedAnyClaim(found.claim_json), status: nextStatus, evidenceDigest,
			} satisfies DemoIntegratedLifecycleRecord
		})
		this.#transition = transition.immediate.bind(transition)
	}

	async claimOutbidReturn(claim: DemoIntegratedAuthorityClaim): Promise<{ claim: DemoIntegratedAuthorityClaim; created: boolean }> {
		return this.#claim(structuredClone(claim))
	}

	async claimTerminalDisposition(claim: DemoIntegratedTerminalAuthorityClaimV2): Promise<{ claim: DemoIntegratedTerminalAuthorityClaimV2; created: boolean }> {
		return this.#terminalClaim(structuredClone(claim))
	}

	async bindExecutionRoot(binding: DemoIntegratedExecutionRootBindingV1): Promise<{ binding: DemoIntegratedExecutionRootBindingV1; created: boolean }> {
		return this.#bindExecution(structuredClone(binding))
	}

	async bindTerminalExecutionRoot(binding: DemoIntegratedExecutionRootBindingV2): Promise<{ binding: DemoIntegratedExecutionRootBindingV2; created: boolean }> {
		return this.#bindTerminalExecution(structuredClone(binding))
	}

	async readTerminalExecutionRoot(operationId: string): Promise<DemoIntegratedExecutionRootBindingV2 | null> {
		const found = this.#database.query<{ binding_json: string }, [string]>(
			'SELECT binding_json FROM demo_integrated_execution_roots WHERE operation_id = ?',
		).get(operationId)
		return found === null ? null : validatedTerminalExecutionBinding(JSON.parse(found.binding_json) as DemoIntegratedExecutionRootBindingV2)
	}

	async readExecutionRoot(operationId: string): Promise<DemoIntegratedExecutionRootBindingV1 | null> {
		const found = this.#database.query<{ binding_json: string }, [string]>(
			'SELECT binding_json FROM demo_integrated_execution_roots WHERE operation_id = ?',
		).get(operationId)
		return found === null ? null : validatedExecutionBinding(JSON.parse(found.binding_json) as DemoIntegratedExecutionRootBindingV1)
	}

	async readLifecycle(operationId: string): Promise<DemoIntegratedLifecycleRecord | null> {
		const found = this.#database.query<{
			claim_json: string; revision: number; lifecycle_status: DemoIntegratedLifecycleStatus; evidence_digest: string | null
		}, [string]>('SELECT claim_json, revision, lifecycle_status, evidence_digest FROM demo_integrated_authority_claims WHERE operation_id = ?')
			.get(operationId)
		if (found === null) return null
		if (!LIFECYCLE_STATUSES.has(found.lifecycle_status) || !Number.isSafeInteger(found.revision) || found.revision < 0
			|| (found.evidence_digest !== null && !/^[0-9a-f]{64}$/.test(found.evidence_digest))) {
			throw new Error('DEMO_AUTHORITY_SQLITE_STATE: stored lifecycle is malformed')
		}
		return {
			schema: 'COCO_DEMO_INTEGRATED_LIFECYCLE_V1', revision: found.revision,
			claim: parsedAnyClaim(found.claim_json), status: found.lifecycle_status,
			evidenceDigest: found.evidence_digest ?? undefined,
		}
	}

	async transitionLifecycle(request: {
		operationId: string
		expectedRevision: number
		expectedStatus: DemoIntegratedLifecycleStatus
		nextStatus: DemoIntegratedLifecycleStatus
		evidenceDigest?: string
	}): Promise<DemoIntegratedLifecycleRecord> {
		return this.#transition(request.operationId, request.expectedRevision, request.expectedStatus, request.nextStatus, request.evidenceDigest)
	}
}
