import { buildCanonicalWalletNamespace, normalizeAccount, normalizeEnvironment, requireSafeId } from './identity'
import { IndexedDbMigrationControlStore } from './indexedDbStore'
import { MigrationSafetyError, type MigrationEnvironment, type MigrationIdentity } from './model'
import type { MigrationControlStore } from './store'
import { runLegacyMonetaryMutation } from './legacyGate'

export interface RuntimeLegacyMutationContext {
	account: string
	environment: MigrationEnvironment
	writerId: string
	operationId?: string
}

let browserControlStore: IndexedDbMigrationControlStore | null = null

function operationId(writerId: string): string {
	const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
	return requireSafeId(`${writerId}:${suffix}`, 'operationId')
}

function identityFromRecord(record: MigrationIdentity): MigrationIdentity {
	return {
		namespace: record.namespace,
		account: record.account,
		environment: record.environment,
		epoch: record.epoch,
	}
}

/**
 * Resolves the durable control record for every call. No authority decision is
 * cached, so a runtime opened before cutover observes a later committed fence.
 */
export async function runLegacyMutationAgainstControlStore<T>(
	store: MigrationControlStore,
	context: RuntimeLegacyMutationContext,
	mutation: () => Promise<T>,
): Promise<T> {
	const account = normalizeAccount(context.account)
	const environment = normalizeEnvironment(context.environment)
	const namespace = buildCanonicalWalletNamespace({ account, environment })
	const record = await store.get(namespace)
	if (!record) return mutation()
	return runLegacyMonetaryMutation(
		store,
		{
			identity: identityFromRecord(record),
			leaseId: operationId('lease'),
			writerId: requireSafeId(context.writerId, 'writerId'),
			operationId: context.operationId ? requireSafeId(context.operationId, 'operationId') : operationId(context.writerId),
		},
		mutation,
	)
}

/**
 * Browser integration for maintained legacy wallet writers. Production and
 * staging fail closed when IndexedDB is unavailable; development/test remain
 * usable in non-browser unit environments where no cutover database exists.
 */
export async function runBrowserLegacyMonetaryMutation<T>(context: RuntimeLegacyMutationContext, mutation: () => Promise<T>): Promise<T> {
	const environment = normalizeEnvironment(context.environment)
	if (typeof indexedDB === 'undefined') {
		if (environment === 'production' || environment === 'staging') {
			throw new MigrationSafetyError('STORAGE_FAILURE', 'legacy monetary authority cannot be verified because IndexedDB is unavailable')
		}
		return mutation()
	}
	browserControlStore ??= new IndexedDbMigrationControlStore()
	return runLegacyMutationAgainstControlStore(browserControlStore, { ...context, environment }, mutation)
}

/**
 * Direct Coco writers are fenced while a migration control record exists but
 * has not committed Coco as canonical. They do not acquire a legacy lease
 * after cutover because they are then the selected authority.
 */
export async function runCocoMutationAgainstControlStore<T>(
	store: MigrationControlStore,
	context: Pick<RuntimeLegacyMutationContext, 'account' | 'environment'>,
	mutation: () => Promise<T>,
): Promise<T> {
	const account = normalizeAccount(context.account)
	const environment = normalizeEnvironment(context.environment)
	const namespace = buildCanonicalWalletNamespace({ account, environment })
	const record = await store.get(namespace)
	if (!record) return mutation()
	if (record.phase !== 'CUTOVER_COMMITTED' || !record.cocoCanonical || record.legacyMonetaryMutationAllowed) {
		throw new MigrationSafetyError('CUTOVER_BLOCKED', 'direct Coco monetary mutation is disabled until cutover is committed')
	}
	return mutation()
}

export async function runBrowserCocoMonetaryMutation<T>(
	context: Pick<RuntimeLegacyMutationContext, 'account' | 'environment'>,
	mutation: () => Promise<T>,
): Promise<T> {
	const environment = normalizeEnvironment(context.environment)
	if (typeof indexedDB === 'undefined') {
		if (environment === 'production' || environment === 'staging') {
			throw new MigrationSafetyError('STORAGE_FAILURE', 'Coco monetary authority cannot be verified because IndexedDB is unavailable')
		}
		return mutation()
	}
	browserControlStore ??= new IndexedDbMigrationControlStore()
	return runCocoMutationAgainstControlStore(browserControlStore, { ...context, environment }, mutation)
}

export function closeBrowserLegacyMutationGate(): void {
	browserControlStore?.close()
	browserControlStore = null
}
