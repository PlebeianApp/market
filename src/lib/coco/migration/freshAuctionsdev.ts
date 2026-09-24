import { createCommitment } from './commitment'
import { assertSameIdentity, createMigrationIdentity, normalizeAccount, normalizeEnvironment } from './identity'
import { publishLegacyDisablement } from './legacyDisableSignal'
import { MigrationSafetyError, type FreshAuctionsdevPreflightEvidence, type MigrationIdentity } from './model'
import { getMigrationAuthorityPurpose, type MigrationControlStore } from './store'

export const FRESH_AUCTIONSDEV_PREFLIGHT_SCHEMA_VERSION = 1 as const
export const FRESH_AUCTIONSDEV_PROFILE = 'FRESH_AUCTIONSDEV_TEST' as const

export type FreshAuctionsdevBlocker =
	| 'WRONG_PROFILE'
	| 'ENVIRONMENT_NOT_ALLOWED'
	| 'MARKET_COMMIT_INVALID'
	| 'IDENTITY_MISMATCH'
	| 'FAKE_MINT_UNVERIFIED'
	| 'FAKE_MINT_MISSING'
	| 'LEGACY_INVENTORY_PRESENT'
	| 'LEGACY_AUTHORITY_PRESENT'
	| 'AUCTION_RECOVERY_PRESENT'
	| 'TRUNCATED_STORAGE_PRESENT'
	| 'TRUNCATED_DATABASE_PRESENT'
	| 'ACTIVE_LEGACY_WRITER'
	| 'COCO_BALANCE_NONZERO'
	| 'COCO_HISTORY_PRESENT'
	| 'COCO_IN_FLIGHT'
	| 'COCO_ORPHAN'
	| 'HOST_COMMAND_PRESENT'
	| 'NAMESPACE_NOT_FRESH'
	| 'AUTHORITATIVE_DATABASE_INVALID'
	| 'VAULT_ROUND_TRIP_FAILED'
	| 'VAULT_KEY_EXTRACTABLE'
	| 'PLAINTEXT_SECRET_PRESENT'
	| 'EVIDENCE_COMMITMENT_INVALID'

export interface FreshAuctionsdevAssessment {
	allowed: boolean
	blockers: readonly FreshAuctionsdevBlocker[]
}

export type FreshAuctionsdevEvidenceInput = Omit<
	FreshAuctionsdevPreflightEvidence,
	'schemaVersion' | 'profile' | 'inventoryCommitment' | 'evidenceCommitment'
>

const MARKET_COMMIT = /^[0-9a-f]{40}$/
const COMMITMENT = /^sha256:[0-9a-f]{64}$/

function requireCount(value: number, field: string): number {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new MigrationSafetyError('INVALID_INPUT', `${field} must be a non-negative safe integer`)
	return value
}

function publicInventory(evidence: FreshAuctionsdevEvidenceInput | FreshAuctionsdevPreflightEvidence) {
	return {
		frozenSnapshotId: evidence.frozenSnapshotId,
		legacySpendableCount: evidence.legacySpendableCount,
		legacyReservationCount: evidence.legacyReservationCount,
		legacyPendingCount: evidence.legacyPendingCount,
		legacyAuthorityCount: evidence.legacyAuthorityCount,
		auctionRecoveryCount: evidence.auctionRecoveryCount,
		truncatedStorageCount: evidence.truncatedStorageCount,
		truncatedDatabaseCount: evidence.truncatedDatabaseCount,
		activeLegacyWriterCount: evidence.activeLegacyWriterCount,
		legacyWriterGeneration: evidence.legacyWriterGeneration,
		cocoBalanceAmount: evidence.cocoBalanceAmount,
		cocoHistoryCount: evidence.cocoHistoryCount,
		cocoInFlightCount: evidence.cocoInFlightCount,
		cocoOrphanCount: evidence.cocoOrphanCount,
		hostCommandCount: evidence.hostCommandCount,
		authoritativeDatabaseCount: evidence.authoritativeDatabaseCount,
		preexistingAuthoritativeDatabaseCount: evidence.preexistingAuthoritativeDatabaseCount,
		preexistingVaultRecordCount: evidence.preexistingVaultRecordCount,
		plaintextSecretRecordCount: evidence.plaintextSecretRecordCount,
	}
}

function publicEvidencePayload(evidence: Omit<FreshAuctionsdevPreflightEvidence, 'evidenceCommitment'>) {
	return { ...evidence }
}

export async function createFreshAuctionsdevEvidence(
	input: FreshAuctionsdevEvidenceInput,
): Promise<Readonly<FreshAuctionsdevPreflightEvidence>> {
	const identity = createMigrationIdentity(input)
	if (identity.environment !== 'auctionsdev' && identity.environment !== 'test') {
		throw new MigrationSafetyError('INVALID_INPUT', 'fresh wallet preflight is restricted to auctionsdev/test')
	}
	if (!MARKET_COMMIT.test(input.marketCommit))
		throw new MigrationSafetyError('INVALID_INPUT', 'market commit must be a lowercase 40-character Git SHA')
	if (!COMMITMENT.test(input.frozenSnapshotId) || !COMMITMENT.test(input.fakeMintIdentityCommitment)) {
		throw new MigrationSafetyError('INVALID_INPUT', 'preflight snapshot commitments are invalid')
	}
	for (const [field, value] of Object.entries(publicInventory(input)).filter(([field]) => field !== 'frozenSnapshotId')) {
		if (typeof value === 'bigint') {
			if (value < BigInt(0)) throw new MigrationSafetyError('INVALID_INPUT', `${field} must be non-negative`)
		} else if (typeof value === 'number') requireCount(value, field)
		else throw new MigrationSafetyError('INVALID_INPUT', `${field} has an invalid type`)
	}
	requireCount(input.fakeMintCount, 'fakeMintCount')
	requireCount(input.collectedAtMs, 'collectedAtMs')
	const inventoryCommitment = await createCommitment('market-coco-v2-fresh-inventory-v1', publicInventory(input))
	const payload = Object.freeze({
		...identity,
		schemaVersion: FRESH_AUCTIONSDEV_PREFLIGHT_SCHEMA_VERSION,
		profile: FRESH_AUCTIONSDEV_PROFILE,
		marketCommit: input.marketCommit,
		collectedAtMs: input.collectedAtMs,
		fakeMintCount: input.fakeMintCount,
		fakeMintIdentityCommitment: input.fakeMintIdentityCommitment,
		fakeMintIdentityVerified: input.fakeMintIdentityVerified,
		...publicInventory(input),
		vaultRoundTripVerified: input.vaultRoundTripVerified,
		vaultKeyExtractable: input.vaultKeyExtractable,
		inventoryCommitment,
	})
	return Object.freeze({
		...payload,
		evidenceCommitment: await createCommitment('market-coco-v2-fresh-auctionsdev-preflight-v1', payload),
	})
}

export async function evaluateFreshAuctionsdevEvidence(
	evidence: Readonly<FreshAuctionsdevPreflightEvidence>,
	expected?: Readonly<{ marketCommit: string; account: string; environment: string }>,
): Promise<Readonly<FreshAuctionsdevAssessment>> {
	const blockers = new Set<FreshAuctionsdevBlocker>()
	if (evidence.schemaVersion !== 1 || evidence.profile !== FRESH_AUCTIONSDEV_PROFILE) blockers.add('WRONG_PROFILE')
	if (evidence.environment !== 'auctionsdev' && evidence.environment !== 'test') blockers.add('ENVIRONMENT_NOT_ALLOWED')
	if (!MARKET_COMMIT.test(evidence.marketCommit)) blockers.add('MARKET_COMMIT_INVALID')
	try {
		createMigrationIdentity(evidence)
	} catch {
		blockers.add('IDENTITY_MISMATCH')
	}
	if (expected) {
		let account: string | null = null
		let environment: string | null = null
		try {
			account = normalizeAccount(expected.account)
			environment = normalizeEnvironment(expected.environment)
		} catch {
			blockers.add('IDENTITY_MISMATCH')
		}
		if (account !== evidence.account || environment !== evidence.environment || expected.marketCommit !== evidence.marketCommit) {
			blockers.add('IDENTITY_MISMATCH')
		}
	}
	if (!evidence.fakeMintIdentityVerified) blockers.add('FAKE_MINT_UNVERIFIED')
	if (evidence.fakeMintCount === 0) blockers.add('FAKE_MINT_MISSING')
	if (evidence.legacySpendableCount + evidence.legacyReservationCount + evidence.legacyPendingCount > 0)
		blockers.add('LEGACY_INVENTORY_PRESENT')
	if (evidence.legacyAuthorityCount > 0) blockers.add('LEGACY_AUTHORITY_PRESENT')
	if (evidence.auctionRecoveryCount > 0) blockers.add('AUCTION_RECOVERY_PRESENT')
	if (evidence.truncatedStorageCount > 0) blockers.add('TRUNCATED_STORAGE_PRESENT')
	if (evidence.truncatedDatabaseCount > 0) blockers.add('TRUNCATED_DATABASE_PRESENT')
	if (evidence.activeLegacyWriterCount > 0) blockers.add('ACTIVE_LEGACY_WRITER')
	if (evidence.cocoBalanceAmount !== BigInt(0)) blockers.add('COCO_BALANCE_NONZERO')
	if (evidence.cocoHistoryCount > 0) blockers.add('COCO_HISTORY_PRESENT')
	if (evidence.cocoInFlightCount > 0) blockers.add('COCO_IN_FLIGHT')
	if (evidence.cocoOrphanCount > 0) blockers.add('COCO_ORPHAN')
	if (evidence.hostCommandCount > 0) blockers.add('HOST_COMMAND_PRESENT')
	if (evidence.authoritativeDatabaseCount !== 1) blockers.add('AUTHORITATIVE_DATABASE_INVALID')
	if (evidence.preexistingAuthoritativeDatabaseCount > 0 || evidence.preexistingVaultRecordCount > 0) {
		blockers.add('NAMESPACE_NOT_FRESH')
	}
	if (!evidence.vaultRoundTripVerified) blockers.add('VAULT_ROUND_TRIP_FAILED')
	if (evidence.vaultKeyExtractable) blockers.add('VAULT_KEY_EXTRACTABLE')
	if (evidence.plaintextSecretRecordCount > 0) blockers.add('PLAINTEXT_SECRET_PRESENT')
	try {
		const inventoryCommitment = await createCommitment('market-coco-v2-fresh-inventory-v1', publicInventory(evidence))
		const { evidenceCommitment: _persistedCommitment, ...payloadWithoutCommitment } = evidence
		const payload = publicEvidencePayload(payloadWithoutCommitment)
		const evidenceCommitment = await createCommitment('market-coco-v2-fresh-auctionsdev-preflight-v1', payload)
		if (inventoryCommitment !== evidence.inventoryCommitment || evidenceCommitment !== evidence.evidenceCommitment) {
			blockers.add('EVIDENCE_COMMITMENT_INVALID')
		}
	} catch {
		blockers.add('EVIDENCE_COMMITMENT_INVALID')
	}
	return Object.freeze({ allowed: blockers.size === 0, blockers: Object.freeze(Array.from(blockers).sort()) })
}

export async function commitFreshAuctionsdevSelection(
	store: MigrationControlStore,
	identityInput: MigrationIdentity,
	expectedRevision: number,
	evidence: Readonly<FreshAuctionsdevPreflightEvidence>,
) {
	const identity = createMigrationIdentity(identityInput)
	const assessment = await evaluateFreshAuctionsdevEvidence(evidence, {
		marketCommit: evidence.marketCommit,
		account: identity.account,
		environment: identity.environment,
	})
	if (!assessment.allowed)
		throw new MigrationSafetyError('CUTOVER_BLOCKED', `fresh AuctionsDev preflight blocked: ${assessment.blockers.join(',')}`)
	assertSameIdentity(identity, evidence)
	const selectionCommitment = await createCommitment('market-coco-v2-fresh-auctionsdev-selection-v1', {
		namespace: identity.namespace,
		epoch: identity.epoch,
		revision: expectedRevision,
		marketCommit: evidence.marketCommit,
		evidenceCommitment: evidence.evidenceCommitment,
		legacyWriterGeneration: evidence.legacyWriterGeneration,
	})
	const committed = await store.transact(identity.namespace, (record) => {
		assertSameIdentity(identity, record)
		if (getMigrationAuthorityPurpose(record) !== 'FRESH_AUCTIONSDEV_TEST' || record.phase !== 'FRESH_TEST_PREPARING') {
			throw new MigrationSafetyError('INVALID_PHASE', 'fresh-test authority is not preparing')
		}
		if (record.revision !== expectedRevision) throw new MigrationSafetyError('STALE_REVISION', 'fresh-test control revision changed')
		if (record.activeLegacyWriters.length > 0 || record.legacyWriterGeneration !== evidence.legacyWriterGeneration) {
			throw new MigrationSafetyError('CUTOVER_BLOCKED', 'legacy writer fence changed during fresh-test preflight')
		}
		return Object.freeze({
			...record,
			phase: 'FRESH_TEST_COMMITTED' as const,
			revision: record.revision + 1,
			legacyMonetaryMutationAllowed: false,
			cocoCanonical: true,
			freshTestEvidence: evidence,
			freshTestSelectionCommitment: selectionCommitment,
		})
	})
	publishLegacyDisablement({ namespace: committed.namespace, revision: committed.revision })
	return committed
}

export async function rollbackFreshAuctionsdevSelection(
	store: MigrationControlStore,
	identityInput: MigrationIdentity,
	expectedRevision: number,
) {
	const identity = createMigrationIdentity(identityInput)
	return store.transact(identity.namespace, (record) => {
		assertSameIdentity(identity, record)
		if (getMigrationAuthorityPurpose(record) !== 'FRESH_AUCTIONSDEV_TEST' || record.phase !== 'FRESH_TEST_PREPARING') {
			throw new MigrationSafetyError('INVALID_PHASE', 'fresh-test selection can only roll back before commit')
		}
		if (record.revision !== expectedRevision) throw new MigrationSafetyError('STALE_REVISION', 'fresh-test control revision changed')
		return Object.freeze({ ...record, phase: 'FRESH_TEST_ROLLED_BACK' as const, revision: record.revision + 1 })
	})
}
