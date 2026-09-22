import { createCommitment } from './commitment'
import { verifyAccountingReport } from './accounting'
import { evaluateCutover, assertPhaseTransition } from './cutover'
import { assertSameIdentity, createMigrationIdentity, requireSafeId } from './identity'
import { verifyInventorySeal } from './inventory'
import { verifyRecoveryQuiescenceCertificate } from '../recovery/metadata'
import { publishLegacyDisablement } from './legacyDisableSignal'
import {
	MigrationSafetyError,
	type AccountingReport,
	type CocoRecoveryQuiescenceCertificate,
	type CutoverExpectedState,
	type InventorySeal,
	type LegacyQuiescenceCertificate,
	type LegacyWriterLease,
	type MigrationControlRecord,
	type MigrationIdentity,
	type MigrationPhase,
} from './model'

export interface MigrationControlStore {
	get(namespace: string): Promise<Readonly<MigrationControlRecord> | null>
	create(record: Readonly<MigrationControlRecord>): Promise<Readonly<MigrationControlRecord>>
	transact(
		namespace: string,
		mutator: (current: Readonly<MigrationControlRecord>) => Readonly<MigrationControlRecord>,
	): Promise<Readonly<MigrationControlRecord>>
}

const FORBIDDEN_MIGRATION_FIELD = /(seed|private.?key|refund.?private|proofs?|witness|bearer|token|nwc.?uri)/i

export function assertMetadataOnly(value: unknown, path = 'record'): void {
	if (value === null || typeof value !== 'object') return
	if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
		throw new MigrationSafetyError('INVALID_INPUT', `migration storage forbids binary material at ${path}`)
	}
	if (Array.isArray(value)) {
		value.forEach((entry, index) => assertMetadataOnly(entry, `${path}[${index}]`))
		return
	}
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (FORBIDDEN_MIGRATION_FIELD.test(key)) {
			throw new MigrationSafetyError('INVALID_INPUT', `migration storage forbids sensitive field ${path}.${key}`)
		}
		assertMetadataOnly(entry, `${path}.${key}`)
	}
}

const IDENTITY_FIELDS = ['namespace', 'account', 'environment', 'epoch'] as const
const ROOT_FIELDS = [
	...IDENTITY_FIELDS,
	'phase',
	'revision',
	'inventorySeal',
	'accountingReport',
	'lateDiscoveryIds',
	'activeLegacyWriters',
	'legacyWriterGeneration',
	'legacyQuiescenceCertificate',
	'orphanCocoOperationIds',
	'unboundHostCommandIds',
	'cocoAuthorityGeneration',
	'recoveryQuiescenceCertificate',
	'legacyMonetaryMutationAllowed',
	'cocoCanonical',
	'boundCocoGeneration',
	'cutoverEvidenceCommitment',
] as const
const INVENTORY_FIELDS = [
	...IDENTITY_FIELDS,
	'sealedAtRevision',
	'sealedAtMs',
	'itemCount',
	'commitment',
	'completions',
	'items',
	'lateDiscoveries',
] as const
const COMPLETION_FIELDS = [
	...IDENTITY_FIELDS,
	'source',
	'sourceSchema',
	'sourceVersion',
	'snapshotId',
	'itemCount',
	'inventoryCommitment',
	'completedAtMs',
] as const
const ITEM_FIELDS = [
	'sourceId',
	'source',
	'mint',
	'unit',
	'amount',
	'state',
	'accountAttribution',
	'attributionReason',
	'legacyAuthorityRetained',
	'uncertainRemoteEffect',
	'unresolvedP2pkRecovery',
	'cocoOperationId',
	'hostCommandId',
	'hostCommandBoundOperationId',
] as const
const ACCOUNTING_FIELDS = [
	...IDENTITY_FIELDS,
	'commitment',
	'reconciled',
	'buckets',
	'sourceCount',
	'dispositions',
	'destinations',
	'failureReasons',
] as const
const BUCKET_FIELDS = [
	'mint',
	'unit',
	'openingCocoAmount',
	'verifiedMigratedSourceAmount',
	'verifiedCocoDestinationAmount',
	'verifiedConsumedAmount',
	'verifiedFeeAmount',
	'delta',
] as const
const DISPOSITION_FIELDS = [
	'sourceId',
	'disposition',
	'mint',
	'unit',
	'sourceAmount',
	'destinationAmount',
	'consumedAmount',
	'feeAmount',
	'destinationId',
	'cocoOperationId',
	'evidenceId',
	'evidenceCommitment',
] as const
const DESTINATION_FIELDS = ['mint', 'unit', 'amount', 'authorityGeneration', 'snapshotId', 'evidenceCommitment'] as const
const LEASE_FIELDS = ['leaseId', 'writerId', 'operationId', 'startedAtMs', 'controlRevision'] as const
const LEGACY_CERTIFICATE_FIELDS = [
	...IDENTITY_FIELDS,
	'certificateId',
	'writerGeneration',
	'inventoryCommitment',
	'issuedAtMs',
	'commitment',
] as const
const RECOVERY_CERTIFICATE_FIELDS = [
	...IDENTITY_FIELDS,
	'certificateId',
	'authorityGeneration',
	'issuedAtMs',
	'operations',
	'commitment',
] as const
const RECOVERY_OPERATION_FIELDS = ['operationId', 'status', 'publicConditionFingerprint'] as const

function assertKnownObjectFields(
	value: unknown,
	allowedFields: readonly string[],
	label: string,
): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new MigrationSafetyError('INVALID_INPUT', `${label} must be a plain data object`)
	}
	const allowed = new Set(allowedFields)
	if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new MigrationSafetyError('INVALID_INPUT', `${label} contains undeclared fields`)
	}
}

function requireArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new MigrationSafetyError('INVALID_INPUT', `${label} must be an array`)
	return value
}

export function assertMigrationControlRecordShape(value: unknown): asserts value is MigrationControlRecord {
	assertMetadataOnly(value)
	assertKnownObjectFields(value, ROOT_FIELDS, 'migration control record')
	if (value.inventorySeal !== null) {
		assertKnownObjectFields(value.inventorySeal, INVENTORY_FIELDS, 'inventory seal')
		for (const completion of requireArray(value.inventorySeal.completions, 'inventory completions')) {
			assertKnownObjectFields(completion, COMPLETION_FIELDS, 'inventory completion')
		}
		for (const item of requireArray(value.inventorySeal.items, 'inventory items')) {
			assertKnownObjectFields(item, ITEM_FIELDS, 'inventory item')
		}
		requireArray(value.inventorySeal.lateDiscoveries, 'inventory late discoveries')
	}
	if (value.accountingReport !== null) {
		assertKnownObjectFields(value.accountingReport, ACCOUNTING_FIELDS, 'accounting report')
		for (const bucket of requireArray(value.accountingReport.buckets, 'accounting buckets')) {
			assertKnownObjectFields(bucket, BUCKET_FIELDS, 'accounting bucket')
		}
		for (const disposition of requireArray(value.accountingReport.dispositions, 'accounting dispositions')) {
			assertKnownObjectFields(disposition, DISPOSITION_FIELDS, 'accounting disposition')
		}
		for (const destination of requireArray(value.accountingReport.destinations, 'accounting destinations')) {
			assertKnownObjectFields(destination, DESTINATION_FIELDS, 'accounting destination')
		}
		requireArray(value.accountingReport.failureReasons, 'accounting failure reasons')
	}
	for (const lease of requireArray(value.activeLegacyWriters, 'active legacy writers')) {
		assertKnownObjectFields(lease, LEASE_FIELDS, 'legacy writer lease')
	}
	if (value.legacyQuiescenceCertificate !== null) {
		assertKnownObjectFields(value.legacyQuiescenceCertificate, LEGACY_CERTIFICATE_FIELDS, 'legacy quiescence certificate')
	}
	if (value.recoveryQuiescenceCertificate !== null) {
		assertKnownObjectFields(value.recoveryQuiescenceCertificate, RECOVERY_CERTIFICATE_FIELDS, 'recovery quiescence certificate')
		for (const operation of requireArray(value.recoveryQuiescenceCertificate.operations, 'recovery operations')) {
			assertKnownObjectFields(operation, RECOVERY_OPERATION_FIELDS, 'recovery operation')
		}
	}
	requireArray(value.lateDiscoveryIds, 'late discovery ids')
	requireArray(value.orphanCocoOperationIds, 'orphan Coco operation ids')
	requireArray(value.unboundHostCommandIds, 'unbound Host command ids')
}

function cloneRecord<T>(value: T): T {
	return structuredClone(value)
}

export class InMemoryMigrationControlStore implements MigrationControlStore {
	private readonly records: Map<string, MigrationControlRecord>
	private queue: Promise<void> = Promise.resolve()

	constructor(records: readonly MigrationControlRecord[] = []) {
		records.forEach((record) => assertMigrationControlRecordShape(record))
		this.records = new Map(records.map((record) => [record.namespace, cloneRecord(record)]))
	}

	async get(namespace: string): Promise<Readonly<MigrationControlRecord> | null> {
		const record = this.records.get(namespace)
		return record ? Object.freeze(cloneRecord(record)) : null
	}

	async create(record: Readonly<MigrationControlRecord>): Promise<Readonly<MigrationControlRecord>> {
		return this.exclusive(() => {
			assertMigrationControlRecordShape(record)
			if (this.records.has(record.namespace)) throw new MigrationSafetyError('STORAGE_FAILURE', 'control record already exists')
			const stored = cloneRecord(record)
			this.records.set(record.namespace, stored)
			return Object.freeze(cloneRecord(stored))
		})
	}

	async transact(
		namespace: string,
		mutator: (current: Readonly<MigrationControlRecord>) => Readonly<MigrationControlRecord>,
	): Promise<Readonly<MigrationControlRecord>> {
		return this.exclusive(() => {
			const current = this.records.get(namespace)
			if (!current) throw new MigrationSafetyError('STORAGE_FAILURE', 'control record does not exist')
			const next = cloneRecord(mutator(Object.freeze(cloneRecord(current))))
			assertMigrationControlRecordShape(next)
			if (next.namespace !== namespace) throw new MigrationSafetyError('STORAGE_FAILURE', 'transaction changed record namespace')
			this.records.set(namespace, next)
			return Object.freeze(cloneRecord(next))
		})
	}

	private async exclusive<T>(operation: () => T): Promise<T> {
		let release!: () => void
		const previous = this.queue
		this.queue = new Promise<void>((resolve) => {
			release = resolve
		})
		await previous
		try {
			return operation()
		} finally {
			release()
		}
	}
}

export function createInitialControlRecord(identityInput: MigrationIdentity): Readonly<MigrationControlRecord> {
	const identity = createMigrationIdentity(identityInput)
	return Object.freeze({
		...identity,
		phase: 'LEGACY_ACTIVE',
		revision: 0,
		inventorySeal: null,
		accountingReport: null,
		lateDiscoveryIds: Object.freeze([]),
		activeLegacyWriters: Object.freeze([]),
		legacyWriterGeneration: 0,
		legacyQuiescenceCertificate: null,
		orphanCocoOperationIds: Object.freeze([]),
		unboundHostCommandIds: Object.freeze([]),
		cocoAuthorityGeneration: null,
		recoveryQuiescenceCertificate: null,
		legacyMonetaryMutationAllowed: true,
		cocoCanonical: false,
		boundCocoGeneration: null,
		cutoverEvidenceCommitment: null,
	})
}

function assertExpected(record: MigrationControlRecord, identity: MigrationIdentity, expectedRevision: number): void {
	if (record.epoch !== identity.epoch) throw new MigrationSafetyError('STALE_EPOCH', 'migration epoch is stale')
	assertSameIdentity(identity, record)
	if (record.revision !== expectedRevision) throw new MigrationSafetyError('STALE_REVISION', 'migration control revision is stale')
}

export async function transitionMigrationPhase(
	store: MigrationControlStore,
	identity: MigrationIdentity,
	expectedRevision: number,
	nextPhase: MigrationPhase,
): Promise<Readonly<MigrationControlRecord>> {
	return store.transact(identity.namespace, (record) => {
		assertExpected(record, identity, expectedRevision)
		assertPhaseTransition(record.phase, nextPhase)
		return Object.freeze({ ...record, phase: nextPhase, revision: record.revision + 1 })
	})
}

export interface ReadinessEvidenceUpdate {
	inventorySeal: InventorySeal
	accountingReport: AccountingReport
	cocoAuthorityGeneration: number
	recoveryQuiescenceCertificate: CocoRecoveryQuiescenceCertificate
	legacyQuiescenceCertificate: LegacyQuiescenceCertificate
	orphanCocoOperationIds?: readonly string[]
	unboundHostCommandIds?: readonly string[]
}

export async function installReadinessEvidence(
	store: MigrationControlStore,
	identity: MigrationIdentity,
	expectedRevision: number,
	update: ReadinessEvidenceUpdate,
): Promise<Readonly<MigrationControlRecord>> {
	const preflight = await store.get(identity.namespace)
	if (!preflight) throw new MigrationSafetyError('STORAGE_FAILURE', 'control record does not exist')
	assertExpected(preflight, identity, expectedRevision)
	await verifyInventorySeal(update.inventorySeal)
	await verifyAccountingReport(update.inventorySeal, update.accountingReport)
	await verifyRecoveryQuiescenceCertificate(update.recoveryQuiescenceCertificate)
	await verifyLegacyQuiescenceCertificate(
		update.legacyQuiescenceCertificate,
		identity,
		update.inventorySeal.commitment,
		preflight.legacyWriterGeneration,
		preflight.activeLegacyWriters.length,
	)
	if (update.accountingReport.destinations.some((destination) => destination.authorityGeneration !== update.cocoAuthorityGeneration)) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'Coco destination evidence is bound to another authority generation')
	}
	return store.transact(identity.namespace, (record) => {
		assertExpected(record, identity, expectedRevision)
		assertSameIdentity(record, update.inventorySeal)
		assertSameIdentity(record, update.accountingReport)
		assertSameIdentity(record, update.recoveryQuiescenceCertificate)
		assertSameIdentity(record, update.legacyQuiescenceCertificate)
		if (!Number.isSafeInteger(update.cocoAuthorityGeneration) || update.cocoAuthorityGeneration < 0) {
			throw new MigrationSafetyError('INVALID_INPUT', 'Coco authority generation is invalid')
		}
		if (update.recoveryQuiescenceCertificate.authorityGeneration !== update.cocoAuthorityGeneration) {
			throw new MigrationSafetyError('IDENTITY_MISMATCH', 'recovery certificate is bound to another Coco generation')
		}
		return Object.freeze({
			...record,
			revision: record.revision + 1,
			inventorySeal: update.inventorySeal,
			accountingReport: update.accountingReport,
			cocoAuthorityGeneration: update.cocoAuthorityGeneration,
			recoveryQuiescenceCertificate: update.recoveryQuiescenceCertificate,
			legacyQuiescenceCertificate: update.legacyQuiescenceCertificate,
			orphanCocoOperationIds: Object.freeze((update.orphanCocoOperationIds ?? []).map((id) => requireSafeId(id, 'operationId'))),
			unboundHostCommandIds: Object.freeze((update.unboundHostCommandIds ?? []).map((id) => requireSafeId(id, 'commandId'))),
		})
	})
}

export interface BeginLegacyMutationInput {
	identity: MigrationIdentity
	expectedRevision: number
	leaseId: string
	writerId: string
	operationId: string
	startedAtMs?: number
}

export async function beginLegacyMonetaryMutation(
	store: MigrationControlStore,
	input: BeginLegacyMutationInput,
): Promise<Readonly<LegacyWriterLease>> {
	let lease!: Readonly<LegacyWriterLease>
	await store.transact(input.identity.namespace, (record) => {
		if (record.epoch !== input.identity.epoch) throw new MigrationSafetyError('STALE_EPOCH', 'migration epoch is stale')
		assertSameIdentity(input.identity, record)
		if (!record.legacyMonetaryMutationAllowed || record.phase === 'CUTOVER_COMMITTED') {
			throw new MigrationSafetyError('LEGACY_WRITER_DISABLED', 'legacy monetary mutation is disabled')
		}
		if (record.revision !== input.expectedRevision) {
			throw new MigrationSafetyError('STALE_REVISION', 'migration control revision is stale')
		}
		const startedAtMs = input.startedAtMs ?? Date.now()
		if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
			throw new MigrationSafetyError('INVALID_INPUT', 'legacy writer start time is invalid')
		}
		lease = Object.freeze({
			leaseId: requireSafeId(input.leaseId, 'leaseId'),
			writerId: requireSafeId(input.writerId, 'writerId'),
			operationId: requireSafeId(input.operationId, 'operationId'),
			startedAtMs,
			controlRevision: record.revision + 1,
		})
		if (record.activeLegacyWriters.some((active) => active.leaseId === lease.leaseId || active.operationId === lease.operationId)) {
			throw new MigrationSafetyError('INVALID_INPUT', 'legacy writer lease identity already exists')
		}
		return Object.freeze({
			...record,
			revision: record.revision + 1,
			activeLegacyWriters: Object.freeze([...record.activeLegacyWriters, lease]),
			legacyWriterGeneration: record.legacyWriterGeneration + 1,
		})
	})
	return lease
}

export async function endLegacyMonetaryMutation(
	store: MigrationControlStore,
	identity: MigrationIdentity,
	leaseId: string,
): Promise<Readonly<MigrationControlRecord>> {
	const normalizedLeaseId = requireSafeId(leaseId, 'leaseId')
	return store.transact(identity.namespace, (record) => {
		assertSameIdentity(identity, record)
		if (!record.activeLegacyWriters.some((lease) => lease.leaseId === normalizedLeaseId)) {
			throw new MigrationSafetyError('LEASE_NOT_FOUND', 'legacy writer lease does not exist')
		}
		return Object.freeze({
			...record,
			revision: record.revision + 1,
			activeLegacyWriters: Object.freeze(record.activeLegacyWriters.filter((lease) => lease.leaseId !== normalizedLeaseId)),
			legacyWriterGeneration: record.legacyWriterGeneration + 1,
		})
	})
}

export async function recordLateInventoryDiscovery(
	store: MigrationControlStore,
	identity: MigrationIdentity,
	expectedRevision: number,
	sourceId: string,
): Promise<Readonly<MigrationControlRecord>> {
	const normalizedSourceId = requireSafeId(sourceId, 'sourceId')
	return store.transact(identity.namespace, (record) => {
		assertExpected(record, identity, expectedRevision)
		if (!record.inventorySeal) throw new MigrationSafetyError('LATE_DISCOVERY', 'no sealed inventory exists to invalidate')
		if (record.inventorySeal.items.some((item) => item.sourceId === normalizedSourceId)) return record
		if (record.lateDiscoveryIds.includes(normalizedSourceId)) return record
		return Object.freeze({
			...record,
			revision: record.revision + 1,
			lateDiscoveryIds: Object.freeze(Array.from(new Set([...record.lateDiscoveryIds, normalizedSourceId])).sort()),
			inventorySeal: Object.freeze({
				...record.inventorySeal,
				lateDiscoveries: Object.freeze(Array.from(new Set([...record.inventorySeal.lateDiscoveries, normalizedSourceId])).sort()),
			}),
		})
	})
}

export async function commitCutover(
	store: MigrationControlStore,
	expected: CutoverExpectedState,
): Promise<Readonly<MigrationControlRecord>> {
	const preflight = await store.get(expected.namespace)
	if (!preflight) throw new MigrationSafetyError('STORAGE_FAILURE', 'control record does not exist')
	assertExpected(preflight, expected, expected.revision)
	if (!preflight.inventorySeal || !preflight.accountingReport || !preflight.recoveryQuiescenceCertificate) {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'cutover evidence is incomplete')
	}
	await verifyInventorySeal(preflight.inventorySeal)
	await verifyAccountingReport(preflight.inventorySeal, preflight.accountingReport)
	await verifyRecoveryQuiescenceCertificate(preflight.recoveryQuiescenceCertificate)
	if (!preflight.legacyQuiescenceCertificate) {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'legacy quiescence evidence is incomplete')
	}
	await verifyLegacyQuiescenceCertificate(
		preflight.legacyQuiescenceCertificate,
		preflight,
		preflight.inventorySeal.commitment,
		preflight.legacyWriterGeneration,
		preflight.activeLegacyWriters.length,
	)
	const immutableEvidenceCommitment = await createCommitment('market-coco-v2-cutover-commit-v1', expected)
	const committed = await store.transact(expected.namespace, (record) => {
		assertExpected(record, expected, expected.revision)
		if (record.phase !== expected.phase) throw new MigrationSafetyError('INVALID_PHASE', 'cutover phase changed')
		if (record.inventorySeal?.commitment !== expected.inventoryCommitment) {
			throw new MigrationSafetyError('STALE_REVISION', 'inventory commitment changed')
		}
		if (record.accountingReport?.commitment !== expected.accountingCommitment) {
			throw new MigrationSafetyError('STALE_REVISION', 'accounting evidence changed')
		}
		if (record.cocoAuthorityGeneration !== expected.cocoAuthorityGeneration) {
			throw new MigrationSafetyError('STALE_REVISION', 'Coco authority generation changed')
		}
		if (record.recoveryQuiescenceCertificate?.commitment !== expected.recoveryQuiescenceCommitment) {
			throw new MigrationSafetyError('STALE_REVISION', 'recovery quiescence evidence changed')
		}
		if (record.legacyQuiescenceCertificate?.commitment !== expected.legacyQuiescenceCommitment) {
			throw new MigrationSafetyError('STALE_REVISION', 'legacy quiescence evidence changed')
		}
		const assessment = evaluateCutover(record)
		if (!assessment.allowed) {
			throw new MigrationSafetyError('CUTOVER_BLOCKED', `cutover blocked: ${assessment.blockers.join(',')}`)
		}
		return Object.freeze({
			...record,
			phase: 'CUTOVER_COMMITTED',
			revision: record.revision + 1,
			legacyMonetaryMutationAllowed: false,
			cocoCanonical: true,
			boundCocoGeneration: expected.cocoAuthorityGeneration,
			cutoverEvidenceCommitment: immutableEvidenceCommitment,
		})
	})
	publishLegacyDisablement({ namespace: committed.namespace, revision: committed.revision })
	return committed
}

export async function createLegacyQuiescenceCertificate(
	record: Readonly<MigrationControlRecord>,
	inventory: InventorySeal,
	certificateId: string,
	issuedAtMs = Date.now(),
): Promise<Readonly<LegacyQuiescenceCertificate>> {
	assertSameIdentity(record, inventory)
	if (record.activeLegacyWriters.length > 0) {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'legacy writers are still active')
	}
	if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) {
		throw new MigrationSafetyError('INVALID_INPUT', 'legacy certificate time is invalid')
	}
	const payload = {
		namespace: record.namespace,
		account: record.account,
		environment: record.environment,
		epoch: record.epoch,
		certificateId: requireSafeId(certificateId, 'certificateId'),
		writerGeneration: record.legacyWriterGeneration,
		inventoryCommitment: inventory.commitment,
		issuedAtMs,
	}
	return Object.freeze({
		...payload,
		commitment: await createCommitment('market-coco-v2-legacy-quiescence-v1', payload),
	})
}

export async function verifyLegacyQuiescenceCertificate(
	certificate: LegacyQuiescenceCertificate,
	identity: MigrationIdentity,
	inventoryCommitment: string,
	writerGeneration: number,
	activeWriterCount: number,
): Promise<void> {
	assertSameIdentity(identity, certificate)
	if (
		!Number.isSafeInteger(certificate.writerGeneration) ||
		certificate.writerGeneration < 0 ||
		!Number.isSafeInteger(certificate.issuedAtMs) ||
		certificate.issuedAtMs < 0
	) {
		throw new MigrationSafetyError('INVALID_INPUT', 'legacy certificate version is invalid')
	}
	if (activeWriterCount !== 0 || certificate.writerGeneration !== writerGeneration) {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'legacy writer fence is not quiescent')
	}
	if (certificate.inventoryCommitment !== inventoryCommitment) {
		throw new MigrationSafetyError('IDENTITY_MISMATCH', 'legacy certificate is bound to another inventory')
	}
	const payload = {
		namespace: certificate.namespace,
		account: certificate.account,
		environment: certificate.environment,
		epoch: certificate.epoch,
		certificateId: requireSafeId(certificate.certificateId, 'certificateId'),
		writerGeneration: certificate.writerGeneration,
		inventoryCommitment: certificate.inventoryCommitment,
		issuedAtMs: certificate.issuedAtMs,
	}
	const commitment = await createCommitment('market-coco-v2-legacy-quiescence-v1', payload)
	if (commitment !== certificate.commitment) {
		throw new MigrationSafetyError('INVALID_INPUT', 'legacy certificate commitment does not match')
	}
}
