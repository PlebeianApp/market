/** Fixed, descriptor-driven terminal resolver for the disabled Friday service. */
import { createHash, randomBytes } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { bytesToHex } from '@noble/hashes/utils.js'

import { createDemoCometCloseVerifier } from './demo-comet-close-verifier'
import {
	createDemoCometRejectedFundingVerifier,
	type DemoCertifiedRejectedFundingV1,
} from './demo-comet-rejected-funding-verifier'
import {
	createDemoCometDisplacementVerifier,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import { deriveDemoCometSignedBidEvidence } from './demo-comet-signed-bid-verifier'
import {
	createDemoFridayFundingAbortFinalityVerifier,
} from './demo-friday-funding-abort-comet'
import type { DemoFridayLockedAbortEvidencePort } from './demo-friday-funding-abort-service'
import type {
	DemoFridayFundingAbortCapsuleStore,
	DemoFridayFundingAbortCapsuleTerminalStore,
} from './demo-friday-funding-abort-capsule'
import {
	demoIntegratedCloseFinalityDigest,
	type DemoCertifiedCloseV1,
} from './demo-integrated-close-authority'
import { demoIntegratedRejectedFundingFinalityDigest } from './demo-integrated-rejected-authority'
import {
	demoIntegratedDisplacementFinalityDigest,
	type DemoCertifiedDisplacementV1,
} from './demo-integrated-authority'
import type { DemoIntegratedTerminalAuthorityStore } from './demo-integrated-authority'
import type { DemoFridayFixedTerminalResolverPort, DemoFridayTrustedTerminalReferenceV1 } from './demo-friday-authority-runtime'
import type { DemoIntegratedRecoveryAuditPort } from './demo-integrated-outbid-return'
import type { DemoIntegratedThreshold3TerminalRequest } from './demo-integrated-threshold3-terminal-service'
import type { DemoIntegratedThreshold3CloseServiceOptions } from './demo-integrated-threshold3-close-service'
import {
	demoMaintainerScopeFor,
	type DemoMaintainerExactBranchTemplate,
	type DemoMaintainerOfflineStore,
} from './demo-maintainer-offline'
import type { DemoMaintainerThreshold3ProcessOptions } from './demo-maintainer-threshold3-process'
import type { DemoMaintainerTerminalThreshold3ProcessOptions } from './demo-maintainer-terminal-threshold3-process'
import type { DemoMaintainerFederationRequest } from './demo-maintainer-federation'
import {
	demoFrostCommitteeLockedProofsDigest,
	demoFrostParticipantPolicyDigest,
	type DemoFrostParticipantPolicyPackage,
} from './demo-frost-participant-policy'
import type { DemoFrostProcessParticipant } from './demo-frost-process-boundary'
import { proofPoint } from './nut-client'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/

export type DemoFridayTerminalDescriptorV1 = {
	schema: 'PLEBEIAN_FRIDAY_TERMINAL_DESCRIPTOR_V1'
	reference: string
	branch: 'outbid_return' | 'rejected_return' | 'funding_abort_return' | 'winner_payout' | 'reserve_unmet_return'
	auctionId: string
	fundingOperationId: string
	scope: string
	bundleDigest: string
	eventHeight: number
	eventId: string
}

export interface DemoFridayTerminalDescriptorPort {
	readExact(reference: string): Promise<DemoFridayTerminalDescriptorV1 | null>
}

export type DemoFridayTerminalScanKind = 'event' | 'close'

export interface DemoFridayTerminalScanRequestV1 {
	fundingOperationId: string
	admissionEventId: string
	kind: DemoFridayTerminalScanKind
	targetId: string
	startHeight: number
	observedEndHeight: number
}

interface DemoFridayTerminalScanRecordV1 {
	schema: 'PLEBEIAN_FRIDAY_TERMINAL_SCAN_V1'
	scanId: string
	fundingOperationId: string
	admissionEventId: string
	kind: DemoFridayTerminalScanKind
	targetId: string
	startHeight: number
	targetHeight: number
	nextHeight: number
	foundHeight: number
	revision: number
}

export interface DemoFridayTerminalScanResultV1 {
	complete: boolean
	foundHeight?: number
	scannedBlocks: number
}

/** Non-bearer authenticated descriptor journal; package secrets stay encrypted elsewhere. */
export class DemoFridayTerminalDescriptorSqlite implements DemoFridayTerminalDescriptorPort {
	constructor(private readonly database: Database) {
		database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS friday_terminal_descriptors (
				reference TEXT PRIMARY KEY NOT NULL, identity_digest TEXT UNIQUE NOT NULL,
				descriptor_json TEXT NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS friday_terminal_scan_cursors (
				scan_id TEXT PRIMARY KEY NOT NULL,
				funding_operation_id TEXT UNIQUE NOT NULL,
				record_json TEXT NOT NULL
			) STRICT`)
	}

	persistAuthenticatedExact(value: DemoFridayTerminalDescriptorV1): DemoFridayTrustedTerminalReferenceV1 {
		const exact = exactDescriptor(value)
		const identityDigest = demoFridayTerminalDescriptorDigest(exact)
		this.database.transaction(() => {
			const prior = this.database.query<{ identity_digest: string; descriptor_json: string }, [string]>(
				'SELECT identity_digest, descriptor_json FROM friday_terminal_descriptors WHERE reference = ?',
			).get(exact.reference)
			if (prior !== null) {
				if (prior.identity_digest !== identityDigest || prior.descriptor_json !== JSON.stringify(exact)) {
					fail('terminal descriptor changed after authentication')
				}
				return
			}
			try {
				this.database.query(`INSERT INTO friday_terminal_descriptors
					(reference, identity_digest, descriptor_json) VALUES (?, ?, ?)`)
					.run(exact.reference, identityDigest, JSON.stringify(exact))
			} catch { fail('terminal descriptor identity was already consumed') }
		}).immediate()
		return { schema: 'PLEBEIAN_FRIDAY_TERMINAL_REFERENCE_V1', reference: exact.reference, identityDigest }
	}

	async readExact(reference: string): Promise<DemoFridayTerminalDescriptorV1 | null> {
		if (!ID.test(reference)) fail('terminal descriptor reference is invalid')
		const row = this.database.query<{ identity_digest: string; descriptor_json: string }, [string]>(
			'SELECT identity_digest, descriptor_json FROM friday_terminal_descriptors WHERE reference = ?',
		).get(reference)
		if (row === null) return null
		const value = exactDescriptor(JSON.parse(row.descriptor_json) as DemoFridayTerminalDescriptorV1)
		if (demoFridayTerminalDescriptorDigest(value) !== row.identity_digest) fail('stored terminal descriptor digest changed')
		return value
	}

	/**
	 * Advance one crash-safe bounded history page.  The first observation fixes
	 * the terminal search horizon; later drain passes resume the exact same
	 * cursor instead of rescanning from admission or silently abandoning a long
	 * auction.  Each committed block is checkpointed independently, so a crash
	 * can repeat at most one authenticated read.
	 */
	async scanHistoryPageExact(options: {
		request: DemoFridayTerminalScanRequestV1
		maxBlocks: number
		readBlock(height: number): Promise<{ height: number; transactions: Uint8Array[] }>
		matches(raw: Uint8Array): boolean
	}): Promise<DemoFridayTerminalScanResultV1> {
		const request = exactScanRequest(options.request)
		if (!Number.isSafeInteger(options.maxBlocks) || options.maxBlocks < 1 || options.maxBlocks > 512) {
			fail('terminal scan page size is invalid')
		}
		let record = this.#readOrCreateScan(request)
		if (request.observedEndHeight < record.targetHeight) fail('terminal observation regressed below scan horizon')
		let scannedBlocks = 0
		while (record.nextHeight <= record.targetHeight && scannedBlocks < options.maxBlocks) {
			const height = record.nextHeight
			const block = await options.readBlock(height)
			if (block.height !== height || !Array.isArray(block.transactions)) fail('terminal history block height differs')
			const matches = block.transactions.filter((raw) => options.matches(raw)).length
			if (matches > 1 || (matches === 1 && record.foundHeight !== 0)) {
				fail('terminal event appears in more than one committed transaction')
			}
			const next: DemoFridayTerminalScanRecordV1 = {
				...record, nextHeight: height + 1,
				foundHeight: matches === 1 ? height : record.foundHeight,
				revision: record.revision + 1,
			}
			this.#checkpointScan(record, next)
			record = next
			scannedBlocks++
		}
		const complete = record.nextHeight > record.targetHeight
		if (complete && record.foundHeight === 0) fail('terminal event is absent from committed history')
		return complete
			? { complete: true, foundHeight: record.foundHeight, scannedBlocks }
			: { complete: false, scannedBlocks }
	}

	#readOrCreateScan(request: DemoFridayTerminalScanRequestV1): DemoFridayTerminalScanRecordV1 {
		const scanId = demoFridayTerminalScanId(request)
		return this.database.transaction(() => {
			const row = this.database.query<{ record_json: string }, [string]>(
				'SELECT record_json FROM friday_terminal_scan_cursors WHERE funding_operation_id = ?',
			).get(request.fundingOperationId)
			if (row !== null) {
				const record = exactScanRecord(JSON.parse(row.record_json) as unknown)
				if (record.scanId !== scanId || record.admissionEventId !== request.admissionEventId
					|| record.kind !== request.kind || record.targetId !== request.targetId
					|| record.startHeight !== request.startHeight) {
					fail('terminal scan identity changed for one funding operation')
				}
				return record
			}
			const record: DemoFridayTerminalScanRecordV1 = {
				schema: 'PLEBEIAN_FRIDAY_TERMINAL_SCAN_V1', scanId,
				fundingOperationId: request.fundingOperationId, admissionEventId: request.admissionEventId,
				kind: request.kind, targetId: request.targetId, startHeight: request.startHeight,
				targetHeight: request.observedEndHeight, nextHeight: request.startHeight,
				foundHeight: 0, revision: 0,
			}
			try {
				this.database.query(`INSERT INTO friday_terminal_scan_cursors
					(scan_id, funding_operation_id, record_json) VALUES (?, ?, ?)`)
					.run(scanId, request.fundingOperationId, JSON.stringify(record))
			} catch { fail('terminal scan identity already belongs to another funding operation') }
			return record
		}).immediate()
	}

	#checkpointScan(prior: DemoFridayTerminalScanRecordV1, next: DemoFridayTerminalScanRecordV1): void {
		exactScanRecord(next)
		this.database.transaction(() => {
			const changed = this.database.query(`UPDATE friday_terminal_scan_cursors SET record_json = ?
				WHERE scan_id = ? AND funding_operation_id = ? AND record_json = ?`).run(
				JSON.stringify(next), prior.scanId, prior.fundingOperationId, JSON.stringify(prior),
			)
			if (changed.changes !== 1) fail('terminal scan cursor changed concurrently')
		}).immediate()
	}
}

export interface DemoFridayTerminalNetworkPinsV1 {
	network: string
	chainId: string
	genesisHash: string
	validatorRosterVersion: string
	validatorsHash: string
	committeeKeysetId: string
	committeeKeysetVersion: string
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	committeePublicKey: string
	participants: { identifier: 1 | 2 | 3 | 4; verifyingShare: string }[]
}

type ThresholdBase = Omit<DemoMaintainerThreshold3ProcessOptions,
	'authorityClaim' | 'authorityStore' | 'request' | 'policy'>
type TerminalThresholdBase = Omit<DemoMaintainerTerminalThreshold3ProcessOptions,
	'authorityClaim' | 'authorityStore' | 'request' | 'policy'>

function fail(message: string): never { throw new Error(`DEMO_FRIDAY_FIXED_RESOLVER: ${message}`) }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

function exactScanRequest(value: DemoFridayTerminalScanRequestV1): DemoFridayTerminalScanRequestV1 {
	if (!ID.test(value.fundingOperationId) || !HEX_32.test(value.admissionEventId)
		|| !['event', 'close'].includes(value.kind)
		|| (value.kind === 'event' ? !HEX_32.test(value.targetId) : !ID.test(value.targetId))
		|| !Number.isSafeInteger(value.startHeight) || value.startHeight < 1
		|| !Number.isSafeInteger(value.observedEndHeight) || value.observedEndHeight < value.startHeight) {
		fail('terminal scan request is malformed')
	}
	return structuredClone(value)
}

export function demoFridayTerminalScanId(value: DemoFridayTerminalScanRequestV1): string {
	const exact = exactScanRequest(value)
	return digest([
		'PLEBEIAN_FRIDAY_TERMINAL_SCAN_ID_V1', exact.fundingOperationId, exact.admissionEventId,
		exact.kind, exact.targetId, exact.startHeight,
	])
}

function exactScanRecord(value: unknown): DemoFridayTerminalScanRecordV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('stored terminal scan is not an object')
	const raw = value as DemoFridayTerminalScanRecordV1
	if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify([
		'admissionEventId', 'foundHeight', 'fundingOperationId', 'kind', 'nextHeight', 'revision',
		'scanId', 'schema', 'startHeight', 'targetHeight', 'targetId',
	].sort()) || raw.schema !== 'PLEBEIAN_FRIDAY_TERMINAL_SCAN_V1'
		|| !HEX_32.test(raw.scanId) || !ID.test(raw.fundingOperationId) || !HEX_32.test(raw.admissionEventId)
		|| !['event', 'close'].includes(raw.kind)
		|| (raw.kind === 'event' ? !HEX_32.test(raw.targetId) : !ID.test(raw.targetId))
		|| !Number.isSafeInteger(raw.startHeight) || raw.startHeight < 1
		|| !Number.isSafeInteger(raw.targetHeight) || raw.targetHeight < raw.startHeight
		|| !Number.isSafeInteger(raw.nextHeight) || raw.nextHeight < raw.startHeight || raw.nextHeight > raw.targetHeight + 1
		|| !Number.isSafeInteger(raw.foundHeight) || raw.foundHeight < 0
		|| (raw.foundHeight !== 0 && (raw.foundHeight < raw.startHeight || raw.foundHeight >= raw.nextHeight))
		|| !Number.isSafeInteger(raw.revision) || raw.revision !== raw.nextHeight - raw.startHeight
		|| raw.scanId !== demoFridayTerminalScanId({
			fundingOperationId: raw.fundingOperationId, admissionEventId: raw.admissionEventId,
			kind: raw.kind, targetId: raw.targetId, startHeight: raw.startHeight,
			observedEndHeight: raw.targetHeight,
		})) fail('stored terminal scan is malformed or changed')
	return structuredClone(raw)
}

function exactDescriptor(value: DemoFridayTerminalDescriptorV1): DemoFridayTerminalDescriptorV1 {
	if (value.schema !== 'PLEBEIAN_FRIDAY_TERMINAL_DESCRIPTOR_V1'
		|| !ID.test(value.reference) || !ID.test(value.auctionId) || !ID.test(value.fundingOperationId)
		|| !['outbid_return', 'rejected_return', 'funding_abort_return', 'winner_payout', 'reserve_unmet_return'].includes(value.branch)
		|| ![value.scope, value.bundleDigest, value.eventId].every((item) => HEX_32.test(item))
		|| !Number.isSafeInteger(value.eventHeight) || value.eventHeight < 1) fail('terminal descriptor is malformed')
	return structuredClone(value)
}

export function demoFridayTerminalDescriptorDigest(value: DemoFridayTerminalDescriptorV1): string {
	const exact = exactDescriptor(value)
	return digest([
		'PLEBEIAN_FRIDAY_TERMINAL_DESCRIPTOR_DIGEST_V1', exact.schema, exact.reference, exact.branch,
		exact.auctionId, exact.fundingOperationId, exact.scope, exact.bundleDigest, exact.eventHeight, exact.eventId,
	])
}

function federationRequest(
	pins: DemoFridayTerminalNetworkPinsV1,
	policy: DemoFrostParticipantPolicyPackage,
): DemoMaintainerFederationRequest {
	return {
		schema: 'COCO_DEMO_FROST_REQUEST_V1', threshold: 3, sessionId: randomBytes(32).toString('hex'),
		packageDigest: policy.packageDigest, cashuSigAllDigest: policy.cashuSigAllDigest,
		committeePublicKey: pins.committeePublicKey, committeeKeysetId: pins.committeeKeysetId,
		committeeKeysetVersion: pins.committeeKeysetVersion, participants: structuredClone(pins.participants),
		policyPackageDigest: demoFrostParticipantPolicyDigest(policy),
		closureEvidenceDigest: policy.certifiedClosure.evidenceDigest,
		signedBidEvidenceDigest: policy.signedBid.evidenceDigest,
		committeeLockedProofsDigest: demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs),
	}
}

async function commonPolicy(options: {
	template: DemoMaintainerExactBranchTemplate
	winner: DemoMaintainerExactBranchTemplate
	certificate: DemoCertifiedDisplacementV1 | DemoCertifiedCloseV1 | DemoCertifiedRejectedFundingV1
	evidenceDigest: string
	evidenceKind: 'outbid' | 'close' | 'rejected'
	eventHeight: number
	eventId?: string
	reader: DemoParticipantConsensusReader
	pins: DemoFridayTerminalNetworkPinsV1
	actorPackageAuthorization: DemoFrostParticipantPolicyPackage['actorPackageAuthorization']
}): Promise<DemoFrostParticipantPolicyPackage> {
	const { template, certificate, pins } = options
	const operationId = 'displacedFundingOperationId' in certificate
		? certificate.displacedFundingOperationId : certificate.fundingOperationId
	const bidderActorId = 'displacedBidderActorId' in certificate
		? certificate.displacedBidderActorId : certificate.bidderActorId
	const finality = certificate.commits[2]
	const amount = 'displacedPoolAmount' in certificate ? certificate.displacedPoolAmount : certificate.poolAmount
	const signedBid = await deriveDemoCometSignedBidEvidence({
		reader: options.reader, validatorsHash: pins.validatorsHash, minimumHeight: state.stateHeight,
		fundingOperationId: operationId,
		deposits: template.inputs.map((proof) => ({
			proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)), amount: proof.amount, keysetId: proof.id,
		})), sellerRecipientPublicKey: options.winner.recipientPublicKey,
	})
	const closureEvidence: DemoFrostParticipantPolicyPackage['certifiedClosure']['evidence'] = options.evidenceKind === 'outbid'
		? {
			schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2', source: 'participant-local',
			kind: 'outbid', eventHeight: options.eventHeight,
			eventId: options.eventId ?? fail('outbid evidence event identity is absent'),
		}
		: options.evidenceKind === 'rejected' ? {
			schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2', source: 'participant-local',
			kind: 'rejected', eventHeight: options.eventHeight,
			eventId: options.eventId ?? fail('rejected evidence event identity is absent'),
		} : {
			schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2', source: 'participant-local',
			kind: 'close', eventHeight: options.eventHeight,
		}
	const policy: DemoFrostParticipantPolicyPackage = {
		schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1', network: pins.network, chainId: pins.chainId,
		auctionId: certificate.auctionId, operationId, bidId: operationId, bidEventId: operationId,
		bidderActorId, role: template.role, outcomeHeight: finality.height,
		appStateHash: finality.appHash, amount, inputFee: 0, inputFeePpk: 0,
		mintUrl: template.mintUrl, unit: 'sat', activeKeysetId: template.mintSeal.activeSatKeysetId,
		locktime: template.locktime, bidderPublicKey: template.bidderPublicKey,
		committeePublicKey: template.committeePublicKey,
		sellerRecipientPublicKey: options.winner.recipientPublicKey,
		recipientPublicKey: template.recipientPublicKey,
		deposits: template.inputs.map((proof) => ({
			proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)), amount: proof.amount, keysetId: proof.id,
		})), committeeLockedProofs: template.inputs.map((proof) => structuredClone(proof)),
		outputs: template.outputs.map((output) => structuredClone(output)),
		recipientCapability: structuredClone(template.recipientCapability), packageDigest: template.templateDigest,
		cashuSigAllDigest: template.cashuSigAllDigest,
		actorPackageAuthorization: structuredClone(options.actorPackageAuthorization),
		certifiedClosure: { evidenceDigest: options.evidenceDigest, evidence: closureEvidence },
		signedBid: {
			evidenceDigest: signedBid.evidenceDigest,
			evidence: { schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1', source: 'participant-local' },
		},
	}
	return policy
}

export function createDemoFridayFixedTerminalResolver(options: {
	descriptors: DemoFridayTerminalDescriptorPort
	reader: DemoParticipantConsensusReader
	pins: DemoFridayTerminalNetworkPinsV1
	offlineStore: DemoMaintainerOfflineStore
	abortCapsules: DemoFridayFundingAbortCapsuleStore
	abortCapsuleTerminalStore: DemoFridayFundingAbortCapsuleTerminalStore
	authorityStore: DemoIntegratedTerminalAuthorityStore
	participants: [DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant, DemoFrostProcessParticipant]
	threshold: Omit<ThresholdBase, 'participants' | 'policySources' | 'policyPorts' | 'dkgRunId' | 'publicKeyPackageSha256' | 'signerRosterDigest'>
	executorFor(template: DemoMaintainerExactBranchTemplate, recipientActorId: string): DemoIntegratedThreshold3CloseServiceOptions['executor']
	fundingAbortEvidence: DemoFridayLockedAbortEvidencePort
	recoveryAudit: DemoIntegratedRecoveryAuditPort
	nowSeconds(): number
}): DemoFridayFixedTerminalResolverPort {
	const pins = structuredClone(options.pins)
	if (![pins.genesisHash, pins.validatorsHash, pins.publicKeyPackageSha256, pins.signerRosterDigest]
		.every((value) => HEX_32.test(value)) || pins.participants.length !== 4) fail('network/DKG pins are malformed')
	const displacementVerifier = createDemoCometDisplacementVerifier({ reader: options.reader, ...pins })
	const closeVerifier = createDemoCometCloseVerifier({ reader: options.reader, ...pins })
	const rejectedVerifier = createDemoCometRejectedFundingVerifier({ reader: options.reader, ...pins })
	return Object.freeze({
		async resolveExact(reference: DemoFridayTrustedTerminalReferenceV1) {
			const descriptorValue = await options.descriptors.readExact(reference.reference)
			if (descriptorValue === null) fail('trusted terminal descriptor is absent')
			const descriptor = exactDescriptor(descriptorValue)
			if (descriptor.reference !== reference.reference
				|| demoFridayTerminalDescriptorDigest(descriptor) !== reference.identityDigest) {
				fail('terminal reference digest differs from fixed descriptor')
			}
			if (descriptor.branch === 'funding_abort_return') {
				const capsule = await options.abortCapsules.readByOperationExact(descriptor.fundingOperationId)
				const template = capsule.refund
				if (capsule.capsuleDigest !== descriptor.bundleDigest
					|| demoMaintainerScopeFor(template) !== descriptor.scope
					|| template.operationId !== descriptor.fundingOperationId
					|| template.auctionId !== descriptor.auctionId) {
					fail('encrypted abort capsule differs from terminal descriptor')
				}
				// The verifier's mint/keyset pins are certificate-specific. Recreate it
				// only from the already encrypted, actor-authorized package; no request
				// field may replace the process network/DKG pins.
				const exactAbortVerifier = createDemoFridayFundingAbortFinalityVerifier({
					reader: options.reader, validatorsHash: pins.validatorsHash,
					pins: {
						authNetworkId: pins.network, chainId: pins.chainId, genesisSha256: pins.genesisHash,
						mintUrl: template.mintUrl, activeKeysetId: template.mintSeal.activeSatKeysetId,
						committeePublicKey: pins.committeePublicKey, committeeKeysetId: pins.committeeKeysetId,
						committeeKeysetVersion: pins.committeeKeysetVersion, dkgRunId: pins.dkgRunId,
						publicKeyPackageSha256: pins.publicKeyPackageSha256, signerRosterDigest: pins.signerRosterDigest,
					},
				})
				const finalized = await exactAbortVerifier.verifyExact({ operationId: descriptor.fundingOperationId,
					consensusEventId: descriptor.eventId, height: descriptor.eventHeight })
				const certificate = finalized.certificate, commit = finalized.commit
				const lockedEvidence = await options.fundingAbortEvidence.readExact(descriptor.fundingOperationId)
				if (certificate.auctionId !== descriptor.auctionId || certificate.operationId !== descriptor.fundingOperationId
					|| certificate.returnPackageDigest !== template.templateDigest
					|| certificate.returnCashuSigAllDigest !== template.cashuSigAllDigest) {
					fail('committed FundingAbort differs from encrypted exact refund package')
				}
				const policy: DemoFrostParticipantPolicyPackage = {
					schema: 'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1', network: pins.network, chainId: pins.chainId,
					auctionId: certificate.auctionId, operationId: certificate.operationId,
					bidId: certificate.operationId, bidEventId: certificate.fundingAuthorizationEventId,
					bidderActorId: certificate.actor, role: 'refund', outcomeHeight: commit.stateHeight,
					appStateHash: commit.stateAppHash, amount: certificate.amount, inputFee: 0, inputFeePpk: 0,
					mintUrl: certificate.mintUrl, unit: 'sat', activeKeysetId: certificate.activeKeysetId,
					locktime: certificate.locktime, bidderPublicKey: certificate.paymentPublicKey,
					committeePublicKey: certificate.committeePublicKey,
					sellerRecipientPublicKey: template.recipientPublicKey,
					recipientPublicKey: template.recipientPublicKey,
					deposits: template.inputs.map((proof) => ({ proofStateRef: bytesToHex(proofPoint(proof).toBytes(true)),
						amount: proof.amount, keysetId: proof.id })),
					committeeLockedProofs: template.inputs.map((proof) => structuredClone(proof)),
					outputs: template.outputs.map((output) => structuredClone(output)),
					recipientCapability: structuredClone(template.recipientCapability),
					packageDigest: template.templateDigest, cashuSigAllDigest: template.cashuSigAllDigest,
					actorPackageAuthorization: structuredClone(capsule.actorReturnAuthorization),
					certifiedClosure: { evidenceDigest: commit.consensusEventId, evidence: {
						schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2', source: 'participant-local',
						kind: 'funding_abort', eventHeight: commit.height, eventId: commit.consensusEventId,
					} },
					signedBid: { evidenceDigest: certificate.fundingAuthorizationEventId, evidence: {
						schema: 'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1', source: 'participant-local',
					} },
				}
				const threshold = { ...options.threshold, participants: options.participants,
					dkgRunId: pins.dkgRunId, publicKeyPackageSha256: pins.publicKeyPackageSha256,
					signerRosterDigest: pins.signerRosterDigest } satisfies ThresholdBase & TerminalThresholdBase
				return { branch: descriptor.branch, options: {
					certificate, commit,
					evidence: lockedEvidence,
					template, authorityStore: options.authorityStore,
					capsules: options.abortCapsules, capsuleTerminalStore: options.abortCapsuleTerminalStore,
					policy, federationRequest: federationRequest(pins, policy), threshold,
					recoveryAudit: options.recoveryAudit, nowSeconds: options.nowSeconds(),
				} } satisfies DemoIntegratedThreshold3TerminalRequest
			}
			const record = await options.offlineStore.loadExact(descriptor.scope, descriptor.bundleDigest)
			if (record === null || record.bundle.bundleDigest !== descriptor.bundleDigest
				|| demoMaintainerScopeFor(record.bundle.winner) !== descriptor.scope
				|| record.bundle.winner.operationId !== descriptor.fundingOperationId
				|| record.bundle.winner.auctionId !== descriptor.auctionId) {
				fail('encrypted admitted bundle differs from terminal descriptor')
			}
			let certificate: DemoCertifiedDisplacementV1 | DemoCertifiedCloseV1 | DemoCertifiedRejectedFundingV1
			let template: DemoMaintainerExactBranchTemplate
			if (descriptor.branch === 'outbid_return') {
				certificate = await displacementVerifier.verifyAndDerive({
					network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
					validatorRosterVersion: pins.validatorRosterVersion, auctionId: descriptor.auctionId,
					displacementHeight: descriptor.eventHeight, replacementBidEventId: descriptor.eventId,
				})
				template = record.bundle.refund
			} else if (descriptor.branch === 'rejected_return') {
				certificate = await rejectedVerifier.verifyAndDerive({
					network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
					validatorRosterVersion: pins.validatorRosterVersion, auctionId: descriptor.auctionId,
					fundingOperationId: descriptor.fundingOperationId, bidEventId: descriptor.eventId,
					rejectionHeight: descriptor.eventHeight,
				})
				template = record.bundle.refund
			} else {
				certificate = await closeVerifier.verifyAndDerive({
					network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
					validatorRosterVersion: pins.validatorRosterVersion, auctionId: descriptor.auctionId,
					closeHeight: descriptor.eventHeight,
				})
				template = descriptor.branch === 'winner_payout' ? record.bundle.winner : record.bundle.refund
			}
			const expectedOperation = 'displacedFundingOperationId' in certificate
				? certificate.displacedFundingOperationId : certificate.fundingOperationId
			const expectedCause = descriptor.branch === 'winner_payout' ? 'winner'
				: descriptor.branch === 'reserve_unmet_return' ? 'reserve_unmet' : undefined
			if (expectedOperation !== descriptor.fundingOperationId
				|| (expectedCause !== undefined && (!('cause' in certificate) || certificate.cause !== expectedCause))) {
				fail('certified outcome differs from terminal descriptor')
			}
			const evidenceDigest = 'displacementState' in certificate
				? demoIntegratedDisplacementFinalityDigest(certificate)
				: 'fundingState' in certificate
					? demoIntegratedRejectedFundingFinalityDigest(certificate)
					: demoIntegratedCloseFinalityDigest(certificate)
			const policy = await commonPolicy({
				template, winner: record.bundle.winner, certificate, evidenceDigest,
				evidenceKind: 'displacementState' in certificate ? 'outbid' : 'fundingState' in certificate ? 'rejected' : 'close',
				eventHeight: descriptor.eventHeight,
				...('displacementState' in certificate || 'fundingState' in certificate ? { eventId: descriptor.eventId } : {}),
				reader: options.reader, pins,
				actorPackageAuthorization: structuredClone(descriptor.branch === 'winner_payout'
					? record.bundle.actorWinnerAuthorization : record.bundle.actorReturnAuthorization),
			})
			const threshold = {
				...options.threshold, participants: options.participants,
				dkgRunId: pins.dkgRunId, publicKeyPackageSha256: pins.publicKeyPackageSha256,
				signerRosterDigest: pins.signerRosterDigest,
			} satisfies ThresholdBase & TerminalThresholdBase
			const shared = {
				template, offlineIdentity: { scope: descriptor.scope, bundleDigest: descriptor.bundleDigest },
				authorityStore: options.authorityStore, policy, federationRequest: federationRequest(pins, policy),
				threshold, executor: options.executorFor(template,
					'displacedBidderActorId' in certificate ? certificate.displacedBidderActorId
						: descriptor.branch === 'winner_payout' ? certificate.sellerActorId : certificate.bidderActorId),
				recoveryAudit: options.recoveryAudit,
				nowSeconds: options.nowSeconds(),
			}
			if (descriptor.branch === 'outbid_return') {
				return { branch: descriptor.branch, options: {
					...shared, displacementRequest: {
						network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
						validatorRosterVersion: pins.validatorRosterVersion, auctionId: descriptor.auctionId,
						displacementHeight: descriptor.eventHeight, replacementBidEventId: descriptor.eventId,
					}, displacementVerifier,
				} } satisfies DemoIntegratedThreshold3TerminalRequest
			}
			if (descriptor.branch === 'rejected_return') {
				return { branch: descriptor.branch, options: {
					...shared, rejectedRequest: {
						network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
						validatorRosterVersion: pins.validatorRosterVersion, auctionId: descriptor.auctionId,
						fundingOperationId: descriptor.fundingOperationId, bidEventId: descriptor.eventId,
						rejectionHeight: descriptor.eventHeight,
					}, rejectedVerifier,
				} } satisfies DemoIntegratedThreshold3TerminalRequest
			}
			return { branch: descriptor.branch, options: {
				...shared, closeRequest: {
					network: pins.network, chainId: pins.chainId, genesisHash: pins.genesisHash,
					validatorRosterVersion: pins.validatorRosterVersion, auctionId: descriptor.auctionId,
					closeHeight: descriptor.eventHeight,
				}, closeVerifier,
			} } satisfies DemoIntegratedThreshold3TerminalRequest
		},
	})
}
