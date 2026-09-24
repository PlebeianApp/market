import { createCommitment } from '../migration/commitment'
import { createMigrationIdentity, normalizeAccount, parseCanonicalWalletNamespace, requireSafeId } from '../migration/identity'
import { MigrationSafetyError, type CocoRecoveryQuiescenceCertificate, type MigrationIdentity } from '../migration/model'

export type RecoveryStatus = 'PENDING' | 'QUIESCENT' | 'RECOVERED' | 'FAILED' | 'NEEDS_PROTECTED_SEED' | 'BACKUP_VERIFIED'

export interface RecoveryMetadata {
	id: string
	walletNamespace: string
	cocoOperationId: string
	derivationPurpose: string
	derivationVersion: number
	derivationReference: string
	publicKey: string
	auctionBinding?: Readonly<{
		auctionId: string
		bidEventId?: string
		sellerPubkey?: string
	}>
	publicConditionFingerprint: string
	status: RecoveryStatus
	updatedAtMs: number
}

export interface RecoveryMetadataStore {
	get(walletNamespace: string, id: string): Promise<Readonly<RecoveryMetadata> | null>
	list(walletNamespace: string): Promise<readonly Readonly<RecoveryMetadata>[]>
	put(metadata: Readonly<RecoveryMetadata>): Promise<void>
}

export interface ProtectedRecoveryAuthority {
	readonly providerReference: string
	derivePublicKey(derivationReference: string): Promise<string>
	signRecoveryChallenge(derivationReference: string, challenge: Uint8Array): Promise<Uint8Array>
}

/**
 * The provider owns seed custody. Market receives a scoped authority callback,
 * never seed bytes or an exportable private key.
 */
export interface OpaqueProtectedWalletSeedProvider {
	withProtectedAuthority<T>(purpose: string, use: (authority: ProtectedRecoveryAuthority) => Promise<T>): Promise<T>
}

export interface HistoricalP2pkAuthorityRecovery {
	recoverPublicAuthority(input: {
		walletNamespace: string
		derivationPurpose: string
		derivationVersion: number
		derivationReference: string
		expectedPublicKey: string
	}): Promise<Readonly<{ publicKey: string; conditionFingerprint: string; providerReference: string }>>
}

export interface BackupRestoreVerifier {
	verifyBackupRestore(input: {
		walletNamespace: string
		expectedPublicKeys: readonly string[]
		expectedAuthorityGeneration: number
	}): Promise<Readonly<{ restoredPublicKeys: readonly string[]; authorityGeneration: number; verificationId: string }>>
}

export interface RecoveryOperationProjection {
	operationId: string
	status: 'QUIESCENT' | 'COMPLETED' | 'PENDING' | 'EXECUTING' | 'AMBIGUOUS' | 'ORPHANED'
	publicConditionFingerprint: string
}

const ALLOWED_ROOT_FIELDS = new Set([
	'id',
	'walletNamespace',
	'cocoOperationId',
	'derivationPurpose',
	'derivationVersion',
	'derivationReference',
	'publicKey',
	'auctionBinding',
	'publicConditionFingerprint',
	'status',
	'updatedAtMs',
])
const ALLOWED_AUCTION_FIELDS = new Set(['auctionId', 'bidEventId', 'sellerPubkey'])
const PUBLIC_KEY = /^(?:[0-9a-f]{64}|0[23][0-9a-f]{64})$/
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/

function assertPlainObject(value: unknown, allowed: ReadonlySet<string>, label: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new MigrationSafetyError('INVALID_INPUT', `${label} must be a plain object`)
	}
	const keys = Reflect.ownKeys(value)
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new MigrationSafetyError('INVALID_INPUT', `${label} contains forbidden fields`)
	}
}

function requirePublicKey(value: unknown): string {
	if (typeof value !== 'string' || !PUBLIC_KEY.test(value.toLowerCase())) {
		throw new MigrationSafetyError('INVALID_INPUT', 'recovery public key is invalid')
	}
	return value.toLowerCase()
}

function requireStatus(value: unknown): RecoveryStatus {
	if (
		value === 'PENDING' ||
		value === 'QUIESCENT' ||
		value === 'RECOVERED' ||
		value === 'FAILED' ||
		value === 'NEEDS_PROTECTED_SEED' ||
		value === 'BACKUP_VERIFIED'
	) {
		return value
	}
	throw new MigrationSafetyError('INVALID_INPUT', 'recovery status is invalid')
}

export function createRecoveryMetadata(input: unknown): Readonly<RecoveryMetadata> {
	assertPlainObject(input, ALLOWED_ROOT_FIELDS, 'recovery metadata')
	const derivationVersion = input.derivationVersion
	const updatedAtMs = input.updatedAtMs
	if (!Number.isSafeInteger(derivationVersion) || (derivationVersion as number) < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', 'derivation version is invalid')
	}
	if (!Number.isSafeInteger(updatedAtMs) || (updatedAtMs as number) < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', 'recovery update time is invalid')
	}
	let auctionBinding: RecoveryMetadata['auctionBinding']
	if (input.auctionBinding !== undefined) {
		assertPlainObject(input.auctionBinding, ALLOWED_AUCTION_FIELDS, 'auction binding')
		auctionBinding = Object.freeze({
			auctionId: requireSafeId(input.auctionBinding.auctionId, 'auctionId'),
			...(input.auctionBinding.bidEventId ? { bidEventId: requireSafeId(input.auctionBinding.bidEventId, 'bidEventId') } : {}),
			...(input.auctionBinding.sellerPubkey ? { sellerPubkey: normalizeAccount(input.auctionBinding.sellerPubkey) } : {}),
		})
	}
	if (typeof input.publicConditionFingerprint !== 'string' || !FINGERPRINT.test(input.publicConditionFingerprint)) {
		throw new MigrationSafetyError('INVALID_INPUT', 'public condition fingerprint is invalid')
	}
	const walletNamespace = requireSafeId(input.walletNamespace, 'walletNamespace')
	parseCanonicalWalletNamespace(walletNamespace)
	return Object.freeze({
		id: requireSafeId(input.id, 'recovery metadata id'),
		walletNamespace,
		cocoOperationId: requireSafeId(input.cocoOperationId, 'cocoOperationId'),
		derivationPurpose: requireSafeId(input.derivationPurpose, 'derivationPurpose'),
		derivationVersion: derivationVersion as number,
		derivationReference: requireSafeId(input.derivationReference, 'derivationReference'),
		publicKey: requirePublicKey(input.publicKey),
		...(auctionBinding ? { auctionBinding } : {}),
		publicConditionFingerprint: input.publicConditionFingerprint,
		status: requireStatus(input.status),
		updatedAtMs: updatedAtMs as number,
	})
}

export async function createRecoveryQuiescenceCertificate(
	identityInput: MigrationIdentity,
	authorityGeneration: number,
	operations: readonly RecoveryOperationProjection[],
	certificateId: string,
	issuedAtMs = Date.now(),
): Promise<Readonly<CocoRecoveryQuiescenceCertificate>> {
	const identity = createMigrationIdentity(identityInput)
	if (!Number.isSafeInteger(authorityGeneration) || authorityGeneration < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', 'authority generation is invalid')
	}
	if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', 'certificate time is invalid')
	}
	const normalizedOperations = operations.map((operation) => {
		if (operation.status !== 'QUIESCENT' && operation.status !== 'COMPLETED') {
			throw new MigrationSafetyError('CUTOVER_BLOCKED', `Coco recovery operation ${operation.operationId} is not quiescent`)
		}
		if (!FINGERPRINT.test(operation.publicConditionFingerprint)) {
			throw new MigrationSafetyError('INVALID_INPUT', 'recovery condition fingerprint is invalid')
		}
		return Object.freeze({
			operationId: requireSafeId(operation.operationId, 'operationId'),
			status: operation.status,
			publicConditionFingerprint: operation.publicConditionFingerprint,
		})
	})
	const payload = {
		...identity,
		certificateId: requireSafeId(certificateId, 'certificateId'),
		authorityGeneration,
		issuedAtMs,
		operations: normalizedOperations,
	}
	return Object.freeze({
		...identity,
		certificateId: payload.certificateId,
		authorityGeneration,
		issuedAtMs,
		operations: Object.freeze(normalizedOperations),
		commitment: await createCommitment('market-coco-v2-recovery-quiescence-v1', payload),
	})
}

export async function verifyRecoveryQuiescenceCertificate(certificate: CocoRecoveryQuiescenceCertificate): Promise<void> {
	const identity = createMigrationIdentity(certificate)
	if (
		!Number.isSafeInteger(certificate.authorityGeneration) ||
		certificate.authorityGeneration < 0 ||
		!Number.isSafeInteger(certificate.issuedAtMs) ||
		certificate.issuedAtMs < 0
	) {
		throw new MigrationSafetyError('INVALID_INPUT', 'recovery certificate version is invalid')
	}
	const operations = certificate.operations.map((operation) => {
		if (operation.status !== 'QUIESCENT' && operation.status !== 'COMPLETED') {
			throw new MigrationSafetyError('CUTOVER_BLOCKED', 'recovery certificate contains a non-quiescent operation')
		}
		if (!FINGERPRINT.test(operation.publicConditionFingerprint)) {
			throw new MigrationSafetyError('INVALID_INPUT', 'recovery certificate fingerprint is invalid')
		}
		return Object.freeze({
			operationId: requireSafeId(operation.operationId, 'operationId'),
			status: operation.status,
			publicConditionFingerprint: operation.publicConditionFingerprint,
		})
	})
	const commitment = await createCommitment('market-coco-v2-recovery-quiescence-v1', {
		...identity,
		certificateId: requireSafeId(certificate.certificateId, 'certificateId'),
		authorityGeneration: certificate.authorityGeneration,
		issuedAtMs: certificate.issuedAtMs,
		operations,
	})
	if (commitment !== certificate.commitment) {
		throw new MigrationSafetyError('INVALID_INPUT', 'recovery certificate commitment does not match')
	}
}

export class InMemoryRecoveryMetadataStore implements RecoveryMetadataStore {
	private readonly records = new Map<string, RecoveryMetadata>()

	async get(walletNamespace: string, id: string): Promise<Readonly<RecoveryMetadata> | null> {
		const namespace = requireSafeId(walletNamespace, 'walletNamespace')
		parseCanonicalWalletNamespace(namespace)
		const record = this.records.get(JSON.stringify([namespace, requireSafeId(id, 'recovery metadata id')]))
		return record ? createRecoveryMetadata(structuredClone(record)) : null
	}

	async list(walletNamespace: string): Promise<readonly Readonly<RecoveryMetadata>[]> {
		const namespace = requireSafeId(walletNamespace, 'walletNamespace')
		return Object.freeze(
			Array.from(this.records.values())
				.filter((record) => record.walletNamespace === namespace)
				.map((record) => createRecoveryMetadata(structuredClone(record))),
		)
	}

	async put(metadata: Readonly<RecoveryMetadata>): Promise<void> {
		const normalized = createRecoveryMetadata(metadata)
		this.records.set(JSON.stringify([normalized.walletNamespace, normalized.id]), structuredClone(normalized))
	}
}
