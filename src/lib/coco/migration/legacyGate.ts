import type { MigrationIdentity } from './model'
import { beginLegacyMonetaryMutation, endLegacyMonetaryMutation, type BeginLegacyMutationInput, type MigrationControlStore } from './store'

export interface LegacyMutationContext extends Omit<BeginLegacyMutationInput, 'identity' | 'expectedRevision'> {
	identity: MigrationIdentity
}

export async function runLegacyMonetaryMutation<T>(
	store: MigrationControlStore,
	context: LegacyMutationContext,
	mutation: () => Promise<T>,
): Promise<T> {
	const current = await store.get(context.identity.namespace)
	if (!current) throw new Error('migration control record does not exist')
	const lease = await beginLegacyMonetaryMutation(store, {
		...context,
		expectedRevision: current.revision,
	})
	try {
		return await mutation()
	} finally {
		await endLegacyMonetaryMutation(store, context.identity, lease.leaseId)
	}
}
