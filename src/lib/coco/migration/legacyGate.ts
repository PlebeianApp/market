import type { LegacyWriterLease, MigrationIdentity } from './model'
import { beginLegacyMonetaryMutation, endLegacyMonetaryMutation, type BeginLegacyMutationInput, type MigrationControlStore } from './store'

export interface LegacyMutationContext extends Omit<BeginLegacyMutationInput, 'identity' | 'expectedRevision'> {
	identity: MigrationIdentity
}

export async function runLegacyMonetaryMutation<T>(
	store: MigrationControlStore,
	context: LegacyMutationContext,
	mutation: () => Promise<T>,
): Promise<T> {
	let lease: Readonly<LegacyWriterLease> | undefined
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await store.get(context.identity.namespace)
		if (!current) throw new Error('migration control record does not exist')
		try {
			lease = await beginLegacyMonetaryMutation(store, {
				...context,
				expectedRevision: current.revision,
			})
			break
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'STALE_REVISION' || attempt === 2) throw error
		}
	}
	if (!lease) throw new Error('failed to acquire legacy monetary writer lease')
	try {
		return await mutation()
	} finally {
		await endLegacyMonetaryMutation(store, context.identity, lease.leaseId)
	}
}
