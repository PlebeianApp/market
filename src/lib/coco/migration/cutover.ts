import {
	MIGRATION_PHASES,
	REQUIRED_PRODUCTION_ENUMERATORS,
	MigrationSafetyError,
	type CutoverAssessment,
	type CutoverBlocker,
	type MigrationControlRecord,
	type MigrationIdentity,
	type MigrationPhase,
} from './model'

function identityMatches(left: MigrationIdentity, right: MigrationIdentity): boolean {
	return (
		left.namespace === right.namespace &&
		left.account === right.account &&
		left.environment === right.environment &&
		left.epoch === right.epoch
	)
}

export function evaluateCutover(record: Readonly<MigrationControlRecord>): Readonly<CutoverAssessment> {
	const blockers = new Set<CutoverBlocker>()
	if (record.phase !== 'COCO_READY') blockers.add('WRONG_PHASE')
	const seal = record.inventorySeal
	if (!seal) {
		blockers.add('INVENTORY_NOT_SEALED')
		blockers.add('REQUIRED_ENUMERATOR_INCOMPLETE')
	} else {
		if (!identityMatches(record, seal)) blockers.add('IDENTITY_MISMATCH')
		const completed = new Set(seal.completions.map((completion) => completion.source))
		if (REQUIRED_PRODUCTION_ENUMERATORS.some((source) => !completed.has(source))) {
			blockers.add('REQUIRED_ENUMERATOR_INCOMPLETE')
		}
		if (seal.lateDiscoveries.length > 0) blockers.add('LATE_DISCOVERY')
		if (seal.items.some((item) => ['PENDING', 'EXECUTING', 'LOCKED', 'AMBIGUOUS', 'QUARANTINED'].includes(item.state))) {
			blockers.add('UNRESOLVED_ITEM')
		}
		if (seal.items.some((item) => item.accountAttribution !== 'CANONICAL_ACCOUNT')) blockers.add('UNATTRIBUTED_SOURCE')
		if (seal.items.some((item) => item.legacyAuthorityRetained)) blockers.add('RETAINED_LEGACY_AUTHORITY')
		if (seal.items.some((item) => item.uncertainRemoteEffect)) blockers.add('UNCERTAIN_REMOTE_EFFECT')
		if (seal.items.some((item) => item.unresolvedP2pkRecovery)) blockers.add('UNRESOLVED_ITEM')
		if (seal.items.some((item) => item.hostCommandId && !item.hostCommandBoundOperationId)) blockers.add('UNBOUND_HOST_COMMAND')
	}
	const accounting = record.accountingReport
	if (record.lateDiscoveryIds.length > 0) blockers.add('LATE_DISCOVERY')
	if (!accounting || !accounting.reconciled) blockers.add('ACCOUNTING_NOT_RECONCILED')
	if (accounting) {
		if (!identityMatches(record, accounting)) blockers.add('IDENTITY_MISMATCH')
		if (
			accounting.dispositions.some((evidence) => evidence.disposition !== 'COCO_OWNED' && evidence.disposition !== 'CONSUMED_COMPLETED')
		) {
			blockers.add('UNSAFE_FINAL_DISPOSITION')
		}
	}
	if (record.activeLegacyWriters.length > 0) blockers.add('ACTIVE_LEGACY_WRITER')
	const legacyCertificate = record.legacyQuiescenceCertificate
	if (
		!legacyCertificate ||
		legacyCertificate.writerGeneration !== record.legacyWriterGeneration ||
		legacyCertificate.inventoryCommitment !== record.inventorySeal?.commitment
	) {
		blockers.add('LEGACY_QUIESCENCE_MISSING')
	} else if (!identityMatches(record, legacyCertificate)) {
		blockers.add('IDENTITY_MISMATCH')
	}
	if (record.orphanCocoOperationIds.length > 0) blockers.add('ORPHAN_COCO_OPERATION')
	if (record.unboundHostCommandIds.length > 0) blockers.add('UNBOUND_HOST_COMMAND')
	if (record.cocoAuthorityGeneration === null) blockers.add('COCO_AUTHORITY_GENERATION_UNKNOWN')
	const certificate = record.recoveryQuiescenceCertificate
	if (!certificate || record.cocoAuthorityGeneration === null || certificate.authorityGeneration !== record.cocoAuthorityGeneration) {
		blockers.add('COCO_RECOVERY_QUIESCENCE_MISSING')
	} else if (!identityMatches(record, certificate)) {
		blockers.add('IDENTITY_MISMATCH')
	}
	return Object.freeze({ allowed: blockers.size === 0, blockers: Object.freeze(Array.from(blockers).sort()) })
}

export function assertPhaseTransition(current: MigrationPhase, next: MigrationPhase): void {
	if (current === 'CUTOVER_COMMITTED') {
		throw new MigrationSafetyError('INVALID_PHASE', 'CUTOVER_COMMITTED is irreversible')
	}
	const currentIndex = MIGRATION_PHASES.indexOf(current)
	const nextIndex = MIGRATION_PHASES.indexOf(next)
	if (currentIndex < 0 || nextIndex < 0) throw new MigrationSafetyError('INVALID_PHASE', 'migration phase is invalid')
	const resolvingBranch = current === 'MIGRATION_SNAPSHOT_FROZEN' && next === 'RESOLVING'
	const importingToVerifying = current === 'IMPORTING' && next === 'VERIFYING'
	const resolvingToVerifying = current === 'RESOLVING' && next === 'VERIFYING'
	if (!(nextIndex === currentIndex + 1 || resolvingBranch || importingToVerifying || resolvingToVerifying)) {
		throw new MigrationSafetyError('INVALID_PHASE', `invalid migration phase transition ${current} -> ${next}`)
	}
}

export type WalletAuthoritySelection = 'LEGACY' | 'COCO' | 'COCO_RECOVERY_UNAVAILABLE'

export function selectWalletAuthority(
	record: Pick<MigrationControlRecord, 'phase' | 'cocoCanonical' | 'legacyMonetaryMutationAllowed'>,
	cocoAvailable: boolean,
): WalletAuthoritySelection {
	if (record.phase === 'CUTOVER_COMMITTED' || record.cocoCanonical) {
		return cocoAvailable ? 'COCO' : 'COCO_RECOVERY_UNAVAILABLE'
	}
	return 'LEGACY'
}
