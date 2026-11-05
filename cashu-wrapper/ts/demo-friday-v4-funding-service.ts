/**
 * Persistent Friday V4 funding admission.
 *
 * Capabilities are fixed at construction: callers submit only one exact
 * browser-prepared envelope.  The service durably owns the encrypted package,
 * obtains an authenticated participant-policy quorum and real admission-domain
 * threshold signature, returns one deterministic Nostr challenge for the
 * browser's NIP-07 signer, and accepts it only after the pinned Comet
 * H/H+1/H+2 confirmer marks the exact signed transaction admitted.
 *
 * A lost broadcast response is deliberately outcome-unknown.  The journal
 * never broadcasts again blindly; an operator must add an authenticated tx
 * recovery path before that row can progress.
 */
import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import type {
	DemoAdmissionParticipantPorts,
	DemoIntegratedAdmissionThreshold3AuthorizationV1,
	DemoIntegratedAdmissionThreshold3Port,
} from './demo-integrated-admission-service'
import type {
	DemoIntegratedAdmissionDkgBindingV1,
	DemoIntegratedAdmissionPolicyEvidenceV1,
} from './demo-integrated-admission-policy'
import { demoIntegratedFundingAnyAdmissionSignatureDigest } from './demo-integrated-admission-receipt-any'
import type { DemoCometBidBroadcastPort, DemoCometTxRecoveryPort, DemoNostrBidEvent } from './demo-comet-bid-consensus'
import {
	demoIntegratedFundingV4ReceiptDigest,
	finalizeDemoIntegratedFundingReceiptV4,
	prepareDemoIntegratedFundingReceiptV4,
	verifyDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4,
} from './demo-integrated-funding-receipt-v4'
import type {
	DemoFridayFundingAdmissionCommitV1,
	DemoFridayFundingReplayRecordV1,
	DemoFridayPreparedFundingAdmission,
} from './demo-friday-prepared-funding'
import type {
	DemoFridayV4BroadcastIdentityV1,
	DemoFridayV4CometAdmissionPort,
} from './demo-friday-v4-comet-admission'
import { proofPoint } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const BID_KIND = 28_641 as const
type Four<T> = [T, T, T, T]
type Three<T> = [T, T, T]

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_V4_FUNDING: ${message}`) }
function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail('non-safe integer'); return JSON.stringify(value) }
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') fail('unsupported canonical value')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }

export interface DemoFridayV4FundingResultV1 {
	schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_RESULT_V1'
	status: 'admitted' | 'rejected_return'
	fundingAuthorizationEventId: string
	fundingOperationId: string
	bidEventId: string
	transactionHash: string
	committedHeight: number
	receiptDigest: string
	bidAmount: number
	reservedPoolAmount: number
	canonicalMintUrl: string
	rejectionReason?: DemoFridayFundingAdmissionCommitV1['rejectionReason']
}

export interface DemoFridayV4FundingChallengeV1 {
	schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_CHALLENGE_V1'
	status: 'signature_required'
	fundingAuthorizationEventId: string
	fundingOperationId: string
	receiptDigest: string
	unsignedEvent: Omit<DemoNostrBidEvent, 'id' | 'sig'>
	/** Exact browser-normalized identity; preparationId is stable across retries. */
	preparationId: string
	bidAmount: number
	reservedPoolAmount: number
	canonicalMintUrl: string
}

export interface DemoFridayV4FundingStatusV1 {
	schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_STATUS_V1'
	status: 'prepared' | 'admitted' | 'rejected_return' | 'unknown'
	preparationId: string
	fundingAuthorizationEventId: string
	fundingOperationId: string
	bidAmount: number
	reservedPoolAmount: number
	canonicalMintUrl: string
	signedBidEventId?: string
	receiptDigest?: string
	transactionHash?: string
	committedHeight?: number
	rejectionReason?: DemoFridayFundingAdmissionCommitV1['rejectionReason']
}

export interface DemoFridayV4FundingConfirmationV1 {
	schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_CONFIRMATION_V1'
	fundingAuthorizationEventId: string
	signedEvent: DemoNostrBidEvent
}

export interface DemoFridayV4FundingAdmissionPort {
	prepareExact(envelope: unknown): Promise<DemoFridayV4FundingChallengeV1>
	confirmExact(confirmation: unknown): Promise<DemoFridayV4FundingResultV1>
	/** Read-only recovery. It never creates or signs a new authorization. */
	readExact(request: {
		preparationId: string
		fundingOperationId: string
		fundingAuthorizationEventId: string
	}): Promise<DemoFridayV4FundingStatusV1>
}

export type DemoFridayV4ConfirmFailureStage =
	| 'initial_anchor'
	| 'confirmation_shape'
	| 'journal_read'
	| 'signed_event_validation'
	| 'journal_signed_transition'
	| 'signed_anchor'
	| 'broadcast_recovery'
	| 'broadcasting_transition'
	| 'broadcast_request'
	| 'broadcast_transition'
	| 'broadcast_anchor'
	| 'comet_admission'
	| 'admitted_transition'
	| 'admitted_anchor'

export interface DemoFridayV4ConfirmFailureDiagnosticV1 {
	schema: 'PLEBEIAN_FRIDAY_V4_CONFIRM_FAILURE_DIAGNOSTIC_V1'
	stage: DemoFridayV4ConfirmFailureStage
}

export interface DemoFridayV4CommittedLeaderPort {
	/** Authenticated fixed-chain read; never supplied by the browser request. */
	readExact(auctionId: string): Promise<{ bidId: string; bidder: string; bidAmount: number; height: number }>
}

export interface DemoFridayV4BroadcastAnchorSnapshotV1 {
	schema: 'PLEBEIAN_FRIDAY_V4_BROADCAST_ANCHOR_V1'
	deploymentId: string
	storeGeneration: string
	globalRevision: number
	stateDigest: string
}

export interface DemoFridayV4BroadcastAnchorPort {
	/** Must be outside the broadcast-journal backup boundary. */
	observeExact(snapshot: DemoFridayV4BroadcastAnchorSnapshotV1): void
}

/** Independent monotonic anchor; deploy outside the broadcast-journal backup boundary. */
export class DemoFridayV4BroadcastRollbackAnchorSqlite implements DemoFridayV4BroadcastAnchorPort {
	constructor(private readonly database: Database, private readonly allowFirstEnrollment = false) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_v4_broadcast_rollback_anchor (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, maximum_global_revision INTEGER NOT NULL,
				state_digest TEXT NOT NULL
			) STRICT`)
	}

	observeExact(snapshot: DemoFridayV4BroadcastAnchorSnapshotV1): void {
		if (snapshot.schema !== 'PLEBEIAN_FRIDAY_V4_BROADCAST_ANCHOR_V1'
			|| !/^[A-Za-z0-9_-]{1,160}$/.test(snapshot.deploymentId)
			|| !HEX_32.test(snapshot.storeGeneration) || !HEX_32.test(snapshot.stateDigest)
			|| !Number.isSafeInteger(snapshot.globalRevision) || snapshot.globalRevision < 0) {
			fail('broadcast rollback snapshot is malformed')
		}
		this.database.transaction(() => {
			const row = this.database.query<{
				deployment_id: string; store_generation: string; maximum_global_revision: number; state_digest: string
			}, []>(`SELECT deployment_id,store_generation,maximum_global_revision,state_digest
				FROM friday_v4_broadcast_rollback_anchor WHERE id=1`).get()
			if (row === null) {
				if (!this.allowFirstEnrollment || snapshot.globalRevision !== 0) fail('broadcast rollback anchor is missing after initialization')
				this.database.query(`INSERT INTO friday_v4_broadcast_rollback_anchor
					(id,deployment_id,store_generation,maximum_global_revision,state_digest) VALUES(1,?,?,?,?)`)
					.run(snapshot.deploymentId, snapshot.storeGeneration, snapshot.globalRevision, snapshot.stateDigest)
				return
			}
			if (row.deployment_id !== snapshot.deploymentId || row.store_generation !== snapshot.storeGeneration
				|| snapshot.globalRevision < row.maximum_global_revision
				|| (snapshot.globalRevision === row.maximum_global_revision && snapshot.stateDigest !== row.state_digest)) {
				fail('broadcast journal was replaced, restored, or changed at one revision')
			}
			if (snapshot.globalRevision > row.maximum_global_revision) {
				const changed = this.database.query(`UPDATE friday_v4_broadcast_rollback_anchor
					SET maximum_global_revision=?,state_digest=? WHERE id=1 AND maximum_global_revision=? AND state_digest=?`)
					.run(snapshot.globalRevision, snapshot.stateDigest, row.maximum_global_revision, row.state_digest)
				if (changed.changes !== 1) fail('broadcast rollback anchor changed concurrently')
			}
		}).immediate()
	}
}

interface SignedBid {
	event: DemoNostrBidEvent
	transactionHash: string
	/** Exact Comet bytes, retained so a restart never reserializes the signed event. */
	transactionHex: string
}

interface BroadcastRecord {
	authorizationEventId: string
	fundingOperationId: string
	phase: 'claimed' | 'prepared' | 'signed' | 'broadcasting' | 'broadcast' | 'admitted' | 'quarantined'
	revision: number
	receipt?: DemoIntegratedFundingReceiptV4
	signed?: SignedBid
	broadcast?: DemoFridayV4BroadcastIdentityV1
	disposition?: Pick<DemoFridayFundingAdmissionCommitV1, 'disposition' | 'rejectionReason'>
}

function exactRecord(value: unknown): BroadcastRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('broadcast journal record is malformed')
	const record = structuredClone(value) as BroadcastRecord
	if (!HEX_32.test(record.authorizationEventId) || typeof record.fundingOperationId !== 'string'
		|| record.fundingOperationId.length < 1 || record.fundingOperationId.length > 160
		|| !['claimed', 'prepared', 'signed', 'broadcasting', 'broadcast', 'admitted', 'quarantined'].includes(record.phase)
		|| !Number.isSafeInteger(record.revision) || record.revision < 0) fail('broadcast journal identity is malformed')
	if (record.phase !== 'claimed' && record.receipt === undefined) fail('prepared broadcast journal lacks receipt')
	if (['signed', 'broadcasting', 'broadcast', 'admitted'].includes(record.phase) && record.signed === undefined) fail('broadcast journal lacks signed event')
	if (['broadcast', 'admitted'].includes(record.phase) && record.broadcast === undefined) fail('broadcast journal lacks committed identity')
	if (record.phase === 'admitted') {
		if (record.disposition === undefined || !['active', 'rejected_return'].includes(record.disposition.disposition)
			|| (record.disposition.disposition === 'active' && record.disposition.rejectionReason !== undefined)
			|| (record.disposition.disposition === 'rejected_return' && ![
				'auction_not_open', 'seller_self_bid', 'late', 'below_minimum', 'stale_leader', 'funding_expired',
			].includes(record.disposition.rejectionReason ?? ''))) fail('admitted journal disposition is malformed')
	} else if (record.disposition !== undefined) fail('non-admitted journal contains a disposition')
	if (record.receipt !== undefined) record.receipt = verifyDemoIntegratedFundingReceiptV4(record.receipt)
	if (record.signed !== undefined) {
		if (record.receipt === undefined) fail('signed journal event lacks receipt')
		let bidContent: unknown
		try { bidContent = JSON.parse(record.signed.event.content) }
		catch { return fail('signed journal event content is not JSON') }
		if (bidContent === null || typeof bidContent !== 'object' || Array.isArray(bidContent)) {
			fail('signed journal event content is not an object')
		}
		const bid = bidContent as Record<string, unknown>
		if (JSON.stringify(Object.keys(bid).sort()) !== JSON.stringify(['amount', 'auction_id', 'integrated_funding', 'replaces_bid_id'])
			|| bid.auction_id !== record.receipt.auction_id || bid.amount !== record.receipt.bid_amount
			|| bid.replaces_bid_id !== record.receipt.replaces_bid_id) {
			fail('signed journal event content differs from the receipt')
		}
		let contentReceipt: DemoIntegratedFundingReceiptV4
		try { contentReceipt = verifyDemoIntegratedFundingReceiptV4(bid.integrated_funding as DemoIntegratedFundingReceiptV4) }
		catch { return fail('signed journal event contains an invalid receipt') }
		if (canonical(contentReceipt) !== canonical(record.receipt)) {
			fail('signed journal event contains another receipt')
		}
		const expected = {
			pubkey: record.receipt.bidder, created_at: record.receipt.attested_at, kind: BID_KIND, tags: [] as string[][],
			content: record.signed.event.content,
		} satisfies Omit<DemoNostrBidEvent, 'id' | 'sig'>
		record.signed.event = exactSignedBid(record.signed.event, expected)
		if (typeof record.signed.transactionHex !== 'string' || !/^[0-9a-f]+$/.test(record.signed.transactionHex)
			|| record.signed.transactionHex.length % 2 !== 0 || record.signed.transactionHex.length > 1_048_576) {
			fail('journal transaction bytes are malformed')
		}
		const tx = hexToBytes(record.signed.transactionHex)
		let decoded: unknown
		try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(tx)) }
		catch { return fail('journal transaction bytes are not exact UTF-8 JSON') }
		if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) fail('journal transaction is not an object')
		const envelope = decoded as Record<string, unknown>
		if (JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(['event', 'type', 'version'])
			|| envelope.version !== 1 || envelope.type !== 'event'
			|| canonical(envelope.event) !== canonical(record.signed.event)
			|| record.signed.transactionHash !== bytesToHex(sha256(tx))) {
			fail('journal transaction bytes differ from the signed event')
		}
	}
	if (record.broadcast !== undefined && (record.signed === undefined
		|| record.broadcast.schema !== 'PLEBEIAN_FRIDAY_V4_BROADCAST_IDENTITY_V1'
		|| record.broadcast.fundingAuthorizationEventId !== record.authorizationEventId
		|| record.broadcast.fundingOperationId !== record.fundingOperationId
		|| record.broadcast.bidEventId !== record.signed.event.id
		|| record.broadcast.transactionHash !== record.signed.transactionHash
		|| !Number.isSafeInteger(record.broadcast.committedHeight) || record.broadcast.committedHeight < 1)) {
		fail('journal broadcast identity differs from signed event')
	}
	return record
}

export class DemoFridayV4BroadcastJournalSqlite {
	readonly storeGeneration: string
	constructor(private readonly database: Database, readonly deploymentId: string) {
		if (!/^[A-Za-z0-9_-]{1,160}$/.test(deploymentId)) fail('broadcast deployment identity is invalid')
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_v4_broadcast_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), deployment_id TEXT NOT NULL,
				store_generation TEXT NOT NULL, global_revision INTEGER NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS friday_v4_broadcast_journal (
				authorization_event_id TEXT PRIMARY KEY NOT NULL,
				funding_operation_id TEXT UNIQUE NOT NULL, phase TEXT NOT NULL,
				revision INTEGER NOT NULL, record_json TEXT NOT NULL
			) STRICT`)
		database.transaction(() => {
			const row = database.query<{ deployment_id: string; store_generation: string }, []>(
				'SELECT deployment_id, store_generation FROM friday_v4_broadcast_metadata WHERE id = 1',
			).get()
			if (row === null) database.query(`INSERT INTO friday_v4_broadcast_metadata
				(id, deployment_id, store_generation, global_revision) VALUES (1, ?, ?, 0)`)
				.run(deploymentId, randomBytes(32).toString('hex'))
			else if (row.deployment_id !== deploymentId || !HEX_32.test(row.store_generation)) fail('broadcast database belongs to another deployment')
		}).immediate()
		this.storeGeneration = database.query<{ store_generation: string }, []>(
			'SELECT store_generation FROM friday_v4_broadcast_metadata WHERE id = 1',
		).get()!.store_generation
	}

	#advance(): void {
		if (this.database.query('UPDATE friday_v4_broadcast_metadata SET global_revision = global_revision + 1 WHERE id = 1').run().changes !== 1) fail('broadcast metadata did not advance')
	}

	anchorSnapshot(): DemoFridayV4BroadcastAnchorSnapshotV1 {
		const meta = this.database.query<{ store_generation: string; global_revision: number }, []>(
			'SELECT store_generation, global_revision FROM friday_v4_broadcast_metadata WHERE id = 1',
		).get()!
		const records = this.database.query<{ record_json: string }, []>(
			'SELECT record_json FROM friday_v4_broadcast_journal ORDER BY authorization_event_id',
		).all().map(({ record_json }) => exactRecord(JSON.parse(record_json) as unknown))
		return {
			schema: 'PLEBEIAN_FRIDAY_V4_BROADCAST_ANCHOR_V1', deploymentId: this.deploymentId,
			storeGeneration: meta.store_generation, globalRevision: meta.global_revision,
			stateDigest: digest(['PLEBEIAN_FRIDAY_V4_BROADCAST_STATE_V1', this.deploymentId, meta.store_generation, meta.global_revision, records]),
		}
	}

	claimExact(authorizationEventId: string, fundingOperationId: string): BroadcastRecord {
		if (!HEX_32.test(authorizationEventId) || !/^[A-Za-z0-9_-]{1,160}$/.test(fundingOperationId)) fail('broadcast claim identity is malformed')
		return this.database.transaction(() => {
			const rows = this.database.query<{ record_json: string }, [string, string]>(
				'SELECT record_json FROM friday_v4_broadcast_journal WHERE authorization_event_id = ? OR funding_operation_id = ?',
			).all(authorizationEventId, fundingOperationId)
			if (rows.length !== 0) {
				if (rows.length !== 1) fail('broadcast journal indexes disagree')
				const prior = exactRecord(JSON.parse(rows[0]!.record_json) as unknown)
				if (prior.authorizationEventId !== authorizationEventId || prior.fundingOperationId !== fundingOperationId) fail('broadcast identity is already owned')
				return prior
			}
			const record: BroadcastRecord = { authorizationEventId, fundingOperationId, phase: 'claimed', revision: 0 }
			this.database.query(`INSERT INTO friday_v4_broadcast_journal
				(authorization_event_id, funding_operation_id, phase, revision, record_json) VALUES (?, ?, ?, 0, ?)`)
				.run(authorizationEventId, fundingOperationId, record.phase, canonical(record))
			this.#advance(); return structuredClone(record)
		}).immediate()
	}

	readExact(authorizationEventId: string): BroadcastRecord | null {
		if (!HEX_32.test(authorizationEventId)) fail('broadcast read identity is malformed')
		const row = this.database.query<{ record_json: string }, [string]>(
			'SELECT record_json FROM friday_v4_broadcast_journal WHERE authorization_event_id = ?',
		).get(authorizationEventId)
		return row === null ? null : exactRecord(JSON.parse(row.record_json) as unknown)
	}

	transitionExact(prior: BroadcastRecord, phase: BroadcastRecord['phase'], patch: Partial<BroadcastRecord> = {}): BroadcastRecord {
		return this.database.transaction(() => {
			const row = this.database.query<{ record_json: string }, [string]>(
				'SELECT record_json FROM friday_v4_broadcast_journal WHERE authorization_event_id = ?',
			).get(prior.authorizationEventId)
			if (row === null) fail('broadcast journal record disappeared')
			const current = exactRecord(JSON.parse(row.record_json) as unknown)
			if (canonical(current) !== canonical(prior)) fail('broadcast journal changed concurrently')
			const updated = exactRecord({ ...current, ...structuredClone(patch), phase, revision: current.revision + 1 })
			const changed = this.database.query(`UPDATE friday_v4_broadcast_journal
				SET phase = ?, revision = ?, record_json = ?
				WHERE authorization_event_id = ? AND phase = ? AND revision = ?`).run(
				updated.phase, updated.revision, canonical(updated), current.authorizationEventId, current.phase, current.revision,
			)
			if (changed.changes !== 1) fail('broadcast journal CAS failed')
			this.#advance(); return structuredClone(updated)
		}).immediate()
	}
}

function eventId(unsigned: Omit<DemoNostrBidEvent, 'id' | 'sig'>): string {
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
}

function exactSignedBid(value: DemoNostrBidEvent, expected: Omit<DemoNostrBidEvent, 'id' | 'sig'>): DemoNostrBidEvent {
	if (value.id !== eventId(expected) || value.pubkey !== expected.pubkey || value.created_at !== expected.created_at
		|| value.kind !== expected.kind || canonical(value.tags) !== canonical(expected.tags) || value.content !== expected.content
		|| !HEX_64.test(value.sig) || !schnorr.verify(hexToBytes(value.sig), hexToBytes(value.id), hexToBytes(value.pubkey))) {
		fail('browser returned a mutated or invalid Nostr bid')
	}
	return structuredClone(value)
}

function exactAuthorization(value: DemoIntegratedAdmissionThreshold3AuthorizationV1, receipt: ReturnType<typeof prepareDemoIntegratedFundingReceiptV4>): void {
	const expectedSignature = demoIntegratedFundingAnyAdmissionSignatureDigest(receipt, value.participantEvidenceDigest)
	if (value.schema !== 'COCO_DEMO_INTEGRATED_ADMISSION_THRESHOLD3_AUTHORIZATION_V1'
		|| value.domain !== 'COCO_DEMO_FROST_ADMISSION_3OF4_V1'
		|| value.receiptDigest !== demoIntegratedFundingV4ReceiptDigest(receipt)
		|| value.signatureDigest !== expectedSignature || value.dkgRunId !== receipt.dkg_run_id
		|| value.publicKeyPackageSha256 !== receipt.public_key_package_sha256
		|| value.signerRosterDigest !== receipt.signer_roster_digest
		|| value.participantIds.length !== 3 || new Set(value.participantIds).size !== 3
		|| value.validFrom !== receipt.attested_at || value.validUntil !== receipt.expires_at
		|| !HEX_64.test(value.committeeSignature)) fail('threshold authorization differs from exact V4 admission')
}

function signedReceiptDigest(value: DemoIntegratedFundingReceiptV4): string {
	const { participant_policy_digest: _policy, committee_signature: _signature, ...unsigned } = value
	return demoIntegratedFundingV4ReceiptDigest(unsigned)
}

function unsignedBidFor(receipt: DemoIntegratedFundingReceiptV4): Omit<DemoNostrBidEvent, 'id' | 'sig'> {
	return {
		pubkey: receipt.bidder, created_at: receipt.attested_at, kind: BID_KIND, tags: [],
		content: JSON.stringify({
			auction_id: receipt.auction_id, amount: receipt.bid_amount,
			replaces_bid_id: receipt.replaces_bid_id, integrated_funding: receipt,
		}),
	}
}

function challengeFrom(row: BroadcastRecord): DemoFridayV4FundingChallengeV1 {
	if (row.receipt === undefined) fail('prepared challenge lacks a receipt')
	return {
		schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_CHALLENGE_V1', status: 'signature_required',
		fundingAuthorizationEventId: row.authorizationEventId,
		fundingOperationId: row.fundingOperationId,
		receiptDigest: signedReceiptDigest(row.receipt),
		unsignedEvent: unsignedBidFor(row.receipt),
		preparationId: row.authorizationEventId,
		bidAmount: row.receipt.bid_amount,
		reservedPoolAmount: row.receipt.pool_amount,
		canonicalMintUrl: row.receipt.mint_url,
	}
}

function statusFrom(row: BroadcastRecord): DemoFridayV4FundingStatusV1 {
	if (row.receipt === undefined) fail('funding status lacks a prepared receipt')
	const base = {
		schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_STATUS_V1' as const,
		preparationId: row.authorizationEventId,
		fundingAuthorizationEventId: row.authorizationEventId,
		fundingOperationId: row.fundingOperationId,
		bidAmount: row.receipt.bid_amount,
		reservedPoolAmount: row.receipt.pool_amount,
		canonicalMintUrl: row.receipt.mint_url,
	}
	if (row.phase === 'admitted') {
		const result = resultFrom(row)
		return { ...base, status: result.status, signedBidEventId: result.bidEventId,
			receiptDigest: result.receiptDigest, transactionHash: result.transactionHash,
			committedHeight: result.committedHeight,
			...(result.rejectionReason === undefined ? {} : { rejectionReason: result.rejectionReason }) }
	}
	if (row.phase === 'broadcasting') return { ...base, status: 'unknown' }
	if (['prepared', 'signed', 'broadcast'].includes(row.phase)) return { ...base, status: 'prepared' }
	fail('funding status is not yet browser-readable')
}

function exactConfirmation(value: unknown): DemoFridayV4FundingConfirmationV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('funding confirmation is malformed')
	const record = value as Record<string, unknown>
	if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([
		'fundingAuthorizationEventId', 'schema', 'signedEvent',
	]) || record.schema !== 'PLEBEIAN_FRIDAY_V4_FUNDING_CONFIRMATION_V1'
		|| typeof record.fundingAuthorizationEventId !== 'string' || !HEX_32.test(record.fundingAuthorizationEventId)) {
		fail('funding confirmation identity is malformed')
	}
	return structuredClone(value) as DemoFridayV4FundingConfirmationV1
}

export function createDemoFridayV4FundingAdmission(options: {
	prepared: DemoFridayPreparedFundingAdmission
	journal: DemoFridayV4BroadcastJournalSqlite
	journalAnchor: DemoFridayV4BroadcastAnchorPort
	leader: DemoFridayV4CommittedLeaderPort
	dkgBinding: DemoIntegratedAdmissionDkgBindingV1
	participants: Four<DemoAdmissionParticipantPorts>
	committee: DemoIntegratedAdmissionThreshold3Port
	broadcaster: DemoCometBidBroadcastPort
	broadcastRecovery: DemoCometTxRecoveryPort
	cometAdmission: DemoFridayV4CometAdmissionPort
	nowSeconds(): number
	policyTimeoutMs?: number
	/** Payload-free diagnostic sink; it must never affect protocol behavior. */
	onConfirmFailure?: (diagnostic: DemoFridayV4ConfirmFailureDiagnosticV1) => void
}): DemoFridayV4FundingAdmissionPort {
	const anchor = (): void => options.journalAnchor.observeExact(options.journal.anchorSnapshot())
	return Object.freeze({
		async prepareExact(envelope: unknown): Promise<DemoFridayV4FundingChallengeV1> {
			anchor()
			const held = await options.prepared.prepareExact(envelope)
			const authorization = held.verified.authorization
			let row = options.journal.claimExact(authorization.event.id, authorization.content.fundingOperationId)
			anchor()
			if (row.phase === 'quarantined') fail('broadcast identity is quarantined')
			if (row.phase === 'broadcasting') fail('broadcast outcome is unknown; authenticated transaction recovery is required')

			if (row.phase === 'claimed') {
				const winner = held.verified.bundle.winner
				const refund = held.verified.bundle.refund
				const current = await options.leader.readExact(winner.auctionId)
				if (!Number.isSafeInteger(current.height) || current.height < 1
					|| (current.bidId !== '' && (!HEX_32.test(current.bidId) || !HEX_32.test(current.bidder)
						|| !Number.isSafeInteger(current.bidAmount) || current.bidAmount < 1))
					|| (current.bidId === '' && (current.bidder !== '' || current.bidAmount !== 0))) fail('trusted leader read is malformed')
				// Friday's approved own-raise rule reserves only the positive delta.
				// The V4 receipt/package currently carries one full-pool amount, so an
				// own raise must fail closed until the separately versioned delta
				// package and terminal aggregation are composed end to end.
				if (current.bidder === authorization.event.pubkey) {
					fail('own raise delta package is not composed; no value was reserved')
				}
				const proofRefs = winner.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
				const unsigned = prepareDemoIntegratedFundingReceiptV4({
					schema: 'PlebeianAuctionsPOCIntegratedFundingV4', auth_network_id: winner.network,
					chain_id: winner.chainId, mint_url: winner.mintUrl, auction_id: winner.auctionId,
					bidder: authorization.event.pubkey, bid_amount: winner.amount, pool_amount: winner.amount,
					replaces_bid_id: current.bidId, funding_operation_id: winner.operationId,
					attested_at: authorization.event.created_at, expires_at: authorization.content.expiresAt,
					proof_state_refs: proofRefs, active_keyset_id: winner.mintSeal.activeSatKeysetId,
					input_fee_ppk: 0, locktime: winner.locktime, bidder_public_key: winner.bidderPublicKey,
					refund_public_key: winner.refundPublicKey, committee_public_key: winner.committeePublicKey,
					committee_keyset_id: winner.committeeKeysetId, committee_keyset_version: winner.committeeKeysetVersion,
					dkg_run_id: options.dkgBinding.dkgRunId,
					public_key_package_sha256: options.dkgBinding.publicKeyPackageSha256,
					signer_roster_digest: options.dkgBinding.signerRosterDigest,
					winner_package_digest: winner.templateDigest, return_package_digest: refund.templateDigest,
					return_cashu_sigall_digest: refund.cashuSigAllDigest,
					bidder_return_signature: refund.bidderMainSignature,
					prepared_bundle_digest: held.verified.bundle.bundleDigest,
					actor_funding_authorization: authorization.event,
				})
				if (options.participants.some((participant, index) => participant.participantId !== index + 1)) fail('four ordered participant services are required')
				const policyRequest = { receipt: structuredClone(unsigned), bundle: structuredClone(held.verified.bundle), nowSeconds: options.nowSeconds(), dkgBinding: structuredClone(options.dkgBinding) }
				const timeoutMs = options.policyTimeoutMs ?? 5_000
				if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail('participant policy timeout is invalid')
				const attempts = await Promise.allSettled(options.participants.map(async (participant) => {
					let timer: ReturnType<typeof setTimeout> | undefined
					try { return await Promise.race([
						participant.validateExact(structuredClone(policyRequest)),
						new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('participant policy timeout')), timeoutMs) }),
					]) } finally { if (timer !== undefined) clearTimeout(timer) }
				}))
				const successful = attempts.flatMap((attempt, index) => attempt.status === 'fulfilled'
					? [{ id: options.participants[index]!.participantId, evidence: attempt.value }] : [])
					.sort((left, right) => left.id - right.id)
				if (successful.length < 3) fail('fewer than three participant policy services approved')
				const evidence = successful.slice(0, 3).map(({ id, evidence }) => {
					if (evidence.participantId !== id || evidence.receiptDigest !== demoIntegratedFundingV4ReceiptDigest(unsigned)
						|| evidence.bundleDigest !== held.verified.bundle.bundleDigest) fail('participant policy evidence differs')
					return structuredClone(evidence)
				}) as Three<DemoIntegratedAdmissionPolicyEvidenceV1>
				const threshold = await options.committee.signExact({
					receipt: structuredClone(unsigned), bundle: structuredClone(held.verified.bundle),
					nowSeconds: policyRequest.nowSeconds, receiptDigest: demoIntegratedFundingV4ReceiptDigest(unsigned),
					dkgBinding: structuredClone(options.dkgBinding), participantEvidence: structuredClone(evidence),
				})
				exactAuthorization(threshold, unsigned)
				const receipt = finalizeDemoIntegratedFundingReceiptV4(unsigned, threshold.participantEvidenceDigest, threshold.committeeSignature)
				row = options.journal.transitionExact(row, 'prepared', { receipt })
				anchor()
			}
			return challengeFrom(row)
		},

		async confirmExact(value: unknown): Promise<DemoFridayV4FundingResultV1> {
			let stage: DemoFridayV4ConfirmFailureStage = 'initial_anchor'
			try {
				anchor()
				stage = 'confirmation_shape'
				const confirmation = exactConfirmation(value)
				stage = 'journal_read'
				let row = options.journal.readExact(confirmation.fundingAuthorizationEventId)
				if (row === null) fail('funding confirmation has no prepared package')
				if (row.phase === 'claimed') fail('funding confirmation arrived before threshold preparation')
				if (row.phase === 'quarantined') fail('broadcast identity is quarantined')
				if (row.receipt === undefined) fail('funding confirmation lacks a prepared receipt')
				stage = 'signed_event_validation'
				const event = exactSignedBid(confirmation.signedEvent, unsignedBidFor(row.receipt))
				if (row.signed !== undefined && canonical(event) !== canonical(row.signed.event)) {
					fail('funding confirmation differs from the persisted signed transaction')
				}
				if (row.phase === 'admitted') return resultFrom(row)
				if (row.phase === 'broadcasting') {
					stage = 'broadcast_recovery'
					const recovered = await options.broadcastRecovery.recoverExact(row.signed!.transactionHash)
					if (recovered === null) fail('broadcast outcome remains unknown; no authenticated transaction was found')
					if (recovered.txHash !== row.signed!.transactionHash || !Number.isSafeInteger(recovered.height) || recovered.height < 1) {
						fail('recovered broadcast identity differs from the persisted transaction')
					}
					const identity: DemoFridayV4BroadcastIdentityV1 = {
						schema: 'PLEBEIAN_FRIDAY_V4_BROADCAST_IDENTITY_V1',
						fundingAuthorizationEventId: row.authorizationEventId, bidEventId: row.signed!.event.id,
						fundingOperationId: row.fundingOperationId, committedHeight: recovered.height,
						transactionHash: recovered.txHash,
					}
					stage = 'broadcast_transition'
					row = options.journal.transitionExact(row, 'broadcast', { broadcast: identity })
					stage = 'broadcast_anchor'; anchor()
				}

				if (row.phase === 'prepared') {
					const tx = new TextEncoder().encode(JSON.stringify({ version: 1, type: 'event', event }))
					stage = 'journal_signed_transition'
					row = options.journal.transitionExact(row, 'signed', {
						signed: { event, transactionHash: bytesToHex(sha256(tx)), transactionHex: bytesToHex(tx) },
					})
					stage = 'signed_anchor'; anchor()
				}

				if (row.phase === 'signed') {
					stage = 'broadcasting_transition'
					row = options.journal.transitionExact(row, 'broadcasting'); anchor()
					stage = 'broadcast_request'
					const tx = hexToBytes(row.signed!.transactionHex)
					const broadcast = await options.broadcaster.broadcastAndWait(tx)
					if (broadcast.txHash !== row.signed!.transactionHash || !Number.isSafeInteger(broadcast.height) || broadcast.height < 1) fail('broadcast response differs from exact signed transaction')
					const identity: DemoFridayV4BroadcastIdentityV1 = {
						schema: 'PLEBEIAN_FRIDAY_V4_BROADCAST_IDENTITY_V1',
						fundingAuthorizationEventId: row.authorizationEventId, bidEventId: row.signed!.event.id,
						fundingOperationId: row.fundingOperationId, committedHeight: broadcast.height,
						transactionHash: broadcast.txHash,
					}
					stage = 'broadcast_transition'
					row = options.journal.transitionExact(row, 'broadcast', { broadcast: identity })
					stage = 'broadcast_anchor'; anchor()
				}
				if (row.phase !== 'broadcast') fail('broadcast journal did not reach confirmable state')
				stage = 'comet_admission'
				const admitted: DemoFridayFundingReplayRecordV1 = await options.cometAdmission.confirmAndAdmitExact(row.broadcast!)
				if (admitted.phase !== 'admitted' || admitted.admission?.transactionHash !== row.broadcast!.transactionHash
					|| admitted.admission.committedHeight !== row.broadcast!.committedHeight) fail('Comet admission returned another durable identity')
				stage = 'admitted_transition'
				row = options.journal.transitionExact(row, 'admitted', { disposition: {
					disposition: admitted.admission.disposition,
					...(admitted.admission.rejectionReason === undefined ? {} : { rejectionReason: admitted.admission.rejectionReason }),
				} })
				stage = 'admitted_anchor'; anchor()
				return resultFrom(row)
			} catch (error) {
				try { options.onConfirmFailure?.({ schema: 'PLEBEIAN_FRIDAY_V4_CONFIRM_FAILURE_DIAGNOSTIC_V1', stage }) }
				catch { /* diagnostics cannot alter the protocol result */ }
				throw error
			}
		},

		async readExact(request: {
			preparationId: string
			fundingOperationId: string
			fundingAuthorizationEventId: string
		}): Promise<DemoFridayV4FundingStatusV1> {
			anchor()
			if (request === null || typeof request !== 'object'
				|| request.preparationId !== request.fundingAuthorizationEventId
				|| !HEX_32.test(request.fundingAuthorizationEventId)
				|| typeof request.fundingOperationId !== 'string' || request.fundingOperationId.length < 1
				|| request.fundingOperationId.length > 160) fail('funding status identity is malformed')
			const row = options.journal.readExact(request.fundingAuthorizationEventId)
			if (row === null || row.authorizationEventId !== request.preparationId
				|| row.fundingOperationId !== request.fundingOperationId) fail('funding status identity is absent or changed')
			return statusFrom(row)
		},
	})
}

function resultFrom(row: BroadcastRecord): DemoFridayV4FundingResultV1 {
	if (row.phase !== 'admitted' || row.receipt === undefined || row.signed === undefined || row.broadcast === undefined) fail('admitted journal result is incomplete')
	return {
		schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_RESULT_V1',
		status: row.disposition?.disposition === 'active' ? 'admitted' : 'rejected_return',
		fundingAuthorizationEventId: row.authorizationEventId, fundingOperationId: row.fundingOperationId,
		bidEventId: row.signed.event.id, transactionHash: row.broadcast.transactionHash,
		committedHeight: row.broadcast.committedHeight, receiptDigest: signedReceiptDigest(row.receipt),
		bidAmount: row.receipt.bid_amount, reservedPoolAmount: row.receipt.pool_amount,
		canonicalMintUrl: row.receipt.mint_url,
		...(row.disposition?.rejectionReason === undefined ? {} : { rejectionReason: row.disposition.rejectionReason }),
	}
}
