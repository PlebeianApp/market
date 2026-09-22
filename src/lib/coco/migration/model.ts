export const MIGRATION_PHASES = [
	'LEGACY_ACTIVE',
	'MIGRATION_SNAPSHOT_FROZEN',
	'IMPORTING',
	'RESOLVING',
	'VERIFYING',
	'COCO_READY',
	'CUTOVER_COMMITTED',
] as const

export type MigrationPhase = (typeof MIGRATION_PHASES)[number]
export type MigrationEnvironment = 'development' | 'test' | 'staging' | 'production'

export const REQUIRED_PRODUCTION_ENUMERATORS = [
	'LEGACY_SPENDABLE_PROOFS',
	'LEGACY_RESERVATIONS',
	'LEGACY_PENDING_OUTBOUND',
	'NIP60_PENDING_RECOVERY',
	'AUCTION_BIDDER_P2PK',
	'AUCTION_SELLER_P2PK_AUTHORITY',
	'IN_FLIGHT_MIGRATIONS',
	'UNRESOLVED_REMOTE_OPERATIONS',
	'COCO_OPENING_BASELINE',
] as const

export type ProductionEnumerator = (typeof REQUIRED_PRODUCTION_ENUMERATORS)[number]
export type MonetaryItemState = 'AVAILABLE' | 'PENDING' | 'EXECUTING' | 'LOCKED' | 'AMBIGUOUS' | 'QUARANTINED' | 'RESOLVED' | 'CONSUMED'
export type FinalDisposition = 'COCO_OWNED' | 'CONSUMED_COMPLETED' | 'PENDING' | 'QUARANTINED' | 'RETAINED_LEGACY_WORKFLOW' | 'UNKNOWN'
export type AccountAttribution = 'CANONICAL_ACCOUNT' | 'UNATTRIBUTED'

export interface MigrationIdentity {
	namespace: string
	account: string
	environment: MigrationEnvironment
	epoch: string
}

export interface InventoryItem {
	sourceId: string
	source: ProductionEnumerator
	mint: string
	unit: string
	amount: bigint
	state: MonetaryItemState
	accountAttribution: AccountAttribution
	attributionReason?: string
	legacyAuthorityRetained: boolean
	uncertainRemoteEffect: boolean
	unresolvedP2pkRecovery: boolean
	cocoOperationId?: string
	hostCommandId?: string
	hostCommandBoundOperationId?: string
}

export interface EnumeratorCompletionEvidence extends MigrationIdentity {
	source: ProductionEnumerator
	sourceSchema: string
	sourceVersion: string
	snapshotId: string
	itemCount: number
	inventoryCommitment: string
	completedAtMs: number
}

export interface InventorySeal extends MigrationIdentity {
	sealedAtRevision: number
	sealedAtMs: number
	itemCount: number
	commitment: string
	completions: readonly EnumeratorCompletionEvidence[]
	items: readonly InventoryItem[]
	lateDiscoveries: readonly string[]
}

export interface VerifiedDispositionEvidence {
	sourceId: string
	disposition: FinalDisposition
	mint: string
	unit: string
	sourceAmount: bigint
	destinationAmount: bigint
	consumedAmount: bigint
	feeAmount: bigint
	destinationId?: string
	cocoOperationId?: string
	evidenceId: string
	evidenceCommitment: string
}

export interface CocoDestinationEvidence {
	mint: string
	unit: string
	amount: bigint
	authorityGeneration: number
	snapshotId: string
	evidenceCommitment: string
}

export interface AccountingBucketResult {
	mint: string
	unit: string
	openingCocoAmount: bigint
	verifiedMigratedSourceAmount: bigint
	verifiedCocoDestinationAmount: bigint
	verifiedConsumedAmount: bigint
	verifiedFeeAmount: bigint
	delta: bigint
}

export interface AccountingReport extends MigrationIdentity {
	commitment: string
	reconciled: boolean
	buckets: readonly AccountingBucketResult[]
	sourceCount: number
	dispositions: readonly VerifiedDispositionEvidence[]
	destinations: readonly CocoDestinationEvidence[]
	failureReasons: readonly string[]
}

export interface CocoRecoveryQuiescenceCertificate extends MigrationIdentity {
	certificateId: string
	authorityGeneration: number
	issuedAtMs: number
	operations: readonly Readonly<{
		operationId: string
		status: 'QUIESCENT' | 'COMPLETED'
		publicConditionFingerprint: string
	}>[]
	commitment: string
}

export interface LegacyWriterLease {
	leaseId: string
	writerId: string
	operationId: string
	startedAtMs: number
	controlRevision: number
}

export interface LegacyQuiescenceCertificate extends MigrationIdentity {
	certificateId: string
	writerGeneration: number
	inventoryCommitment: string
	issuedAtMs: number
	commitment: string
}

export interface MigrationControlRecord extends MigrationIdentity {
	phase: MigrationPhase
	revision: number
	inventorySeal: InventorySeal | null
	accountingReport: AccountingReport | null
	lateDiscoveryIds: readonly string[]
	activeLegacyWriters: readonly LegacyWriterLease[]
	legacyWriterGeneration: number
	legacyQuiescenceCertificate: LegacyQuiescenceCertificate | null
	orphanCocoOperationIds: readonly string[]
	unboundHostCommandIds: readonly string[]
	cocoAuthorityGeneration: number | null
	recoveryQuiescenceCertificate: CocoRecoveryQuiescenceCertificate | null
	legacyMonetaryMutationAllowed: boolean
	cocoCanonical: boolean
	boundCocoGeneration: number | null
	cutoverEvidenceCommitment: string | null
}

export interface CutoverExpectedState extends MigrationIdentity {
	revision: number
	phase: 'COCO_READY'
	inventoryCommitment: string
	accountingCommitment: string
	cocoAuthorityGeneration: number
	recoveryQuiescenceCommitment: string
	legacyQuiescenceCommitment: string
}

export type CutoverBlocker =
	| 'WRONG_PHASE'
	| 'INVENTORY_NOT_SEALED'
	| 'REQUIRED_ENUMERATOR_INCOMPLETE'
	| 'UNRESOLVED_ITEM'
	| 'UNATTRIBUTED_SOURCE'
	| 'UNSAFE_FINAL_DISPOSITION'
	| 'RETAINED_LEGACY_AUTHORITY'
	| 'LATE_DISCOVERY'
	| 'ACCOUNTING_NOT_RECONCILED'
	| 'ACTIVE_LEGACY_WRITER'
	| 'LEGACY_QUIESCENCE_MISSING'
	| 'UNCERTAIN_REMOTE_EFFECT'
	| 'ORPHAN_COCO_OPERATION'
	| 'UNBOUND_HOST_COMMAND'
	| 'COCO_AUTHORITY_GENERATION_UNKNOWN'
	| 'COCO_RECOVERY_QUIESCENCE_MISSING'
	| 'IDENTITY_MISMATCH'

export interface CutoverAssessment {
	allowed: boolean
	blockers: readonly CutoverBlocker[]
}

export class MigrationSafetyError extends Error {
	constructor(
		readonly code:
			| 'INVALID_INPUT'
			| 'IDENTITY_MISMATCH'
			| 'DUPLICATE_SOURCE'
			| 'LATE_DISCOVERY'
			| 'STALE_REVISION'
			| 'STALE_EPOCH'
			| 'INVALID_PHASE'
			| 'CUTOVER_BLOCKED'
			| 'LEGACY_WRITER_DISABLED'
			| 'LEASE_NOT_FOUND'
			| 'STORAGE_FAILURE',
		message: string,
	) {
		super(message)
		this.name = 'MigrationSafetyError'
	}
}
