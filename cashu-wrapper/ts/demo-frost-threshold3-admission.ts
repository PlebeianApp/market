/** Concrete task-local adapter for the admission-only Rust 3-of-4 domain. */
import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoAdmissionParticipantPorts,
	DemoIntegratedAdmissionThreshold3AuthorizationV1,
	DemoIntegratedAdmissionThreshold3Port,
} from './demo-integrated-admission-service'
import type { DemoIntegratedAdmissionPolicyEvidenceV1 } from './demo-integrated-admission-policy'
import {
	demoIntegratedFundingAnyAdmissionSignatureDigest,
	demoIntegratedFundingAnyCanonicalBytes,
	demoIntegratedFundingAnyReceiptDigest,
	type DemoIntegratedFundingReceiptAnyUnsigned,
} from './demo-integrated-admission-receipt-any'

export const DEMO_FROST_ADMISSION_VERSION = 'COCO_DEMO_FROST_ADMISSION_3OF4_V1' as const
const AUTH_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_ADMISSION_AUTH_V1')
const OPERATION_ROOT_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_ADMISSION_OPERATION_ROOT_V1')
const TRANSCRIPT_CONTEXT = utf8ToBytes('COCO_DEMO_FROST_ADMISSION_TRANSCRIPT_V1')
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const COMPRESSED_KEY = /^(?:02|03)[0-9a-f]{64}$/
const EVEN_KEY = /^02[0-9a-f]{64}$/
const IDS = [1, 2, 3, 4] as const
type ParticipantId = typeof IDS[number]
type Four<T> = [T, T, T, T]
type Three<T> = [T, T, T]

export interface DemoFrostAdmissionRustAuthorization {
	version: typeof DEMO_FROST_ADMISSION_VERSION
	dkg_run_id: string
	committee_keyset_id: string
	committee_keyset_version: string
	public_key_package_sha256: string
	signer_roster_digest: string
	committee_public_key: string
	operation_id: string
	operation_root: string
	session_id: string
	receipt_hex: string
	receipt_sha256: string
	receipt_digest: string
	participant_evidence_digest: string
	bid_intent_id: string
	auth_network_id: string
	chain_id: string
	auction_id: string
	bidder: string
	mint_url: string
	pool_amount: number
	proof_state_refs_digest: string
	active_keyset_id: string
	bundle_digest: string
	winner_package_digest: string
	return_package_digest: string
	return_cashu_sigall_digest: string
	valid_from: number
	valid_until: number
	roster: [1, 2, 3, 4]
	threshold: 3
}

export interface DemoFrostAdmissionRustCommitment {
	version: typeof DEMO_FROST_ADMISSION_VERSION
	operation_id: string
	session_id: string
	authorization_digest: string
	participant_id: ParticipantId
	durable_binding: DemoAdmissionSignerDurableBindingV1
	hiding_hex: string
	binding_hex: string
}

export interface DemoFrostAdmissionRustShare {
	version: typeof DEMO_FROST_ADMISSION_VERSION
	operation_id: string
	session_id: string
	authorization_digest: string
	commitments_digest: string
	participant_id: ParticipantId
	durable_binding: DemoAdmissionSignerDurableBindingV1
	share_hex: string
}

export interface DemoFrostAdmissionRustAggregate {
	version: typeof DEMO_FROST_ADMISSION_VERSION
	operation_id: string
	operation_root: string
	session_id: string
	authorization_digest: string
	commitments_digest: string
	receipt_digest: string
	admission_signature_digest: string
	bid_intent_id: string
	signer_roster_digest: string
	participant_ids: ParticipantId[]
	signature_hex: string
}

export interface DemoAdmissionRustParticipant {
	participantId: ParticipantId
	configPath: string
	stateDirectory: string
	verifyingShare: string
	/**
	 * Participant-local policy service. A four-host deployment must colocate
	 * this service with the matching signer key and authenticate its RPC; a
	 * coordinator-local adapter is test-only and must not be wired here.
	 */
	policyService: DemoAdmissionParticipantPorts
}

export interface DemoAdmissionSignerDurableBindingV1 {
	version: typeof DEMO_FROST_ADMISSION_VERSION
	participant_id: ParticipantId
	dkg_run_id: string
	public_key_package_sha256: string
	signer_roster_digest: string
	state_directory_identity: string
	journal_generation: string
	restart_epoch: number
}

export interface DemoAdmissionSigningSessionStore {
	claim(binding: {
		operationId: string
		operationRoot: string
		receiptDigest: string
		participantIds: [ParticipantId, ParticipantId, ParticipantId]
	}): Promise<{ sessionId: string; completed?: DemoIntegratedAdmissionThreshold3AuthorizationV1 }>
	complete(binding: {
		operationId: string
		operationRoot: string
		receiptDigest: string
		sessionId: string
		participantIds: [ParticipantId, ParticipantId, ParticipantId]
	}, value: DemoIntegratedAdmissionThreshold3AuthorizationV1): Promise<void>
	observeParticipant(binding: DemoAdmissionSignerDurableBindingV1): Promise<void>
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new Error('DEMO_FROST_ADMISSION_CANONICAL: non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	if (typeof value !== 'object') throw new Error('DEMO_FROST_ADMISSION_CANONICAL: unsupported value')
	const object = value as Record<string, unknown>
	return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

function hashJson(value: unknown): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))
}

function hashCanonical(value: unknown): string {
	return bytesToHex(sha256(utf8ToBytes(canonicalJson(value))))
}

function frame(value: Uint8Array): Uint8Array {
	const size = new Uint8Array(4)
	new DataView(size.buffer).setUint32(0, value.length, false)
	return concatBytes(size, value)
}

function u64(value: number): Uint8Array {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error('DEMO_FROST_ADMISSION_INTEGER: invalid unsigned integer')
	const bytes = new Uint8Array(8)
	new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false)
	return bytes
}

function u16(value: number): Uint8Array {
	const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, false); return bytes
}

function operationRoot(value: Omit<DemoFrostAdmissionRustAuthorization, 'operation_root' | 'session_id'>): string {
	const strings = [
		value.dkg_run_id, value.committee_keyset_id, value.committee_keyset_version,
		value.public_key_package_sha256, value.signer_roster_digest, value.committee_public_key,
		value.operation_id, value.receipt_sha256, value.receipt_digest, value.participant_evidence_digest,
		value.bid_intent_id, value.auth_network_id, value.chain_id, value.auction_id, value.bidder, value.mint_url,
		value.proof_state_refs_digest, value.active_keyset_id, value.bundle_digest,
		value.winner_package_digest, value.return_package_digest, value.return_cashu_sigall_digest,
	]
	return bytesToHex(sha256(concatBytes(
		OPERATION_ROOT_CONTEXT, ...strings.map((entry) => frame(utf8ToBytes(entry))),
		u64(value.pool_amount), u64(value.valid_from), u64(value.valid_until),
		...value.roster.map(u16), u16(value.threshold),
	)))
}

export function demoFrostAdmissionAuthorizationDigest(value: DemoFrostAdmissionRustAuthorization): string {
	const strings = [
		value.dkg_run_id, value.committee_keyset_id, value.committee_keyset_version,
		value.public_key_package_sha256, value.signer_roster_digest, value.committee_public_key,
		value.operation_id, value.operation_root, value.session_id, value.receipt_sha256,
		value.receipt_digest, value.participant_evidence_digest, value.bid_intent_id,
		value.auth_network_id, value.chain_id, value.auction_id, value.bidder, value.mint_url, value.proof_state_refs_digest,
		value.active_keyset_id, value.bundle_digest, value.winner_package_digest,
		value.return_package_digest, value.return_cashu_sigall_digest,
	]
	return bytesToHex(sha256(concatBytes(
		AUTH_CONTEXT, ...strings.map((entry) => frame(utf8ToBytes(entry))),
		u64(value.pool_amount), u64(value.valid_from), u64(value.valid_until),
		...value.roster.map(u16), u16(value.threshold),
	)))
}

export function demoFrostAdmissionTranscriptHash(authDigest: string, commitments: DemoFrostAdmissionRustCommitment[]): string {
	const transcriptEntries = commitments.map(({ durable_binding: _binding, ...entry }) => entry)
	return bytesToHex(sha256(concatBytes(
		TRANSCRIPT_CONTEXT, hexToBytes(authDigest), utf8ToBytes(canonicalJson(transcriptEntries)),
	)))
}

export function demoFrostAdmissionStateDirectoryIdentity(path: string): string {
	return bytesToHex(sha256(concatBytes(
		utf8ToBytes('COCO_DEMO_FROST_ADMISSION_STATE_DIRECTORY_V1'), utf8ToBytes(path),
	)))
}

export function exactDemoAdmissionDurableBinding(
	value: DemoAdmissionSignerDurableBindingV1,
	target: DemoAdmissionRustParticipant,
	receipt: DemoIntegratedFundingReceiptAnyUnsigned,
): DemoAdmissionSignerDurableBindingV1 {
	if (value.version !== DEMO_FROST_ADMISSION_VERSION || value.participant_id !== target.participantId
		|| value.dkg_run_id !== receipt.dkg_run_id
		|| value.public_key_package_sha256 !== receipt.public_key_package_sha256
		|| value.signer_roster_digest !== receipt.signer_roster_digest
		|| value.state_directory_identity !== demoFrostAdmissionStateDirectoryIdentity(target.stateDirectory)
		|| !HEX_32.test(value.journal_generation)
		|| !Number.isSafeInteger(value.restart_epoch) || value.restart_epoch < 1) {
		throw new Error('DEMO_FROST_ADMISSION_ANCHOR: signer durable binding differs from enrolled state')
	}
	return structuredClone(value)
}

function exactResult(value: DemoIntegratedAdmissionThreshold3AuthorizationV1): DemoIntegratedAdmissionThreshold3AuthorizationV1 {
	if (value.schema !== 'COCO_DEMO_INTEGRATED_ADMISSION_THRESHOLD3_AUTHORIZATION_V1'
		|| value.domain !== DEMO_FROST_ADMISSION_VERSION
		|| [value.receiptDigest, value.receiptBytesSha256, value.participantEvidenceDigest,
			value.signatureDigest, value.operationRoot, value.sessionId, value.bidIntentId, value.publicKeyPackageSha256,
			value.signerRosterDigest, value.transcriptHash].some((entry) => !HEX_32.test(entry))
		|| value.participantIds.length !== 3 || new Set(value.participantIds).size !== 3
		|| value.participantIds.some((id, index) => !IDS.includes(id as ParticipantId) || (index > 0 && value.participantIds[index - 1]! >= id))
		|| !Number.isSafeInteger(value.validFrom) || !Number.isSafeInteger(value.validUntil)
		|| value.validUntil < value.validFrom || !HEX_64.test(value.committeeSignature)) {
		throw new Error('DEMO_FROST_ADMISSION_RESULT: malformed authorization')
	}
	return structuredClone(value)
}

export class DemoAdmissionSqliteSessionStore implements DemoAdmissionSigningSessionStore {
	constructor(private readonly database: Database) {
		database.exec(`CREATE TABLE IF NOT EXISTS demo_admission_sessions (
			operation_id TEXT PRIMARY KEY, operation_root TEXT NOT NULL, receipt_digest TEXT NOT NULL,
			participant_ids TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE, completed_json TEXT
		) STRICT;
		CREATE TABLE IF NOT EXISTS demo_admission_signer_anchors (
			participant_id INTEGER PRIMARY KEY NOT NULL,
			stable_identity TEXT NOT NULL,
			maximum_restart_epoch INTEGER NOT NULL
		) STRICT`)
	}

	async claim(binding: {
		operationId: string; operationRoot: string; receiptDigest: string
		participantIds: [ParticipantId, ParticipantId, ParticipantId]
	}): Promise<{ sessionId: string; completed?: DemoIntegratedAdmissionThreshold3AuthorizationV1 }> {
		if (!HEX_32.test(binding.operationRoot) || !HEX_32.test(binding.receiptDigest)) throw new Error('DEMO_FROST_ADMISSION_SESSION: malformed binding')
		const ids = JSON.stringify(binding.participantIds)
		const transaction = this.database.transaction(() => {
			const row = this.database.query(`SELECT operation_root, receipt_digest, participant_ids, session_id, completed_json
				FROM demo_admission_sessions WHERE operation_id = ?`).get(binding.operationId) as Record<string, string | null> | null
			if (row !== null) {
				if (row.operation_root !== binding.operationRoot || row.receipt_digest !== binding.receiptDigest || row.participant_ids !== ids) {
					throw new Error('DEMO_FROST_ADMISSION_SESSION_CONFLICT: operation already owns another root, receipt, or signer subset')
				}
				return { sessionId: String(row.session_id), completed: row.completed_json === null ? undefined : exactResult(JSON.parse(row.completed_json) as DemoIntegratedAdmissionThreshold3AuthorizationV1) }
			}
			const sessionId = randomBytes(32).toString('hex')
			this.database.query(`INSERT INTO demo_admission_sessions
				(operation_id, operation_root, receipt_digest, participant_ids, session_id, completed_json)
				VALUES (?, ?, ?, ?, ?, NULL)`).run(binding.operationId, binding.operationRoot, binding.receiptDigest, ids, sessionId)
			return { sessionId }
		})
		return transaction.immediate()
	}

	async complete(binding: {
		operationId: string; operationRoot: string; receiptDigest: string; sessionId: string
		participantIds: [ParticipantId, ParticipantId, ParticipantId]
	}, value: DemoIntegratedAdmissionThreshold3AuthorizationV1): Promise<void> {
		const exact = exactResult(value)
		if (exact.operationRoot !== binding.operationRoot || exact.receiptDigest !== binding.receiptDigest
			|| exact.sessionId !== binding.sessionId || JSON.stringify(exact.participantIds) !== JSON.stringify(binding.participantIds)) {
			throw new Error('DEMO_FROST_ADMISSION_SESSION_RESULT: result differs from durable session')
		}
		const transaction = this.database.transaction(() => {
			const row = this.database.query(`SELECT operation_root, receipt_digest, participant_ids, session_id, completed_json
				FROM demo_admission_sessions WHERE operation_id = ?`).get(binding.operationId) as Record<string, string | null> | null
			if (row === null || row.operation_root !== binding.operationRoot || row.receipt_digest !== binding.receiptDigest
				|| row.participant_ids !== JSON.stringify(binding.participantIds) || row.session_id !== binding.sessionId) {
				throw new Error('DEMO_FROST_ADMISSION_SESSION_RESULT: durable session is absent or conflicting')
			}
			const serialized = canonicalJson(exact)
			if (row.completed_json !== null && canonicalJson(JSON.parse(row.completed_json)) !== serialized) {
				throw new Error('DEMO_FROST_ADMISSION_SESSION_RESULT: another result is already durable')
			}
			if (row.completed_json === null) this.database.query(`UPDATE demo_admission_sessions SET completed_json = ? WHERE operation_id = ?`).run(serialized, binding.operationId)
		})
		transaction.immediate()
	}

	async observeParticipant(binding: DemoAdmissionSignerDurableBindingV1): Promise<void> {
		if (binding.version !== DEMO_FROST_ADMISSION_VERSION || !IDS.includes(binding.participant_id)
			|| !HEX_32.test(binding.public_key_package_sha256) || !HEX_32.test(binding.signer_roster_digest)
			|| !HEX_32.test(binding.state_directory_identity) || !HEX_32.test(binding.journal_generation)
			|| !Number.isSafeInteger(binding.restart_epoch) || binding.restart_epoch < 1) {
			throw new Error('DEMO_FROST_ADMISSION_ANCHOR: signer durable binding is malformed')
		}
		const stable = canonicalJson({
			version: binding.version, participant_id: binding.participant_id, dkg_run_id: binding.dkg_run_id,
			public_key_package_sha256: binding.public_key_package_sha256,
			signer_roster_digest: binding.signer_roster_digest,
			state_directory_identity: binding.state_directory_identity,
			journal_generation: binding.journal_generation,
		})
		const transaction = this.database.transaction(() => {
			const found = this.database.query<{ stable_identity: string; maximum_restart_epoch: number }, [number]>(
				'SELECT stable_identity, maximum_restart_epoch FROM demo_admission_signer_anchors WHERE participant_id = ?',
			).get(binding.participant_id)
			if (found === null) {
				this.database.query('INSERT INTO demo_admission_signer_anchors(participant_id, stable_identity, maximum_restart_epoch) VALUES (?, ?, ?)')
					.run(binding.participant_id, stable, binding.restart_epoch)
				return
			}
			if (found.stable_identity !== stable) {
				throw new Error('DEMO_FROST_ADMISSION_ANCHOR_REPLACED: signer generation, state directory, DKG, or roster changed')
			}
			if (binding.restart_epoch <= found.maximum_restart_epoch) {
				throw new Error('DEMO_FROST_ADMISSION_ANCHOR_REGRESSED: signer restart epoch did not advance')
			}
			const updated = this.database.query('UPDATE demo_admission_signer_anchors SET maximum_restart_epoch = ? WHERE participant_id = ? AND maximum_restart_epoch = ?')
				.run(binding.restart_epoch, binding.participant_id, found.maximum_restart_epoch)
			if (updated.changes !== 1) throw new Error('DEMO_FROST_ADMISSION_ANCHOR_CAS: signer epoch changed concurrently')
		})
		transaction.immediate()
	}
}

type CommandRunner = (command: string[], signal?: AbortSignal) => Promise<void>

async function defaultRun(command: string[], signal?: AbortSignal): Promise<void> {
	const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
	const abort = () => child.kill()
	signal?.addEventListener('abort', abort, { once: true })
	try {
		const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
		if (exitCode !== 0) throw new Error(`DEMO_FROST_ADMISSION_COMMAND: exit ${exitCode}: ${stderr.trim() || 'no diagnostic'}`)
	} finally { signal?.removeEventListener('abort', abort) }
}

function absolute(path: string, field: string): void {
	if (!path.startsWith('/') || path === '/' || path.endsWith('/') || path.includes('//') || path.split('/').some((part) => part === '.' || part === '..')) {
		throw new Error(`DEMO_FROST_ADMISSION_PATH: ${field} must be a canonical absolute path`)
	}
}

async function scratch<T>(parent: string, run: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(parent, 'coco-frost-admission-'))
	await chmod(directory, 0o700)
	try { return await run(directory) }
	finally { await rm(directory, { recursive: true, force: true }) }
}

async function privateJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' }); await chmod(path, 0o600)
}

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }

export function demoFrostAdmissionAuthorization(
	receipt: DemoIntegratedFundingReceiptAnyUnsigned,
	participantEvidence: Three<DemoIntegratedAdmissionPolicyEvidenceV1>,
	sessionId: string,
): DemoFrostAdmissionRustAuthorization {
	const receiptDigest = demoIntegratedFundingAnyReceiptDigest(receipt)
	const receiptBytes = demoIntegratedFundingAnyCanonicalBytes(receipt)
	const evidenceDigest = hashCanonical(['COCO_DEMO_FROST_ADMISSION_PARTICIPANT_EVIDENCE_V1', participantEvidence])
	const stable: Omit<DemoFrostAdmissionRustAuthorization, 'operation_root' | 'session_id'> = {
		version: DEMO_FROST_ADMISSION_VERSION, dkg_run_id: receipt.dkg_run_id,
		committee_keyset_id: receipt.committee_keyset_id, committee_keyset_version: receipt.committee_keyset_version,
		public_key_package_sha256: receipt.public_key_package_sha256,
		signer_roster_digest: receipt.signer_roster_digest, committee_public_key: receipt.committee_public_key,
		operation_id: receipt.funding_operation_id, receipt_hex: bytesToHex(receiptBytes),
		receipt_sha256: bytesToHex(sha256(receiptBytes)), receipt_digest: receiptDigest,
		participant_evidence_digest: evidenceDigest,
		bid_intent_id: hashJson(['COCO_DEMO_FROST_ADMISSION_BID_INTENT_V1', receipt.auth_network_id, receipt.chain_id, receipt.auction_id, receipt.bidder, receipt.funding_operation_id, receiptDigest]),
		auth_network_id: receipt.auth_network_id, chain_id: receipt.chain_id,
		auction_id: receipt.auction_id, bidder: receipt.bidder, mint_url: receipt.mint_url,
		pool_amount: receipt.pool_amount,
		proof_state_refs_digest: hashJson(['COCO_DEMO_FROST_ADMISSION_PROOF_REFS_V1', receipt.proof_state_refs]),
		active_keyset_id: receipt.active_keyset_id, bundle_digest: receipt.bundle_digest,
		winner_package_digest: receipt.winner_package_digest, return_package_digest: receipt.return_package_digest,
		return_cashu_sigall_digest: receipt.return_cashu_sigall_digest,
		valid_from: receipt.attested_at, valid_until: receipt.expires_at, roster: [1, 2, 3, 4], threshold: 3,
	}
	return { ...stable, operation_root: operationRoot(stable), session_id: sessionId }
}

/**
 * A signer re-runs participant-local policy immediately before nonce use. The
 * live Comet observation digest is expected to advance as blocks commit; every
 * immutable funding, mint, proof-use, bundle, amount, and participant fact
 * must remain byte-identical. validateExact independently proves that its new
 * Comet observation still names the receipt's exact predecessor.
 */
export function sameDemoAdmissionPolicyAuthorizationFacts(
	supplied: DemoIntegratedAdmissionPolicyEvidenceV1,
	observed: DemoIntegratedAdmissionPolicyEvidenceV1,
): boolean {
	const { consensusEvidenceDigest: suppliedConsensus, ...suppliedStable } = supplied
	const { consensusEvidenceDigest: observedConsensus, ...observedStable } = observed
	return HEX_32.test(suppliedConsensus) && HEX_32.test(observedConsensus)
		&& canonicalJson(suppliedStable) === canonicalJson(observedStable)
}

/** Pure wire constructor used by the cross-language Rust-to-Go acceptance gate. */
export function demoFrostAdmissionAuthorizationForRequest(
	receipt: DemoIntegratedFundingReceiptAnyUnsigned,
	participantEvidence: Three<DemoIntegratedAdmissionPolicyEvidenceV1>,
	sessionId: string,
): DemoFrostAdmissionRustAuthorization {
	return demoFrostAdmissionAuthorization(structuredClone(receipt), structuredClone(participantEvidence), sessionId)
}

export function createDemoFrostThreshold3AdmissionPort(options: {
	binaryPath: string
	publicKeyPackagePath: string
	scratchParent: string
	participants: Four<DemoAdmissionRustParticipant>
	selectedParticipantIds?: [ParticipantId, ParticipantId, ParticipantId]
	sessions: DemoAdmissionSigningSessionStore
	runCommand?: CommandRunner
}): DemoIntegratedAdmissionThreshold3Port {
	for (const [field, path] of Object.entries({ binaryPath: options.binaryPath, publicKeyPackagePath: options.publicKeyPackagePath, scratchParent: options.scratchParent })) absolute(path, field)
	if (options.participants.some((participant, index) => participant.participantId !== IDS[index]
		|| !COMPRESSED_KEY.test(participant.verifyingShare))) throw new Error('DEMO_FROST_ADMISSION_ROSTER: four ordered participant identities are required')
	if (new Set(options.participants.map(({ verifyingShare }) => verifyingShare.slice(2))).size !== 4) throw new Error('DEMO_FROST_ADMISSION_ROSTER: verifying shares must be distinct')
	const configuredSelected = options.selectedParticipantIds === undefined ? undefined
		: [...options.selectedParticipantIds].sort((left, right) => left - right) as [ParticipantId, ParticipantId, ParticipantId]
	if (configuredSelected !== undefined && (new Set(configuredSelected).size !== 3 || configuredSelected.some((id) => !IDS.includes(id)))) {
		throw new Error('DEMO_FROST_ADMISSION_ROSTER: select exactly three enrolled participants')
	}
	const run = options.runCommand ?? defaultRun
	const participant = (id: ParticipantId) => options.participants[id - 1]!

	return Object.freeze({
		async signExact(request: Parameters<DemoIntegratedAdmissionThreshold3Port['signExact']>[0]) {
			const exactReceipt = structuredClone(request.receipt)
			const digest = demoIntegratedFundingAnyReceiptDigest(exactReceipt)
			const suppliedEvidence = structuredClone(request.participantEvidence)
			const selected = suppliedEvidence.map((entry) => entry.participantId)
				.sort((left, right) => left - right) as [ParticipantId, ParticipantId, ParticipantId]
			if (suppliedEvidence.length !== 3 || new Set(selected).size !== 3 || selected.some((id) => !IDS.includes(id))
				|| (configuredSelected !== undefined && JSON.stringify(selected) !== JSON.stringify(configuredSelected))) {
				throw new Error('DEMO_FROST_ADMISSION_REQUEST: policy quorum is not an exact enrolled three-member subset')
			}
			suppliedEvidence.sort((left, right) => left.participantId - right.participantId)
			const provisionalEvidenceDigest = hashCanonical(['COCO_DEMO_FROST_ADMISSION_PARTICIPANT_EVIDENCE_V1', suppliedEvidence])
			const signatureDigest = demoIntegratedFundingAnyAdmissionSignatureDigest(exactReceipt, provisionalEvidenceDigest)
			const now = Math.floor(Date.now() / 1000)
			if (digest !== request.receiptDigest || exactReceipt.dkg_run_id !== request.dkgBinding.dkgRunId
				|| exactReceipt.public_key_package_sha256 !== request.dkgBinding.publicKeyPackageSha256
				|| exactReceipt.signer_roster_digest !== request.dkgBinding.signerRosterDigest
				|| !EVEN_KEY.test(exactReceipt.committee_public_key)
				|| suppliedEvidence.some((value: DemoIntegratedAdmissionPolicyEvidenceV1) => value.receiptDigest !== digest)
				|| now < exactReceipt.attested_at || now > exactReceipt.expires_at) {
				throw new Error('DEMO_FROST_ADMISSION_REQUEST: receipt, DKG, or participant evidence differs')
			}
			const locallyDerived = await Promise.all(selected.map((id) => {
				const target = participant(id)
				if (target.policyService.participantId !== id) {
					throw new Error('DEMO_FROST_ADMISSION_POLICY_SERVICE: policy service is not colocated with its roster identity')
				}
				return target.policyService.validateExact({
					receipt: structuredClone(exactReceipt), bundle: structuredClone(request.bundle),
					nowSeconds: request.nowSeconds, dkgBinding: structuredClone(request.dkgBinding),
				})
			})) as Three<DemoIntegratedAdmissionPolicyEvidenceV1>
			locallyDerived.sort((left, right) => left.participantId - right.participantId)
			if (locallyDerived.some((entry, index) => !sameDemoAdmissionPolicyAuthorizationFacts(suppliedEvidence[index]!, entry))) {
				throw new Error('DEMO_FROST_ADMISSION_POLICY_SERVICE: signer-local policy evidence differs from coordinator transcript')
			}
			const provisional = demoFrostAdmissionAuthorization(exactReceipt, suppliedEvidence, '00'.repeat(32))
			const binding = { operationId: provisional.operation_id, operationRoot: provisional.operation_root, receiptDigest: digest, participantIds: selected }
			const claimed = await options.sessions.claim(binding)
			if (claimed.completed !== undefined) return exactResult(claimed.completed)
			if (!HEX_32.test(claimed.sessionId)) throw new Error('DEMO_FROST_ADMISSION_SESSION: store returned malformed session')
			const authorization = demoFrostAdmissionAuthorization(exactReceipt, suppliedEvidence, claimed.sessionId)
			if (authorization.operation_root !== binding.operationRoot) throw new Error('DEMO_FROST_ADMISSION_SESSION: session changed stable root')
			const authDigest = demoFrostAdmissionAuthorizationDigest(authorization)
			const commitments = await Promise.all(selected.map((id) => scratch(options.scratchParent, async (directory) => {
				const authPath = join(directory, 'authorization.json'); const outputPath = join(directory, 'commitment.json')
				await privateJson(authPath, authorization)
				const target = participant(id)
				await run([options.binaryPath, 'admission-commit', target.configPath, target.stateDirectory, authPath, outputPath])
				const value = await readJson<DemoFrostAdmissionRustCommitment>(outputPath)
				if (value.version !== DEMO_FROST_ADMISSION_VERSION || value.operation_id !== authorization.operation_id
					|| value.session_id !== authorization.session_id || value.authorization_digest !== authDigest
					|| value.participant_id !== id || !COMPRESSED_KEY.test(value.hiding_hex) || !COMPRESSED_KEY.test(value.binding_hex)) {
					throw new Error('DEMO_FROST_ADMISSION_COMMITMENT: participant returned mismatched commitment')
				}
				await options.sessions.observeParticipant(exactDemoAdmissionDurableBinding(value.durable_binding, target, exactReceipt))
				return value
			})))
			const transcript = demoFrostAdmissionTranscriptHash(authDigest, commitments)
			const shares = await Promise.all(selected.map((id) => scratch(options.scratchParent, async (directory) => {
				const authPath = join(directory, 'authorization.json'); const bundlePath = join(directory, 'commitments.json'); const outputPath = join(directory, 'share.json')
				await privateJson(authPath, authorization)
				await privateJson(bundlePath, { version: DEMO_FROST_ADMISSION_VERSION, entries: commitments })
				const target = participant(id)
				await run([options.binaryPath, 'admission-share', target.configPath, target.stateDirectory, authPath, bundlePath, outputPath])
				const value = await readJson<DemoFrostAdmissionRustShare>(outputPath)
				const mismatches = [
					[value.version !== DEMO_FROST_ADMISSION_VERSION, 'version'],
					[value.operation_id !== authorization.operation_id, 'operation_id'],
					[value.session_id !== authorization.session_id, 'session_id'],
					[value.authorization_digest !== authDigest, 'authorization_digest'],
					[value.commitments_digest !== transcript, 'commitments_digest'],
					[value.participant_id !== id, 'participant_id'],
					[!HEX_32.test(value.share_hex), 'share_hex'],
				].filter(([failed]) => failed).map(([, field]) => field)
				if (mismatches.length > 0) {
					throw new Error(`DEMO_FROST_ADMISSION_SHARE: participant returned mismatched ${mismatches.join(',')}`)
				}
				await options.sessions.observeParticipant(exactDemoAdmissionDurableBinding(value.durable_binding, target, exactReceipt))
				return value
			})))
			const aggregate = await scratch(options.scratchParent, async (directory) => {
				const authPath = join(directory, 'authorization.json'); const requestPath = join(directory, 'aggregate.json'); const outputPath = join(directory, 'signature.json')
				await privateJson(authPath, authorization)
				await privateJson(requestPath, {
					version: DEMO_FROST_ADMISSION_VERSION, operation_id: authorization.operation_id,
					session_id: authorization.session_id,
					commitments: commitments.map((value) => ({ participant_id: value.participant_id, hiding_hex: value.hiding_hex, binding_hex: value.binding_hex })),
					shares: shares.map((value) => ({ participant_id: value.participant_id, share_hex: value.share_hex })),
				})
				await run([options.binaryPath, 'admission-aggregate', authPath, options.publicKeyPackagePath, requestPath, outputPath])
				return readJson<DemoFrostAdmissionRustAggregate>(outputPath)
			})
			if (aggregate.version !== DEMO_FROST_ADMISSION_VERSION || aggregate.operation_id !== authorization.operation_id
				|| aggregate.operation_root !== authorization.operation_root || aggregate.session_id !== authorization.session_id
				|| aggregate.authorization_digest !== authDigest || aggregate.commitments_digest !== transcript
				|| aggregate.receipt_digest !== digest || aggregate.bid_intent_id !== authorization.bid_intent_id
				|| aggregate.admission_signature_digest !== signatureDigest
				|| aggregate.signer_roster_digest !== authorization.signer_roster_digest
				|| JSON.stringify(aggregate.participant_ids) !== JSON.stringify(selected)
				|| !HEX_64.test(aggregate.signature_hex)
				|| !schnorr.verify(hexToBytes(aggregate.signature_hex), hexToBytes(signatureDigest), hexToBytes(exactReceipt.committee_public_key.slice(2)))) {
				throw new Error('DEMO_FROST_ADMISSION_AGGREGATE: aggregate differs from exact admission')
			}
			const result: DemoIntegratedAdmissionThreshold3AuthorizationV1 = {
				schema: 'COCO_DEMO_INTEGRATED_ADMISSION_THRESHOLD3_AUTHORIZATION_V1', domain: DEMO_FROST_ADMISSION_VERSION,
				receiptDigest: digest, receiptBytesSha256: authorization.receipt_sha256,
				participantEvidenceDigest: authorization.participant_evidence_digest,
				signatureDigest,
				operationRoot: authorization.operation_root, sessionId: authorization.session_id,
				bidIntentId: authorization.bid_intent_id, dkgRunId: authorization.dkg_run_id,
				publicKeyPackageSha256: authorization.public_key_package_sha256,
				signerRosterDigest: authorization.signer_roster_digest, participantIds: selected,
				transcriptHash: transcript, validFrom: authorization.valid_from, validUntil: authorization.valid_until,
				committeeSignature: aggregate.signature_hex,
			}
			await options.sessions.complete({ ...binding, sessionId: authorization.session_id }, result)
			return exactResult(result)
		},
	})
}
